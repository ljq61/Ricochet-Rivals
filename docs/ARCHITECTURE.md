# Ricochet Rivals — Architecture

本文档定义项目的长期架构约束与关键决策。
顶层开发约束以仓库根目录 `CODELY.md` 为准，本文档是其架构展开。

## 1. 总览

Ricochet Rivals 是横版 2D 回合制弹道对战网页游戏。

技术栈：

| 层 | 选型 |
| --- | --- |
| 语言 | TypeScript（strict） |
| 构建 | Vite |
| 渲染 / 场景 | Phaser 4.x |
| 物理 | Phaser Matter Physics |
| 测试 | Vitest |
| 联机（后续） | WebRTC RTCDataChannel（Host Authoritative） |

核心设计目标：

**Single Player 与 Multiplayer 共用同一套 Game Logic，区别只是 Input Source。**

```
LocalInput ─┐
AIInput ────┤→ GameCommand → Game Logic (GameState/Turn/Damage/Projectile)
NetworkInput┘                      ↑                ↓
                              Host 权威状态    渲染 / UI / 音效
```

## 2. 分层规则

必须严格分离（CODELY.md §3）：

| 模块 | 职责 | 禁止 |
| --- | --- | --- |
| state/ | 纯数据：GameState、PlayerState、TurnPhase | 持有任何 Phaser 对象 |
| commands/ | GameCommand discriminated union | 感知输入来源 |
| systems/ | 回合、移动、伤害、投射物等规则逻辑 | 直接读写 DOM / 直接监听输入 |
| camera/ | CameraMode 状态机、相机滚动计算 | 承载游戏规则 |
| input/ | 人类 / AI / 网络输入 → GameCommand | 包含游戏规则 |
| scenes/ | 生命周期、系统初始化与连接、update 调度 | 变成 God Object |
| ui/ | HUD、Debug、反馈表现 | 修改 GameState |
| physics/ | 弹道计算、物理适配 | 散落 magic numbers |
| network/ | Transport 抽象、协议、状态同步 | 被 Game Logic 直接 import WebRTC |
| ai/ | AI 决策 → GameCommand | 直接调用 Player 内部方法 |

**State 红线**：`GameState` / `PlayerState` 严禁持有 Sprite、Matter Body、Camera、Scene。
渲染层通过 `playerId` 关联 State 并读取数据；写入永远走 System / Command。

**BattleScene 红线**：只做生命周期、初始化、连接、update 调度；
任何具体规则逻辑（伤害计算、移动预算、回合切换）都必须下沉到对应 System。

## 3. Command 驱动

所有玩家行为最终转换为 `GameCommand`（`src/game/commands/GameCommand.ts`）：

```ts
type GameCommand = MoveCommand | FireCommand | ReadyCommand;
```

- 本地玩家、AI、远端网络玩家产生**同一种** Command。
- Game Logic 通过 CommandBus 接收并验证（turnId、playerId、合法性），不感知来源。
- AI 与网络模块**只能**通过 Command 影响游戏，禁止直接调用内部方法改状态。

## 4. 目录结构

