import { once } from 'node:events';
import { afterAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { startSignalingServer, type RunningSignalingServer } from '../src/bootstrap';
import { loadServerConfig } from '../src/serverConfig';
import { SIGNALING_PROTOCOL_VERSION } from '../../../src/game/network/signaling/SignalingMessage';

/**
 * 集成测试（SG-2）—— 真实 node:ws 全链路：ws 适配 → decode → 分发 → relay。
 * port:0 起 Server，双 WebSocket 客户端驱动 create → join → 协商 relay →
 * PEER_LEFT happy path（单测矩阵外的传输层粘合验证）。
 */

const config = {
  port: 0,
  waitingTtlMs: 600_000,
  slotGraceMs: 30_000,
  sweepIntervalMs: 15_000,
  heartbeatIntervalMs: 5_000,
  heartbeatTimeoutMs: 10_000,
  stunUrls: ['stun:stun.integration-test'],
  turnUrls: [],
  turnSharedSecret: null,
  turnCredentialTtlMs: 30 * 60_000,
};

const running: RunningSignalingServer = startSignalingServer(config);
const url = `ws://127.0.0.1:${running.port}`;

afterAll(async () => {
  await running.close();
});

interface WireFrame {
  [key: string]: unknown;
}

class TestClient {
  readonly ws: WebSocket;
  private readonly frames: WireFrame[] = [];
  private readonly waiters: Array<{ type: string; resolve: (frame: WireFrame) => void; timer: ReturnType<typeof setTimeout> }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as WireFrame;
      const index = this.waiters.findIndex((w) => w.type === frame['type']);
      const waiter = this.waiters[index];
      if (index >= 0 && waiter) {
        clearTimeout(waiter.timer);
        this.waiters.splice(index, 1);
        waiter.resolve(frame);
        return;
      }
      this.frames.push(frame);
    });
  }

  static connect(url: string, options: WebSocket.ClientOptions = {}): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, options);
      ws.once('open', () => {
        resolve(new TestClient(ws));
      });
      ws.once('error', (error) => {
        reject(error);
      });
    });
  }

  send(payload: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ v: SIGNALING_PROTOCOL_VERSION, ...payload }));
  }

  /** 等待指定类型帧（先扫已缓存队列）；超时 reject */
  async expectMessage(type: string, timeoutMs = 3_000): Promise<WireFrame> {
    const index = this.frames.findIndex((f) => f['type'] === type);
    if (index >= 0) {
      const frame = this.frames[index];
      if (frame !== undefined) {
        this.frames.splice(index, 1);
        return frame;
      }
    }
    return new Promise<WireFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.type === type);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`expectMessage('${type}') timed out after ${timeoutMs}ms; buffered=[${this.frames.map((f) => f['type']).join(',')}]`));
      }, timeoutMs);
      this.waiters.push({ type, resolve, timer });
    });
  }

  close(): void {
    this.ws.close();
  }
}

