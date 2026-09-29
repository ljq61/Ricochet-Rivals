# Ricochet Rivals

横版 2D 回合制弹道对战网页游戏。
Worms 式双方阵地对抗 + Angry Birds 式反方向拖拽瞄准发射。

当前进度：**Phase 0 ～ Phase 14 完成**（见 `TASKS.md`）——含 **WebRTC P2P 联机对战**（Host Authoritative），**真机 Mac ↔ iPhone 配对 + 完整对战实测跑通**（2026-09-29 真机修复轮，见 TASKS.md Phase 13 节）。

## 技术栈

- TypeScript (strict) + Vite
- Phaser 4.x + Matter Physics
- Vitest（442 单测）+ puppeteer-core E2E（118 项，Windows / macOS 双平台，双浏览器真实 WebRTC 对战）
- WebRTC RTCDataChannel P2P 联机（HOST AUTHORITATIVE，已落地）

## 开发

```bash
npm install --include=dev   # 本机 npm 全局 omit=dev，必须带 --include=dev

npm run dev        # 启动开发服务器
npm run typecheck  # tsc --noEmit（strict）
npm run test       # vitest run（442 项）
npm run build      # 类型检查 + 生产构建
npm run preview    # 预览构建产物
npm run e2e        # 全量 E2E（desktop / mobile / sp / online 配对 / online 对战）
                   # 调试单场景：RR_E2E_ONLY=battle|online|sp|mobile|desktop npm run e2e
```

## 游戏模式

- **Single Player**：P1 vs AI（三档难度：easy / normal / hard，seeded RNG，纯函数决策）
- **Local 2 Player**：热座双人（共用键鼠 / 触屏，回合切换横幅提示）
- **Online P2P**：手动配对（Host 生成连接码 ↔ 微信等渠道互发 ↔ Guest 应答），真实 WebRTC DataChannel 直连；**Host = P1 = 权威**，Guest 为意图客户端（本地仅做表现播放，HP / 伤害 / 回合切换一律以 Host 广播为准）。真机优化：Guest Response 码页面内展示（HTTP 下长按复制）、等待 Host 应用无时限、Host 侧 2 分钟连接预算、COPY 按钮剪贴板双路径（clipboard API → execCommand 降级，跨平台可靠复制）

## 玩法要点

- 5000 × 1080 超宽世界，左右两个基地；每回合 250px 移动预算（按实际距离消耗），一回合限一次发射
- 鼠标拖动 / 触屏拖动自由观察战场；Space 或准星按钮「回到炮手 / 瞄准」（350ms 相机回家 → 锁定）
- Angry Birds 式反向拖拽瞄准：拖线 + 力度条 + 12 点轨迹预览，松手发射；Esc / 右键 / 再点按钮取消
- 炮弹飞行相机自动平滑跟随，命中后爆炸点停留 850ms（抖动 + 伤害数字 + 受击闪烁）
- 伤害分层：距爆心 ≤60px 直伤 2 点，≤140px 溅射 1 点；10 HP 制，先清零对方获胜
- 回合状态机：START → ACTION → RETURN_HOME → AIM → PROJECTILE → RESOLVE → END → 下一回合
- 联机同步：只同步命令与权威快照（MOVE / FIRE 参数 + TURN_RESULT），**绝不逐帧同步炮弹坐标**；双方本地模拟弹道，结果以 Host `TURN_RESULT` 为准（stateHash 双端比对）；回合切换由 Host `TURN_END` 授权（Turn Barrier）
- 断线处理：对方掉线冻结输入 + OPPONENT DISCONNECTED 横幅 + 返回菜单（复杂重连归后续阶段）

## 平台

- Desktop：A / D 移动、鼠标瞄准 / 相机拖动、Space 瞄准、Esc / 右键取消
- Mobile Landscape（一等目标）：触屏方向按钮、拇指范围大热区瞄准（死区防误触）、Safe Area HUD、高 DPR 清晰渲染、竖屏门禁（连接流程除外）
- 输入能力（pointer/hover）决定控制档位，不用 User Agent 猜测；世界坐标与物理参数跨设备恒定

## 架构

命令驱动：Human / AI / Network 输入统一转 `GameCommand` → `CommandBus` → `GameLogic` → 系统层（单一 validate+execute 路径，Game Logic 不感知命令来源）。严格分层：GameLogic / Rendering / Input / AI / Network / Camera / UI 互不渗透；联机协议层（`src/game/network/online/`）见 `docs/ARCHITECTURE.md` §6。

## 文档

- `CODELY.md` — 项目长期架构与开发约束（顶层规则）
- `docs/ARCHITECTURE.md` — 分层架构与关键决策（含联机协议与 Phase 14 落地架构）
- `docs/GAMEPLAY.md` — 玩法规则与参数表
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
    platform/             # ViewportService / DeviceProfile / OrientationGate
    settings/             # UserSettings（localStorage）
    random/               # SeededRandom（Mulberry32）
    ui/                   # AimButton / AimRenderer / TurnBanner / PlayerHud / DebugOverlay
    utils/                # MathUtils
tests/                    # Vitest 纯逻辑测试（38 文件 442 项，含双端 loopback 集成）
scripts/e2e.mjs           # E2E（desktop / mobile / sp / online 配对 / online 对战）
```
