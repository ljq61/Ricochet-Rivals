import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnlineConnectionController } from '../../src/game/network/OnlineConnectionController';
import { OnlineConnectionState } from '../../src/game/network/OnlineConnectionState';
import { OnlineSessionManager } from '../../src/game/network/OnlineSession';
import { WebRTCTransport } from '../../src/game/network/WebRTCTransport';
import { NetworkMessageType } from '../../src/game/network/NetworkMessageType';
import { TransportState } from '../../src/game/network/TransportState';
import { FakeRTCPeerConnection, bridgeChannels, tick } from './webrtcFakes';

/**
 * OnlineConnectionController（Phase 13 验收 7–15）：
 * 真实 WebRTCTransport + fake RTC 双 PC 互联 —— 一个 Controller 只扮演
 * 一个角色（Host 侧 / Guest 侧各一个 rig），全链路：
 * offer → guest accept → answer → host accept → 双通道 open →
 * PING/PONG（bridge 自动回声）→ VERIFIED。
 */

interface TestRig {
  controller: OnlineConnectionController;
  pc: FakeRTCPeerConnection;
  states: OnlineConnectionState[];
  failures: string[];
  factoryRoles: Array<'host' | 'guest'>;
}

function makeRig(): TestRig {
  const pc = new FakeRTCPeerConnection();
  const factoryRoles: Array<'host' | 'guest'> = [];
  const controller = new OnlineConnectionController({
    matchId: 'match-online-test',
    createTransport: (r) => {
      factoryRoles.push(r);
      return new WebRTCTransport({
        role: r,
        peerConnectionFactory: () => pc as unknown as RTCPeerConnection,
      });
    },
  });
  const states: OnlineConnectionState[] = [];
  const failures: string[] = [];
  controller.onStateChange((state) => states.push(state));
  controller.onFailure((message) => failures.push(message));
  return { controller, pc, states, failures, factoryRoles };
}

/** Host 侧生成 Offer Code(fake ICE 需手动完成 gathering) */
async function hostCreateOffer(host: TestRig): Promise<string> {
  const pending = host.controller.createHostSession();
  await tick();
  host.pc.completeIceGathering();
  const { connectionCode } = await pending;
  return connectionCode;
}

/** Guest 侧粘贴 Offer → Response Code */
async function guestCreateAnswer(guest: TestRig, offerCode: string): Promise<string> {
  const pending = guest.controller.submitOfferCode(offerCode);
  await tick();
  guest.pc.completeIceGathering();
  const { responseCode } = await pending;
  return responseCode;
}

/** Host 侧应用 Answer → 双通道 open + 桥接 → 双方 VERIFIED */
async function hostAcceptAndOpen(
  host: TestRig,
  guest: TestRig,
  responseCode: string
): Promise<void> {
  const acceptPending = host.controller.submitAnswerCode(responseCode);
  const hostChannel = host.pc.dataChannels[0];
  const guestChannel = guest.pc.dataChannels[0];
  if (!hostChannel || !guestChannel) {
    throw new Error('fake channels missing');
  }
  bridgeChannels(hostChannel, guestChannel);
  hostChannel.simulateOpen();
  guestChannel.simulateOpen();
  await acceptPending;
  await tick(); // PING → PONG → VERIFIED
}

/** 完整手动配对（双向 VERIFIED） */
async function performFullHandshake(
  host: TestRig,
  guest: TestRig
): Promise<{ hostCode: string; responseCode: string }> {
  const hostCode = await hostCreateOffer(host);
  const responseCode = await guestCreateAnswer(guest, hostCode);
  await hostAcceptAndOpen(host, guest, responseCode);
  return { hostCode, responseCode };
}

function makePair(): { host: TestRig; guest: TestRig } {
  return { host: makeRig(), guest: makeRig() };
}

