# Ricochet Rivals

横版 2D 回合制弹道对战网页游戏。
Worms 式双方阵地对抗 + Angry Birds 式反方向拖拽瞄准发射。

当前进度：**Phase 0～16 完成；Phase 17 美术持续精修；Phase 18 代码侧加固已落地，真实设备 QA 待完成**；并行轨道 **联机信令迁移（SG-0～8 全部完成，分支 `dev_signaling_turn`：房间码自动配对 + WebSocket 信令 + Trickle ICE + TURN 兜底 + 对局期 ICE Restart 恢复；公网信令已部署，Pages 发布构建已接入，剩余公网 TURN 配置与真机 QA）**（见 `TASKS.md`）。已包含 WebRTC P2P 对战、Desync 恢复与联机再战；海港场景、二头身角色、炮弹火焰拖尾与爆炸、分档基地火烟、低血量章鱼障碍和音效已接入。

最新美术调整：蓝红角色各 8 帧走路循环；基地大小火各 8 帧，按血量分层布点；章鱼触角 16 帧卷曲，从海面下方完整升起。见 [动画制作与验证记录](docs/ArtDesign/ANIMATION_REFINEMENT.md)。此前的 [长支架与标题菜单](docs/ArtDesign/DOCK_MENU_REFINEMENT.md) 保持。独立视差层及走路以外的完整角色动作仍为后续精制项，真机验收见 [设备 QA 清单](docs/PHASE18_DEVICE_QA.md)。

## 技术栈

- TypeScript (strict) + Vite
- Phaser 4.x + Matter Physics
- Vitest（575 单测，49 文件）+ 独立信令服务器单测（31 项，workspace `server/signaling`）+ puppeteer-core E2E（desktop / mobile / sp / online 手动配对回归 / online 对战 / online-room 房间码真实信令 + ICE restart 恢复；基线 184 项，复跑记录见 `TASKS.md`）
- WebRTC RTCDataChannel P2P 联机（HOST AUTHORITATIVE，已落地；含 desync 防护与对局期 ICE Restart 重连恢复）；Render 公网 WebSocket 信令房间码配对（`wss://ricochet-rivals.onrender.com`）+ coturn TURN 时限 REST 凭据兜底（代码已支持，公网 TURN 待配置）

## 开发

```bash
npm install --include=dev   # 本机 npm 全局 omit=dev，必须带 --include=dev

npm run dev        # 启动开发服务器
npm run typecheck  # tsc --noEmit（strict）
npm run test       # vitest run（575 项；不含信令服务器测试）
npm run build      # 类型检查 + 生产构建
npm run preview    # 预览构建产物
npm run e2e        # 全量 E2E（desktop / mobile / sp / online 配对 / online 对战 / online-room 房间码）
                   # 调试单场景：RR_E2E_ONLY=battle|online|online-room|sp|mobile|desktop npm run e2e

# 房间码联机模式需另起 Signaling Server（缺省 ws://127.0.0.1:8787）：
cd server/signaling
npm install --include=dev
npm run dev        # 信令服务器（tsx watch）；生产部署地址经根 VITE_SIGNALING_URL 构建变量注入
npm test           # 信令单测 + 真实 ws 集成（31 项）
npm run typecheck
```

## 游戏模式