```
src/
  main.ts                        # 入口：创建 Phaser.Game
  game/
    config/
      GameConfig.ts              # 所有 Gameplay 参数唯一来源（as const）
      DebugConfig.ts             # DEBUG_GAME 总开关
      PhaserGameConfig.ts        # Phaser 实例配置（Scale/Matter/Scene 列表）
    state/                       # 纯逻辑数据层（零 Phaser 依赖）
      ids.ts                     # PlayerId / MatchId / TurnId / WeaponId ...
      TurnPhase.ts
      PlayerState.ts
      WorldItemState.ts          # V0.1 仅定义，预留 Item 系统
      ProjectileState.ts         # 投射物状态契约（velocity 单位 px/s）
      ExplosionEvent.ts          # ProjectileImpact / ExplosionEvent 契约（Phase 7）
      DamageResult.ts            # PlayerDamageResult / DamageResult 契约（Phase 7）
      GameState.ts               # 含 createInitialGameState 纯工厂
    commands/
      GameCommand.ts             # MOVE / FIRE / READY 契约
      CommandBus.ts              # CommandBus 接口 + InMemoryCommandBus
    scenes/
      BootScene.ts
      BattleScene.ts             # 生命周期 / 初始化 / 连接 / update 调度
    entities/
      Player.ts                  # 玩家视觉实体（每帧从 PlayerState 同步）
      Projectile.ts              # 投射物：State + Matter 刚体 + 视觉 + 状态机
    systems/
      WorldBuilder.ts            # 占位世界视觉（地面/基地/刻度）
      MovementSystem.ts          # 移动规则（阶段/边界/预算/hasFired/校验，纯逻辑）
      FireSystem.ts              # FIRE 校验 + hasFired + 阶段门禁（纯逻辑）
      ProjectileSystem.ts        # 炮弹管理：刚体/碰撞/出界/超时/引信
      DamageSystem.ts           # 伤害分层计算 + 结算写入 GameState（Phase 7，纯逻辑）
      ExplosionSystem.ts        # Impact → ExplosionEvent → DamageSystem（Phase 7）
      TurnManager.ts            # 回合阶段状态机（Phase 8：相位/切换/重置，纯逻辑）
      GameLogic.ts               # 订阅 CommandBus，路由命令到各系统
    physics/
      aimMath.ts                 # 瞄准计算纯函数（拖拽→方向/力度/速度）
      TrajectoryCalculator.ts    # 弹道预测纯函数（p₀+v·t+½g·t²）
      collisionCategories.ts     # Matter 碰撞分类（GROUND/PLAYER/PROJECTILE）
      projectileRules.ts         # 出界/超时/引信 纯函数（可单测）
    platform/                     # Phase 6.5：平台档案 / 视口 / 横屏门禁
      DeviceProfile.ts           # pointer/hover 能力 → ControlProfile（禁 UA）
      viewportMath.ts            # zoom 指标纯函数 + safe-area 探测（零 Phaser）
      ViewportService.ts         # 唯一 RESIZE 枢纽：动态 zoom + 通知订阅者
      OrientationGate.ts         # 竖屏 + 触屏 → DOM 旋转提示覆盖层
    input/
      InputSource.ts             # 输入源契约（Human/AI/Network 同接口）
      gesture.ts                 # GestureArbiter：优先级仲裁 + 单 Owner 生命周期（纯逻辑）
      InputRouter.ts             # window PointerEvents → Arbiter（桌面/触屏统一指针入口）
      MoveInputCore.ts           # 键盘/触屏共享移动加速曲线 + MoveCommand
      KeyboardMoveInput.ts       # A/D 与方向键 → direction → MoveInputCore
      DesktopControls.ts         # 桌面档位门面：键盘移动 + Space/Esc/右键快捷键
      TouchControls.ts           # 触屏档位门面：◀/▶ 按住按钮 + 己方/敌方聚焦（InputSource）
      AimController.ts           # AIM claimant：拖拽 → AimState → FireCommand（含死区）
      aimGesture.ts              # 瞄准死区纯函数
      CameraHotkeys.ts           # Space 发起瞄准 / Esc·右键取消（桌面）
    camera/
      CameraMode.ts              # 6 模式枚举
      cameraBounds.ts            # 中心锚定 clamp 纯函数（zoom 无关，可单测）
      cameraMotion.ts            # 指数平滑纯函数（帧率无关）
      aimFlow.ts                 # 瞄准流程模式转移表（纯函数，可单测）
      CameraController.ts        # 相机状态机：拖动/回家/瞄准/跟随/爆炸停留/panToX
    ui/
      AimButton.ts               # 固定 HUD 按钮（回到炮手 / 瞄准 / 取消；InputRouter zone）
      AimRenderer.ts             # 瞄准渲染（拖线/力度条/轨迹点/拉伸圈；反馈按 1/zoom 缩放）
      PlayerHud.ts               # 双方 HP 血条（Safe Area 布局，HP 变化动画，Phase 7）
      DamageNumbers.ts           # 受击伤害数字（世界锚定浮动，Phase 7）
      DebugOverlay.ts
    utils/
      MathUtils.ts               # clamp / moveToward 等纯工具
tests/                           # Vitest（node 环境，只测纯逻辑）
```

后续 Phase 按需扩展（ai/ network/），
**不为目录完整而预建空文件**。

## 5. 关键架构决策（Phase 0–8 已定型）

### 5.1 State 与 Phaser 完全分离

