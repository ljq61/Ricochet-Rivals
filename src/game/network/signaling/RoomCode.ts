/**
 * Room Code（Online Connection Migration SG-1/SG-2 共享）—— 6 位高可读房间码。
 *
 * Alphabet 排除易混淆字符：0/O、1/I/L（迁移规格）。Client 与 Signaling
 * Server 共用本模块（纯 TS、零环境依赖）：
 * * Client：JOIN 输入规范化 + 入站 ROOM_CREATED/ROOM_JOINED 校验。
 * * Server（SG-2）：生成房间码。
 *
 * 房间码只存在于 Signaling（连接协议）层 —— Gameplay / NetworkEnvelope
 * 不感知（迁移规格红线：两协议完全独立）。
 */

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

/** alphabet 仅含字母数字（无正则元字符），内插进字符类安全 */
const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/**
 * 规范化用户输入：去空白与连字符 + 大写。
 * 手机输入法常插入空格；用户读码习惯 "K7M4-Q2" 分组 —— 两类噪音都容忍。
 * 永不 throw：畸形输入原样交给 isValidRoomCode 判死。
 */
export function normalizeRoomCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

/** 严格校验：恰好 ROOM_CODE_LENGTH 位且全部来自 alphabet。 */
export function isValidRoomCode(input: string): boolean {
  return ROOM_CODE_PATTERN.test(input);
}
