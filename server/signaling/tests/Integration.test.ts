import { afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startSignalingServer, type RunningSignalingServer } from '../src/bootstrap';
import { SIGNALING_PROTOCOL_VERSION } from '../../../src/game/network/signaling/SignalingMessage';
import type { SignalingIceServer } from '../../../src/game/network/signaling/SignalingMessage';

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
  iceServers: [{ urls: 'stun:stun.integration-test' }] as SignalingIceServer[],
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

  static connect(url: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
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
    expect(created['iceServers']).toEqual(config.iceServers);

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
});
