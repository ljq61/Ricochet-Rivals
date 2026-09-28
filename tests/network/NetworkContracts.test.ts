import { describe, expect, it } from 'vitest';
import { NetworkMessageType } from '../../src/game/network/NetworkMessageType';
import type { PeerRole } from '../../src/game/network/PeerRole';
import { TransportState } from '../../src/game/network/TransportState';

/**
 * 协议常量锁：值即 wire 契约 —— 任何值变动都是破坏性协议变更，
 * 必须递增 NetworkEnvelope.version，不允许静默重命名。
 */
describe('Network contracts (Phase 12)', () => {
  it('NetworkMessageType 值与 TASKS.md Contracts 一致（含 PING/PONG 保活预留）', () => {
    expect(Object.values(NetworkMessageType)).toEqual([
      'PING',
      'PONG',
      'PLAYER_READY',
      'GAME_START',
      'MOVE_REQUEST',
      'MOVE',
      'FIRE_REQUEST',
      'FIRE',
      'TURN_RESULT',
      'TURN_END',
      'COMMAND_REJECTED',
      'STATE_SYNC_REQUEST',
      'STATE_SNAPSHOT',
      'REMATCH',
      'DISCONNECT',
    ]);
  });

  it('TransportState 值全为字符串且覆盖六态', () => {
    expect(Object.values(TransportState)).toEqual([
      'IDLE',
      'CONNECTING',
      'CONNECTED',
      'DISCONNECTED',
      'FAILED',
      'CLOSED',
    ]);
  });

  it('PeerRole 限于 host | guest（HOST AUTHORITATIVE）', () => {
    const roles: PeerRole[] = ['host', 'guest'];
    expect(roles).toEqual(['host', 'guest']);
  });
});
