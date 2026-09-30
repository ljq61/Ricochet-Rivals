/**
 * Signaling Message Protocol（Online Connection Migration SG-1）——
 * 房间连接信令协议（Client ↔ Signaling Server，WebSocket 文本帧）。
 *
 * 架构红线（迁移规格）：
 * * 与 NetworkEnvelope（Gameplay 协议）**完全独立** —— 互不 import、
 *   互不感知。WebSocket 只用于 Signaling；Gameplay 只走 WebRTC
 *   DataChannel。
 * * Signaling Server 禁止处理 Gameplay State —— 协议中不存在任何游戏
 *   语义字段，只搬运连接建立材料（Room / SDP / ICE candidate）。
 * * 本文件为 Client / Server 双端共享契约：纯 TS、零 DOM / Node 专属
 *   依赖（SG-2 的 Node Signaling Server 直接 import 本文件）。
 *
 * wire 格式：JSON 文本帧 `{ v: 1, type, ...payload }`。
 * * encodeSignalingMessage —— 出站（Client → Server）。入参是内部
 *   类型化数据；运行期形状违反契约 = 本层 bug，直接 throw（同
 *   serializeEnvelope「失败即本类 bug」口径）。
 * * decodeSignalingMessage —— 入站（Server → Client）是 Untrusted
 *   Input：永不 throw，全部走 { ok: false, reason } Result 双轨（与
 *   ConnectionCodeCodec 同风格），畸形帧由调用方记录丢弃。
 *
 * ICE 类型说明：为双端共享而使用结构化最小定义（非 DOM lib 类型）——
 * SignalingIceServer 对 RTCIceServer、SignalingIceCandidate 对
 * RTCIceCandidateInit 结构可赋值，浏览器侧可直接喂 RTCPeerConnection
 * （见 SignalingMessage.test.ts 编译期断言），Node 侧无需 DOM lib。
 */

import { isValidRoomCode } from './RoomCode';

export const SIGNALING_PROTOCOL_VERSION = 1;

// ---- 结构化 ICE 类型（环境无关） -------------------------------------------

/** RTCIceServer 结构子集：urls + 可选凭据（TURN 临时凭据由 Signaling 下发） */
export interface SignalingIceServer {
  readonly urls: string | string[];
  readonly username?: string;
  readonly credential?: string;
}

/** RTCIceCandidateInit 结构子集：candidate 必填，其余 optional */
export interface SignalingIceCandidate {
  readonly candidate: string;
  readonly sdpMid?: string | null;
  readonly sdpMLineIndex?: number | null;
  readonly usernameFragment?: string | null;
}

/** Server 已知错误码；未列出者按通用错误处理（前向兼容，decode 不拒绝） */
export const SIGNALING_ERROR_CODES = [
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_EXPIRED',
  'INVALID_ROOM_CODE',
  'INVALID_MESSAGE',
  'NOT_IN_ROOM',
  'SERVER_ERROR',
] as const;

export type SignalingErrorCode = (typeof SIGNALING_ERROR_CODES)[number];

export function isSignalingErrorCode(code: string): code is SignalingErrorCode {
  return (SIGNALING_ERROR_CODES as readonly string[]).includes(code);
}

// ---- 消息类型 --------------------------------------------------------------

/** Client → Server */
export type SignalingOutboundMessage =
  | { readonly type: 'CREATE_ROOM' }
  | { readonly type: 'JOIN_ROOM'; readonly roomCode: string }
  | { readonly type: 'OFFER'; readonly sdp: string }
  | { readonly type: 'ANSWER'; readonly sdp: string }
  | { readonly type: 'ICE_CANDIDATE'; readonly candidate: SignalingIceCandidate }
  | { readonly type: 'ICE_END' };

/** Server → Client（OFFER/ANSWER/ICE_* 为 Server 向房间内对端的转发） */
export type SignalingInboundMessage =
  | {
      readonly type: 'ROOM_CREATED';
      readonly roomCode: string;
      readonly peerToken: string;
      readonly iceServers: SignalingIceServer[];
      readonly expiresAt: number;
    }
  | {
      readonly type: 'ROOM_JOINED';
      readonly roomCode: string;
      readonly peerToken: string;
      readonly iceServers: SignalingIceServer[];
      readonly expiresAt: number;
    }
  | { readonly type: 'PEER_JOINED' }
  | { readonly type: 'OFFER'; readonly sdp: string }
  | { readonly type: 'ANSWER'; readonly sdp: string }
  | { readonly type: 'ICE_CANDIDATE'; readonly candidate: SignalingIceCandidate }
  | { readonly type: 'ICE_END' }
  | { readonly type: 'PEER_LEFT' }
  | { readonly type: 'ERROR'; readonly code: string; readonly message?: string };

const INBOUND_TYPES: ReadonlySet<string> = new Set([
  'ROOM_CREATED',
  'ROOM_JOINED',
  'PEER_JOINED',
  'OFFER',
  'ANSWER',
  'ICE_CANDIDATE',
  'ICE_END',
  'PEER_LEFT',
  'ERROR',
]);

// ---- 运行时守卫（Untrusted Input 防线零件） ---------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isSignalingIceServer(value: unknown): value is SignalingIceServer {
  if (!isRecord(value)) {
    return false;
  }
  const urls = value.urls;
  if (typeof urls === 'string') {
    if (urls.length === 0) {
      return false;
    }
  } else if (Array.isArray(urls)) {
    if (urls.length === 0 || !urls.every((entry) => typeof entry === 'string' && entry.length > 0)) {
      return false;
    }
  } else {
    return false;
  }
  if (value.username !== undefined && typeof value.username !== 'string') {
    return false;
  }
  if (value.credential !== undefined && typeof value.credential !== 'string') {
    return false;
  }
  return true;
}