`state/` 目录不 import Phaser，可在 node 环境（Vitest）直接测试。
渲染层（WorldBuilder / 未来的 Player 实体）读取 State 生成 GameObject。

### 5.2 相机滚动 clamp 手写而非依赖 Phaser bounds

`cameraBounds.ts` 提供纯函数（Phase 6.5 起为**中心锚定**语义，
zoom 无关）：

- `clampCameraCenterX(centerX, visibleWorldWidth, worldWidth)`
- `groundAnchoredCenterY(visibleWorldHeight, worldHeight)`

原因：

1. 可单测（9 个测试覆盖此模块）；
2. 不受 Phaser 内部 bounds 行为差异影响；
3. viewport 比 World 更大时（极端窗口）可显式定义"居中"语义；
4. Phaser zoom 围绕视口中心缩放，相机中心（= scroll + viewport/2）
   与 zoom 无关 —— ViewportService 的动态 zoom 不破坏任何边界。

### 5.3 指针事件：window 级 Pointer Events + InputRouter 仲裁

Phaser 4 的 MouseManager 默认只监听 Canvas（`MouseInputConfig.target`）。
若完全依赖 Phaser Input 做拖动，鼠标拖出 Canvas 后 move/up 丢失，Camera 会卡住
（Phase 1 验收标准 7 明确禁止）。

Phase 6.5 起，指针生命周期统一由 `InputRouter` 接管（§5.12）：

- window 级 `pointerdown/pointermove/pointerup/pointercancel`，
  统一鼠标 / 触摸 / 触控笔（pointerId 天然支持多指仲裁）；
- pointerdown 仅在 `event.target === canvas` 时受理 ——
  DOM 覆盖层（竖屏提示）天然拦截手势；
- 相机拖动 / 瞄准拖拽作为 GestureClaimant 由 GestureArbiter 按优先级
  仲裁（UI > AIM > MOVEMENT > CAMERA），HUD 按钮注册屏幕 zone；
- window blur → 所有手势按 cancel 释放；
- Phaser Unified Pointer 仅保留给键盘与右键（CameraHotkeys）。

### 5.4 Scale 采用 RESIZE 模式 + 动态相机 zoom

`Phaser.Scale.RESIZE` + `width/height '100%'`：Viewport 响应浏览器
尺寸（需求原文）。Phase 6.5 起 `ViewportService` 作为唯一 RESIZE
枢纽：zoom = viewportHeight / worldViewHeight(1080)（clamp
[0.3, 3]）→ 纵向构图稳定，超宽屏自然看到更多横向世界，
桌面 1080p 与 Phase 1～6（zoom=1）行为完全一致。
垂直贴地（`groundAnchoredCenterY`），水平 clamp 在 World Bounds
（中心语义）。

### 5.5 Matter 物理接入与单位适配（Phase 5 定型）

- **重力单位适配**：GameConfig 统一 px/s²（gravityY = 1000）；
  Matter 的 gravity 1 ≈ 1000 px/s²，转换在 `PhaserGameConfig` 完成
  （`/ 1000`）——这是契约允许的"Physics Adapter 层转换"，
  系统代码永远只使用 px/s²。
- **速度单位适配**：FireCommand / ProjectileState 的 velocity 为 px/s；
  Matter `setVelocity` 为 px/step（60Hz），转换在 Projectile 内（`/ 60`）。
- **炮弹 frictionAir = 0**：与 TrajectoryCalculator 的解析抛体一致，
  "预览即真实前 0.8 秒"成立。
- **碰撞分类**：`collisionCategories.ts`（GROUND / PLAYER / PROJECTILE），
  玩家刚体（28×76 静态矩形）每帧从 PlayerState 同步，只作为炮弹目标，
  不参与移动物理。
- **引信机制**：炮弹出生点在炮手碰撞体内，飞离发射点 100px 前
  collisionMask 只含 GROUND，之后激活 PLAYER（保持激活，
  回落砸中发射者同样爆炸）——见 `projectileRules.isProjectileArmed`。

### 5.6 Debug UI 开关

`DebugConfig.DEBUG_GAME` 控制 DebugOverlay 创建与否；
发布 / 演示时改为 `false` 即隐藏，无需删除代码。

### 5.7 移动全链路走 Command（Phase 2 定型）

