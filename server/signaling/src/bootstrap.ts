import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager } from './RoomManager';
import { SignalingRoomServer } from './SignalingRoomServer';
import {
  createIceServersProvider,
  loadServerConfig,
  type SignalingServerConfig,
} from './serverConfig';
import type { SignalingSocket } from './socket';

/**
 * bootstrap（SG-2）—— ws 传输层接线：node:ws → SignalingSocket 适配 +
 * 周期 sweep。独立于 index.ts（CLI 入口），便于集成测试以 port:0 拉起真实
 * WebSocketServer 全链路验证。
 */

export interface RunningSignalingServer {
  readonly config: SignalingServerConfig;
  readonly wss: WebSocketServer;
  readonly roomServer: SignalingRoomServer;
  readonly manager: RoomManager;
  /** 实际监听端口（port:0 时由 OS 分配） */
  readonly port: number;
  close(): Promise<void>;
}

export function startSignalingServer(
  config: SignalingServerConfig = loadServerConfig(),
  options: { manager?: RoomManager } = {},
): RunningSignalingServer {
  const manager = options.manager ?? new RoomManager({
    now: Date.now,
    waitingTtlMs: config.waitingTtlMs,
    slotGraceMs: config.slotGraceMs,
  });
  const roomServer = new SignalingRoomServer({
    manager,
    provideIceServers: createIceServersProvider(config),
    now: Date.now,
  });

  const wss = new WebSocketServer({ port: config.port });
  const pendingPings = new Map<WebSocket, ReturnType<typeof setTimeout>>();
  const clearPendingPing = (ws: WebSocket): void => {
    const timer = pendingPings.get(ws);
    if (timer !== undefined) clearTimeout(timer);
    pendingPings.delete(ws);
  };
  wss.on('connection', (ws: WebSocket) => {
    const socket = wrapSocket(ws);
    roomServer.handleConnect(socket);
    ws.on('message', (data, isBinary) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (isBinary) {
        console.debug('[SignalingServer] dropped binary frame');
        return;
      }
      roomServer.handleMessage(socket, data.toString());
    });
    ws.on('pong', () => clearPendingPing(ws));
    // terminate/close 都按旧 socket 身份解绑；迟到 close 不影响恢复后的新槽位。
    ws.on('close', () => {
      clearPendingPing(ws);
      roomServer.handleDisconnect(socket);
    });
    ws.on('error', () => {
      /* close 事件随后到达 —— 无需重复处理 */
    });
  });

  // TCP 黑洞不会发 close，ws 也不会自行探活。协议 ping/pong 无需客户端 JS
  // 定时器；默认最坏 15s 清槽，给 20s 的单次 ICE recovery 留出重入时间。
  const heartbeatTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState !== WebSocket.OPEN || pendingPings.has(ws)) continue;
      const timeout = setTimeout(() => {
        pendingPings.delete(ws);
        ws.terminate();
      }, config.heartbeatTimeoutMs);
      timeout.unref();
      pendingPings.set(ws, timeout);
      ws.ping();
    }
  }, config.heartbeatIntervalMs);
  heartbeatTimer.unref();

  const sweepTimer = setInterval(() => {
    roomServer.runSweep();
  }, config.sweepIntervalMs);
  sweepTimer.unref();

  return {
    config,
    wss,
    roomServer,
    manager,
    port: readPort(wss, config.port),
    close: async () => {
      clearInterval(sweepTimer);
      clearInterval(heartbeatTimer);
      for (const timer of pendingPings.values()) clearTimeout(timer);
      pendingPings.clear();
      const closedClients = [...wss.clients].map((client) =>
        new Promise<void>((resolve) => {
          client.once('close', () => resolve());
          client.terminate();
        }),
      );
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      // TCP server 的 close 回调可能先于 WS close；待槽位清理后才完成 shutdown。
      await Promise.all(closedClients);
    },
  };
}

function wrapSocket(ws: WebSocket): SignalingSocket {
  return {
    id: randomUUID(),
    send: (data: string) => {
      ws.send(data);
    },
    close: () => {
      ws.terminate();
    },
  };
}

function readPort(wss: WebSocketServer, requested: number): number {
  const address = wss.address();
  if (typeof address === 'object' && address !== null) {
    return address.port;
  }
  return requested;
}
