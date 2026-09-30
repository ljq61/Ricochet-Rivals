import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { RoomManager } from './RoomManager';
import { SignalingRoomServer } from './SignalingRoomServer';
import { loadServerConfig, type SignalingServerConfig } from './serverConfig';
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
  const manager = options.manager ?? new RoomManager({ now: Date.now });
  const roomServer = new SignalingRoomServer({
    manager,
    iceServers: config.iceServers,
    now: Date.now,
  });

  const wss = new WebSocketServer({ port: config.port });
  wss.on('connection', (ws: WebSocket) => {
    const socket = wrapSocket(ws);
    roomServer.handleConnect(socket);
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        console.debug('[SignalingServer] dropped binary frame');
        return;
      }
      roomServer.handleMessage(socket, data.toString());
    });
    // close/error 只经 disconnect 收口（error 后必随 close；socket 半开由 ws 兜底）
    ws.on('close', () => roomServer.handleDisconnect(socket));
    ws.on('error', () => {
      /* close 事件随后到达 —— 无需重复处理 */
    });
  });

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
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(sweepTimer);
        for (const client of wss.clients) {
          client.close();
        }
        wss.close(() => {
          resolve();
        });
      }),
  };
}

function wrapSocket(ws: WebSocket): SignalingSocket {
  return {
    id: randomUUID(),
    send: (data: string) => {
      ws.send(data);
    },
    close: () => {
      ws.close();
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