```
键盘 → KeyboardMoveInput → MoveCommand(targetX)
     → CommandBus → GameLogic → MovementSystem.execute(state, cmd)
     → GameState（唯一数据源）→ Player 实体视觉同步
```

要点：

- 输入层不含规则：边界 clamp、预算消耗、hasFired、turnId / currentPlayer
  校验全部在 `MovementSystem`（纯逻辑，18 个单测覆盖）；
- 键盘按住时每帧产生一个增量 MoveCommand（加速手感在输入层实现），
  AI / 网络未来直接发"最终位置"命令，走同一校验入口；
- 距离按实际移动累计（向右 100 再向左 40 = 消耗 140），
  松开方向键立即停（无惯性），避免浪费移动预算。

### 5.8 瞄准流程是相机状态机，不是 GameCommand（Phase 3 定型）

「发起瞄准 / 取消」只影响 CameraMode，不改变 GameState，
因此不走 CommandBus，直接由 UI / 快捷键驱动 CameraController：

```
AimButton / Space → requestAim(playerXProvider)
  FREE_VIEW → RETURN_HOME（350ms Tween）→ AIMING
Esc / 右键 → cancelAim()
  AIMING | RETURN_HOME → FREE_VIEW
```

要点：

- 合法转移表抽成纯函数 `aimFlow.ts`（8 个单测），非法请求一律忽略，
  后续 Phase 的相机模式（PROJECTILE_FOLLOW 等）不会被瞄准/取消误打断；
- AIMING 通过 provider 读取当前玩家 x，玩家移动时相机持续居中跟随；
- Phase 4 的拖拽瞄准发生在 AIMING 模式内，发射才产生 FireCommand；
  届时"取消瞄准"同样先经 aimFlow 回到 FREE_VIEW。

### 5.9 瞄准三件套分层（Phase 4 定型）

```
aimMath.ts（纯）      拖拽 → direction/power/velocity，零 Phaser
TrajectoryCalculator（纯）  p₀+v·t+½g·t²，与 Projectile 同一套重力
AimController（输入）  AIMING 拖拽事件 → 维护 AimState → 松手发 FireCommand
AimRenderer（渲染）   只读 AimState 画拖线/力度条/轨迹点
FireSystem（规则）    校验 FIRE + hasFired=true
```

要点：

- 力度/方向的**全部数值计算**在纯函数，输入层只管事件采集，
  AI（Phase 10）与网络玩家（Phase 12+）可绕过 AimController 直接构造
  FireCommand，走同一 FireSystem 校验；
- 轨迹预览使用与 Projectile 相同的 GameConfig 重力参数——
  预览即真实模型的前 0.8 秒（CODELY.md §13 禁止假轨迹）；
- 拖拽事件统一走 InputRouter（AIM claimant，§5.12）：
  触屏起始判定 150 屏幕px + 14px 死区（防误触），
  桌面保持 180 世界px 且死区 0（与 Phase 4 一致）；
- 力度不足（< 0.15）松手 = 静默取消，不产生命令；
- 发射后：FireSystem 标记 hasFired → 移动即被 MovementSystem 拒绝
  （两系统通过 State 解耦），Phase 5 在同一 FIRE 路由上接 ProjectileSystem。

### 5.10 投射物链路（Phase 5 定型）

```
FireCommand → GameLogic → FireSystem 校验（hasFired）
                        → ProjectileSystem.launch → Projectile
碰撞/超时 → IMPACT → EXPLODING（280ms 占位动画）→ DESTROYED
出界     → 直接 DESTROYED（无爆炸）
```

要点：

- **Projectile 不改任何 PlayerState**：爆炸结算走 Phase 7 的
  ExplosionEvent → DamageSystem，Projectile 层只推进自身状态机；
- ProjectileSystem 持有地面/玩家静态刚体，玩家刚体每帧从 State 同步
  ——物理层从 State 读、不向 State 写（除投射物自身 ProjectileState）；
- `activeProjectiles` 只读暴露 ProjectileState 列表，
  Phase 6 相机跟随、Phase 7 爆炸事件都从这里取数据；
- 投射物判定规则（出界 / 超时 / 引信）全部是 `physics/projectileRules.ts`
  纯函数（7 个单测），系统层无内联 magic numbers。

