# Ricochet Rivals — Signaling Server（SG-2）

WebSocket **Signaling** 服务器：房间配对（6 位 Room Code）+ Offer/Answer/ICE candidate
转发。**只处理连接协议（SignalingMessage）**——Gameplay 全部经 WebRTC DataChannel，
本服务不接触任何游戏状态（架构红线见仓库 TASKS.md「Online Connection Migration」）。

协议契约单一事实源：`src/game/network/signaling/SignalingMessage.ts`（Client 与
Server 共享，环境无关纯 TS）。

## 运行

```bash
cd server/signaling
npm install
npm run dev        # 开发（tsx watch）
npm start          # 运行
npm test           # 单测矩阵 + 真实 ws 集成
npm run typecheck
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8787` | 监听端口 |
| `SIGNALING_WAITING_TTL_MS` | `600000` | 房间未配对保留期（规格 5~10min；超时删除并通知 Host） |
| `SIGNALING_SLOT_GRACE_MS` | `30000` | 断开后持 peerToken 原位重连窗口（Host 超窗 → 房间删除） |
| `SIGNALING_SWEEP_INTERVAL_MS` | `15000` | 过期清扫周期 |
| `SIGNALING_ICE_SERVERS` | Google STUN | JSON 数组，注入 ROOM_CREATED/ROOM_JOINED 的 `iceServers` |

## 房间语义

- CREATE_ROOM 的 socket = Host（固定 P1）；JOIN_ROOM 的 socket = Guest（固定 P2）。
  角色由动作固化——协议中不存在角色声明，Guest 无法自称 Host。
- 每房间最多两人；第三个 socket JOIN → `ROOM_FULL`。
- `peerToken`：连接身份锚点。WS 掉线后在 grace 窗口内持 token 重新 JOIN_ROOM
  → 原位恢复（Host 恢复通知 Guest `PEER_JOINED`，反之亦然）。
- Host 断开 → Guest 收 `PEER_LEFT`；Host 在 grace 内未归 → 房间删除。
- 等待配对超过 TTL → 房间删除，Host 收 `ERROR ROOM_EXPIRED`。

## TURN（SG-6 占位）

`SIGNALING_ICE_SERVERS` 现为静态注入（开发默认仅 STUN）。SG-6 将按用户决策接自建
coturn（`use-auth-secret` + REST API 时间受限凭据，secret 只存在 TURN + Signaling
两侧，绝不入仓库 / 客户端 bundle）。
