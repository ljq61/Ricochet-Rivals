import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkEnvelope } from '../../src/game/network/NetworkEnvelope';
import { createLoopbackPair } from '../../src/game/network/LocalLoopbackTransport';
import { NetworkMessageType } from '../../src/game/network/NetworkMessageType';
import { NetworkProtocolError } from '../../src/game/network/NetworkProtocol';
import { TransportError, type NetworkTransport } from '../../src/game/network/NetworkTransport';
import { TransportState } from '../../src/game/network/TransportState';
import { makeEnvelope } from './envelopeFixture';

/** 捕获 send 预期抛出的 TransportError 并断言 reason（不依赖 toThrow 匹配器能力） */
function captureSendError(transport: NetworkTransport, message: NetworkEnvelope): TransportError {
  let caught: unknown;
  try {
    transport.send(message);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(TransportError);
  return caught as TransportError;
}

describe('LocalLoopbackTransport', () => {
  describe('fake timers（延迟与时序）', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('初始状态：两端 IDLE、未连接、不可 send', () => {
      const { a, b } = createLoopbackPair();

      expect(a.state).toBe(TransportState.IDLE);
      expect(b.state).toBe(TransportState.IDLE);
      expect(a.connected).toBe(false);
      expect(b.connected).toBe(false);
      expect(() => a.send(makeEnvelope())).toThrow(TransportError);
    });

    it('connect：发起端 CONNECTING → CONNECTED，对端直接 CONNECTED（模拟 onopen）', async () => {
      const { a, b } = createLoopbackPair();
      const aStates: TransportState[] = [];
      const bStates: TransportState[] = [];
      a.onStateChange((s) => aStates.push(s));
      b.onStateChange((s) => bStates.push(s));

      await a.connect();

      expect(a.state).toBe(TransportState.CONNECTED);
      expect(b.state).toBe(TransportState.CONNECTED);
      expect(a.connected).toBe(true);
      expect(aStates).toEqual([TransportState.CONNECTING, TransportState.CONNECTED]);
      expect(bStates).toEqual([TransportState.CONNECTED]);
    });

    it('connect 幂等：已连接重复 connect 直接 resolve，不重复迁移', async () => {
      const { a, b } = createLoopbackPair();
      const aStates: TransportState[] = [];
      a.onStateChange((s) => aStates.push(s));

      await a.connect();
      await a.connect();
      await b.connect();

      expect(a.state).toBe(TransportState.CONNECTED);
      expect(aStates).toEqual([TransportState.CONNECTING, TransportState.CONNECTED]);
    });

    it('双向通信（默认 0ms 仍为异步投递）', async () => {
      const { a, b } = createLoopbackPair();
      await a.connect();
      const aReceived: NetworkEnvelope[] = [];
      const bReceived: NetworkEnvelope[] = [];
      a.onMessage((m) => aReceived.push(m));
      b.onMessage((m) => bReceived.push(m));

      a.send(makeEnvelope({ senderId: 'P1', sequence: 0 }));
      b.send(makeEnvelope({ senderId: 'P2', sequence: 0, type: NetworkMessageType.PONG }));

      vi.advanceTimersByTime(0);

      expect(bReceived).toHaveLength(1);
      expect(aReceived).toHaveLength(1);
      const fromP1 = bReceived[0];
      if (!fromP1) throw new Error('a → b delivery missing');
      expect(fromP1).toEqual(makeEnvelope({ senderId: 'P1', sequence: 0 }));
      const fromP2 = aReceived[0];
      if (!fromP2) throw new Error('b → a delivery missing');
      expect(fromP2).toEqual(
        makeEnvelope({ senderId: 'P2', sequence: 0, type: NetworkMessageType.PONG }),
      );
    });

    it('latencyMs > 0：延迟到期前不投递、到期后投递（fake timers）', async () => {
      const { a, b } = createLoopbackPair({ latencyMs: 100 });
      await a.connect();
      const bReceived: NetworkEnvelope[] = [];
      b.onMessage((m) => bReceived.push(m));

      a.send(makeEnvelope());
      vi.advanceTimersByTime(50);
      expect(bReceived).toHaveLength(0);

      vi.advanceTimersByTime(50);
      expect(bReceived).toHaveLength(1);
    });

    it('投递物是 JSON 副本：深等价但非同引用（与真实 wire 同构）', async () => {
      const { a, b } = createLoopbackPair();
      await a.connect();
      const bReceived: NetworkEnvelope[] = [];
      b.onMessage((m) => bReceived.push(m));

      const sent = makeEnvelope({ payload: { hp: 3 } });
      a.send(sent);
      vi.advanceTimersByTime(0);

      const got = bReceived[0];
      if (!got) throw new Error('delivery missing');
      expect(got).toEqual(sent);
      expect(got).not.toBe(sent);
      expect(got.payload).not.toBe(sent.payload);
    });

    it('多消息按发送顺序投递', async () => {
      const { a, b } = createLoopbackPair();
      await a.connect();
      const sequences: number[] = [];
      b.onMessage((m) => sequences.push(m.sequence));

      a.send(makeEnvelope({ sequence: 0 }));
      a.send(makeEnvelope({ sequence: 1 }));
      a.send(makeEnvelope({ sequence: 2 }));
      vi.advanceTimersByTime(0);

      expect(sequences).toEqual([0, 1, 2]);
    });

    it('send 非法 envelope：同步抛 NetworkProtocolError，不上线不投递', async () => {
      const { a, b } = createLoopbackPair();
      await a.connect();
      const bReceived: NetworkEnvelope[] = [];
      b.onMessage((m) => bReceived.push(m));

      // 故意非法的 envelope：测试专用双重断言越过类型防线（生产代码禁止此写法）
      const bad = { ...makeEnvelope(), version: 2 } as unknown as NetworkEnvelope;
      expect(() => a.send(bad)).toThrow(NetworkProtocolError);

      a.send(makeEnvelope());
      vi.advanceTimersByTime(0);
      expect(bReceived).toHaveLength(1);
    });

    it('close 后 send 防护：本端 CLOSED → TRANSPORT_CLOSED；对端 DISCONNECTED → NOT_CONNECTED', async () => {
      const { a, b } = createLoopbackPair();
      await a.connect();
      a.close();

      const aError = captureSendError(a, makeEnvelope());
      expect(aError.reason).toBe('TRANSPORT_CLOSED');
      expect(aError.message).toContain('CLOSED');

      const bError = captureSendError(b, makeEnvelope());
      expect(bError.reason).toBe('NOT_CONNECTED');
      expect(bError.message).toContain('DISCONNECTED');
    });

    it('一侧 close → 对端 DISCONNECTED + onDisconnect(原因)（成对联动）', async () => {
      const { a, b } = createLoopbackPair();
      const disconnectReasons: (string | undefined)[] = [];
      const bStates: TransportState[] = [];
      b.onDisconnect((reason) => disconnectReasons.push(reason));
      b.onStateChange((s) => bStates.push(s));

      await a.connect();
      a.close();

      expect(a.state).toBe(TransportState.CLOSED);
      expect(b.state).toBe(TransportState.DISCONNECTED);
      expect(b.connected).toBe(false);
      expect(disconnectReasons).toEqual(['PEER_CLOSED']);
      expect(bStates).toEqual([TransportState.CONNECTED, TransportState.DISCONNECTED]);
    });

    it('close 幂等：重复 close 不产生第二次对端事件', async () => {
      const { a, b } = createLoopbackPair();
      await a.connect();
      let disconnectCount = 0;
      b.onDisconnect(() => disconnectCount++);

      a.close();
      a.close();

      expect(a.state).toBe(TransportState.CLOSED);
      expect(disconnectCount).toBe(1);
    });

    it('从未连接时 close：对端同样收到 DISCONNECTED（统一规则：close 杀死整对）', () => {
      const { a, b } = createLoopbackPair();
      const disconnectReasons: (string | undefined)[] = [];
      b.onDisconnect((reason) => disconnectReasons.push(reason));

      a.close();

      expect(a.state).toBe(TransportState.CLOSED);
      expect(b.state).toBe(TransportState.DISCONNECTED);
      expect(disconnectReasons).toEqual(['PEER_CLOSED']);
    });

    it('在途消息随 close 丢弃（发送端 close）', async () => {
      const { a, b } = createLoopbackPair({ latencyMs: 100 });
      await a.connect();
      const bReceived: NetworkEnvelope[] = [];
      b.onMessage((m) => bReceived.push(m));

      a.send(makeEnvelope());
      a.close();
      vi.advanceTimersByTime(300);

      expect(bReceived).toHaveLength(0);
      expect(b.state).toBe(TransportState.DISCONNECTED);
    });

    it('在途消息随对端 close 丢弃（接收端 close）', async () => {
      const { a, b } = createLoopbackPair({ latencyMs: 100 });
      await a.connect();
      const bReceived: NetworkEnvelope[] = [];
      b.onMessage((m) => bReceived.push(m));

      a.send(makeEnvelope());
      b.close();
      vi.advanceTimersByTime(300);

      expect(bReceived).toHaveLength(0);
      expect(a.state).toBe(TransportState.DISCONNECTED);
      expect(() => a.send(makeEnvelope())).toThrow(TransportError);
    });

    it('终态 connect 拒绝：TRANSPORT_CLOSED（重连需新建 transport）', async () => {
      const { a, b } = createLoopbackPair();
      await a.connect();
      a.close();

      const aError = await a.connect().then(
        () => null,
        (e: unknown) => e,
      );
      expect(aError).toBeInstanceOf(TransportError);
      expect((aError as TransportError).reason).toBe('TRANSPORT_CLOSED');

      const bError = await b.connect().then(
        () => null,
        (e: unknown) => e,
      );
      expect(bError).toBeInstanceOf(TransportError);
      expect((bError as TransportError).reason).toBe('TRANSPORT_CLOSED');
    });

    it('unsubscribe：onMessage 取消函数只移除自身订阅', async () => {
      const { a, b } = createLoopbackPair();
      await a.connect();
      let h1Count = 0;
      let h2Count = 0;
      const off1 = b.onMessage(() => {
        h1Count++;
      });
      b.onMessage(() => {
        h2Count++;
      });

      a.send(makeEnvelope({ sequence: 0 }));
      vi.advanceTimersByTime(0);
      expect(h1Count).toBe(1);
      expect(h2Count).toBe(1);

      off1();
      a.send(makeEnvelope({ sequence: 1 }));
      vi.advanceTimersByTime(0);
      expect(h1Count).toBe(1);
      expect(h2Count).toBe(2);
    });

    it('unsubscribe：onStateChange / onDisconnect 取消函数有效', async () => {
      const { a, b } = createLoopbackPair();
      const bStates: TransportState[] = [];
      let disconnectCount = 0;
      const offState = b.onStateChange((s) => bStates.push(s));
      const offDisconnect = b.onDisconnect(() => disconnectCount++);

      offState();
      offDisconnect();
      await a.connect();
      a.close();

      expect(bStates).toHaveLength(0);
      expect(disconnectCount).toBe(0);
      expect(b.state).toBe(TransportState.DISCONNECTED); // 状态本身照常迁移
    });

    it('handler 异常向上传播且不被吞（后续 handler 停止执行，同 Node EventEmitter 语义）', async () => {
      const { a, b } = createLoopbackPair();
      await a.connect();
      const after: NetworkEnvelope[] = [];
      b.onMessage(() => {
        throw new Error('handler boom');
      });
      b.onMessage((m) => after.push(m));

      a.send(makeEnvelope());
      expect(() => vi.advanceTimersByTime(0)).toThrow('handler boom');
      expect(after).toHaveLength(0);
    });

    it('非法 latencyMs 配置：立刻抛错（不静默钳制）', () => {
      expect(() => createLoopbackPair({ latencyMs: -5 })).toThrow();
      expect(() => createLoopbackPair({ latencyMs: Number.NaN })).toThrow();
      expect(() => createLoopbackPair({ latencyMs: Number.POSITIVE_INFINITY })).toThrow();
    });
  });

  describe('真实定时器', () => {
    it('真实 setTimeout 下默认 0ms 仍为异步投递（防 fake-timer 幻觉）', async () => {
      const { a, b }: { a: NetworkTransport; b: NetworkTransport } = createLoopbackPair();
      await a.connect();
      const bReceived: NetworkEnvelope[] = [];
      b.onMessage((m) => bReceived.push(m));

      a.send(makeEnvelope());
      expect(bReceived).toHaveLength(0); // 同步点不投递

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(bReceived).toHaveLength(1);
    });
  });
});