### 5.11 相机跟随与攻击收口（Phase 6 定型）

```
ProjectileSystem 事件（相机 / TurnManager 消费，实体无感知）：
  onLaunched ──→ CameraController.followProjectile(provider)
                   → PROJECTILE_FOLLOW（双轴指数平滑 rate 10/s）
  onImpact ────→ CameraController.focusImpact(爆炸点): Promise
                   → IMPACT（贴向爆炸点，停留 850ms 后 resolve）
  onOutOfBounds → 直接结束攻击（无爆炸点可锁定）
停留结束 / 出界 → BattleScene.onAttackResolved
                   → 当前占位回 FREE_VIEW；Phase 8 改通知 TurnManager
```

要点：

- 相机去向由**事件**驱动而非输入回调——本地拖拽、AI、网络 FIRE 走同一
  launch 入口，镜头行为天然一致；
- 平滑用 `cameraMotion.exponentialApproach`（时间可加性 = 帧率无关），
  "不硬锁"由收敛速率参数表达（projectileFollowRate / impactFocusRate）；
- 跟随时水平 clamp 在 World Bounds，垂直自由——炮弹可飞出世界上沿，
  相机跟到天空，IMPACT 时自然回落；
- focusImpact 的 Promise 在停留结束或模式被外部接管时 resolve；
  onAttackResolved 用"当前模式仍为 IMPACT/FOLLOW"门控，
  过期回调不会覆盖已被接管的新镜头；
- Phase 4 的"发射后回 FREE_VIEW"占位已移除（由本节流程取代）。

### 5.12 平台层与手势仲裁（Phase 6.5 定型）

Mobile Landscape 为一等目标平台（CODELY.md §25）。
**Desktop 与 Mobile 共用全部 Gameplay**，平台差异只存在于
Input Adapter / HUD Layout / Viewport / Safe Area / Touch Feedback /
Desktop Keyboard Shortcuts。

```
DeviceProfile（pointer fine/coarse + hover + maxTouchPoints，禁 UA）
  ├─ desktop → DesktopControls（KeyboardMoveInput + CameraHotkeys）
  └─ touch   → TouchControls（◀/▶ hold + 己方/敌方聚焦，InputSource 门面）
两者共用：
  MoveInputCore（加速曲线 + MoveCommand）
  AimController / aimMath（同一瞄准计算）
  CameraController / cameraBounds（同一相机语义）
  GestureArbiter（同一仲裁规则）

InputRouter（window PointerEvents，鼠标/触摸/触控笔统一）
  → GestureArbiter（优先级 UI > AIM > MOVEMENT > CAMERA；
     按 pointerId 追踪，一个 Pointer 一个 Owner，
     up/cancel/blur 释放）
  → Zone（AimButton、TouchControls 按钮 —— 屏幕实体按钮一律 UI）
  → Claimant（AIM = AimController，CAMERA = CameraController）

ViewportService（唯一 RESIZE 枢纽）
  zoom = viewportHeight / worldViewHeight(1080)  → camera.setZoom
  → onChange → CameraController.onViewportChanged（重 clamp）
              → HUD（safe-area 重排）
```

要点：

- **纵向构图稳定**：所有设备显示相同的世界纵向范围（1080 世界px），
  超宽屏（19.5:9 / 20:9）自然看到更多横向世界；桌面 1080p zoom=1，
  与 Phase 1～6 行为完全一致。World / Physics / Movement / Explosion
  参数不因设备改变。
- **相机中心锚定**：Phaser zoom 围绕视口中心缩放，midPoint =
  scroll + viewport/2 与 zoom 无关（phaser 源码验证）；
  cameraBounds 全部改为中心语义纯函数，zoom 变化不破坏边界。
- **指针入口**：window 级 Pointer Events 取代旧的 mousemove/mouseup
  方案（Phase 1 的"移出 Canvas 不丢事件"问题依旧覆盖），并天然携带
  pointerId 供多指仲裁；pointerdown 只认 `event.target === canvas`，
  DOM 覆盖层（竖屏旋转提示）显示时手势天然被拦截。
