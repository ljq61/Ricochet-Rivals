/**
 * P2P 对等角色（HOST AUTHORITATIVE，CODELY.md §5）。
 * Host = 创建房间者，GameState 最终权威；Guest = 本地表现 + 命令上报。
 */
export type PeerRole = 'host' | 'guest';
