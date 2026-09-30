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
| `SIGNALING_HEARTBEAT_INTERVAL_MS` | `5000` | 服务端 WS ping 周期（正数毫秒；浏览器协议层自动 pong） |
| `SIGNALING_HEARTBEAT_TIMEOUT_MS` | `10000` | ping 后等待 pong 时限；超时 terminate 并释放半开 socket 槽位 |
| `SIGNALING_STUN_URLS` | Google STUN | 逗号分隔 STUN 列表 |
| `SIGNALING_TURN_URLS` | （空） | 逗号分隔 TURN 列表（`turn:` UDP/TCP、`turns:` TLS）——**必须与 SECRET 成对** |
| `SIGNALING_TURN_SHARED_AUTH_SECRET` | （空） | 与 coturn `static-auth-secret` 相同；**只经环境变量注入，永不入库** |
| `SIGNALING_TURN_CREDENTIAL_TTL_MS` | `1800000` | TURN 临时凭据 TTL（规格 30~60min） |

## 房间语义

- CREATE_ROOM 的 socket = Host（固定 P1）；JOIN_ROOM 的 socket = Guest（固定 P2）。
  角色由动作固化——协议中不存在角色声明，Guest 无法自称 Host。
- 每房间最多两人；第三个 socket JOIN → `ROOM_FULL`。
- `peerToken`：连接身份锚点。WS 掉线后在 grace 窗口内持 token 重新 JOIN_ROOM
  → 原位恢复（Host 恢复通知 Guest `PEER_JOINED`，反之亦然）。
  有效 token 也可立即接管尚未发出 close 的旧连接；旧 socket 终止且解绑，
  其迟到帧 / close 不影响新槽位。无有效 token 仍无法挤占在连席位。
- 静默断网没有 FIN 时，ping/pong 最坏约 15s 清理旧连接，之后开始计算 grace。
  token 恢复不必等待 heartbeat。调整 heartbeat 参数应考虑单次 20s 的恢复窗口。
- Host 断开 → Guest 收 `PEER_LEFT`；Host 在 grace 内未归 → 房间删除。
- 等待配对超过 TTL → 房间删除，Host 收 `ERROR ROOM_EXPIRED`。
  JOIN 触发的惰性过期与定时清扫使用同一通知 / 解绑路径。

## TURN（SG-6，coturn 部署）

每个 ROOM_CREATED / ROOM_JOINED ack 下发 `iceServers = [STUN, TURN(time-limited
credential)]`；浏览器只拿临时 username / credential（`username = <expiry unix 秒>`、
`credential = base64(HMAC-SHA1(secret, username))`，coturn REST API 契约）——
shared secret 只存在 TURN 与 Signaling 两侧环境变量。

coturn 侧对应配置（`turnserver.conf`）：

```
use-auth-secret
static-auth-secret=<与 SIGNALING_TURN_SHARED_AUTH_SECRET 相同>
realm=ricochet-rivals
listening-port=3478
tls-listening-port=5349
# cert=/path/to/cert.pem  key=/path/to/key.pem   # turns: 需要
```

验证 TURN 可用：客户端 DebugConfig.DEBUG_FORCE_RELAY=true（iceTransportPolicy
='relay'）后连接，Debug 句柄 `awaitRtcDiagnostics()` 的 `selectedPair` 必须含
`relay` candidate（route=RELAY）—— 否则不能声称 TURN 已验证（规格 Tests—TURN）。