describe('Signaling Server 集成（真实 ws）', () => {
  it('create → join → 协商 relay 四类帧 → PEER_LEFT 全链路', async () => {
    const host = await TestClient.connect(url);
    host.send({ type: 'CREATE_ROOM' });
    const created = await host.expectMessage('ROOM_CREATED');
    const roomCode = created['roomCode'];
    const hostToken = created['peerToken'];
    expect(typeof roomCode).toBe('string');
    expect(typeof hostToken).toBe('string');
    expect(created['iceServers']).toEqual([{ urls: 'stun:stun.integration-test' }]);

    const guest = await TestClient.connect(url);
    guest.send({ type: 'JOIN_ROOM', roomCode });
    const joined = await guest.expectMessage('ROOM_JOINED');
    expect(joined['roomCode']).toBe(roomCode);
    const guestToken = joined['peerToken'];
    expect(typeof guestToken).toBe('string');
    expect(hostToken).not.toBe(guestToken);
    await host.expectMessage('PEER_JOINED');

    // 协商 relay：四类帧双向
    host.send({ type: 'OFFER', sdp: 'integration-offer-sdp' });
    const offer = await guest.expectMessage('OFFER');
    expect(offer['sdp']).toBe('integration-offer-sdp');

    guest.send({ type: 'ANSWER', sdp: 'integration-answer-sdp' });
    const answer = await host.expectMessage('ANSWER');
    expect(answer['sdp']).toBe('integration-answer-sdp');

    host.send({ type: 'ICE_CANDIDATE', candidate: { candidate: 'candidate:1 1 UDP 1 192.168.1.4 54321 typ host', sdpMid: '0' } });
    const candidate = await guest.expectMessage('ICE_CANDIDATE');
    expect((candidate['candidate'] as { candidate?: string }).candidate).toContain('typ host');

    host.send({ type: 'ICE_END' });
    await guest.expectMessage('ICE_END');

    // 断开：guest close → host PEER_LEFT
    guest.close();
    await host.expectMessage('PEER_LEFT');
  });

  it('错误路径：join 不存在房间 → ERROR ROOM_NOT_FOUND（真实传输回环）', async () => {
    const client = await TestClient.connect(url);
    client.send({ type: 'JOIN_ROOM', roomCode: 'ZZZZZ9' });
    const error = await client.expectMessage('ERROR');
    expect(error['code']).toBe('ROOM_NOT_FOUND');
    client.close();
  });

  it('bootstrap 透传配置：ROOM ack TTL 与 Host grace 都使用环境变量', async () => {
    const customConfig = loadServerConfig({
      PORT: '0', SIGNALING_WAITING_TTL_MS: '873', SIGNALING_SLOT_GRACE_MS: '70',
      SIGNALING_SWEEP_INTERVAL_MS: '2000',
    });
    const local = startSignalingServer(customConfig);
    const localUrl = `ws://127.0.0.1:${local.port}`;
    try {
      const host = await TestClient.connect(localUrl);
      host.send({ type: 'CREATE_ROOM' });
      const created = await host.expectMessage('ROOM_CREATED');
      const room = local.manager.findRoom(String(created['roomCode']));
      expect(Number(created['expiresAt']) - Number(room?.createdAt)).toBe(873);
      const guest = await TestClient.connect(localUrl);
      guest.send({ type: 'JOIN_ROOM', roomCode: created['roomCode'] });
      await guest.expectMessage('ROOM_JOINED');
      await host.expectMessage('PEER_JOINED');
      host.close();
      await guest.expectMessage('PEER_LEFT');
      await new Promise((resolve) => setTimeout(resolve, 90));
      const hostBack = await TestClient.connect(localUrl);
      hostBack.send({ type: 'JOIN_ROOM', roomCode: created['roomCode'], peerToken: created['peerToken'] });
      expect(await hostBack.expectMessage('ERROR')).toMatchObject({ code: 'ROOM_EXPIRED', message: 'host left' });
      expect(await guest.expectMessage('ERROR')).toMatchObject({ code: 'ROOM_EXPIRED', message: 'host left' });
      expect(local.roomServer.boundSocketCount).toBe(0);
    } finally {
      await local.close();
    }
  });

  it.each(['host', 'guest'] as const)('真实 WS %s 黑洞无 FIN：有效 token 在 heartbeat 前立即接管', async (role) => {
    const local = startSignalingServer({ ...config, heartbeatIntervalMs: 1000 });
    const localUrl = `ws://127.0.0.1:${local.port}`;
    let old: TestClient | undefined;
    try {
      const host = await TestClient.connect(localUrl);
      host.send({ type: 'CREATE_ROOM' });
      const created = await host.expectMessage('ROOM_CREATED');
      const guest = await TestClient.connect(localUrl);
      guest.send({ type: 'JOIN_ROOM', roomCode: created['roomCode'] });
      const joined = await guest.expectMessage('ROOM_JOINED');
      await host.expectMessage('PEER_JOINED');
      old = role === 'host' ? host : guest;
      const peer = role === 'host' ? guest : host;
      old.ws.pause(); // 无 FIN；浏览器/网络静默挂起的传输模型
      expect(old.ws.readyState).toBe(WebSocket.OPEN);
      expect(local.wss.clients.size).toBe(2);
      const oldClosed = once(old.ws, 'close');
      const replacement = await TestClient.connect(localUrl);
      const peerToken = role === 'host' ? created['peerToken'] : joined['peerToken'];
      replacement.send({ type: 'JOIN_ROOM', roomCode: created['roomCode'], peerToken });
      expect(await replacement.expectMessage('ROOM_JOINED')).toMatchObject({ peerToken });
      await peer.expectMessage('PEER_JOINED');
      old.ws.resume();
      await oldClosed;
      expect(local.roomServer.boundSocketCount).toBe(2);
      replacement.send({ type: 'ICE_END' });
      await peer.expectMessage('ICE_END');
      expect(peer.ws.readyState).toBe(WebSocket.OPEN);
    } finally {
      old?.ws.terminate();
      await local.close();
    }
  });

  it('heartbeat：无 FIN 且无法回应 pong 的旧 Guest 自动释放，原 token 仍可恢复', async () => {
    const local = startSignalingServer({ ...config, heartbeatIntervalMs: 25, heartbeatTimeoutMs: 80 });
    const localUrl = `ws://127.0.0.1:${local.port}`;
    let guest: TestClient | undefined;
    try {
      const host = await TestClient.connect(localUrl);
      host.send({ type: 'CREATE_ROOM' });
      const created = await host.expectMessage('ROOM_CREATED');
      guest = await TestClient.connect(localUrl);
      guest.send({ type: 'JOIN_ROOM', roomCode: created['roomCode'] });
      const joined = await guest.expectMessage('ROOM_JOINED');
      await host.expectMessage('PEER_JOINED');
      guest.ws.pause();
      expect(guest.ws.readyState).toBe(WebSocket.OPEN);
      await host.expectMessage('PEER_LEFT');
      const room = local.manager.findRoom(String(created['roomCode']));
      expect(room?.guestConnected).toBe(false);
      expect(local.roomServer.boundSocketCount).toBe(1);
      const replacement = await TestClient.connect(localUrl);
      replacement.send({ type: 'JOIN_ROOM', roomCode: created['roomCode'], peerToken: joined['peerToken'] });
      expect(await replacement.expectMessage('ROOM_JOINED')).toMatchObject({ peerToken: joined['peerToken'] });
      await host.expectMessage('PEER_JOINED');
      // 正常客户端自动 pong，跨过多个 heartbeat 周期仍保留双槽。
      await new Promise((resolve) => setTimeout(resolve, 140));
      expect(local.roomServer.boundSocketCount).toBe(2);
      replacement.send({ type: 'OFFER', sdp: 'recovered' });
      expect(await host.expectMessage('OFFER')).toMatchObject({ sdp: 'recovered' });
    } finally {
      guest?.ws.terminate();
      await local.close();
    }
  });

  it('shutdown 清理 sweep/heartbeat/pong timeout，黑洞 socket 不等 close 握手', async () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const local = startSignalingServer({ ...config, heartbeatIntervalMs: 30, heartbeatTimeoutMs: 1000 });
    const intervalHandles = intervalSpy.mock.results.map((result) => result.value);
    let client: TestClient | undefined;
    try {
      client = await TestClient.connect(`ws://127.0.0.1:${local.port}`, { autoPong: false });
      await once(client.ws, 'ping');
      const heartbeatTimeoutIndex = timeoutSpy.mock.calls.findIndex((call) => call[1] === 1000);
      expect(heartbeatTimeoutIndex).toBeGreaterThanOrEqual(0);
      const heartbeatTimeout = timeoutSpy.mock.results[heartbeatTimeoutIndex]?.value;
      client.ws.pause();
      const started = Date.now();
      await local.close();
      expect(Date.now() - started).toBeLessThan(1000);
      expect(local.wss.clients.size).toBe(0);
      for (const handle of intervalHandles) expect(clearIntervalSpy).toHaveBeenCalledWith(handle);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(heartbeatTimeout);
    } finally {
      client?.ws.terminate();
      if (local.wss.clients.size > 0) await local.close();
      vi.restoreAllMocks();
    }
  });
});