export function isSignalingIceCandidate(value: unknown): value is SignalingIceCandidate {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.candidate !== 'string' || value.candidate.length === 0) {
    return false;
  }
  if (value.sdpMid !== undefined && value.sdpMid !== null && typeof value.sdpMid !== 'string') {
    return false;
  }
  if (
    value.sdpMLineIndex !== undefined &&
    value.sdpMLineIndex !== null &&
    typeof value.sdpMLineIndex !== 'number'
  ) {
    return false;
  }
  if (
    value.usernameFragment !== undefined &&
    value.usernameFragment !== null &&
    typeof value.usernameFragment !== 'string'
  ) {
    return false;
  }
  return true;
}

// ---- 编解码 ----------------------------------------------------------------

export function encodeSignalingMessage(message: SignalingOutboundMessage): string {
  switch (message.type) {
    case 'OFFER':
    case 'ANSWER':
      if (message.sdp.length === 0) {
        throw new Error(`[SignalingMessage] ${message.type} sdp must be non-empty`);
      }
      break;
    case 'ICE_CANDIDATE':
      if (!isSignalingIceCandidate(message.candidate)) {
        throw new Error('[SignalingMessage] ICE_CANDIDATE candidate malformed');
      }
      break;
    case 'CREATE_ROOM':
    case 'JOIN_ROOM':
    case 'ICE_END':
      break;
  }
  return JSON.stringify({ v: SIGNALING_PROTOCOL_VERSION, ...message });
}

export type SignalingDecodeRejectReason =
  | 'EMPTY'
  | 'NOT_JSON'
  | 'NOT_OBJECT'
  | 'UNSUPPORTED_VERSION'
  | 'UNKNOWN_TYPE'
  | 'INVALID_PAYLOAD';

export type DecodeSignalingMessageResult =
  | { ok: true; message: SignalingInboundMessage }
  | { ok: false; reason: SignalingDecodeRejectReason; detail?: string };

export function decodeSignalingMessage(raw: string): DecodeSignalingMessageResult {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, reason: 'EMPTY' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'NOT_JSON' };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: 'NOT_OBJECT' };
  }
  if (parsed.v !== SIGNALING_PROTOCOL_VERSION) {
    return { ok: false, reason: 'UNSUPPORTED_VERSION' };
  }
  const type = parsed.type;
  if (typeof type !== 'string' || !INBOUND_TYPES.has(type)) {
    return { ok: false, reason: 'UNKNOWN_TYPE' };
  }
  switch (type) {
    case 'ROOM_CREATED':
    case 'ROOM_JOINED':
      return decodeRoomAck(type, parsed);
    case 'PEER_JOINED':
      return { ok: true, message: { type: 'PEER_JOINED' } };
    case 'OFFER':
    case 'ANSWER': {
      const sdp = parsed.sdp;
      if (!isNonEmptyString(sdp)) {
        return { ok: false, reason: 'INVALID_PAYLOAD', detail: type };
      }
      return { ok: true, message: { type, sdp } };
    }
    case 'ICE_CANDIDATE': {
      const candidate = parsed.candidate;
      if (!isSignalingIceCandidate(candidate)) {
        return { ok: false, reason: 'INVALID_PAYLOAD', detail: 'ICE_CANDIDATE' };
      }
      return { ok: true, message: { type: 'ICE_CANDIDATE', candidate } };
    }
    case 'ICE_END':
      return { ok: true, message: { type: 'ICE_END' } };
    case 'PEER_LEFT':
      return { ok: true, message: { type: 'PEER_LEFT' } };
    case 'ERROR': {
      const code = parsed.code;
      if (typeof code !== 'string' || code.length === 0) {
        return { ok: false, reason: 'INVALID_PAYLOAD', detail: 'ERROR' };
      }
      const errorMessage = parsed.message;
      if (errorMessage !== undefined && typeof errorMessage !== 'string') {
        return { ok: false, reason: 'INVALID_PAYLOAD', detail: 'ERROR' };
      }
      return errorMessage === undefined
        ? { ok: true, message: { type: 'ERROR', code } }
        : { ok: true, message: { type: 'ERROR', code, message: errorMessage } };
    }
    default:
      return { ok: false, reason: 'UNKNOWN_TYPE' };
  }
}

/** ROOM_CREATED / ROOM_JOINED 共用负载校验 */
function decodeRoomAck(
  type: 'ROOM_CREATED' | 'ROOM_JOINED',
  parsed: Record<string, unknown>,
): DecodeSignalingMessageResult {
  const roomCode = parsed.roomCode;
  if (!isNonEmptyString(roomCode) || !isValidRoomCode(roomCode)) {
    return { ok: false, reason: 'INVALID_PAYLOAD', detail: type };
  }
  const peerToken = parsed.peerToken;
  if (!isNonEmptyString(peerToken)) {
    return { ok: false, reason: 'INVALID_PAYLOAD', detail: type };
  }
  const iceServers = parsed.iceServers;
  if (!Array.isArray(iceServers) || !iceServers.every((entry) => isSignalingIceServer(entry))) {
    return { ok: false, reason: 'INVALID_PAYLOAD', detail: type };
  }
  const expiresAt = parsed.expiresAt;
  if (!isFiniteNumber(expiresAt)) {
    return { ok: false, reason: 'INVALID_PAYLOAD', detail: type };
  }
  return { ok: true, message: { type, roomCode, peerToken, iceServers, expiresAt } };
}