- **屏幕按钮 = UI tier**：触屏上炮塔瞄准起始半径可能覆盖 ◀/▶ 按钮
  区域，按住按钮移动不能被误判为开始瞄准 —— 实体按钮一律注册 UI
  zone（永远先于 AIM/CAMERA 世界手势）；MOVEMENT tier 预留给未来
  非按钮移动手势。
- **触屏瞄准采集**：起始判定 150 屏幕px（÷zoom 换算世界距离），
  拖动超 14px 死区才激活（防误触），死区内松手静默取消；
  桌面死区 0，与 Phase 4 行为一致。AimButton 在 AIMING 时点击 =
  取消瞄准（触屏无 Esc 的取消入口，桌面同步受益）。
- **瞄准反馈**：AimRenderer 反馈元素尺寸按 1/zoom 缩放（屏幕尺寸
  恒定）；位置与最大拉伸圈半径保持世界真实值（gameplay 语义）。
- **浏览器手势冲突**：touch-action:none + user-scalable=no +
  viewport-fit=cover（safe-area env() 生效）+ overscroll-behavior:none
  + iOS gesturestart 兜底 + body fixed。
- **E2E**：`npm run e2e`（puppeteer-core + 系统 Chrome headless，
  vite preview 服务 dist），Desktop 鼠标键盘与 Mobile 触摸模拟
  （含发射→跟随→爆炸→收口全链路、竖屏覆盖层）共 29 项断言。

### 5.13 爆炸与伤害链路（Phase 7 定型）

红线（CODELY.md §15）：Projectile 不直接修改 Player HP。

```
ProjectileSystem.onImpact(ProjectileImpact {x,y,ownerId,weaponId,turnId})
  → BattleScene（系统连接）
  → ExplosionSystem.explode(state, impact)
      → ExplosionEvent（半径统一来自 GameConfig.explosion）
      → DamageSystem.calculate → DamageResult
      → DamageSystem.apply → GameState（hp / isAlive / gameOver / winnerId）
  → 反馈（渲染层，只读结果）：
      camera.shake（渲染矩阵偏移，不污染 scroll）
      + DamageNumbers（受击者头顶 -N）
      + Player.playHitReaction（受击闪烁）
      + PlayerHud（血条动画，State 变化驱动）
      + focusImpact 停留 850ms（Phase 6 链路）
```

要点：

- **分层伤害**：≤60 → 2；60 < d ≤ 140 → 1；>140 → 0。
  距离 = 爆炸中心到玩家**身体中心**（x, y − collision.height/2）；
- **阵亡与胜负**：apply 内 hp clamp ≥ 0 → isAlive；任一阵亡即
  gameOver + winnerId（同归于尽 → null）。Phase 8 TurnManager 消费该状态；
- 已阵亡玩家免疫（damage 0，血量不变）；自爆（回落砸发射者）同样结算；
- Projectile 携带 turnId（FIRE 命令），爆炸事件可追溯到回合 ——
  Phase 8 TurnManager 校验 / Phase 15 stateHash 都依赖它；
- DamageSystem / ExplosionSystem 零 Phaser 依赖、纯逻辑可单测
  （16 个单测覆盖分层边界 / 几何 / 阵亡 / 胜负）；
- 未来扩展（Shield / Poison / Critical / Damage Boost / Armor）
  只改 DamageSystem，Projectile / UI 不动。

### 5.14 回合状态机（Phase 8 定型）

TurnManager（纯逻辑）唯一拥有 TurnPhase / turnId / currentPlayerId；
相机与输入不拥有回合状态，只在事件点回调状态机。

```
startMatch → ACTION（重置预算 + hasFired）
requestAim（仅 ACTION、未发射、存活）→ RETURN_HOME
  ├─ 相机 Tween 到位 →（场景对账）→ AIM
  └─ cancel → ACTION
FIRE 校验通过 → notifyProjectileLaunched → PROJECTILE
爆炸结算（DamageSystem 已写 gameOver）/ 出界 → RESOLVE | GAME_OVER
停留结束 → endTurn → END（turnId++、切换玩家、重置新玩家）
相机 TURN_TRANSITION 600ms 到新玩家 → notifyTurnTransitionComplete → ACTION
GAME_OVER：回合冻结（不切换、输入与命令全拒）
```

要点：

