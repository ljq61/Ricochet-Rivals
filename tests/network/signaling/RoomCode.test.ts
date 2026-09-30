import { describe, expect, it } from 'vitest';
import {
  isValidRoomCode,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from '../../../src/game/network/signaling/RoomCode';

/**
 * RoomCode（SG-1）—— 6 位高可读房间码契约。
 * 规格样本：K7M4Q2；alphabet 排除 0/O/1/I/L。
 */

describe('RoomCode', () => {
  it('1. 规格样本 K7M4Q2 合法', () => {
    expect(ROOM_CODE_LENGTH).toBe(6);
    expect(isValidRoomCode('K7M4Q2')).toBe(true);
  });

  it('2. normalize：大小写 / 空白 / 连字符容忍', () => {
    expect(normalizeRoomCode('k7m4q2')).toBe('K7M4Q2');
    expect(normalizeRoomCode(' k7m4-q2 ')).toBe('K7M4Q2');
    expect(normalizeRoomCode('K7M4\tQ2\n')).toBe('K7M4Q2');
  });

  it('3. alphabet 逐一通过；排除字符 0/O/1/I/L 全拒', () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[0O1IL]/);
    for (const char of ROOM_CODE_ALPHABET) {
      expect(isValidRoomCode(char.repeat(ROOM_CODE_LENGTH))).toBe(true);
    }
    for (const excluded of ['0', 'O', '1', 'I', 'L']) {
      expect(isValidRoomCode(excluded.repeat(ROOM_CODE_LENGTH))).toBe(false);
    }
  });

  it('4. 非法：空 / 长度不足 / 超长 / 非法字符 / 未 normalize 小写', () => {
    expect(isValidRoomCode('')).toBe(false);
    expect(isValidRoomCode('K7M4Q')).toBe(false);
    expect(isValidRoomCode('K7M4Q22')).toBe(false);
    expect(isValidRoomCode('K7M4Q!')).toBe(false);
    expect(isValidRoomCode('k7m4q2')).toBe(false);
  });
});