describe('OnlineConnectionController', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('7. Host 全链：状态序列 + PING/PONG wire 帧 → VERIFIED + session(Host=P1)', async () => {
    const { host, guest } = makePair();
    const sessionManager = new OnlineSessionManager();
    host.controller.onSession((session) => sessionManager.store(session));

    const { hostCode, responseCode } = await performFullHandshake(host, guest);
    expect(hostCode.startsWith('RR1-OFFER-')).toBe(true);
    expect(responseCode.startsWith('RR1-ANSWER-')).toBe(true);

    expect(host.controller.currentState).toBe(OnlineConnectionState.VERIFIED);
    for (const expected of [
      OnlineConnectionState.HOST_CREATING_OFFER,
      OnlineConnectionState.HOST_WAITING_FOR_ANSWER,
      OnlineConnectionState.HOST_APPLYING_ANSWER,
      OnlineConnectionState.CONNECTING,
      OnlineConnectionState.CONNECTED,
      OnlineConnectionState.VERIFIED,
    ]) {
      expect(host.states).toContain(expected);
    }

    // PING/PONG 真实经过 wire
    const wireTypes = [
      ...(host.pc.dataChannels[0]?.sent ?? []),
      ...(guest.pc.dataChannels[0]?.sent ?? []),
    ]
      .map((raw) => JSON.parse(raw) as { type: NetworkMessageType })
      .map((frame) => frame.type);
    expect(wireTypes).toContain(NetworkMessageType.PING);
    expect(wireTypes).toContain(NetworkMessageType.PONG);

    const session = sessionManager.current;
    expect(session?.role).toBe('host');
    expect(session?.localPlayerId).toBe('P1');
    expect(session?.remotePlayerId).toBe('P2');
    expect(session?.transport.state).toBe(TransportState.CONNECTED);
  });

  it('8. Guest 全链：lazy start + 状态序列 + VERIFIED（Guest=P2）', async () => {
    const { host, guest } = makePair();
    const guestSessionManager = new OnlineSessionManager();
    guest.controller.onSession((session) => guestSessionManager.store(session));

    // Guest 不显式 startGuestSession —— 直接粘贴 Offer（lazy start）
    const hostCode = await hostCreateOffer(host);
    const responseCode = await guestCreateAnswer(guest, hostCode);
    await hostAcceptAndOpen(host, guest, responseCode);

    expect(guest.controller.currentState).toBe(OnlineConnectionState.VERIFIED);
    for (const expected of [
      OnlineConnectionState.GUEST_WAITING_FOR_OFFER,
      OnlineConnectionState.GUEST_CREATING_ANSWER,
      OnlineConnectionState.GUEST_WAITING_FOR_HOST,
      OnlineConnectionState.CONNECTING,
      OnlineConnectionState.CONNECTED,
      OnlineConnectionState.VERIFIED,
    ]) {
      expect(guest.states).toContain(expected);
    }
    expect(guestSessionManager.current?.localPlayerId).toBe('P2');
    expect(guestSessionManager.current?.remotePlayerId).toBe('P1');
    expect(host.controller.currentState).toBe(OnlineConnectionState.VERIFIED);
  });

  it('9. Retry：彻底销毁旧会话重建（旧 pc closed、factory 二次调用、回 CHOOSE_ROLE）', async () => {
    const rig = makeRig();
    await hostCreateOffer(rig);
    expect(rig.factoryRoles.filter((r) => r === 'host').length).toBe(1);

    rig.controller.retry();
    expect(rig.controller.currentState).toBe(OnlineConnectionState.CHOOSE_ROLE);
    expect(rig.pc.closed).toBe(true);

    await hostCreateOffer(rig); // 新 transport + 新 fake PC 会话
    expect(rig.factoryRoles.filter((r) => r === 'host').length).toBe(2);
  });

  it('10. Back：彻底释放（pc closed、状态 CLOSED、幂等）', async () => {
    const rig = makeRig();
    await hostCreateOffer(rig);

    rig.controller.back();
    expect(rig.controller.currentState).toBe(OnlineConnectionState.CLOSED);
    expect(rig.pc.closed).toBe(true);

    rig.controller.back(); // 幂等
    expect(rig.controller.currentState).toBe(OnlineConnectionState.CLOSED);
  });

  it('11. Timeout：通道永不 open → FAILED + Connection timed out（不重复失败）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { host, guest } = makePair();

    const offerPending = host.controller.createHostSession();
    await vi.advanceTimersByTimeAsync(1);
    host.pc.completeIceGathering();
    const { connectionCode } = await offerPending;

    const answerPending = guest.controller.submitOfferCode(connectionCode);
    await vi.advanceTimersByTimeAsync(1);
    guest.pc.completeIceGathering();
    const { responseCode } = await answerPending;

    void host.controller.submitAnswerCode(responseCode); // CONNECTING；通道不 open
    await vi.advanceTimersByTimeAsync(20_000);

    expect(host.controller.currentState).toBe(OnlineConnectionState.FAILED);
    expect(host.failures).toContain('Connection timed out');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(host.failures.filter((m) => m === 'Connection timed out').length).toBe(1);
  });

  it('12. 重复 submitAnswerCode：setRemoteDescription 只执行一次（防 race）', async () => {
    const { host, guest } = makePair();
    const hostCode = await hostCreateOffer(host);
    const responseCode = await guestCreateAnswer(guest, hostCode);

    const spy = vi.spyOn(host.pc, 'setRemoteDescription');
    void host.controller.submitAnswerCode(responseCode);
    await host.controller.submitAnswerCode(responseCode); // 已离开 WAITING → 静默忽略
    await host.controller.submitAnswerCode(responseCode);
    await tick();
    expect(spy.mock.calls.length).toBe(1);
  });

  it('13. 无 PONG：验证窗口超时 → FAILED（verification failed）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { host, guest } = makePair();

    const offerPending = host.controller.createHostSession();
    await vi.advanceTimersByTimeAsync(1);
    host.pc.completeIceGathering();
    const { connectionCode } = await offerPending;

    const answerPending = guest.controller.submitOfferCode(connectionCode);
    await vi.advanceTimersByTimeAsync(1);
    guest.pc.completeIceGathering();
    const { responseCode } = await answerPending;

    void host.controller.submitAnswerCode(responseCode);
    const hostChannel = host.pc.dataChannels[0];
    const guestChannel = guest.pc.dataChannels[0];
    if (!hostChannel || !guestChannel) throw new Error('channels missing');
    // 单向桥：Guest 收到 PING 但不回 PONG（模拟对端异常）
    bridgeChannels(hostChannel, guestChannel, { guestToHost: false });
    hostChannel.simulateOpen();
    guestChannel.simulateOpen();
    await vi.advanceTimersByTimeAsync(1);

    expect(host.controller.currentState).toBe(OnlineConnectionState.CONNECTED);
    await vi.advanceTimersByTimeAsync(10_000); // 验证窗口耗尽
    expect(host.controller.currentState).toBe(OnlineConnectionState.FAILED);
    expect(host.failures).toContain('Connection unstable — verification failed');
  });

  it('14. OnlineSessionManager：store/current/disposeSession（幂等 + 覆盖防泄漏）', async () => {
    const manager = new OnlineSessionManager();
    expect(manager.current).toBeNull();

    const { host, guest } = makePair();
    host.controller.onSession((session) => manager.store(session));
    await performFullHandshake(host, guest);

    expect(manager.current).not.toBeNull();
    expect(manager.current?.role).toBe('host');
    expect(manager.current?.transport.state).toBe(TransportState.CONNECTED);

    const first = manager.current;
    manager.disposeSession();
    expect(manager.current).toBeNull();
    expect(first?.transport.state).toBe(TransportState.CLOSED);
    manager.disposeSession(); // 幂等

    // 覆盖 store：旧会话彻底销毁（防泄漏旧连接）
    const pair2 = makePair();
    pair2.host.controller.onSession((second) => manager.store(second));
    await performFullHandshake(pair2.host, pair2.guest);
    expect(manager.current?.role).toBe('host');
    expect(first?.transport.state).toBe(TransportState.CLOSED); // 旧连接不复活
  });

  it('15. disposeSession 关闭 Transport（验收 15 独立断言）', async () => {
    const { host, guest } = makePair();
    const manager = new OnlineSessionManager();
    host.controller.onSession((session) => manager.store(session));
    await performFullHandshake(host, guest);

    const session = manager.current;
    expect(session).not.toBeNull();
    manager.disposeSession();
    expect(manager.current).toBeNull();
    expect(session?.transport.state).toBe(TransportState.CLOSED);
  });

  it('16. VERIFIED 幂等：后续 PONG 不再重建 session（reviewer issue-2 回归守护）', async () => {
    const { host, guest } = makePair();
    const manager = new OnlineSessionManager();
    let sessionCalls = 0;
    host.controller.onSession((session) => {
      sessionCalls += 1;
      manager.store(session);
    });
    await performFullHandshake(host, guest);
    expect(sessionCalls).toBe(1);
    expect(host.controller.currentState).toBe(OnlineConnectionState.VERIFIED);

    // VERIFIED 后再次 ping → 对端自动回 PONG → handleVerified 必须幂等早退
    const session = manager.current;
    session?.networkManager.ping();
    await tick();
    expect(host.controller.currentState).toBe(OnlineConnectionState.VERIFIED);
    expect(sessionCalls).toBe(1); // 不产生第二个 session
    expect(session?.transport.state).toBe(TransportState.CONNECTED); // 旧连接未被 dispose
  });
});
