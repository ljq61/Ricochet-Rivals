# Ricochet Rivals

横版 2D 回合制弹道对战网页游戏。
Worms 式双方阵地对抗 + Angry Birds 式反方向拖拽瞄准发射。

当前进度：**Phase 0 ～ Phase 6 完成**（见 `TASKS.md`）。

## 技术栈

- TypeScript (strict) + Vite
- Phaser 4.x + Matter Physics
- Vitest
- （后续）WebRTC RTCDataChannel P2P，Host Authoritative

## 开发

```bash
npm install --include=dev   # 本机 npm 全局 omit=dev，必须带 --include=dev

npm run dev        # 启动开发服务器
npm run typecheck  # tsc --noEmit（strict）
npm run test       # vitest run
npm run build      # 类型检查 + 生产构建
npm run preview    # 预览构建产物
```

## 当前玩法（Phase 1 + 2）

- 5000 × 1080 超宽世界，左右两个基地与炮手占位
- 鼠标左键拖动空白区域横向移动 Camera（不能拖出世界边界）
- A / D 或方向键移动 P1 炮手：限制在己方阵地内，每回合 250px 预算按实际距离消耗
- 底部按钮或 Space 发起瞄准：Camera 350ms 回到炮手并锁定；Esc / 右键取消，未发射前可反复观察
- 瞄准中在炮手附近左键反向拖拽：拖线 + 力度条 + 12 点 0.8s 轨迹预览，松手发射（≥15% 力度）；发射后本回合锁定
- 松手后 Matter 物理炮弹沿预览弹道飞行（frictionAir=0，预览即真实）：碰地面/玩家/8s 超时 → 占位爆炸动画；飞出世界边界直接销毁
- 发射后相机自动平滑跟随炮弹（PROJECTILE_FOLLOW），命中后锁定爆炸点停留 850ms（IMPACT），随后回到自由观察
- 左上角 Debug Overlay：FPS / Camera X / Current Player / Turn / Camera Mode
- `src/game/config/DebugConfig.ts` 中 `DEBUG_GAME` 控制调试信息开关

## 文档

- `CODELY.md` — 项目长期架构与开发约束（顶层规则）
- `docs/ARCHITECTURE.md` — 分层架构与关键决策
- `docs/GAMEPLAY.md` — 玩法规则与参数表
- `TASKS.md` — Phase 开发计划（Phase 0～18）
- `docs/横版回合制弹道对战网页游戏 V0.1 PRD.md` — 产品需求
- `docs/TASKS.md + Core TypeScript Contracts.md` — 原始规划草稿

## 目录

```
src/
  main.ts                 # 入口
  game/
    config/               # GameConfig / DebugConfig / PhaserGameConfig / Palette
    state/                # 纯数据层（GameState 等，零 Phaser 依赖）
    commands/             # GameCommand（MOVE / FIRE / READY）+ CommandBus
    scenes/               # BootScene / BattleScene
    entities/             # Player / Projectile（视觉+Matter 实体）
    systems/              # WorldBuilder / MovementSystem / FireSystem / ProjectileSystem / GameLogic
    physics/              # aimMath / TrajectoryCalculator / collisionCategories / projectileRules（纯函数）
    input/                # InputSource / KeyboardMoveInput / AimController / CameraHotkeys
    camera/               # CameraMode 状态机 / aimFlow / 拖动与回家瞄准
    ui/                   # AimButton / AimRenderer / DebugOverlay
    utils/                # MathUtils
tests/                    # Vitest 纯逻辑测试
```