- **Single Player**：P1 vs AI（三档难度：easy / normal / hard，seeded RNG，纯函数决策）
- **Local 2 Player**：热座双人（共用键鼠 / 触屏，回合切换横幅提示）
- **Online P2P**（房间码自动配对，SG-5 起默认流）：Host 点 CREATE → 展示 6 位房间码（31 字符表，剔除易混 0/O/1/I/L）→ 微信 / 口头发码 → Guest 输码 JOIN → WebSocket 信令服务器自动交换 SDP Offer/Answer 与 Trickle ICE candidate → 双方 VERIFIED 进局，用户全程不接触 SDP。真实 WebRTC DataChannel 直连；**Host = P1 = 权威**，Guest 为意图客户端（本地仅做表现播放，HP / 伤害 / 回合切换一律以 Host 广播为准）。**TURN 兜底（SG-6）**：房间 ack 按需下发 coturn 时限 REST 凭据（HMAC-SHA1；secret 仅存环境变量，永不入库），严格 NAT 走中继；`DEBUG_FORCE_RELAY` 强制 relay 验证，Debug 句柄含候选类型 / selected pair route（DIRECT/RELAY）诊断。**失败分类（SG-7）**：ICE_FAILED / DATA_CHANNEL_FAILED / TURN_UNAVAILABLE → 简洁文案 + TRY AGAIN（输入保留），Debug 构建状态行附 `[REASON:CODE]` 后缀。**对局期断线恢复（SG-8）**：网络断族失败 → RECONNECTING… → 限次 ICE Restart（3×20s 窗，Host 发起 restart offer 经活信令交换、信令死则持 peerToken 原位重入）→ 恢复后自动走既有 Desync 快照对账继续对局；手机后台短暂切走可恢复；对端主动离场则立即 OPPONENT DISCONNECTED。手动 SDP 配对（Phase 13 流程及其真机复制优化）保留为 Debug 门控回退（`DEBUG_GAME && ?manual-sdp`，E2E 回归入口）。**Desync 防护（Phase 15）**：回合边界 stateHash 比对 → 偏差自动请求权威快照恢复（Host 永远权威）→ 对局继续；Turn Result ACK 同步屏障保证 Host 不超前 Guest；超时有限重试后安全终止。**Online Rematch（Phase 16）**：对局结束双方点 REMATCH → 复用同一 WebRTC 连接重新开局（握手同 Lobby，Host 每局全新 matchId + seed），等待对方期间显示 WAITING / OPPONENT READY；对端 Result 期离开 → OPPONENT LEFT 提示回菜单

## 玩法要点

- 5000 × 1080 超宽世界，左右两个基地；行动阶段可在己方基地内不限距离往返，一回合限一次发射
- 鼠标拖动 / 触屏拖动自由观察战场；顶部中央小地图显示双方基地、人物与飞行炮弹位置，白色描边表示当前视野；Space 或圆形持枪角色按钮「回到炮手 / 瞄准」（灰色待机 / 彩色激活，350ms 相机回家 → 锁定）
- Angry Birds 式反向拖拽瞄准：拖线 + 力度条 + 12 点轨迹预览，松手发射；Esc / 右键 / 再点按钮取消
- 炮弹飞行相机自动平滑跟随，命中后爆炸点停留 850ms（抖动 + 伤害数字 + 受击闪烁）
- 伤害分层：距爆心 ≤60px 直伤 2 点，≤140px 溅射 1 点；10 HP 制，先清零对方获胜
- 回合状态机：START → ACTION → RETURN_HOME → AIM → PROJECTILE → RESOLVE → END → 下一回合
- 联机同步：只同步命令与权威快照（MOVE / FIRE 参数 + TURN_RESULT），**绝不逐帧同步炮弹坐标**；双方本地模拟弹道，结果以 Host `TURN_RESULT` 为准（stateHash v2 双端比对：位置归一化 0.01 精度防物理微差假报）；回合切换由 Host `TURN_END` 授权，且需 Guest `TURN_RESULT_ACK` 同步确认（Sync Barrier）；Guest 状态偏差 → `STATE_SYNC_REQUEST` → Host 权威快照恢复 → 对局继续（Phase 15）
- 断线处理：对方掉线冻结输入 + OPPONENT DISCONNECTED 横幅 + 返回菜单（复杂重连归后续阶段）

## 平台