- **相位门禁显式化**：MovementSystem / FireSystem 校验
  `WRONG_PHASE`（允许 ACTION / RETURN_HOME / AIM）——
  PROJECTILE 起禁止移动与二次发射。hasFired 仍是双保险；
  自由相机由 CameraMode 门禁天然保证（仅 FREE_VIEW 可拖动）；
- **瞄准中可移动**是既定 UX（相机经 provider 跟随），三个阶段同权；
- **相机 ↔ 相位对账**：RETURN_HOME→AIM 由 update() 每帧对账
  （相机 Tween 完成是异步的）；其余转移由事件点回调，
  非法转移一律忽略（幂等，与 aimFlow 风格一致）；
- **热座输入**：MoveInputCore 用 playerId Provider 跟随当前回合玩家
  （Local 2P 即此形态）；Phase 10 SP 时 AI 回合场景
  setEnabled(false) 人类输入，架构不变；
- **死亡判定不在 TurnManager**：DamageSystem.apply 写入
  gameOver / winnerId（Phase 7），本状态机只消费该标志；
- **GAME_OVER 后续**：Phase 11 菜单 / Phase 16 Rematch 在此接续。

## 6. 联机（Phase 12 Transport 已落地；13+ 继续实现）

### 分层

```
Gameplay（TurnManager / 命令系统）
        ↓ 只依赖
NetworkManager（envelope 组装 / 分发 / sequence / PING-PONG）
        ↓ 只依赖
NetworkTransport（接口：状态机 / send / 订阅，订阅返回取消函数）
        ↓ 实现
WebRTCTransport（P2P dataChannel）      LocalLoopbackTransport（离线开发 / 测试）
```

### 协议与防线

- **versioned 协议**：一切 wire 消息为 `NetworkEnvelope`（version 固定 1，
  不兼容演进必须递增 version）；`sequence` 由发送方单调自增，
  NetworkManager 保存远端最近 sequence（Phase 14/15 命令对齐与
  desync 检测用）。
- **Untrusted input 校验**：出站 `serializeEnvelope`（内部数据失败即 bug，
  直接 throw）；入站 `deserializeEnvelope` 以 Result 返回，网络垃圾消息
  记录丢弃，不崩 transport、不改状态。
- Host Authoritative：建房者持有权威 GameState；Guest 本地只做预测播放。
- 只同步 Command / 关键事件 / 结果快照，禁止逐帧同步弹道坐标。
- Game Logic 只依赖 `NetworkManager` 门面 + `NetworkTransport` 抽象，
  禁止直接 import RTCPeerConnection（WebRTC API 只存在于
  WebRTCTransport 与 WebRTCConfig 类型）。
- 物理不假设跨端 100% deterministic，差异以 Host `TURN_RESULT` 快照为准。

### WebRTC 边界

- 单一可靠有序 dataChannel（`'game'`，`ordered: true`；禁
  maxRetransmits / maxPacketLifeTime —— 回合制命令不可丢）。
- Offer/Answer（JSON string 编码）由信令通道搬运；
  `createOffer/createAnswer` 等待 ICE gathering complete（2s 超时兜底，
  Phase 13 Connection Code 需完整 SDP）。
- **WebRTC P2P ≠ 所有网络可直连**：默认 STUN（`stun:stun.l.google.com:19302`）
  仅协助 NAT traversal；严格 NAT / 防火墙场景可能需要 TURN 中继。
  Phase 12 仅架构支持（`WebRTCConfig.iceServers` 可注入 TURN），不部署
  任何 TURN；TURN 凭据属部署环境，禁止入仓库。

### 阶段边界

- **Phase 12**：Transport only —— 协议层 + NetworkManager +
  WebRTCTransport，零 Gameplay 接线。
- **Phase 13**：Connection Flow（房间 / 信令 / 连接码 UI）。
- **Phase 14**：Gameplay Sync（GameCommand ↔ envelope 对齐 +
  HOST AUTHORITATIVE 校验）。
- **Phase 15**：Desync Protection（STATE_SNAPSHOT 对账 / sequence 检查 /
  恢复策略）。

## 7. 质量门禁

每个 Phase 完成必须全部通过：

```bash
npm run typecheck   # tsc --noEmit（strict）
npm run test        # vitest run
npm run build       # tsc --noEmit && vite build
```

失败必须先修复，禁止带错进入下一 Phase（CODELY.md §20/§21）。
