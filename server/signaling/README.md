# Ricochet Rivals — Signaling Server（SG-2）

## 公网信令（2026-09-30）

- Render 服务：`wss://ricochet-rivals.onrender.com`。
- GitHub Pages 发布流程在构建时注入这个地址；仓库 Actions 变量 `VITE_SIGNALING_URL` 可覆盖它。更换地址后需重新发布网页。
- 本地开发仍默认使用 `ws://127.0.0.1:8787`，可通过 `VITE_SIGNALING_URL` 指定公网或局域网服务。
- 服务只提供 WebSocket；直接用浏览器访问 HTTPS 地址返回 `426 Upgrade Required` 属于正常行为。
- 部署单实例，房间保存在内存中；服务重启或免费实例休眠后需重新创建房间。免费实例唤醒可能需要约一分钟。
- 当前公网服务下发 STUN，尚未配置 TURN。房间配对可用不代表所有跨网络组合都能建立直连，仍需两部手机分别使用 Wi-Fi / 蜂窝网络验收。

Render 配置：Root Directory 留空，Node.js 22，Build Command 为 `npm --prefix server/signaling ci --include=dev`，Start Command 为 `npm --prefix server/signaling start`。Health Check Path 留空使用 TCP 检查；服务读取平台提供的 `PORT`。

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
| `SIGNALING_SLOT_GRACE_MS` | `30000` | 已配对房间断开后的原位重连窗口（Host 超窗 → 房间删除）；未配对 Host 保留至原 waiting TTL |
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
- 未配对 Host 切去分享房间码时，断开的房间保留至原 waiting TTL（默认 10 分钟），持原 token 可恢复；重连不刷新有效期。
- 配对后 Host 断开 → Guest 收 `PEER_LEFT`；Host 在 grace 内未归 → 房间删除。
- 首轮 OFFER 尚未转发且 Guest 已在房内时，Host 重入在 `ROOM_JOINED` 后另收 `PEER_JOINED`，继续初次配对。已开始协商 / 对局的重入由既有 ICE Restart 接管。
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
