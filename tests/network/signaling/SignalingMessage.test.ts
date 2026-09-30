import { describe, expect, it } from 'vitest';
import {
  decodeSignalingMessage,
  encodeSignalingMessage,
  isSignalingErrorCode,
  SIGNALING_ERROR_CODES,
  SIGNALING_PROTOCOL_VERSION,
  type SignalingInboundMessage,
} from '../../../src/game/network/signaling/SignalingMessage';

/**
 * SignalingMessage（SG-1）—— 信令协议编解码契约。
 * * wire：{ v: 1, type, ...payload } JSON 文本帧。
 * * decode 是 Untrusted Input 防线：全部 Result 双轨，永不 throw。
 * * 结构化 ICE 类型对 DOM 同名类型可赋值（编译期断言，见 4）。
 */

const ICE_SERVERS = [
  { urls: 'stun:stun.example.com:3478' },
  {
    urls: ['turn:turn.example.com:3478?transport=udp', 'turn:turn.example.com:3478?transport=tcp'],
    username: '1234567890:user',
    credential: 'temporary-secret',
  },
];

function frame(payload: Record<string, unknown>): string {
  return JSON.stringify({ v: SIGNALING_PROTOCOL_VERSION, ...payload });
}

describe('SignalingMessage', () => {
  it('1. 出站帧携带 v:1 与 type（全 6 类型）', () => {
    const frames = [
      JSON.parse(encodeSignalingMessage({ type: 'CREATE_ROOM' })) as Record<string, unknown>,
      JSON.parse(encodeSignalingMessage({ type: 'JOIN_ROOM', roomCode: 'K7M4Q2' })) as Record<
        string,
        unknown
      >,
      JSON.parse(encodeSignalingMessage({ type: 'OFFER', sdp: 'offer-sdp' })) as Record<
        string,
        unknown
      >,
      JSON.parse(encodeSignalingMessage({ type: 'ANSWER', sdp: 'answer-sdp' })) as Record<
        string,
        unknown
      >,
      JSON.parse(
        encodeSignalingMessage({
          type: 'ICE_CANDIDATE',
          candidate: { candidate: 'candidate:1 1 UDP 1 192.168.1.4 54321 typ host', sdpMid: '0' },
        }),
      ) as Record<string, unknown>,
      JSON.parse(encodeSignalingMessage({ type: 'ICE_END' })) as Record<string, unknown>,
    ];
    for (const f of frames) {
      expect(f.v).toBe(SIGNALING_PROTOCOL_VERSION);
      expect(typeof f.type).toBe('string');
    }
    expect(frames[0]?.type).toBe('CREATE_ROOM');
    expect(frames[1]?.roomCode).toBe('K7M4Q2');
    expect(frames[2]?.sdp).toBe('offer-sdp');
    expect(frames[3]?.sdp).toBe('answer-sdp');
    expect(
      (frames[4]?.candidate as { candidate?: string } | undefined)?.candidate,
    ).toContain('192.168.1.4');
    expect(frames[5]?.type).toBe('ICE_END');
  });

  it('2. 出站内部契约违规即 throw（空 SDP / 畸形 candidate）', () => {
    expect(() => encodeSignalingMessage({ type: 'OFFER', sdp: '' })).toThrow();
    expect(() => encodeSignalingMessage({ type: 'ANSWER', sdp: '' })).toThrow();
    expect(() =>
      encodeSignalingMessage({
        type: 'ICE_CANDIDATE',
        // 运行期绕过类型：candidate 字段缺失
        candidate: { sdpMid: '0' } as unknown as { candidate: string },
      }),
    ).toThrow();
  });

  it('3. 入站全类型 decode 往返保真', () => {
    const roomAck = {
      roomCode: 'K7M4Q2',
      peerToken: 'peer-token-1',
      iceServers: ICE_SERVERS,
      expiresAt: 1_800_000_000_000,
    };
    const cases: Array<{ raw: string; expected: SignalingInboundMessage }> = [
      {
        raw: frame({ type: 'ROOM_CREATED', ...roomAck }),
        expected: { type: 'ROOM_CREATED', ...roomAck },
      },
      {
        raw: frame({ type: 'ROOM_JOINED', ...roomAck }),
        expected: { type: 'ROOM_JOINED', ...roomAck },
      },
      { raw: frame({ type: 'PEER_JOINED' }), expected: { type: 'PEER_JOINED' } },
      { raw: frame({ type: 'OFFER', sdp: 'offer-sdp' }), expected: { type: 'OFFER', sdp: 'offer-sdp' } },
      {
        raw: frame({ type: 'ANSWER', sdp: 'answer-sdp' }),
        expected: { type: 'ANSWER', sdp: 'answer-sdp' },
      },
      {
        raw: frame({
          type: 'ICE_CANDIDATE',
          candidate: { candidate: 'candidate:1 1 UDP 1 10.0.0.2 44444 typ relay', sdpMid: '0', sdpMLineIndex: 0 },
        }),
        expected: {
          type: 'ICE_CANDIDATE',
          candidate: { candidate: 'candidate:1 1 UDP 1 10.0.0.2 44444 typ relay', sdpMid: '0', sdpMLineIndex: 0 },
        },
      },
      { raw: frame({ type: 'ICE_END' }), expected: { type: 'ICE_END' } },
      { raw: frame({ type: 'PEER_LEFT' }), expected: { type: 'PEER_LEFT' } },
      { raw: frame({ type: 'ERROR', code: 'ROOM_FULL', message: 'room is full' }), expected: { type: 'ERROR', code: 'ROOM_FULL', message: 'room is full' } },
      { raw: frame({ type: 'ERROR', code: 'ROOM_NOT_FOUND' }), expected: { type: 'ERROR', code: 'ROOM_NOT_FOUND' } },
    ];
    for (const { raw, expected } of cases) {
      const decoded = decodeSignalingMessage(raw);
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      expect(decoded.message).toEqual(expected);
    }
  });

  it('4. 结构化 ICE 类型可直接喂浏览器 API（编译期结构兼容断言）', () => {
    const decoded = decodeSignalingMessage(
      frame({ type: 'ROOM_CREATED', roomCode: 'K7M4Q2', peerToken: 't', iceServers: ICE_SERVERS, expiresAt: 1 }),
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    if (decoded.message.type !== 'ROOM_CREATED') return;
    // SignalingIceServer[] → RTCIceServer[]（RTCPeerConnection config 直接可用）
    const rtcConfig: RTCIceServer[] = decoded.message.iceServers;
    expect(rtcConfig.length).toBe(2);
    // SignalingIceCandidate → RTCIceCandidateInit（addIceCandidate 直接可用）
    const candidateDecoded = decodeSignalingMessage(
      frame({ type: 'ICE_CANDIDATE', candidate: { candidate: 'candidate:1 1 UDP 1 8.8.8.8 99 typ srflx' } }),
    );
    expect(candidateDecoded.ok).toBe(true);
    if (!candidateDecoded.ok) return;
    if (candidateDecoded.message.type !== 'ICE_CANDIDATE') return;
    const rtcCandidate: RTCIceCandidateInit = candidateDecoded.message.candidate;
    expect(rtcCandidate.candidate).toContain('srflx');
  });

  it('5. ERROR 前向兼容：未知 code 照常 decode，已知 code 可判别', () => {
    const unknown = decodeSignalingMessage(frame({ type: 'ERROR', code: 'FUTURE_CODE' }));
    expect(unknown.ok).toBe(true);
    if (!unknown.ok) return;
    expect(unknown.message.type).toBe('ERROR');
    if (unknown.message.type !== 'ERROR') return;
    expect(unknown.message.code).toBe('FUTURE_CODE');
    expect(isSignalingErrorCode(unknown.message.code)).toBe(false);

    for (const code of SIGNALING_ERROR_CODES) {
      expect(isSignalingErrorCode(code)).toBe(true);
    }
  });

  it('6. 拒绝矩阵：EMPTY / NOT_JSON / NOT_OBJECT / 版本 / 未知类型 / 出站类型回环', () => {
    const cases: Array<{ raw: string; reason: string }> = [
      { raw: '', reason: 'EMPTY' },
      { raw: '   ', reason: 'EMPTY' },
      { raw: '{not-json', reason: 'NOT_JSON' },
      { raw: '[1,2,3]', reason: 'NOT_OBJECT' }, // JSON 数组
      { raw: '"string"', reason: 'NOT_OBJECT' },
      { raw: '42', reason: 'NOT_OBJECT' },
      { raw: JSON.stringify({ v: 2, type: 'PEER_JOINED' }), reason: 'UNSUPPORTED_VERSION' },
      { raw: JSON.stringify({ type: 'PEER_JOINED' }), reason: 'UNSUPPORTED_VERSION' }, // 缺 v
      { raw: JSON.stringify({ v: 1, type: 'FOO' }), reason: 'UNKNOWN_TYPE' },
      { raw: JSON.stringify({ v: 1 }), reason: 'UNKNOWN_TYPE' }, // 缺 type
      { raw: JSON.stringify({ v: 1, type: 'CREATE_ROOM' }), reason: 'UNKNOWN_TYPE' }, // 出站类型不得入站
    ];
    for (const { raw, reason } of cases) {
      const decoded = decodeSignalingMessage(raw);
      expect(decoded.ok).toBe(false);
      if (decoded.ok) continue;
      expect(decoded.reason).toBe(reason);
    }
  });

  it('7. 拒绝矩阵：INVALID_PAYLOAD 逐字段', () => {
    const badRoomAcks = [
      frame({ type: 'ROOM_CREATED', roomCode: 'K7M4Q', peerToken: 't', iceServers: [], expiresAt: 1 }), // 5 位
      frame({ type: 'ROOM_CREATED', roomCode: 'K7M4Q0', peerToken: 't', iceServers: [], expiresAt: 1 }), // 非法字符 0
      frame({ type: 'ROOM_JOINED', roomCode: 'k7m4q2', peerToken: 't', iceServers: [], expiresAt: 1 }), // 小写未规范化
      frame({ type: 'ROOM_JOINED', roomCode: 'K7M4Q2', iceServers: [], expiresAt: 1 }), // 缺 peerToken
      frame({ type: 'ROOM_CREATED', roomCode: 'K7M4Q2', peerToken: 't', expiresAt: 1 }), // 缺 iceServers
      frame({ type: 'ROOM_CREATED', roomCode: 'K7M4Q2', peerToken: 't', iceServers: {}, expiresAt: 1 }), // 非数组
      frame({
        type: 'ROOM_CREATED',
        roomCode: 'K7M4Q2',
        peerToken: 't',
        iceServers: [{ urls: 42 }],
        expiresAt: 1, // urls 非法
      }),
      frame({
        type: 'ROOM_CREATED',
        roomCode: 'K7M4Q2',
        peerToken: 't',
        iceServers: [{ urls: 'turn:x', credential: 3 }],
        expiresAt: 1, // credential 非法
      }),
      frame({ type: 'ROOM_CREATED', roomCode: 'K7M4Q2', peerToken: 't', iceServers: [], expiresAt: 'soon' }), // expiresAt 非数字
    ];
    for (const raw of badRoomAcks) {
      const decoded = decodeSignalingMessage(raw);
      expect(decoded.ok).toBe(false);
      if (decoded.ok) continue;
      expect(decoded.reason).toBe('INVALID_PAYLOAD');
    }

    const others: Array<{ raw: string; detail: string }> = [
      { raw: frame({ type: 'OFFER', sdp: '' }), detail: 'OFFER' },
      { raw: frame({ type: 'ANSWER', sdp: 3 }), detail: 'ANSWER' },
      { raw: frame({ type: 'ICE_CANDIDATE', candidate: { sdpMid: '0' } }), detail: 'ICE_CANDIDATE' },
      { raw: frame({ type: 'ICE_CANDIDATE' }), detail: 'ICE_CANDIDATE' },
      { raw: frame({ type: 'ERROR' }), detail: 'ERROR' },
      { raw: frame({ type: 'ERROR', code: '' }), detail: 'ERROR' },
      { raw: frame({ type: 'ERROR', code: 'X', message: 7 }), detail: 'ERROR' },
    ];
    for (const { raw, detail } of others) {
      const decoded = decodeSignalingMessage(raw);
      expect(decoded.ok).toBe(false);
      if (decoded.ok) continue;
      expect(decoded.reason).toBe('INVALID_PAYLOAD');
      expect(decoded.detail).toBe(detail);
    }
  });
});
