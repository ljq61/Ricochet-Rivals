import { TransportError } from '../NetworkTransport';

/**
 * WebRTC 信令编解码 + ICE gathering 等待（Phase 13 F3 自 WebRTCTransport 拆出）。
 *
 * 纯函数、零 transport 实例状态：
 * * encodeDescription —— SDP 以 JSON `{type, sdp}` 字符串编码（transport 对外信令契约）。
 * * decodeSignaling —— Untrusted Input 防线：JSON 解析 + type 匹配 + sdp 非空，
 *   非法输入 throw TransportError(INVALID_SIGNALING)。
 * * waitForIceGatheringComplete —— 等 ICE candidate 收齐；2s 兜底超时 resolve
 *   当前 SDP（提前复制的 SDP 缺 candidate 可能连接失败，Phase 13 连接码需完整 SDP）。
 *   close 清理由调用方经 pendingRejects 集合注入：transport.close 遍历该集合
 *   reject 所有未决等待（TRANSPORT_CLOSED），本函数在 settle 时自行摘除。
 */

const ICE_GATHERING_TIMEOUT_MS = 2_000;

export function encodeDescription(description: RTCSessionDescriptionInit | RTCSessionDescription): string {
  const sdp = description.sdp;
  if (sdp === undefined) {
    // 真实浏览器 createOffer/createAnswer 必产出 sdp；缺失 = 底层异常，不静默
    throw new TransportError('INVALID_SIGNALING', '[SignalingCodec] peer connection produced no SDP');
  }
  return JSON.stringify({ type: description.type, sdp });
}

export function decodeSignaling(encoded: string, expectedType: 'offer' | 'answer'): RTCSessionDescriptionInit {
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch (error) {
    throw new TransportError(
      'INVALID_SIGNALING',
      `[SignalingCodec] signaling is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new TransportError('INVALID_SIGNALING', '[SignalingCodec] signaling must be a JSON object');
  }
  const candidate = parsed as Record<string, unknown>;
  const type = candidate.type;
  const sdp = candidate.sdp;
  if (typeof type !== 'string' || type !== expectedType || typeof sdp !== 'string' || sdp.length === 0) {
    throw new TransportError(
      'INVALID_SIGNALING',
      `[SignalingCodec] expected ${expectedType} {type, sdp} signaling (got ${JSON.stringify(candidate)})`,
    );
  }
  return { type, sdp };
}

export function waitForIceGatheringComplete(
  pc: RTCPeerConnection,
  pendingRejects: Set<(error: TransportError) => void>,
): Promise<void> {
  if (pc.iceGatheringState === 'complete') {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onGatheringChange);
      pendingRejects.delete(rejectOnClose);
      resolve();
    };
    const onGatheringChange = (): void => {
      if (pc.iceGatheringState === 'complete') {
        settle();
      }
    };
    const rejectOnClose = (error: TransportError): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onGatheringChange);
      pendingRejects.delete(rejectOnClose);
      reject(error);
    };
    // 2s 兜底：部分 candidate 的 SDP 可能连不上 —— Phase 13 连接码需完整 SDP
    timer = setTimeout(settle, ICE_GATHERING_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', onGatheringChange);
    pendingRejects.add(rejectOnClose);
  });
}