- Desktop：A / D 移动、鼠标瞄准 / 相机拖动、Space 瞄准、Esc / 右键取消
- Mobile Landscape（一等目标）：触屏方向按钮、拇指范围大热区瞄准（死区防误触）、Safe Area HUD、高 DPR 清晰渲染、竖屏门禁（连接流程除外）
- 输入能力（pointer/hover）决定控制档位，不用 User Agent 猜测；世界坐标与物理参数跨设备恒定

## 架构

命令驱动：Human / AI / Network 输入统一转 `GameCommand` → `CommandBus` → `GameLogic` → 系统层（单一 validate+execute 路径，Game Logic 不感知命令来源）。严格分层：GameLogic / Rendering / Input / AI / Network / Camera / UI 互不渗透；联机协议层与信令客户端（`src/game/network/online/` + `signaling/`）见 `docs/ARCHITECTURE.md` §6。

## 文档

- `CODELY.md` — 项目长期架构与开发约束（顶层规则）
- `docs/ARCHITECTURE.md` — 分层架构与关键决策（含联机协议、Phase 14 落地架构与房间码信令迁移）
- `server/signaling/README.md` — 信令服务器运行 / 房间语义 / coturn TURN 部署环境变量
- `docs/GAMEPLAY.md` — 玩法规则与参数表
- `docs/ArtDesign/ANIMATION_REFINEMENT.md` — 走路、大小火和触角动画制作与验证
- `docs/ArtDesign/DOCK_MENU_REFINEMENT.md` — 长支架与标题菜单精修记录
- `TASKS.md` — Phase 开发计划与完成状态（Phase 0～18）
- `docs/横版回合制弹道对战网页游戏 V0.1 PRD.md` — 产品需求
- `docs/TASKS.md + Core TypeScript Contracts.md` — 原始规划草稿

## 目录

```
src/
  main.ts                 # 入口（组合根：OnlineSessionManager 注入 game.registry）
  game/
    config/               # GameConfig / DebugConfig / PhaserGameConfig / Palette
    state/                # 纯数据层（GameState 等，零 Phaser 依赖）
    commands/             # GameCommand（MOVE / FIRE / READY）+ CommandBus
    scenes/               # Boot / MainMenu / Battle / Result / OnlineConnection
    entities/             # Player / Projectile（视觉+Matter 实体）
    systems/              # WorldBuilder / Movement / Fire / Projectile / Damage /
                          # Explosion / TurnManager / GameLogic（含 onOutcome 广播源）
    physics/              # aimMath / TrajectoryCalculator / projectileRules（纯函数）
    input/                # InputRouter / KeyboardMoveInput / AimController / TouchControls
    camera/               # CameraMode 状态机 / aimFlow / CameraController
    ai/                   # AIController / TrajectorySolver / AIInputSource（Phase 10）
    match/                # GameMode / MatchSetup / MatchFactory（Phase 11）
    network/              # Transport 协议层（Phase 12）+ online/ 协调器（Phase 14）
                          #   + online/sync/ desync 检测与快照恢复（Phase 15）
                          #   + signaling/ 房间码协议 + WS 客户端（SG-1）；
                          #     RoomConnectionController 房间码自动配对（SG-3~5）
    platform/             # ViewportService / DeviceProfile / OrientationGate
    settings/             # UserSettings（localStorage）
    random/               # SeededRandom（Mulberry32）
    ui/                   # AimButton / AimRenderer / TurnBanner / PlayerHud / DebugOverlay
    utils/                # MathUtils
tests/                    # Vitest 纯逻辑测试（48 文件 557 项，含双端 loopback 集成、
                          #   Phase 15 desync 恢复全链与 Phase 16 Rematch 握手）
server/signaling/         # 自托管 WebSocket 信令服务器（SG-2：房间管理 + SDP/ICE 转发
                          #   + coturn REST 凭据下发；独立 workspace，31 项单测）
scripts/e2e.mjs           # E2E（desktop / mobile / sp / online 配对 / online 对战 / online-room 房间码）
```
