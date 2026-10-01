# Ricochet Rivals — Development Tasks

> 状态：**Phase 0 ～ Phase 17 已完成（2026-09-29）；Phase 18（Mobile QA & V0.1 Release Hardening）agent 侧已闭环：基础设施审计（3 缺口全处置）+ 聚焦钮命中区 48px 下限 + 粒子观测口 + E2E 扩展（932×430@DPR3 视口矩阵 / 双指 / pointercancel / 粒子预算）+ test-reviewer PASS WITH ISSUES（仅 P3×3，已即时修复）—— **agent 侧 Release Gate 就绪**；剩余：用户真机 QA（`docs/PHASE18_DEVICE_QA.md` A-F 段）→ 反馈修复 → Phase 18 = COMPLETE + V0.1 RELEASE GATE。不自动进入 V0.2。**
> 并行轨道：**Online Connection Migration（SG-0 ~ SG-8，分支 `dev_signaling_turn`，2026-10-01 已合并 main）—— 全部 Stage ✅（SG-8 ICE Restart 2026-09-30 收官：限次 restartIce 经活信令 + peerToken 重入、恢复走既有 Phase 15 恢复链）。公网 WSS 信令已部署并验证（Render 单实例；9 项公网协议检查 + 34 项真实 WebRTC 双端对战 + 5 项 Pages 手机尺寸配对检查）。合并 main 前复验（2026-10-01）：根 788/788 + server 43/43 + 全量 E2E **215/215**。剩余 = coturn TURN（尚未启用）与真机验收矩阵、Manual SDP Cleanup。详见「Online Connection Migration」章节。**
> 当前验证（2026-10-01）：`npm run typecheck` / `npm run test`（**790**）/ `npm run build` / `npm run e2e` 全量 **215 passed / 0 failed** 全绿（六段；含 Host 直推快照恢复修复与转场近距快转；E2E 严禁与写 dist 任务并行）。
> 规则：每完成一个 Phase → 更新本文件 → 跑三项验证 → 停止，等待下一 Phase。

---

# Phase 0 — Bootstrap ✅

- [x] 创建 Vite + TypeScript 项目
- [x] 安装 Phaser
- [x] 配置 Matter Physics
- [x] 配置 TypeScript strict
- [x] 配置 Vitest
- [x] 创建基础目录
- [x] 创建 GameConfig
- [x] 创建 Phaser Config
- [x] 创建 BootScene
- [x] 创建 BattleScene
- [x] 添加 npm scripts：
  - [x] dev
  - [x] build
  - [x] typecheck
  - [x] test
- [x] 创建基础 README
- [x] 创建 docs/ARCHITECTURE.md
- [x] 创建 docs/GAMEPLAY.md

验收：

- [x] npm run typecheck
- [x] npm run test
- [x] npm run build

---

# Phase 1 — World & Free Camera ✅

## World

- [x] World Size = 5000 × 1080
- [x] Ground
- [x] Left Base
- [x] Right Base
- [x] P1 placeholder
- [x] P2 placeholder

## Camera

实现 CameraController。

状态：

FREE_VIEW

RETURN_HOME

AIMING

PROJECTILE_FOLLOW

IMPACT

TURN_TRANSITION

当前只激活：

FREE_VIEW

功能：

- [x] Mouse Drag
- [x] Horizontal Camera Movement
- [x] World Bounds
- [x] Prevent Browser text selection
- [x] Correct pointer release behavior
  - 注：拖动监听使用 window 级 DOM 事件（Phaser MouseManager 只监听 Canvas，
    直接依赖它会在鼠标移出 Canvas 时丢失 move/up 导致 Camera 卡住）；
    window blur 时强制结束拖动。

## Debug

- [x] FPS
- [x] Camera X
- [x] Current Player
- [x] Turn
- [x] Camera Mode
- [x] DEBUG_GAME 开关（DebugConfig.ts）

验收：

- [x] 从 P1 基地能够平滑拖到 P2 基地
- [x] Camera 不能拖出地图边界
- [x] GameState 不依赖 Phaser GameObject
- [x] 未实现 Phase 2+ 任何 Gameplay（无 Projectile / Damage / AI / WebRTC / Items）

## 测试（Phase 1 新增）

- [x] GameState 初始状态（19 个测试：state / cameraBounds / GameConfig integrity）

---

# Phase 2 — Player Movement ✅

实现：

Player（视觉实体）

KeyboardMoveInput + InputSource（输入层）

MovementSystem + CommandBus + GameLogic（规则与路由）

## Rule

P1：

100 <= x <= 850

P2：

4150 <= x <= 4900

每回合：

moveBudget = 250

累计移动消耗。

例如：

+100

-50

消耗：

150。

## Input

支持：

A / D

或者：

Left / Right

同时预留未来屏幕 UI。

实现说明：

- 键盘 → KeyboardMoveInput → MoveCommand → CommandBus → GameLogic → MovementSystem
- 按住加速（maxSpeed 320 px/s，加速度 2400 px/s²，来自 GameConfig），松开立即停止
- 输入层无规则逻辑；边界 / 预算 / hasFired 校验全部在 MovementSystem
- InputSource 接口已就位，未来屏幕 UI / AI / 网络输入实现同一接口即可接入

## Movement

- [x] acceleration / speed 参数 Config 化
- [x] movement boundaries
- [x] move budget
- [x] movement animation placeholder（移动时轻微起伏）
- [x] face direction（随移动方向翻转，初始朝向中央）
- [x] GameState sync（Player 实体每帧从 State 同步）

## Test

测试：

- [x] P1 Bounds
- [x] P2 Bounds
- [x] Movement Budget
- [x] Reverse Movement Still Costs Distance
- [x] Movement Disabled After Fire
- [x] Command 校验（turnId / currentPlayer / gameOver / isAlive / 原地不动）

（18 个 MovementSystem 测试，全部通过）

---

# Phase 3 — Camera Home & Aim Mode ✅

增加：

“瞄准 / 回到炮手”

固定 HUD Button。

快捷键：

Space。

流程：

FREE_VIEW

↓

RETURN_HOME

↓

AIMING

RETURN_HOME：

Camera Tween 到 Current Player。

约：

350ms。

完成前：

不能拖 Aim。

AIMING：

锁 Camera。

## Cancel

Escape / Right Mouse：

AIMING

↓

FREE_VIEW

尚未发射时允许反复：

观察 → 瞄准 → 取消 → 观察。

## 实现说明（2026-09-28）

- [x] AimButton（ui/AimButton.ts）：固定底部中央 HUD 按钮，AIMING 时文案切换为取消提示，窗口 resize 自动重定位
- [x] CameraHotkeys（input/CameraHotkeys.ts）：Space 发起、Esc / 右键取消；禁用 Canvas 右键菜单
- [x] RETURN_HOME：350ms Sine.easeOut Tween（`camera.returnHomeDurationMs`），期间禁止拖动；完成自动进入 AIMING
- [x] AIMING：相机每帧锁定当前炮手（provider 读取，玩家移动保持跟随），禁止拖动
- [x] 相机模式转移表抽出为纯函数 aimFlow.ts（8 个单测覆盖非法转移被忽略）
- [x] 拖动启动改为 Phaser pointerdown + hitTestPointer：点击 UI 按钮不再误开相机拖动；拖动持续仍走 window 监听（防移出 Canvas 卡死）

---

# Phase 4 — Angry Birds Aim ✅

实现：

AimController（input/AimController.ts）

AimRenderer（ui/AimRenderer.ts）

aimMath + TrajectoryCalculator（physics/，纯函数）

FireSystem（systems/，FIRE 校验 + hasFired）

## Interaction

pointerDown：

炮手附近 / Aim Zone

drag：

反方向拖拽

pointerUp：

FireCommand

## Constants

MAX_AIM_DRAG：

180px

MIN_FIRE_POWER：

0.15

MIN_LAUNCH_SPEED：

550

MAX_LAUNCH_SPEED：

2400

（2026-09-28 调参：原建议 1400 → 2400。1400 的 45° 最大射程 v²/g 仅 1960px，
双方阵地间距 3300～4800px，物理上无法命中对面；2400 射程 5760px 覆盖最坏情况。
CODELY.md §7 的"建议值"未同步，以 GameConfig 为准。）

## Formula

drag:

pointer - launchOrigin

direction:

-normalize(drag)

power:

clamp(length(drag) / MAX_AIM_DRAG)

speed:

lerp(
MIN_LAUNCH_SPEED,
MAX_LAUNCH_SPEED,
power
)

velocity:

direction × speed

## Aim UI

- [x] Drag line（炮塔 → 指针，力度染色）
- [x] Power indicator（炮手上方力度条，绿→黄→红）
- [x] Trajectory dots（12 点 / 0.8s，渐小渐透明，力度不足时不显示）
- [x] Maximum stretch indication（180px 虚线圆）

## Preview

大约：

12 points

只预测：

0.8 second

禁止显示完整落点。

## Tests

- [x] power clamp
- [x] direction inversion
- [x] minimum power
- [x] trajectory formula
- [x] FireSystem 校验（turnId / currentPlayer / isAlive / gameOver / ALREADY_FIRED）+ 与 MovementSystem 的 hasFired 一致性

## 实现说明（2026-09-28）

- 瞄准计算（aimMath.ts）与弹道预测（TrajectoryCalculator.ts）全部纯函数，零 Phaser 依赖，19 个单测覆盖
- 发射原点 = 炮手脚底 + `player.launcher.offsetY`（-64，炮塔位置），Phase 5 炮弹从此出生
- AimController：AIMING + 未发射 + 炮手 220px 内 pointerdown 开始；拖拽持续/释放走 window 监听（移出 Canvas 不丢）；低于最小力度松手 = 静默取消；Esc/右键取消瞄准时自动中止
- 轨迹预测与 Projectile 共用同一 GameConfig 重力（p = p₀ + v·t + ½g·t²），不写"假轨迹"
- FireCommand 全参数（playerId/turnId/weaponId/start/velocity/seed）经 CommandBus → GameLogic → FireSystem；Phase 4 仅标记 hasFired 并锁移动，炮弹 Phase 5 生成
- 发射后相机回 FREE_VIEW（Phase 6 起改为 PROJECTILE_FOLLOW）

---

# Phase 5 — Projectile ✅

实现：

Projectile（entities/Projectile.ts）

ProjectileSystem（systems/ProjectileSystem.ts，含工厂职责 launch/create）

ProjectileState（state/ProjectileState.ts，契约）

第一种：

NORMAL（唯一 WeaponId）

## Matter

使用统一：

gravity（单位适配：GameConfig px/s² ÷ 1000 → Matter gravity，PhaserGameConfig 完成）

collision categories（physics/collisionCategories.ts：GROUND / PLAYER / PROJECTILE）

world bounds（出界判定 physics/projectileRules.ts，纯函数 + 7 单测）

## State

SPAWN → FLYING → IMPACT → EXPLODING → DESTROYED ✅
（出界直接 DESTROYED，无爆炸）

## Fire

AimController 不直接创建 Projectile。

流程：

AimController

↓

FireCommand

↓

CommandBus

↓

GameLogic（FireSystem 校验通过）

↓

ProjectileSystem.launch

↓

Projectile ✅

## Collision

支持：

Ground ✅

Player ✅（引信距离 180px 内不激活，避免扩大后的角色在发射瞬间自爆；激活后回落砸发射者同样爆炸）

Obstacle（V0.1 无障碍物，FUTURE）

World Exit ✅（左右/穿地越界直接销毁）

## Lifetime

最大：

8 seconds ✅（超时原地爆炸）

## 实现说明（2026-09-28）

- Matter gravity 单位坑修复：Matter gravity 1 ≈ 1000 px/s²，GameConfig 的 px/s² 在 PhaserGameConfig 层 ÷1000 适配（Phase 0 遗留隐患）
- 炮弹刚体 frictionAir=0：与 TrajectoryCalculator 预览同一抛体模型，预览即真实前 0.8s
- FireCommand velocity（px/s）→ Matter setVelocity（px/step，÷60）适配在 Projectile 内
- 玩家碰撞体（120×180 静态矩形）每帧从 PlayerState 同步；不参与移动物理
- 占位爆炸动画（IMPACT→EXPLODING 280ms 扩散淡出）；正式爆炸/伤害/反馈为 Phase 7
- Projectile 不修改任何 PlayerState（HP 由 Phase 7 DamageSystem 处理）

---

# Phase 6 — Projectile Camera ✅

当 Projectile 发射：

CameraMode：

PROJECTILE_FOLLOW ✅（launch 事件驱动，指数平滑 rate 10/s，帧率无关，不硬锁）

实现：

Camera smoothly follows Projectile。✅

不要完全硬锁。✅

Projectile 碰撞：

Camera：

IMPACT ✅（impact 事件驱动，取刚体实时位置为爆炸点）

锁定爆炸点。✅（impactFocusRate 16/s 平滑贴住）

停留：

约 850ms。✅（`camera.impactStayMs`，停留结束 Promise resolve）

随后通知：

TurnManager。✅（事件点位已就绪：onAttackResolved 回调；Phase 8 接 TurnManager）
当前占位：停留结束 / 出界 → 回 FREE_VIEW 观察战场。

## 实现说明（2026-09-28）

- ProjectileSystem 新增事件：onLaunched / onImpact（爆炸点）/ onOutOfBounds——相机与未来 TurnManager 都从事件消费，Projectile 实体保持无感知
- 发射后相机去向由 launch 事件统一驱动（AI / 网络 FIRE 走同一入口，行为一致）；移除了 Phase 4 的"发射后回 FREE_VIEW"占位
- 相机跟随为双轴：水平 clamp 在 World Bounds，垂直自由（炮弹可飞出世界上沿，相机跟随到天空）
- 平滑公式抽成纯函数 cameraMotion.exponentialApproach（时间可加性=帧率无关，5 个单测）
- focusImpact 返回 Promise；模式被外部接管时提前 resolve（stale 安全：onAttackResolved 只在仍处于 IMPACT/PROJECTILE_FOLLOW 时切 FREE_VIEW）
- 出界销毁：无爆炸点可锁定，直接结束攻击（相机回 FREE_VIEW）

---

# Phase 6.5 — Mobile-First Interaction & Responsive UX ✅

Mobile Landscape 提升为一等目标平台（CODELY.md §25）。
Desktop + Mobile 共用全部 Gameplay（GameState / GameCommand /
MovementSystem / Aim 计算 / ProjectileSystem / 相机边界语义），
差异只存在于 Input Adapter、HUD Layout、Viewport / Safe Area、
Touch Feedback、Desktop Keyboard Shortcuts。

## 架构（新增系统）

- [x] DeviceProfile（platform/）：按 pointer capability（fine/coarse）、
      hover capability、maxTouchPoints 决定 ControlProfile；
      禁止 User Agent 判断。混合设备（触屏笔记本）→ desktop。
- [x] ViewportService + viewportMath（platform/）：唯一 RESIZE 枢纽。
      纵向构图稳定：zoom = viewportHeight / worldViewHeight(1080)，
      clamp [0.3, 3]；19.5:9 / 20:9 手机自然看到更多横向世界，
      桌面 1080p zoom=1 与 Phase 1～6 行为完全一致。
      World = 5000×1080 与全部 Physics / Movement / Explosion 参数不变。
- [x] Safe Area：env(safe-area-inset-*) 探针（index.html 加
      viewport-fit=cover），HUD 布局消费 insets。
- [x] InputRouter + GestureArbiter（input/）：window 级 Pointer Events
      统一鼠标 / 触摸 / 触控笔（天然 pointerId 多指仲裁）。
      优先级 UI > AIM > MOVEMENT > CAMERA；同一 Pointer 从 pointerdown
      到 pointerup / pointercancel 只属于一个 Gesture Owner；
      window blur / pointercancel 按 cancel 释放。
      屏幕实体按钮一律注册 UI zone（炮塔瞄准半径可能覆盖按钮区域，
      按住按钮移动不能被误判为开始瞄准）。
- [x] MoveInputCore（input/）：键盘与触屏方向按钮共用同一加速曲线
      与 MoveCommand 链路 —— 移动手感跨平台完全一致。
- [x] DesktopControls / TouchControls（input/）：两个 Control Profile
      的 InputSource 门面；TouchControls 含大号 ◀/▶ 按住移动按钮
      （多指各自追踪）与「己方 / 敌方」快捷聚焦（仅 FREE_VIEW 激活）。

## Camera / 瞄准适配（不重写 Gameplay）

- [x] 相机数学改为中心锚定（cameraBounds.ts）：
      Phaser zoom 围绕视口中心缩放，midPoint = scroll + viewport/2 与
      zoom 无关（源码验证）；clampCameraCenterX / groundAnchoredCenterY
      纯函数，zoom 变化不破坏任何边界语义。
- [x] CameraController 拖动改走 InputRouter claimant；
      拖动速度按 1/zoom 换算；新增 panToX（快捷聚焦平移）。
- [x] AimController 改走 InputRouter claimant：触屏起始判定
      aimStartRadiusScreenPx(150) 屏幕半径（÷zoom 换算世界距离），
      桌面保持 startRadius(220) 世界距离；aimMath 纯函数未动。
- [x] Aim Dead Zone：触屏拖动超过 14px 才激活（防误触），
      死区内松手 = 静默取消不发射；桌面死区 0 = 与 Phase 4 一致。
- [x] AimButton：InputRouter zone 命中；触屏加大（300×72）并抬高到
      移动按钮之上；AIMING 时点击 = 取消瞄准（触屏无 Esc 的取消入口，
      桌面同步受益）。
- [x] AimRenderer：反馈元素尺寸按 1/zoom 缩放（屏幕尺寸恒定 =
      Touch Feedback 平台差异），位置与最大拉伸圈保持世界真实值。

## Mobile 必备项

- [x] Landscape only gameplay：竖屏 + 触屏 → OrientationGate 显示
      「请横过来」DOM 覆盖层（覆盖层同时拦截 InputRouter 手势）
- [x] Responsive viewport（Scale.RESIZE + ViewportService）
- [x] Dynamic camera zoom（纵向构图稳定）
- [x] Safe area HUD
- [x] Single finger camera drag
- [x] Large LEFT / RIGHT hold controls（88px，多指追踪）
- [x] Enlarged Aim touch area（150 屏幕px）
- [x] Aim dead zone（14px）
- [x] Gesture capture / arbitration（UI > AIM > MOVEMENT > CAMERA）
- [x] Focus Self / Focus Enemy camera shortcuts（panToX 450ms）
- [x] Prevent browser scroll / zoom conflict（touch-action:none、
      user-scalable=no、overscroll-behavior、iOS gesturestart 兜底、
      body fixed）
- [x] Resize and orientation handling（RESIZE → zoom 重算 + 重 clamp；
      竖屏 → 覆盖层；转回横屏恢复）

## 实现说明（2026-09-28）

- 相机中心锚定迁移：requestAim Tween / AIMING 锁定 / PROJECTILE_FOLLOW
  平滑 / IMPACT 停留 / 拖动全部经 clampCameraCenterX，行为与
  zoom=1 时代完全等价（相机回归测试更新为 9 个中心语义用例）
- InputRouter pointerdown 只认 event.target === canvas —— DOM 覆盖层
  （横屏提示）天然拦截手势，无需额外耦合
- 相机/瞄准控制器不再持有任何 DOM 监听（window mousemove 等全部
  移交 InputRouter），destroy 生命周期由 BattleScene 统一调度
- DeviceProfile 能力矩阵 / viewport 指标 / GestureArbiter 优先级与
  单一 Owner 生命周期 / MoveInputCore 加速曲线 / 瞄准死区 —— 全部
  纯逻辑单测覆盖；Phaser 依赖只留在 Service / Controller 薄层
- E2E（npm run e2e，puppeteer-core + 系统 Chrome headless）：
  Desktop（鼠标拖动 / A,D 移动 / Space→AIMING / Esc 取消 /
  拖拽发射→PROJECTILE_FOLLOW→IMPACT→FREE_VIEW 全链路）与
  Mobile（844×390 触摸模拟：touch profile / zoom 0.361 / 单指拖动 /
  ◀ 按住移动与松开即停 / AimButton 点击与取消 / 死区不发射 /
  拖拽发射全链路 / 己方·敌方聚焦 / 竖屏覆盖层与手势拦截 / 转回横屏）
  共 29 项断言全部通过

### 真机修复轮（2026-09-28 手机实测反馈）

症状：真机上 UI 显示位置与触点命中位置不一致（"画面在中间、点击在别处"）。

- [x] 根因定位：触点 zone 命中直接拿 clientX/Y（页面坐标）比对
      游戏坐标 —— 画布一旦被手机浏览器缩放 / 偏移
      （fixed 元素百分比链、工具栏、旋转时序等），输入与画面即错位
- [x] InputRouter 统一坐标归一化：client → 画布坐标
      （canvas.getBoundingClientRect() × gameSize），所有 zone 命中 /
      瞄准 / 相机拖动与视觉渲染同一空间；瞄准死区保留 client 坐标
      （物理手感）；画布铺满视口时为恒等变换（桌面 / E2E 行为不变）
- [x] index.html：布局改四边拉伸（position:fixed + top/left/right/bottom），
      去掉 width/height:100% 百分比链（部分手机浏览器对 fixed 元素
      百分比高度解析与可见视口不一致）
- [x] ViewportService：监听 visualViewport resize → scale.refresh()
      （iOS 工具栏收起 / 旋转时序下 window resize 可能不触发的兜底）
- [x] DebugOverlay 新增真机诊断行：Canvas CSS 尺寸 / Game 尺寸 / DPR /
      window 视口尺寸（三组数字应当一致，不一致即定位错位根源）
- [x] E2E 新增回归用例：故意偏移画布后点击"视觉位置"仍命中 zone
      （E2E 29 → 44 项）

### 高分屏清晰渲染（2026-09-28 iPhone 17 Pro 真机反馈：字体发糊）

根因（Phaser 源码验证）：引擎全库不使用 devicePixelRatio，
RESIZE 模式画布位图 = CSS 像素（canvas.width = baseSize）——
DPR 3 的 iPhone 上位图被浏览器拉伸 3 倍 → 所有文字 / 图形发糊。

- [x] Scale 模式 RESIZE → **NONE** + ViewportService 手动驱动：
      scale.resize(CSS×DPR) 位图 = 物理分辨率（清晰），
      zoom = 1/DPR 把 CSS 显示尺寸缩回；游戏坐标空间 = 物理像素
- [x] ViewportMetrics 新增 uiScale（= DPR）：HUD 尺寸 / 字号 /
      边距 / 触摸瞄准半径等"屏幕手感"常量统一 ×uiScale，
      CSS 观感跨设备恒定（HUD Layout 平台差异区）
- [x] 可见视口取 visualViewport 优先（iOS 工具栏可见时 =
      玩家真实可见区域，底部按钮不再被工具栏盖住）
- [x] canvas CSS 尺寸由 ViewportService 显式写死：
      Phaser 只在 styleSize ≠ gameSize 时写样式，zoom=1 的桌面
      会跳过导致 CSS 滞留占位值（画布压扁 + rect≠gameSize 错位，
      E2E 曾复现 45° 射击全失准）—— 手动布局保证位图与 CSS 同步
- [x] 世界相机 zoom = 物理高度/1080：可见世界纵向范围跨设备恒定
      （DPR 被 zoom 精确补偿，构图与 DPR 无关）
- [x] 诊断行新增 UIScale：正确关系 = Game = Canvas × DPR = VP × DPR
- [x] E2E（44 → 48 项）：Mobile 升级为 DPR 2 物理像素全链路
      （位图 1688×780 / uiScale 2 / 命中 / 回合循环 / 偏移回归），
      Desktop + Mobile 各加"画布 CSS 尺寸 = 视口"防滞留断言

## 测试（Phase 6.5 新增）

- [x] DeviceProfile 能力矩阵（6）
- [x] Viewport 指标：zoom 公式 / 超宽屏横向扩展 / clamp / 方向（9）
- [x] GestureArbiter：优先级 / 单 Owner / cancel / blur / 非主键 /
      inactive zone / hover（14）
- [x] MoveInputCore：加速 / 立即停 / 命令 / 禁用（6）
- [x] 瞄准死区（4）
- [x] cameraBounds 中心语义重写（9，替换旧 scroll 语义 8）
- [x] E2E：npm run e2e（29 项，Desktop + Mobile）

验收：

- [x] npm run typecheck
- [x] npm run test（116 tests / 15 files）
- [x] npm run build
- [x] Desktop Mouse + Keyboard 实测（E2E）
- [x] Mobile Touch 实测（E2E 触摸模拟）
- [x] 未开始 Phase 7（Explosion & Damage）

---

# Phase 7 — Explosion & Damage ✅

实现：

- [x] ExplosionSystem（systems/ExplosionSystem.ts）
- [x] DamageSystem（systems/DamageSystem.ts，纯逻辑）
- [x] DamageResult（state/DamageResult.ts，契约）
- [x] ExplosionEvent / ProjectileImpact（state/ExplosionEvent.ts，契约）

## Radius

- [x] ≤ 60：2 Damage（directDamage）
- [x] 60 ～ 140：1 Damage（splashDamage）
- [x] > 140：0 Damage
- [x] Player：10 HP
- [x] 距离 = 爆炸中心到玩家碰撞矩形最近边缘（矩形内部距离为 0；二头身体型同步）

## Feedback（Placeholder）

- [x] Explosion Circle（爆炸范围提示环：真实 explosion.radius=140 红色扩散环 + 本体扩散淡出）
- [x] Camera Shake（camera.shake 300ms / 0.012，渲染矩阵偏移不污染 scroll 语义）
- [x] Damage Number（受击玩家头顶浮动 "-N"，2 伤红 / 1 伤黄，上升淡出）
- [x] Character Flash（受击玩家整体闪烁 4 次）
- [x] HP HUD Animation（PlayerHud：左上 P1 / 右上 P2 血条 + 数值，
      HP 变化触发血条 Tween + 数值闪红放大，阵亡置灰；Safe Area 布局）

## Flow（CODELY.md §15 红线）

Projectile 不直接执行 `player.hp -= damage`：

- [x] Projectile 携带 turnId（FIRE 命令）；
      ProjectileSystem 的 onImpact payload 扩展为
      ProjectileImpact { x, y, ownerId, weaponId, turnId }
- [x] ExplosionSystem.explode：Impact → ExplosionEvent（半径来自
      GameConfig.explosion）→ DamageSystem.calculate → apply → DamageResult
- [x] DamageSystem.apply：hp clamp ≥ 0 → isAlive →
      任一阵亡即 gameOver + winnerId（同归于尽 → null；
      Phase 8 TurnManager 消费）
- [x] 已阵亡玩家不再受伤（damage 0，血量不变）
- [x] 自爆：回落砸中发射者同样结算（Phase 5 引信语义延续）

## 实现说明（2026-09-28）

- BattleScene.onImpact 顺序：先 explode（同步结算 GameState），再驱动
  反馈（相机抖动 → 伤害数字 → 受击闪烁 → focusImpact 停留 850ms）
- DamageSystem 与 ExplosionSystem 均零 Phaser 依赖，calculate/apply
  纯函数式可测；未来 Shield / Poison / Critical / Armor 只改 DamageSystem
- PlayerHud 每帧从 PlayerState 刷新（State 唯一数据源），
  内部做 HP 变化检测触发动画，渲染层不写任何状态
- Phaser camera.shake 是 preRender 阶段的渲染矩阵偏移，
  与 CameraController 每帧 scroll clamp 天然兼容（源码验证）

## 测试（Phase 7 新增）

- [x] DamageSystem：分层边界（60→2 / 60.0001→1 / 140→1 / 140.0001→0）、
      玩家 AABB 最近边缘几何、双玩家结果、阵亡免疫、hpAfter clamp、
      apply 写入 GameState、gameOver + winner、自爆、同归于尽（12）
- [x] ExplosionSystem：事件构建（半径/上下文透传）、结算链一致、
      击杀流程、远落点无伤（4）
- [x] E2E：45° 弹道求解直接命中 P2 —— Desktop 与 Mobile 各自跑通
      Impact → Damage → GameState 全链路（P2 HP 下降、P1 无伤、
      游戏未结束），E2E 总数 29 → 36

验收：

- [x] npm run typecheck
- [x] npm run test（135 tests / 17 files）
- [x] npm run build
- [x] npm run e2e（36 项，含双端真实命中伤害验证）
- [x] 未开始 Phase 8（Turn Manager）

---

# Phase 8 — Turn Manager ✅

实现完整回合状态机（systems/TurnManager.ts，纯逻辑驱动 GameState）：

START ✅ → ACTION ✅ → RETURN_HOME ✅ → AIM ✅ → PROJECTILE ✅
→ RESOLVE ✅ → END ✅ →（相机 TURN_TRANSITION）→ ACTION ✅
致死 → GAME_OVER ✅（回合冻结，不切换）

## START

- [x] Reset move budget（startMatch/beginTurn → moveRemaining = 250）
- [x] Reset hasFired

## ACTION

允许：

- [x] Move（MovementSystem：ACTION/RETURN_HOME/AIM 阶段放行）
- [x] Free Camera
- [x] Aim（TurnManager.requestAim：仅 ACTION；已发射 / 已阵亡拒绝）

## AIM

- [x] Aim Control（相机到位后 BattleScene 对账 → phase AIM；
      瞄准中移动仍允许 —— 既定 UX，相机经 provider 跟随）

## PROJECTILE

禁止：

- [x] Movement（MovementSystem WRONG_PHASE；hasFired 双保险）
- [x] Free Camera（CameraMode 门禁，仅 FREE_VIEW 可拖动）
- [x] Second Fire（FireSystem WRONG_PHASE + hasFired）

## RESOLVE

- [x] Damage（Phase 7 链路在 impact 同步完成）
- [x] Result（DamageResult 透传；出界 = null）
- [x] Game Over Check（消费 DamageSystem 写入的 gameOver → GAME_OVER）

## END

- [x] Switch Player（endTurn：turnId++、切换玩家、重置新玩家
      moveRemaining + hasFired；gameOver 不切换）

Camera：

- [x] TURN_TRANSITION（CameraController.transitionToPlayer：
      600ms Sine.easeInOut 平移到新玩家，完成自动回 FREE_VIEW 并
      resolve Promise → 场景据此进入下一回合 ACTION；
      模式被接管时提前 resolve，stale 安全）

## 输入架构（Phase 8 调整）

- [x] MoveInputCore 改为 playerId Provider：热座输入跟随当前回合
      玩家（P1/P2 共用键盘/触屏 —— Phase 9 本地双人即此形态；
      Phase 10 SP 时 AI 回合场景 setEnabled(false) 人类输入）
- [x] requestAim/cancelAim 由 TurnManager 相位门禁先行，
      相机流程（aimFlow）保持不变

## Test（TASKS 验收项，全部覆盖）

- [x] Turn increments（1→2→3）
- [x] Current Player switches（P1→P2→P1）
- [x] Move resets（endTurn 重置新玩家 250 / false）
- [x] Fire once only（hasFired + WRONG_PHASE 双层）
- [x] Dead player triggers game over（GAME_OVER 冻结，不切换）

单元（新增 TurnManager 12 个；Movement/Fire/MoveInputCore 更新
phase 门禁用例）：157 tests / 18 files 全绿。

E2E（36→43）：Desktop 完整回合循环 P1→P2→P1（热座键盘跟随 P2、
P2 45° 回击命中 P1、setHp 注入残血后补刀 → gameOver + GAME_OVER
+ 不切换回合）；Mobile 回合切换 + 新当前玩家下聚焦按钮验证。

验收：

- [x] npm run typecheck
- [x] npm run test（157 tests / 18 files）
- [x] npm run build
- [x] npm run e2e（43 项）
- [x] 未开始 Phase 9（Full Local 2P Prototype）

---

# Phase 9 — Full Local 2P Prototype ✅

暂时两个玩家都使用同一电脑。

P1 Turn：Human ✅

P2 Turn：Human ✅

（热座自 Phase 8 起已就位：MoveInputCore playerId Provider
跟随当前回合玩家，P1/P2 共用同一套输入与全部 Gameplay。）

确保：

完整 Battle Loop 可以从：

P1 ↓ P2 ↓ P1 一直运行。✅

（E2E 升级为**自然完整对局**：不再注入 HP，双方 45° 互射
9 回合 —— P1 10→8→6→4→2、P2 10→8→6→4→2→0 ——
第 9 回合 P1 自然击杀获胜，全程无任何状态注入。）

这一步是重要 Gameplay Review Gate。✅

- [x] TurnBanner（ui/TurnBanner.ts）：新回合 ACTION 开始时
      短暂展示「P1 · 第 N 回合」横幅（玩家着色，淡入停留淡出，
      纯视觉不阻塞输入）—— 此前"轮到谁"只有 DebugOverlay 可见，
      真人热座无法感知回合切换
- [x] 胜负画面：gameOver → 持久横幅「P1 获胜！」
      （winnerId = null → 「平局 · 同归于尽」），轻微呼吸动画，
      State 变化检测驱动（同 PlayerHud displayedHp 模式）
- [x] E2E：Desktop 自然完整对局（9 发互射 → 自然击杀 →
      winnerId / 终局血量 / 不切换回合 / 胜负横幅断言）；
      Desktop + Mobile 回合横幅断言（开局 P1、切换后 P2）
- [x] 调参入口确认：Gravity / Launch Speed / Camera Speed /
      Explosion Radius / Damage / Movement Distance 全部集中于
      GameConfig（无 magic number），试玩反馈后直接改此文件

## 实现说明（2026-09-28）

- 横幅触发时机 = 相位进入 ACTION 且 currentPlayerId:turnId 键
  变化（开场一次 + 每次 TURN_TRANSITION 完成后一次；取消瞄准
  回 ACTION 不换键，不重复弹横幅）；gameOver 后 showTurn 被
  winnerActive 门禁挡住，胜负横幅接管
- TurnBanner 遵循 HUD 约定：scrollFactor(0) / depth 960 /
  uiScale（= DPR）/ Safe Area 顶部居中 / viewport 变化重定位；
  渲染层只读派生数据，不写状态
- debug handles 新增 turnBanner {visible,text} / lastBannerText
  （fade 后保留，E2E 时序无关断言）/ winnerId
- 本阶段无 AI（Phase 10 才引入），无新增 Gameplay 参数变更 ——
  参数"手感"调优等待试玩反馈（见下方 Review Gate）

## Review Gate（Gameplay 手感试玩）—— 反馈落地中

### 已落地反馈 ①（2026-09-28）：点击「回到炮手/瞄准」后位置锁定

原行为（Phase 8 既定 UX）：瞄准中（RETURN_HOME / AIM）仍可移动。
按试玩反馈改为：

- [x] **MovementSystem：仅 ACTION 阶段允许移动** —— 点击
      「回到炮手 / 瞄准」按钮的瞬间（相位 → RETURN_HOME）位置即锁定；
      取消瞄准 / 新回合回 ACTION 自动恢复，剩余预算继续可用
      （每回合 250px 重置不变 —— "每回合都能移动"不受影响）
- [x] **移动端：◀/▶ 移动按钮仅 ACTION 相位显示** —— 进入瞄准流程
      即隐藏（zone 同步失活，原按钮区域可正常开始瞄准拖拽，
      隐藏时清空按住追踪），取消瞄准恢复
- [x] 单元测试：MovementSystem RETURN_HOME / AIM 由放行改为
      WRONG_PHASE（锁定 + 预算不消耗）
- [x] E2E：Desktop「AIMING 中按住 D 不动 / 取消后移动恢复」；
      Mobile「AIMING 中按钮隐藏 / 取消后恢复」

### E2E 踩坑记录（2026-09-28，Desktop 拖拽起点）

AIMING 相机中心受世界边界 clamp（桌面 1280×800 可见宽 1728，
中心左极限 864）——炮手屏幕 x = (玩家x − 864)·zoom + 640。
P1 移动到 ~663 后炮塔屏幕位置 (490, 676) 恰好落进 AimButton
zone（x∈[490,790], y∈[668,724]）→ pointerdown 被按钮抢走 =
取消瞄准，拖拽永远无法发射。修复：Desktop 拖拽起点统一上移
60 CSS px（与 Mobile 同一防御；仍在 220 世界 px 起始半径内，
瞄准向量按「指针 − 炮塔」计算，起点偏移不影响力度/方向）。

### 已落地反馈 ②（2026-09-28）：移动端 UI 布局调整（仅触屏档位）

- [x] **「己方 / 敌方」聚焦按钮**：右下角 → 画面中间底部成对居中，
      尺寸缩小 2/3（72 → 24 CSS px，圆形，字号 22 → 10）
- [x] **◀ / ▶ 移动按钮**：常驻半透明 alpha 0.2（按下抬亮 0.5
      保留按压反馈）；zone 命中与移动手感不变
- [x] **「回到炮手 / 瞄准」按钮**：底部大文字按钮 → 画面右侧
      垂直居中的准星 icon（64 CSS px）—— 蓝准星 = 点击瞄准；
      AIMING 红准星 + 斜杠 = 点击取消；桌面档位保持原文字按钮
- [x] E2E 同步：AimButton 触点 (422,222) → (792,195)；聚焦按钮
      (788/704, 334) → (438/406, 358)；画布偏移回归改负向偏移
      （正向会把右侧 icon 推出 844 视口）

参数手感维度（试玩后按反馈调整，全部在 GameConfig）：

| 手感维度 | 参数 | 当前值 |
|---|---|---|
| Gravity | physics.gravityY | 1000 px/s² |
| Launch Speed | aiming.min/maxLaunchSpeed | 550 / 2400 |
| Camera Speed | camera.returnHome / follow / transition | 350ms / rate 10 / 600ms |
| Explosion Radius | explosion.radius / directDamageRadius | 140 / 60 |
| Damage | explosion.directDamage / splashDamage | 2 / 1 |
| Movement Distance | player.maxMovePerTurn | 250 |

验收：

- [x] npm run typecheck
- [x] npm run test（159 tests / 18 files）
- [x] npm run build
- [x] npm run e2e（71 项，43 → 71：自然完整对局 + 横幅断言 +
      瞄准位置锁定 / 移动按钮隐藏断言）
- [ ] 用户试玩反馈手感（Review Gate 出口）
- [x] 未开始 Phase 10（Single Player AI）

---

# Phase 10 — Single Player AI ✅

实现：

- [x] AIController（src/game/ai/AIController.ts，纯逻辑决策核心，零 Phaser）
- [x] TrajectorySolver（src/game/ai/TrajectorySolver.ts）
- [x] AIInputSource（src/game/ai/AIInputSource.ts，实现 InputSource 契约）
- [x] SeededRandom（src/game/random/SeededRandom.ts，Mulberry32，
      next/range/integer —— CODELY.md §16 首次落地）
- [x] aiMode（src/game/ai/aiMode.ts，URL `?ai=1&difficulty=easy|normal|hard`，
      缺省 Local 2P 行为零变化）
- [x] GameConfig.ai 配置节（表现延迟 / 尽力弹仰角 / 三档难度误差）

AI 必须产生 GameCommand。✅（dispatch MOVE/FIRE → CommandBus → GameLogic
→ MovementSystem/FireSystem，与人类完全同链路；AIController 纯读 state）

禁止直接控制 Scene。✅（相机零改动：FIRE → onLaunched 事件自动驱动）

## AI Flow（已实现）

Turn Start（AI 回合 = currentPlayer 为 P2 且 phase ACTION）
↓
思考延迟 500–900ms（seeded，表现层）
↓
Evaluate Position（AIController.decide 纯函数）
↓
Optional MoveCommand（原地无解时搜索 ≤4 个合法候选：
朝敌/背敌 × 全程/半程，clamp bounds+预算，MovementSystem 终审）
↓
Calculate Shot（TrajectorySolver）
↓
Apply Error（难度 seeded 误差）
↓
停顿 250–500ms
↓
FireCommand（start 用发射瞬间炮塔位置）
↓
正常 Gameplay 系统执行 ✅

## TrajectorySolver 策略

- 45° 射程灵敏度驻点（角度误差二阶不敏感）+ 力度一维二分搜索
  （射程对速度单调，48 次迭代上限 + 0.25px 收敛，绝不死循环）
- 复用 TrajectoryCalculator 同一解析模型与 GAME_CONFIG 全部参数
  （gravity 1000 / 速度 550–2400 / groundTopY / 直伤半径 60px 容差），
  零第二套物理常量
- 不可行弹道（超射程 / 过近 / 同 x / NaN）→ null；
  AIController 兜底尽力弹（朝敌 30° + √(R·g) 估速）——
  回合唯一出口是发射，绝不卡死
- 已知 Matter 半隐式积分 ~0.6–0.7% 过冲由 60px 直伤半径吸收（不补偿）

## Difficulty 策略（一套 AI，三档参数）

| 难度 | aimErrorDeg | powerErrorRatio |
|---|---|---|
| easy | ±16° | ±25% |
| normal（CODELY.md §18） | ±8° | ±12% |
| hard | ±3° | ±5% |

误差全部经 SeededRandom（seed = GameState.seed）；误差后速度 clamp 回
[550, 2400]、角度 clamp [1°, 179°]（与人类可达空间同构）。

## AI UX

- 思考 500–900ms → 移动 → 停顿 250–500ms → 发射，全部 seeded
- 延迟只存在于 AIInputSource 状态机（idle→thinking→moving），
  决策零延迟纯函数（不影响可测性）
- SP 人类静默：AI 回合内 controls.setEnabled(false)（移动禁用）+
  requestAim/cancelAim 的 isAiControlledTurn 守卫（Space/Esc/右键/
  AimButton 全部静默）；回合切回人类自动恢复；gameOver 后人类恢复
  自由观察

## 委托记录（Subagent 工作流）

- gameplay-engineer：全部实现 + 37 个单测（MAX_TURNS 截断，
  Main Agent 补尾：BattleScene 重复接线清理、solver 类型注解、
  测试窄化守卫与时序假设修正）
- Main Agent：集成审查通过（命令链路 / 无复制逻辑 / 输入零回归 /
  人类静默链验证）+ T1 GameConfig ai 节守卫断言补强 + M1 注释口径修正
- test-reviewer：**PASS WITH ISSUES**（12 项验收全过、零 Critical/High、
  typecheck/test/build 独立复跑全绿）

## 测试（Phase 10 新增：38 个）

- [x] SeededRandom：确定性 / 区间 / integer 闭区间边界（7）
- [x] TrajectorySolver：可命中 / 数值积分交叉验证（<2px）/ 近远距离 /
      超射程 null / 过近 null / 异常输入短路（9）
- [x] AIController：决策确定性 / 移动候选 bounds+预算 / 尽力弹兜底 /
      三档误差 50-seed 批量断言 / 全部安全短路（9）
- [x] AIInputSource：思考-移动-发射时序（假时钟）/ 门禁五项 /
      每回合一射 / 跨回合 re-engage / 时序确定性 / 中断恢复（7）
- [x] aiMode：URL 解析 5 种情况（5）
- [x] GameConfig ai 节不变量守卫（1，test-reviewer T1 建议）

验收：

- [x] npm run typecheck
- [x] npm run test（197 tests / 24 files）
- [x] npm run build
- [x] npm run e2e（79 项：Local 2P 回归 71 + SP 冒烟 8）
- [x] 未开始 Phase 11（Menu & Game Modes）

## Known Issues（非阻塞，test-reviewer 验收记录）

- [ ] **[M1] solver 速度下限口径**：搜索区间下限 550 低于人类可发射
      下限（minPower=0.15 → ≈827）；双方阵地最小间距 3300px 下求解
      速度 ≥1800，对局不可触达；注释已修正口径（不阻塞）
- [ ] **[L2] SP seed 固定为 1**：每局 AI 开局行为相同；待联机准备阶段
      引入 match seed 变化源（Phase 12+）
- [ ] **[L3] AI 回合触屏按钮可见性**：◀/▶ 与 AimButton 在 AI 回合仍
      可见但静默；UX polish 待 Phase 17 或试玩反馈
- [ ] **[P10-note] Normal 远距命中率**：±12% 力度误差 → 射程误差
      ±24%（R∝v²），远距离经常脱靶 —— 符合 §18 规格值，待试玩后
      可调（如 0.06）

---

# Phase 11 — Menu & Game Modes ✅

实现：

- [x] MainMenuScene（scenes/MainMenuScene.ts：RICHOCHET RIVALS 标题 +
      SINGLE PLAYER / LOCAL 2 PLAYER / ONLINE + Sound 开关 +
      Fullscreen 按钮〔feature-detect，不支持隐藏，失败静默〕）
- [x] OnlineModePlaceholderScene（ONLINE MODE / Coming in Phase 12 / BACK；
      **零网络 import**，不实现 WebRTC/Offer/Answer/Room/Signaling）
- [x] ResultScene（按 GameMode：SP → YOU WIN / YOU LOSE；L2P →
      PLAYER 1 WINS / PLAYER 2 WINS；平局 DRAW；REMATCH + MAIN MENU）
- [x] Scene Flow：Boot → MainMenu → 模式 → Battle → gameOver
      （胜负横幅 1.6s）→ fadeOut 250ms → Result → Rematch / Main Menu；
      全程 fade 转场 220ms（150~300ms 达标）

提供：

- [x] 单机游戏（P1 human + P2 AI，复用 Phase 10 AIInputSource，零复制）
- [x] 本地双人（P1/P2 双 human 热座，复用全部现有 Gameplay）
- [x] 联机游戏入口（占位场景 + Coming in Phase 12 + BACK）

## Game Mode Architecture（Phase 11）

- [x] `match/GameMode.ts`：`single_player | local_2p | online`
- [x] `match/MatchSetup.ts`：`{ mode; p1Controller; p2Controller;
      aiDifficulty? }` + `BattleSceneData`（scene.start 载荷契约）
      + `PlayerController = human | ai | network`（Phase 12 契约占位）
- [x] `match/MatchFactory.ts`：createMatchSetup 三模式标准组合
      （SP: P2=ai+难度缺省 normal；L2P 双 human；online: P2=network 占位）
- [x] **BattleScene 只凭 init(data).setup 装配 InputSource** ——
      删除 Phase 10 的 parseAiMode URL 解析（aiMode.ts + 5 测试删除），
      全仓零 URL/全局变量/字符串猜模式
- [x] Gameplay Systems 零 GameMode 感知（无 import）——
      模式差异只体现在谁产出 GameCommand
- [x] settings/UserSettings.ts：soundEnabled，localStorage 持久化
      （try/catch 兜底），无 localStorage 时内存兜底（Scene 切换间保持）

## Rematch（验收核心）

- [x] Rematch = 同 MatchSetup 重新 scene.start → BattleScene.create 重建
      全新 GameState（HP/位置/预算/相位/炮弹/相机/AI 全新，旧局污染清零）
- [x] **scene.start 复用 Scene 实例的坑（实测两处）**：类字段初始化只在
      构造跑一次 → init() 复位清单：bannerTurnKey / bannerGameOverShown
      （不复位则第二局 gameOver 转场被吞）/ **aiInput**（不复位则幽灵 AI
      接管下一场 Local 2P）/ touchControls（防御性）——24 字段全部定性固化注释
- [x] SP Rematch 保持 SP；L2P Rematch 保持 L2P；Online 不实现 Rematch

## UI / 平台

- [x] MenuButton（ui/MenuButton.ts）：InputRouter zone 命中（与 Battle HUD
      同管线——**Phaser GameObject setInteractive 在本项目 Scale.NONE +
      手动 canvas 样式配置下指针坐标失效〔实测 worldX/Y=0〕，故菜单按钮
      一律走 window 级 InputRouter**）；64 CSS px ≥ 56 触控下限；
      触屏 pressed 状态、不依赖 hover；Safe Area + uiScale 布局
- [x] ViewportService 增加 worldCameraZoom 选项（Battle 缺省 true 零变化；
      Menu/Result 用 false = identity 相机 + 物理像素屏幕坐标）
- [x] 各场景 debug 句柄（scene 字段 + 按钮 CSS 坐标）供 E2E 驱动

## 实测修复（SHUTDOWN 时序 / 实例复用）

- [x] CameraHotkeys / ProjectileSystem / Projectile 的 destroy 在
      Battle→Result 切换时 `scene.input`/`scene.matter.world` 已 null
      → "Cannot read properties of null (reading 'off')" 致使
      ResultScene create 失败（稳定复现）→ 统一 `?.` 防御，正常清理不变
- [x] MainMenu/Result/Online 三场景 transitioning 守卫在 create 复位
      （同为实例复用坑）

## 测试（Phase 11 新增 8）

- [x] MatchFactory：SP/L2P/online 组合契约（4）+ Rematch 防污染 /
      HP·回合重置（2，createInitialGameState 纯度）
- [x] UserSettings：默认开 / toggle 保持（2）
- [x] E2E 91 → **95 项**：三场景全部经真实菜单进入；Desktop 自然对局 →
      ResultScene 'PLAYER 1 WINS' → MAIN MENU；SP 击杀 → YOU WIN →
      REMATCH 全新对局（HP 10/10、turn 1、aiEnabled）→ 二杀 → MAIN MENU；
      Online 占位 → BACK；Sound 开关翻转；触屏菜单按钮 CSS 坐标 ≥56px；
      **跨模式回归 4 项**（SP 完赛 → MAIN MENU → LOCAL 2P：aiEnabled=false、
      P2 热座人类可控、1500ms 幽灵无开火 —— C1 防线，reviewer 要求）

## 委托记录（Subagent 工作流）

- gameplay-engineer ①：BattleScene init(data) 消费 MatchSetup、删
      parseAiMode（200/200 绿，零超限）
- Main Agent：契约层 / 三场景 / MenuButton / ViewportService 选项 /
      E2E 重写 / SHUTDOWN 崩溃修复
- test-reviewer ①：**FAIL** —— [C1] BattleScene 跨模式残留 aiInput
      （幽灵 AI 接管 L2P，scene 实例复用坑第二处，E2E 新页面盲区）+
      [M1] Projectile.destroy null 防御缺口
- gameplay-engineer ②：C1+M1 修复 + 24 字段复位清单
- test-reviewer ②（复检）：**PASS**（24/24 字段清单验证、C1/M1/L1 确认、
      E2E 95/95 独立复跑、幽灵检测时序核算 ≥500ms 裕量）

验收：

- [x] npm run typecheck
- [x] npm run test（200 tests / 24 files）
- [x] npm run build
- [x] npm run e2e（95 项，71 → 95）
- [x] test-reviewer：FAIL → 修复 → **PASS**（复检）
- [x] 未开始 Phase 12（WebRTC Transport）

## Known Issues（非阻塞）

- [ ] SP/L2P 对局 seed 固定 1（Rematch 与新局 AI 开局行为相同；
      Phase 12+ 引入 match seed 变化源 —— Phase 10 遗留）
- [ ] AI 回合触屏按钮可见性 / Normal 远距命中率（Phase 10 遗留观察项）
- [ ] beginImpact/destroyWithoutExplosion 仍直访 scene.matter.world
      （仅活体模拟期可达，不在关闭链 —— reviewer info 级备忘）
- [ ] UserSettings localStorage 真实读写路径仅代码审查覆盖
      （测试环境无 localStorage，走内存兜底）

---

# Phase 12 — WebRTC Transport ✅

实现独立：

- [x] NetworkTransport interface（网络抽象：state/connected/connect/
      send/onMessage/onStateChange/onDisconnect/close，订阅均返回取消函数；
      TransportError reason 分类：NOT_CONNECTED/TRANSPORT_CLOSED/
      CONNECT_FAILED/INVALID_SIGNALING —— send 永不静默失败）
- [x] WebRTCTransport（398 行：DI peerConnectionFactory 可注入 fake；
      Host createDataChannel('game',{ordered:true}) 禁 maxRetransmits ——
      回合制命令可靠有序；Guest ondatachannel；
      createOffer/acceptOffer/createAnswer/acceptAnswer（JSON {type,sdp}，
      waitForIceGatheringComplete 事件驱动+2s 超时兜底 —— Phase 13
      连接码保证完整 SDP）；connect 等 open+10s 超时→FAILED；
      close 幂等全清理〔listener 摘除→pending reject→channel/pc close〕；
      wire 垃圾不崩、瞬态 disconnected 不迁移状态）
- [x] LocalLoopbackTransport（createLoopbackPair 成对双向，latencyMs 模拟，
      投递走 serialize→setTimeout→deserialize 副本 —— 与真实 wire 同构）
- [x] NetworkManager（sequence 从 0 单调递增、typed onMessage 分发 +
      handler try/catch 兜底、PING/PONG 自动应答 + sentAt 透传（RTT 可算）、
      dispose 幂等清订阅 + close、lastRemoteSequence 暴露（Phase 14/15 用）、
      无全局 singleton）

禁止让 Game Logic import WebRTC。✅（RTC API 全仓 grep 仅命中 network 层
4 文件；Gameplay 六目录零 network import；Gameplay 在不知道 WebRTC 的
情况下运行的特性保持 —— 281/281 回归 + E2E 95/95 佐证）

架构：

Gameplay
↓
NetworkManager
↓
NetworkTransport
↓
WebRTCTransport / LocalLoopbackTransport

## 协议（Phase 12 契约固定）

- [x] NetworkEnvelope：version **字面量 1**（未知版本拒绝）/ type /
      matchId / turnId / senderId / sequence / timestamp / payload
      （键必须存在，null 合法 = 显式无载荷）
- [x] NetworkMessageType 14 值（PING/PONG/PLAYER_READY/GAME_START/
      MOVE_REQUEST/MOVE/FIRE_REQUEST/FIRE/TURN_RESULT/TURN_END/
      STATE_SYNC_REQUEST/STATE_SNAPSHOT/REMATCH/DISCONNECT）
- [x] NetworkProtocol.validateEnvelope：Untrusted Input 两阶段校验
      （存在性扫描→逐字段），返回规范化新副本，零 `as` 直通
- [x] NetworkSerializer：**全仓唯一 JSON 收敛点**，canonical 固定字段序
      （Phase 15 stateHash 基础）；deserialize 走 ok/error Result 双轨
- [x] WebRTCConfig：STUN-only 开发默认，零 secret；TURN 仅架构可注入
      （文档明确：WebRTC P2P ≠ 所有网络可直连，严格 NAT 可能需 TURN）
- [x] docs/ARCHITECTURE.md §6 扩写为 Networking Layer（分层图 / 协议防线 /
      STUN/TURN 边界 / Phase 12–15 阶段边界）

## 委托记录（Subagent 工作流）

- network-engineer ①：协议层 + Transport 抽象 + Loopback（64 测试；
      产出"给②的接口注意事项"清单 —— 拆分委托策略生效）
- network-engineer ②：WebRTCTransport + NetworkManager + PING/PONG +
      文档（17 测试）。**首次运行在探索阶段耗尽预算（23 tool uses 未写
      代码）—— 重试时回灌接口摘要 + 禁读大文件后 30 tool uses 完成**。
      委托经验：探索预算必须显式约束
- Main Agent：集成审查（RTC 隔离/Gameplay 零污染 grep 双零命中）+
      E2E 95/95 回归
- test-reviewer：**PASS WITH ISSUES**（13 项验收全 PASS、零 Critical/
      High；281/281 独立复跑；遗留项全部非阻塞）

## 测试（Phase 12 新增：81 个）

- [x] 协议层：Contracts 3 + Protocol 26（全字段错误矩阵/未知版本/
      边界值/规范化副本）+ Serializer 15（往返保真/INVALID_JSON/
      canonical 字符串锁定）
- [x] Loopback 20：双向/latency/副本语义/close 联动/在途丢弃/
      终态 connect 拒绝/订阅取消/handler 异常传播/真实定时器
- [x] NetworkManager 5：sequence 单调/字段+typed 分发/dispose/
      PING-PONG over loopback/handler 兜底
- [x] WebRTCTransport 12（fake 注入）：状态迁移/close 清理/未连接 send/
      ICE 等待+超时/offer-answer 往返+非法信令/wire 垃圾/connect 超时

验收：

- [x] npm run typecheck
- [x] npm run test（281 tests / 30 files，200+81）
- [x] npm run build
- [x] npm run e2e（95/95 回归，零影响）
- [x] test-reviewer：PASS WITH ISSUES（非阻塞）
- [x] 未实现 Phase 14 逻辑（零 Gameplay 接线，grep 双零命中）
- [x] 未开始 Phase 13

## Known Issues（非阻塞，Phase 13 前后处理）

- [ ] **[F1] PING payload 无形状守卫**：畸形 PING 会原样回声，RTT 显示
      接线前补 sentAt 整数校验（reviewer）
- [ ] **[F2] FAILED 状态不粘滞**：后续 close 事件可能 FAILED→DISCONNECTED
      降级迁移（双死态语义无破坏，错误 UX 接线前修复）
- [ ] **[F3] WebRTCTransport 401 行**：Phase 13 加信令方法时评估拆出
      Offer/Answer 编解码段
- [ ] **[T1–T3] 缺测试**：close 打断 ICE gathering（Phase 13 首个任务
      补，高频路径）/ 瞬态 disconnected 不迁移的钉子 / CONNECTING 中
      重复 connect 复用 promise
- [ ] **[F4] docs §4 目录树陈旧**（ai/network 未列，下次文档维护补）
- [ ] 真实浏览器 P2P（真 ICE/STUN）未验证 —— node 仅 fake 替身，
      Phase 13 首次联调优先过 createOffer→accept→createAnswer→accept→connect
      全链路

---

# Phase 13 — Manual P2P Connection ✅

第一版不用 Signaling Server。✅（全程手动复制粘贴 Connection Code，零服务器）

Host：Create P2P Game → Create Offer → 显示 Connection Code ✅
Guest：Paste Offer → Create Answer → 显示 Answer Code ✅
Host：Paste Answer → Connected ✅
显示：CONNECTED / PING / HOST / GUEST ✅（VERIFIED 就绪页：CONNECTED—HOST/GUEST—PING XXms + "Gameplay sync will be enabled in Phase 14" + BACK TO MENU）

## 实现（2026-09-28）

**连接逻辑层（network-engineer 3 次预算截断 → Main Agent 按其定案规格补尾）**：

- [x] `network/signaling/ConnectionCodeCodec.ts`：连接码 = `RR1-OFFER-` /
      `RR1-ANSWER-` 前缀 + base64url(JSON)；payload `{version:1, kind, sdp}`
      （sdp 存原始 SDP 文本）；decode 永不 throw（Result 双轨），
      reason：EMPTY/INVALID_FORMAT/UNSUPPORTED_VERSION/WRONG_CODE_TYPE/
      INVALID_SDP/MALFORMED_PAYLOAD；base64url 纯 TS（零 btoa/atob/Buffer）
- [x] `network/OnlineConnectionState.ts`：12 态状态机
      （CHOOSE_ROLE/HOST×3/GUEST×3/CONNECTING/CONNECTED/VERIFIED/FAILED/CLOSED）
- [x] `network/OnlineConnectionController.ts`：Host/Guest 流程编排
      （createHostSession memoize 防重复 PeerConnection；submit 阶段守卫
      防 setRemoteDescription race；20s 连接总预算 + 10s PING/PONG 验证窗口；
      retry/back 彻底 dispose 重建；**handleVerified 幂等**——VERIFIED 后
      interval PONG 不再重建 session；用户可读错误映射 6 类）
- [x] `network/OnlineSession.ts`：OnlineSession
      {role, localPlayerId, remotePlayerId, transport, networkManager}
      （Host=P1/Guest=P2 固定）+ OnlineSessionManager
      （store 覆盖前 dispose 防泄漏 / disposeSession 幂等 / 非全局 singleton）
- [x] Phase 12 遗留修复：F1 PING payload 形状守卫 / F2 FAILED 粘滞 /
      F3 SignalingCodec 拆分（WebRTCTransport 回 ~340 行）/ T1-T3 守护测试

**连接 UI（Main Agent）**：

- [x] `scenes/OnlineConnectionScene.ts`（替换已删除的
      OnlineModePlaceholderScene）：状态驱动 UI（CHOOSE_ROLE 两按钮/
      HOST STEP1 code+COPY/STEP2 textarea+CONNECT/GUEST textarea+
      CREATE RESPONSE→code+COPY+WAITING/VERIFIED 就绪页/FAILED+
      TRY AGAIN+BACK）；DOM textarea 动态创建销毁（真实文本选择/
      长按粘贴/系统键盘/Ctrl+V，touch-action auto，Safe Area 抬高）；
      clipboard writeText 失败降级 select；leaveToMenu 幂等
      （fade 220ms + 300ms delayedCall 兜底 — 后台页 rAF 冻结防御）
- [x] MenuButton：setVisible 同步 **zone 失活**（实测修复：不可见按钮
      与可见按钮重叠布局时会抢走点击）
- [x] OrientationGate shouldGate 注入：**仅 Battle 强制横屏**，
      连接流程允许竖屏（手机复制/粘贴微信连接码体验优先）

## 实战调试记录（P2P E2E，全部已修复）

- 后台 page rAF 冻结（headless visibilityState=hidden，实测禁节流 flags
  无效）：场景启动/fade/delayedCall 全停而事件驱动的 WebRTC/Manager 正常
  ——E2E 双页收尾 bringToFront 轮转；**架构含金量：Guest 切微信复制时
  页面后台化，连接与验证不挂（全事件驱动）**
- .mjs 内误写 TS 注解 → SyntaxError；E2E 诊断 helper 返回值 truthy 陷阱
  （实际 scene 字符串被当命中）→ waitForScene 独立实现
- RTT 断言竞态 → waitFor 化；双页初始化改串行

## 测试（Phase 13 新增：24 个，总 305）

- [x] ConnectionCodeCodec 9：往返×2 / WRONG_CODE_TYPE 双向 / RR2 前缀
      +payload version 双路径 / INVALID_FORMAT 4 类 / MALFORMED_PAYLOAD
      4 类 / INVALID_SDP / EMPTY / trim+独立 btoa oracle 互认（unicode）
- [x] OnlineConnectionController 10：Host/Guest 全链（fake RTC 双 PC 互联
      + bridgeChannels 真实 PING/PONG wire 帧断言）/ retry / back /
      timeout 双窗口 / 防重复 setRemoteDescription / 无 PONG 验证超时 /
      SessionManager store-dispose-覆盖防泄漏 / **VERIFIED 幂等回归**
- [x] WebRTCTransport +4（F2 粘滞 / T1 ICE 打断 / T2 瞬态 / T3 promise 复用）
- [x] NetworkManager +1（F1 畸形 PING）

## E2E（95 → 101 项）

- [x] Desktop：ONLINE → OnlineConnectionScene（CREATE/JOIN/BACK）→ BACK 回菜单
- [x] **Online P2P 双页真实 WebRTC smoke**：两独立 page 真实
      RTCPeerConnection/DataChannel/host candidates 直连 —— Host CREATE
      → Offer Code（RR1-OFFER-，完整 ICE SDP）→ Guest JOIN+粘贴 →
      CREATE RESPONSE → Answer Code（RR1-ANSWER-）→ Host 粘贴 + CONNECT →
      **双方 VERIFIED** → 双方 RTT 显示 → bringToFront 轮转回菜单
      （连接彻底释放）；`RR_E2E_ONLY=online` 场景过滤器（调试加速）

## 委托记录

- network-engineer ①②：Phase 12 遗留修复 + F3 SignalingCodec 拆分落盘、
      全部设计定案（3 次运行均预算截断：2 次 ERROR 1 次部分完成 —
      探索/总结阶段消耗过大，重试回灌契约摘要仍不足；
      **Main Agent 按其规格补尾 Codec/State/Controller/Session/测试**）
- test-reviewer：**PASS WITH ISSUES**（12 项验收全 PASS、零 Critical/High、
      304 独立复跑全绿、3 项披露全部接受）；两条 Low 级测试补强
      （RR2 前缀字面量用例 + VERIFIED 幂等回归用例）已当场修复（305 全绿）

验收：

- [x] npm run typecheck
- [x] npm run test（305 tests / 33 files）
- [x] npm run build
- [x] npm run e2e（101 项：Offline 95 + Online P2P 6）
- [x] test-reviewer：PASS WITH ISSUES（非阻塞，补强已修）
- [x] 无 Phase 14 超前（PLAYER_READY/GAME_START 仅枚举存在，零接线）
- [x] 未开始 Phase 14

## Known Limitations（如实披露）

- **NOT REAL-DEVICE VERIFIED**：真机（手机）Copy/Paste/双端 smoke 未做
  —— DOM textarea/Safe Area/touch-action 代码证据充分 + E2E DPR/触摸
  分支覆盖，列为 Phase 14 前验证债
- E2P 为同机双标签页（host candidates 直连，无真实 STUN/TURN NAT 穿越样本）
  —— Phase 13 范围内接受，外网穿越待后续验证
- headless 后台页 rAF 冻结：E2E bringToFront 修复 + leaveToMenu 300ms
  兜底双保险；真人场景页面后台化时连接不挂（事件驱动）但场景切换/计时
  会暂停 —— 浏览器平台固有行为
- OnlineSessionManager 目前由 OnlineConnectionScene 持有 —— Phase 14
  BattleScene 接管前需上提到跨 Scene 容器（reviewer 建议）

## 真机修复轮（2026-09-29，Mac ↔ iPhone 配对实测反馈）

症状：手机 Guest 粘贴 Offer 点 CREATE RESPONSE 后直接显示 Connecting，
Answer 码从未显示，配对必然超时失败。三处叠加根因（全部已修）：

- [x] **Answer 码被瞬时状态顶掉**：runGuestAnswer 生成码后同步调
      connectAndVerify()（立即置 CONNECTING）→ Scene 永远渲染不出
      GUEST_WAITING_FOR_HOST 页面；且 Scene 的 currentCode 在状态回调
      之后才赋值、无补渲染。E2E 经 debug 句柄读码测不出（真人才踩）。
      修复：connectAndVerify(waitForHost) —— Guest 停留
      GUEST_WAITING_FOR_HOST 开放等待；Scene 码就绪后补 renderState()
- [x] **Guest 超时预算对人肉传码不现实**：transport.connect 10s open
      超时 + controller 20s 总预算从生成 Answer 码即倒计时，真人微信
      传码必然超时。修复：connect(timeoutMs=Infinity) 开放等待
      （失败仍由 ICE failed / close 兜底 reject）；Host 路径预算不变
- [x] **移动端 HTTP 无复制路径**：局域网 http 非 secure context，
      navigator.clipboard 不存在 → COPY 必失败，降级 select() 选中
      的是隐藏 textarea（拿不到码）。修复：GUEST_WAITING_FOR_HOST 态
      textarea 只读展示 Response 码（长按选中复制 = 手机侧可靠路径）
- [x] 单测：test8 Guest 状态序列去掉 CONNECTING + 8b 开放等待回归
      （120s 不失败、Host 延迟应用仍 VERIFIED）+ ⑦b connect(Infinity)
      回归；总 442 全绿
- [x] **E2E macOS 移植**：BROWSER_CANDIDATES 补 Mac Chrome 路径；
      实测本机 headless Chrome 的 mDNS host 候选（.local 假名）解析
      失败（本地网络多播疑似被权限挡）+ STUN 被网络劫持（srflx 为
      128.1.x.x 垃圾地址）→ 双页 ICE 永远失败（提交版原样复现，
      非 Phase 14 回归）；`--disable-features=WebRtcHideLocalIpsWithMdns`
      让 host 候选输出真实 IP 后直连成功 —— 已加入 e2e 启动参数，
      118/118 在 Mac 全绿（Windows 行为不变）
- [ ] **真机 ICE 注意**：正常启动的桌面 Chrome 仍有 mDNS 假名候选，
      若手机配对卡在 Connecting，用
      `open -a "Google Chrome" --args --disable-features=WebRtcHideLocalIpsWithMdns http://localhost:5173`
      冷启动 Chrome（先 ⌘Q 退干净）—— 单侧真实 IP 候选即可建链
      （对端 check 打向真实 IP 即成对）；或在 系统设置 → 隐私与安全 →
      本地网络 给 Chrome 授权后走 mDNS。待真机复测确认。

## 真机修复轮 · 第二轮（2026-09-29，首次真机配对成功后的反馈）

- [x] **连接预算 20s → 2 分钟**：第二次配对时延不够（手机后台化 /
      传码节奏）→ CONNECT_TOTAL_TIMEOUT_MS=120s，Host 侧 transport 与
      controller 兜底同预算；Guest 侧保持开放等待不变；test11 同步
      120s 推进
- [x] **连接页文案重写（按试玩话术）**：Host 等 Answer 页 "Press COPY
      and send the offer code to the other player."；Guest 粘贴页
      "Paste the offer code from the host below." + "Then press
      CREATE RESPONSE and send the response code back to the host."；
      Guest Response 页 "Press COPY and send this response code to
      the host."；VERIFIED 页 prompt 改 "You can enter the game now —
      press ENTER BATTLE."（UI 语言保持英文与全游戏一致，中文话术
      如需可再切换）
- [x] **连接页遮挡修复（实测算出来重叠）**：旧布局在粘贴 / 展示码状态
      把说明文字排在 H−280 附近 —— 恰好被 DOM textarea（H−292..H−220）
      完全盖住（桌面与手机同病）；固定 +220 CSS 底距在手机横屏
      （390 CSS 高）把输入框顶进文案区。新布局：文案区固定在标题下方
      （safeArea.top+100ui），textarea 底边 = 动作行（CONNECT/CREATE
      RESPONSE/COPY 槽位）顶沿 −12 CSS（与按钮行同源计算），Host 页
      CONNECT 与 COPY 并排一行（320+260 ≤ 手机 844 CSS 宽），删除冗余
      codeLine（"code ready" 行，零信息量且占垂直预算）
- [x] 验证：typecheck / test 442 / build / e2e 118 全绿（E2E 按钮坐标
      动态读 rect，布局变更零脚本改动）
- [x] **COPY 降级链修复（真机反馈：Host 点 COPY 显示成功却贴出空白）**：
      探针实锤调用链 = writeText(码) → NotAllowedError（写权限被拒 /
      LAN HTTP 下 API 整个缺失）→ 降级 execCommand —— 但第一版降级
      select() 的是页面上那个输入框，Host 侧它承载待粘贴 Answer
      （此刻为空）→ 复制空内容且按钮显示 COPIED!（引入性缺陷）。
      修复：legacyCopy() —— 临时不可见 textarea（fixed + opacity 0 +
      readonly，iOS 要求屏幕内）装载【码本身】，setSelectionRange 全选
      后 execCommand('copy')。探针双环境验证：localhost（writeText 拒
      → 降级 → 剪贴板 readText === 连接码）+ LAN URL（API 缺失 → 同步
      抛 → 降级 execCommand true）。副产品：手机做 Host 的 COPY 路径
      一并打通。E2E 不经 COPY 路径，typecheck/test/build + online
      配对 smoke 6/6 复验绿
- [ ] **彻底解法（未做）**：dev server 上 HTTPS（@vitejs/plugin-basic-ssl）
      → 全平台获得安全上下文，navigator.clipboard 原生可用，降级链仅作
      兜底；需要时再上
- [x] **验证窗口 10s → 2 分钟（2026-09-29 第二轮真机反馈："复制 code
      的时间又变短了"）**：根因不是连接预算（120s 未被 Phase 15 触碰），
      而是 CONNECTED 后的 PING/PONG 验证窗口 VERIFICATION_TIMEOUT_MS
      =10s——Guest 复制完连接码切微信（移动端页面后台化 JS 挂起）→
      Host CONNECT 通道已开 → PING 无 PONG → 10s 即 "Connection
      unstable — verification failed"，表现为"刚连上很快就失败"。
      放宽至与连接预算同税制 120s（正常场景 PONG 毫秒级完成验证；
      通道真坏时窗口兜底 FAILED 不无限等）；test13 假时钟同步推进；
      typecheck / test 475 / build / online 配对 smoke 6/6 复验绿

---

# Phase 14 — P2P Gameplay Synchronization ✅

**目标**：把现有 Gameplay 接入 P2P——两台浏览器完成一局基础 Online Battle。
Host = P1 = 权威；Guest = P2 = Input Client + Local Presentation Client。
双方共用同一套 GameState / GameCommand / TurnManager / Movement / Aim /
Projectile / Damage / Camera（禁止 Online 专用 Gameplay）。

## 实现落地

- **契约层（Main Agent）**：`online/OnlineTypes.ts`（全部 payload +
  OnlineGameCoordinatorApi 公共契约）+ `CommandRejectedReason.ts`（8 值）+
  `NetworkMessageType.COMMAND_REJECTED` 新增（NetworkContracts 锁定同步）。
- **Gameplay 契约钩子（gameplay-engineer 委托）**：`GameLogic.onOutcome`
  （accepted/rejected 双发 + destroy 清订阅 —— Host 广播唯一汇聚源）；
  `TurnManager.applyRemoteTurnEnd`（Guest 消费 Host 授权值，gameplay 层
  零网络 import）。
- **数据层（network-engineer 定稿，Main Agent 照稿落地）**：
  `OnlinePayloads.ts`（全 payload 形状守卫 + hasOwnProperty 防原型链）；
  `AuthoritativeState.ts`（buildSnapshot / stateFromSnapshot /
  buildTurnResultPayload / applyTurnResult / computeStateHash FNV-1a /
  synthesizeAuthoritativeDamage）；`GuestIntentBus.ts`（Guest 输入拦截：
  本地命令 → *_REQUEST，不本地执行）；`NetworkManager.matchId` getter。
- **Coordinator（Main Agent 实现，三文件 <400 行）**：
  `OnlineGameCoordinator.ts`（生命周期壳：lobby 握手 + PLAYER_READY
  1.5s 低频重发直到 GAME_START（订阅时序防线）/ attach / guardInbound
  入站三防线（payload → matchId → senderId → per-type sequence 幂等）/
  sendOut 统一出站 / debugInfo 诊断 / dispose）；`OnlineHostChannel.ts`
  （请求级守卫 verdict 纯函数（sender/turnId/存活 + FIRE 专属：速度
  ∈[550,2400]、起点距炮塔≤5px、seed 一致）+ outcome 广播 —— 重入红线：
  handler 只 send 不 dispatch）；`OnlineGuestChannel.ts`（MOVE 绝对覆写 /
  FIRE 经真实总线播放 / TURN_RESULT reconcile / Turn Barrier 双条件
  （本地 dwell ✓ + TURN_END ✓ 两种到达序均处理）/ calculate-only
  伤害系统 GuestAuthoritativeDamage）。
- **单一 validate+execute 路径**：Host 本地命令与 Guest 请求重建命令
  走同一条 CommandBus → GameLogic → Systems；语义校验（phase/预算/
  hasFired/clamp）全在系统层，coordinator 不重复；拒因映射
  `OnlineReasonMap.ts` → COMMAND_REJECTED（不 disconnect）。
- **Scene 接线（Main Agent）**：OnlineSessionManager 上提 game.registry
  （main.ts 组合根）；OnlineConnectionScene VERIFIED → ENTER BATTLE →
  PLAYER_READY → GAME_START → BattleScene（bootstrap 携带同一 coordinator
  实例；handedOff 交接 + `controller.detach()` 交接语义 —— onShutdown 不
  再销毁已移交会话）；BattleScene 联机接线（stateFromSnapshot 状态源 /
  attach / inputBus 三处 / 输入锁 isRemoteControlledTurn / YOUR TURN·
  OPPONENT'S TURN 横幅 / 伤害数字 Host 直显 vs Guest 权威展示 /
  OPPONENT DISCONNECTED overlay + BACK TO MENU / DEBUG_NETWORK 段）；
  ResultScene 联机 YOU WIN/YOU LOSE 视角（无 REMATCH，Phase 16）。
- **修复循环（E2E 实测驱动）**：① PLAYER_READY 订阅时序缺陷（对端先点
  ENTER → 消息在订阅前投递丢失 → 死锁）→ 低频重发防线；② 连接场景
  SHUTDOWN 无条件 controller.dispose() 杀死已交接会话（manager disposed
  + transport CLOSED）→ detach() 分流；③ Guest 'proceed' 双驱动转场
  （applyRemoteTurnEnd→resumeNextTurn 已发起 + 场景层再 beginTransition
  → 首个 tween 被提前 resolve，相机滞留 TURN_TRANSITION、aimFlow 静默
  拒绝瞄准）→ 场景层禁止二次发起（相机事件环形日志定位）。

## 测试（Phase 14 新增 135 个，总 440 / 38 文件）

- 单测：OnlinePayloads 62（守卫逐字段腐蚀 + 原型链键拒绝）；AuthoritativeState
  12（往返全等 / 深独立 / hash 确定性·敏感性·键序无关）；GuestIntentBus 16；
  OnlineGameCoordinator 27（①~㉒：握手同源 / attach 守卫 / Host 权威 MOVE /
  越界 clamp / 预算 / 伪造 playerId / stale+future turn / 重复 sequence 重放 /
  FIRE 全防线 / TURN_RESULT 覆写预测 / Barrier A·B 双序 / TURN_END 异常 /
  断线双向 + gameOver 抑制 / dispose 幂等静默 / damageSystem 语义）；
  OnlineLoopbackBattle 2（**P1→P2→P1 完整循环 + 双端 computeStateHash 全等**）；
  OnlineConnectionController +2（detach 不杀会话 / 未 detach dispose 语义）；
  GameLogic 8（outcome）；TurnManager +4（applyRemoteTurnEnd）；
  MatchFactory +2（host/guest 角色组合）。
- E2E（118/118）：新增 `RR_E2E_ONLY=battle` runOnlineBattle 17 项 —— 双页
  真实 WebRTC（手动配对→ENTER BATTLE→GAME_START 同源→Host Move 双端可见
  →Host Fire 双端发射→P1→P2 切换→Guest Barrier→HP 一致→Guest Move 经
  Host 验证→Guest Fire 双端→本地结算→Host 授权→**P1→P2→P1 完整循环**→
  双端 HP/位置一致→**stateHash 一致**→优雅关闭断线感知）。既有
  desktop/mobile/sp/online 四场景零改动全过。

## 验收

- `npm run typecheck` ✓ / `npm run test` 440/440 ✓ / `npm run build` ✓ /
  `npm run e2e` 118/118 ✓。
- **test-reviewer：PASS WITH ISSUES**（无 Critical/Major；验收重点十项
  全过：Host authority / Guest intent-only / 命令验证 / 幂等防重放 /
  stale turn / coordinator boundary / 零 RTC 入 gameplay / 零逐帧同步 /
  TURN_RESULT reconcile / 离线与移动端回归 / E2E 证据逐路径核验）。

## Known Issues（非阻塞）

- **[Low→Phase 15]** Lobby 期断线后 ENTER BATTLE 仍可点击（controller 停
  VERIFIED 终态）；再点击基于死 session 抛 TransportError 未捕获 —— 无
  状态损坏，BACK TO MENU 可恢复；Phase 15 一并做输入面冻结 + 统一吞错。
- **[Low→Phase 15]** per-type sequence 幂等不约束跨消息类型乱序 —— 当前
  依赖 RTCDataChannel ordered:true（正确）；引入非 ordered 通道需重审。
- **[Info]** stateHash Phase 14 仅计算/携带/诊断（lastHashMatch 只读），
  不回滚不恢复 —— Phase 15 Desync Protection 消费。
- **[Info]** 对端进程异常崩溃（非优雅关闭）只到 ICE disconnected（瞬态，
  Phase 12 防误杀设计）→ failed 终局需数十秒；优雅关闭（关标签页 /
  Channel.close）即时感知。恢复策略归 Phase 15。
- **[Info]** Guest 发炮请求→FIRE 广播返回的 RTT 窗口内可再次拖拽开火 →
  Host ALREADY_FIRED 回执（幂等覆盖，体验噪声）。
- **[Info]** Guest 移动无本地预测（等权威 MOVE 返回才更新位置）—— 权威
  覆写设计；局域网 RTT 下感知轻微，Phase 15+ 可评估预测。
- **[Info]** BattleScene 742 行（Phase 14 前 533，组合根既有超限先例，
  记录为债）；Online Rematch 未实现（Phase 16）；SP seed=1 既有已知问题
  —— **联机 seed 为 Host 随机生成（已解决联机侧）**。
- **[验证债]** INTERNET P2P NOT VERIFIED（E2E 为同机双标签页 host
  candidates 直连；PC Wi-Fi ↔ 手机 4G/5G 外网 NAT 穿越未测）。

## Phase 15 就绪

- stateHash 已在 TURN_RESULT 双端计算与比对（lastHashMatch 诊断字段），
  Phase 15 直接消费做 desync 防护。
- Sequence 基础设施（NetworkManager.lastRemoteSequence / per-type 去重）
  已就绪，支持 STATE_SNAPSHOT 对账协议。
- Reviewer 建议 Phase 15 backlog：lobby 断线输入面冻结、网络层统一吞
  TransportError、Guest 移动预测、非 ordered 通道重审。

---

# Phase 15 — Desync Detection & State Recovery ✅

**目标**：Online Match 出现状态偏差时 —— 自动检测 → 请求权威状态 →
恢复 Guest GameState → 继续下一回合，而不是整局报废。**Host 永远权威，
Guest 永远对齐 Host**（不平均、不比时间戳、不信任 Guest 的 HP/Turn/Winner）。

## 实现落地（2026-09-29）

- **协议层（Main Agent 补尾，network-engineer 委托①截断）**：
  - `computeStateHash` **v2**：位置经 `normalizePosition`（0.01 精度）——
    物理/插值来源的双端浮点微差不触发假 desync；规范串以
    `STATE_HASH_VERSION='v2'` 前缀（hash 契约版本化，两端不同 build 显式
    mismatch）；hp/turnId/moveRemaining 整数语义字段不做浮点处理
  - 新契约 + 形状守卫：`STATE_SYNC_REQUEST`（reason 四值枚举，
    hasOwnProperty 防原型链伪造）/ `STATE_SNAPSHOT` / `TURN_RESULT_ACK`
    （NetworkMessageType 新增 TURN_RESULT_ACK，契约锁定测试同步）
  - `applyAuthoritativeSnapshot`：原子全量应用（含 turnId / phase /
    currentPlayerId / seed / matchId——与 applyTurnResult 的部分覆写
    不同，恢复场景本地状态不可信无"部分"可言）；原地覆写不新建对象；
    items 数组保持引用
  - `SnapshotValidator`：形状 → matchId → turnId/phase → 数值范围
    （hp∈[0,maxHp] / moveRemaining≥0 / 有限位置）→ gameOver↔winnerId
    联动 → **hash 自洽重算**（防篡改/坏数据）六道防线；reason 可读字符串
- **通道层（network-engineer 委托② 4/6 落盘 + Main Agent 补尾去重）**：
  - `OnlineSyncState` 六态：SYNCED / DESYNC_DETECTED / SYNC_REQUESTED /
    APPLYING_SNAPSHOT / SYNCED_AFTER_RECOVERY（粘性诊断态）/ SYNC_FAILED
  - **Guest 恢复链**（OnlineGuestChannel）：TURN_RESULT hash mismatch →
    锁输入 → STATE_SYNC_REQUEST → STATE_SNAPSHOT → validator →
    applyAuthoritativeSnapshot → 复验 → ACK(recovered:true) → 解锁；
    **MISSING_TURN_RESULT**（TURN_END 先到无本回合结算）与
    **INVALID_LOCAL_STATE**（envelope.turnId 跳号）同样触发恢复；
    validator 拒收有限重试（2 次）后 SYNC_FAILED；恢复即视为 post-turn
    表现完成（dwellComplete 置位——篡改 turnId 后 FIRE 被 WRONG_TURN
    拒的本地无炮弹场景，Force Desync E2E 实测）
  - **Host ACK Barrier**（OnlineHostChannel）：TURN_RESULT 后等
    TURN_RESULT_ACK（turnId + hash 双校验）才放行 TURN_END；ACK 后到
    经 resumeNextTurn 补驱（与 'proceed' 路径互斥无双驱动）；
    **超时阶梯 8s×3**：重发 TURN_RESULT → 主动推 STATE_SNAPSHOT →
    SYNC_FAILED（onSyncFailure 恰一次，coordinator 去重）
  - gameOver：Guest hash 确认终局（`isFinalStateConfirmed` gate）后才
    收口 ResultScene——避免双端胜负显示不一致；Host 转场不被 ACK 阻塞
  - `debugForceDesync()`：Guest 本地 turnId+1（唯一可靠篡改面——hp/x/
    hasFired 会被 applyTurnResult 在 hash 比较前覆写自愈）
- **场景接线（Main Agent）**：BattleScene deps 新增 setSyncLock
  （syncLocked 并入 isRemoteControlledTurn，锁 Move/Aim/Fire、保留相机
  自由观察）/ onSyncStateChange（SYNCHRONIZING 横幅）/ onSyncFailure
  （SYNC FAILED 横幅 + BACK TO MENU，禁继续错局）；**Host resumeNextTurn
  双语义**（Host=endTurn+转场；Guest=仅转场）；update 循环 gameOver gate；
  **断线/同步失败后不再弹回合横幅**（迟到的转场 showTurn 会覆盖
  OPPONENT DISCONNECTED——25% flaky E2E 实测暴露的产品级缺陷）；
  DebugOverlay SYNC 段（state/recovery/reason/双端 hash 对比）

## 测试（Phase 15 新增 33 个，总 475）

- Phase15Protocol 20：hash v2 确定性/敏感性/浮点微差同 hash/键序无关/
  versioning；validator 全 reason 矩阵（matchId/turnId/phase/hp 越界/
  winner 联动/自洽）；applyAuthoritativeSnapshot 原地全量+引用保持；
  三守卫正负用例（含原型链伪造拒）
- Phase15Sync 13（loopback 双端真实协调器）：ACK 先到/后到双序 barrier；
  篡改 turnId → HASH_MISMATCH 请求+锁；全链恢复 parity + recoveryCount +
  ACK(recovered)；锁 true→false；Host 超时阶梯 3 段恰一次 onSyncFailure；
  重复快照幂等；错 matchId 拒收；MISSING_TURN_RESULT；future TURN_END；
  gameOver 终局确认无 TURN_END；debugForceDesync 全流程（恢复后第二回合
  干净 ACK(recovered:false)）；Guest 坏快照重试上限 SYNC_FAILED
- E2E 118 → **123**：真实 WebRTC Force Desync 全链（篡改 → 边界检测 →
  turn3 快照恢复 → Barrier 放行 → P2 Turn 4 继续 → 双端 HP/位置一致 →
  诊断记录）+ 既有 118 全绿（Offline 95 + Online 28）
- 既有 barrier 单测按新 ACK 契约适配（resolveAndAck 前置）

## 委托记录（Subagent 工作流）

- network-engineer ①：**截断**（15 tool uses/87s 零落盘，result 为中途
  思考片段）→ Main Agent 按其任务规格补尾全部协议层
- network-engineer ②：**completed_partial**（核心流程 A/B/C 落盘；
  Coordinator 五处修改/harness/测试未做；HostChannel 存在 replace 假
  阴性重试产生的 7 处重复方法块——第三次实测该模式）→ Main Agent 去重
  + 补尾 Coordinator 确认已由 subagent 落盘 + harness 扩展 + 13 用例
  测试 + 时序修复（fake timers 与 loopback 冲突 / TurnManager phase 链
  需 notifyProjectileLaunched+notifyTurnTransitionComplete 完整驱动）

## 验收

- [x] npm run typecheck
- [x] npm run test（475 tests / 40 files）
- [x] npm run build
- [x] npm run e2e（123 项：Offline 95 + Online 28，含 Force Desync 恢复）
- [x] **DEBUG Force Desync 自动恢复验证**（loopback 13 用例 + 真实
      WebRTC E2E 全链）
- [x] Single Player / Local 2P / Mobile 无回归（Offline 95 全绿）
- [x] Offline 隔离：TurnManager / Gameplay 系统零 sync 感知（sync 全部
      在 network/online/sync/ + channel 层）
- [x] test-reviewer 独立验收：**PASS**（17/17 验收点全过、零 Critical/
      High/Medium；三命令独立复跑全绿；4 项 Low 均文档注释级——
      StateSnapshotPayload.generatedAtTurnId / expectedTurnId JSDoc 与
      实际"仅诊断"行为不一致（stale-turnId 防线已有 Known Issue 追踪）、
      normalizePosition 0.005 边界量化固有、Sync ⑦ recoveryCount 宽松
      断言——随 Phase 16 顺手处理，不阻塞）

## Known Issues（非阻塞）

- [ ] **[协议缺口→Phase 16]** SnapshotValidator 无 stale turnId 时序检查
      （generatedAtTurnId 低于 Guest 当前 turn 仍可 apply——权威模型下
      "回退恢复"合法但病态；真实触发需 Guest 领先 Host，仅页面后台化
      ACK 超时级联才可能出现）—— Phase 16+ 评估加 turn 时序防线
      （test-reviewer Low #1/#2 同源：两处 JSDoc 声称"据此校验/拒收"，
      实际仅诊断 —— 补防线或修注释二选一）
- [ ] **[环境限制]** INTERNET RECOVERY NOT VERIFIED（恢复验证为局域网
      同机双页真实 WebRTC + loopback；Wi-Fi ↔ 5G 外网恢复未测——
      Phase 14 起的外网验证债延续）
- [ ] **[行为变化]** Host TURN_END 现等 Guest ACK（8s 超时兜底）——
      极端网络下回合切换比 Phase 14 慢（设计如此：Turn Sync Barrier
      保证双端同步点）
- [ ] **[Info]** 恢复链触发时 SYNCHRONIZING 横幅可能闪现（恢复通常
      亚秒级；SYNC_FAILED 有持久横幅 + 返回菜单出口）

---

# Phase 16 — Disconnect / Rematch ✅

**目标**：Opponent disconnected 提示（Phase 14 已有）+ Return Menu（已有）+
**Online Rematch**：重新 gameSeed / GameState / Turn State，且复用同一
WebRTC 连接（不重新配对）。

## 实现落地（2026-09-29）

- **架构决策：零新 wire 协议**。Rematch 握手复用 PLAYER_READY → Host
  汇齐 → GAME_START（与 Lobby 进局完全同构）—— REMATCH 枚举保留
  不启用（V0.2 再评估显式"再来一局"邀请 UX）。
- **连接复用**：ResultScene 创建**新 OnlineGameCoordinator 实例共享同
  一 OnlineSession**（WebRTC 不重建）；channel / sync / hash / barrier
  状态随新实例天然重置（Phase 15 基建直接受益）；Host 的
  createMatchIdentity 每局生成全新 matchId + seed。
- **场景交接链**：BattleScene.transitionToResult 联机时把旧协调器经
  ResultSceneData.onlineCoordinator 交接（handedToResult 置位后
  Battle onShutdown 不销毁 session —— 与 Phase 14 handedOff 同防御
  模式）；ResultScene 负责旧协调器 dispose；回菜单 / 未交接时彻底
  清理（sessionManager.disposeSession → transport CLOSED）。
- **ResultScene 联机 Rematch**：REMATCH 按钮（联机分支创建）→
  onOnlineRematch（旧协调器 dispose → 新协调器 enterLobby +
  sendPlayerReady）→ Host 汇齐 → 新 GAME_START → startRematchBattle
  → 全新 BattleScene；WAITING FOR OPPONENT… / OPPONENT READY 提示
  行（update 轮询刷新，事件驱动到达 + 回前台补渲染）；对端 Result
  期离开 → OPPONENT LEFT — BACK TO MENU（按钮隐藏）；MAIN MENU 彻底
  清理（dispose + session 销毁 → 对端经断线提示得知）。
- **Coordinator 对称 ready**（Phase 16）：Guest 侧同样记录 Host 的
  PLAYER_READY（hostReady 字段）；`opponentReady` 公共 API（Host 视角
  = guestReady，Guest 视角 = hostReady）；handlePlayerReady 改为双方
  消费（started 后幂等）。
- **修复**：connectAndVerify 连接成功后未清 connectTimer（预算与验证
  窗口同税制 120s 后实测暴露——已连接会话会被误判 timedOut）；
  OnlineDebugInfo 新增 selfReady / started 诊断字段。
- **Rematch 重置契约验证**：新局 initialState 为全新权威状态
  （HP 10/10 / turn 1 / P1 先手 / hasFired=false / 预算 250），
  GameState 经 stateFromSnapshot 重建，TurnState 随 BattleScene
  create 全新实例 —— 满足"重新 gameSeed / GameState / Turn State"。

## 测试（Phase 16 新增 6 单测 + 7 E2E）

- Phase16Rematch.test.ts（loopback 双端）6 项：① 旧局结束 → 新协调
  器（同 session）→ 双方 Ready → 新 GAME_START（新 matchId/seed ≠
  旧局）→ 双方 onStart 同源 + 全新初始状态；② 对称 ready +
  started 后重复 Ready 双向幂等短路（不二次开局，验收修复轮强化）；
  ③ Result 期对端离开（dispose + close → 本端 onDisconnected；注释
  归因修正：感知来自 transport close 而非 DISCONNECT 消息）；
  ④ 新局 GameState 重置契约；⑤ 单方等待不超时（open-ended，真人
  节奏）；⑥ 对端先离开后点 REMATCH —— transport.connected 守卫
  依据 + sendPlayerReady 对死通道抛 TransportError（验收修复轮新增）
- E2E 123 → **130**：真实 WebRTC 自然终局链（Guest Turn 4 发射 →
  Turn 5 注入残血 → Host 精确击杀 → gameOver hash gate 放行双端
  ResultScene → Host WIN / Guest LOSE 视角）+ REMATCH（双方点击 →
  同一 WebRTC 连接复用 → 双方全新对局 HP 10/10 / Turn 1）+ 既有
  123 全绿
- E2E 时序修复（实测）：Turn 4 收口需双端前台轮换（Host 切后台炮弹
  物理冻结 → Guest FIRE_REQUEST 被 phase 门禁拒绝）；Host 的
  scene.start(Battle) 在后台页 rAF 冻结下永不启动 —— Guest 点击后
  必须立即 bringToFront(Host)（真人场景不受影响，面前页面自然前台）

## 验收

- [x] npm run typecheck
- [x] npm run test（41 files / 481 tests，含验收修复轮新增）
- [x] npm run build
- [x] npm run e2e（130 项：Offline 95 + Online 35，含自然终局 + Rematch）
- [x] Single Player / Local 2P 无回归（Offline 95 全绿；SP/L2P 的
      离线 REMATCH 路径未动）
- [x] Rematch 重新 gameSeed / GameState / Turn State（单测 ①④ + E2E
      新局断言）
- [x] test-reviewer 独立验收：**PASS WITH ISSUES**（见下节记录）；
      Medium×2 验收后修复并复验三命令全绿

## test-reviewer 验收记录（2026-09-29）

**判定：PASS WITH ISSUES**。reviewer 三命令亲跑全绿（typecheck /
480 tests / build；E2E 按指示未运行，代码与记录核验自洽）。
11 项验收：重置契约 / 连接复用 / 交接生命周期 / Host authority /
对称 ready / Result 期断线 / 离线隔离 / connectTimer 修复 / 场景
复用防御 / 测试质量 / 无过度设计 —— 无 Critical / High，Medium×2 +
Low×3。核心契约（重置、连接复用、Host authority、对称 ready、
离线隔离、connectTimer、实例复用防御）全部达标。

**Medium×2 —— Main Agent 亲修（场景/网络边缘路径，改动 < 10 行，
不值得再委托）+ 单测补充：**

- **ISSUE-1（孤儿 keepAlive timer）**：online Result 直接 MAIN MENU
  （未点 REMATCH）路径 oldCoordinator 永不 dispose —— Battle 期
  startKeepAlive 的 2s interval 仅经 dispose 清理，每退一次泄一个
  setInterval + 协调器对象图。修复：transitionTo online 分支补
  oldCoordinator 收口。
- **ISSUE-2（对端先离开 → REMATCH 死按钮）**：对端在本地点 REMATCH
  前离开 —— 旧协调器 gameOver 抑制断线提示，session 残留但通道已
  死；sendPlayerReady 向死通道发送抛 TransportError（tap 未捕获 =
  无响应无提示）。修复：onOnlineRematch 守卫
  `session === null || !session.transport.connected` → 直接
  OPPONENT LEFT（tap 回调整段同步执行，无 TOCTOU 窗口）。
- **复验（修复轮）**：typecheck ✅ / test 481（Phase16Rematch 6/6）✅ /
  build ✅。

**Low×3 处置**：② started 幂等补直接覆盖（②强化）；③ 注释归因修正
（transport close 而非 DISCONNECT 消息）；DISCONNECT 死信（Phase 14
遗留）与 E2E 静态 check 计数疑点 → Known Issues 记录。

## Known Issues（非阻塞）

- [ ] **[UX]** Rematch 无显式"邀请/拒绝"—— 双方都点才开局（与 Lobby
      同构的最简握手）；对端不点可无限等（可随时 MAIN MENU 退出）。
      REMATCH 消息枚举保留，V0.2 评估邀请 UX
- [ ] **[Info]** Result 期对端离开的感知依赖 transport close 事件
      （优雅关闭即时；进程崩溃走 ICE disconnected 瞬态 → 数十秒
      failed —— Phase 12 既有设计）
- [ ] **[Phase 15 遗留 → 已修]** connectTimer 连接成功后未清（同税制
      改动暴露的隐患，Phase 16 修复）
- [ ] **[Phase 14 遗留]** NetworkMessageType.DISCONNECT 死信：全 src
      仅 OnlineGameCoordinator.dispose 发送一处、零接收方（对端感知
      实际靠 transport close 事件触发）—— V0.2 清理枚举或补消费方
- [ ] **[Info]** E2E 静态 `check(` 计数 120 vs 运行记录 130（reviewer
      未运行 E2E 无法静态确证；记录来自实跑 130/130 绿，疑循环/动态
      计数差 —— 下次 E2E 运行顺带核对一次即闭环）

---

# Phase 17 — Juice / Polish

基础美术素材替换 Placeholder。

首屏样片进度（2026-09-29；不代表完整 A 批次或 Phase 17 完成）：

- [x] 风格规范、素材清单与接入顺序：`docs/ArtDesign/PHASE17_ART_DIRECTION.md`
- [x] 内置 image_gen 生成海港远景、蓝红角色静态姿态、机械塔楼、NORMAL 弹体和爆炸视觉，共 6 张 PNG
- [x] 主菜单背景与角色构图、金属按钮、战场背景 / 平台 / 塔楼、角色和血条面板接入
- [x] 远景按比例放大至至少 1800 世界像素高，顶部延伸到 y=-720；5000 世界像素宽度只铺两片相邻镜像
- [x] 修正标题拼写、手机横屏标题布局、角色脚底锚点；Debug Overlay 独立开关，保留 E2E 观测句柄
- [x] 双方角色改为二头身 Q 版并放大到约 180 世界像素高；碰撞体 120×180、发射点 / 引信 / 瞄准起始范围同步调参
- [x] NORMAL 弹体与单帧爆炸资源导入 `Projectile`，保留资源缺失时的 Graphics 回退
- [x] 484 单测通过；构建含类型检查通过；桌面 / 手机模拟截图复查
- [x] Chrome 实际截图检查：桌面 1440×900 @1x、手机模拟 844×390 @2x；菜单进入本地对战正常
- [ ] 样片用户视觉验收、真机验证、其余 A 批次素材与独立背景视差层

## 用户反馈修复轮（2026-09-29，4 项）

- [x] **Online 连接页返回按钮**：手机上 260 宽 BACK 与底部动作行（CONNECT/COPY）重叠
  —— 改为左上角 64×64 小 icon（'←'，safeArea 边距 24；标题 / 文案带整体
  下移让出顶部带；E2E 仍经 debug rect 点击，零脚本改动）
- [x] **炮弹视觉放大**：素材画布 1254 但内容仅 456px 宽，displaySize 64 时
  可见炮弹仅 ~23 世界 px（比碰撞直径 32 还小）→ 64 → **165**（可见
  ~60 世界 px ≈ 2× 碰撞直径，Q 版比例下可读；物理半径不变）
- [x] **瞄准朝向跟随抛物线**：`BattleScene.updateAimPoseVisual` 每帧按
  `aimState` 发射方向驱动 `Player.setFacing`（拖拽反向=发射向，左右跨拖
  自动翻转）；瞄准结束 / 发射 / 回合切换自动复位
- [x] **瞄准抬枪序列图 15/30/45/60/75°**：全能日辉（frontier_sunburst）
  以既有蓝红 chibi 为参考各生成 5 张透明姿态图（共 10 张，
  `public/assets/art/{blue,red}-aim{15..75}.png`）；`ArtAssets` 姿态
  key / 文件清单 / 分桶纯函数（<7.5° 回 idle，平局取小角）+
  实测锚点边界；`Player.setAimPose` 幂等切换纹理（素材缺失回退
  idle）；BootScene 预加载；单测 3 项（484 → 487）
- [x] **工具沉淀**：`scripts/measure-art.mjs`（零依赖 PNG alpha 边界
  测量，zlib 解码 + unfilter —— 姿态锚点 / 弹体尺寸实测来源）；
  `scripts/visual-check.mjs`（5 张视觉抽查截图：icon / 45°/75°/15°左
  翻转 / 炮弹飞行，多模态复查通过）
- [x] **E2E 时序修复 + 相机滞留根因修复**：全量 E2E 三连在同点失败
  （123/124，Guest 相机等 FREE_VIEW 超时）→ 诊断升级（卡点相机模式
  转储 + cameraEventLog）实锤根因：**desync 恢复不清在飞本地模拟炮弹**
  —— 后台冻结的旧回模拟在恢复+回前台后迟发 impact（camLog：
  `4:beginTransition→FREE_VIEW` → `4:impact@612`（turn 4 无人发射）
  → `attackResolved-waiting`），pendingTurnEnd 已消费无重试 → 相机
  永久滞留 IMPACT（真实用户后台化页面同窗口可中招）。修复：
  `ProjectileSystem.clearInFlightSimulations()`（静默销毁，无 IMPACT/
  OUT_OF_BOUNDS 事件）+ BattleScene 在 DESYNC_DETECTED/SYNC_REQUESTED
  入口调用；等待预算 5s→15s 一并对齐邻居（次因：全量负载下后台页
  rAF 恢复慢）。单段 29/29 通过 + 全量复跑见验证记录

资产来源、原始提示词、技术规格与局限：`docs/ArtDesign/FIRST_LOOK_ASSETS.md`。
首轮记录保留；后续音效与表现升级见下文及 `docs/ArtDesign/PHASE17_POLISH_REWORK.md`。完整逐帧角色动画仍不是当前程序动画的交付内容。

### 修复轮 Known Issues（非阻塞）

- [ ] **[Info]** 75° 姿态素材实际枪口仰角 ~60–65°（生成精度；序列递进
      可读，真人视角可接受）—— 后续素材批次统一重制时校正
- [ ] **[Info]** 手机端 Online 连接页提示行（prompt）与 DOM textarea 半
      遮挡（既有布局：textarea 锚定底部动作行，prompt 在其中段）——
      归样片用户视觉验收轮一并处理

## Juice 音效轮（2026-09-29）

## 美术批次轮（真机反馈，2026-09-29，concept01 / concept_UI 驱动）

- [x] **双方基地**（concept01 §05）：蓝方废铁要塞（瓦楞钢板+蓝爪印
  横幅+油桶/木箱/管道杂物）/ 红方工坊（烟囱群+天线桅+吊车臂+兔子头
  红横幅+货柜），760 世界 px 显示、**底部平整甲板=角色走线**、双方
  独立成体中间开阔断开（塔楼占位退役为回退）；甲板锚点 per-side
  （蓝 0.99 贴底 / 红 0.86 支柱区补偿 —— 宁沉勿浮，下沉被不透明地面
  条遮盖）；多模态截图复核双方甲板与走线齐平、走线连续
- [x] **HP HUD concept_UI 化**：铆钉深色钢板 + 顶部高光线 + 队色角签
  （P1/P2）+ 生成头像（缺素材队色占位）+ **10 段血格**（掉血逐格收缩
  + 数值闪红动画保留）
- [x] **手机移动按钮**（concept01 §06）：圆角矩形 → 扁平半透明圆形 +
  细描边 + 实心白三角，按下点亮队色
- [x] **触屏瞄准两态图标**（生成）：金准星金属盘=待命；红热准星+
  中心上膛炮弹+**呼吸脉冲**=瞄准中（弃用斜杠禁止符语义）
- [x] **主菜单 Logo**（生成，"RICOCHET RIVALS" 拼写多模态校验通过，
  O 为准星造型；缺素材回退 Georgia 文本）
- [x] **菜单按钮 9-slice 底板**（生成无字：金=主操作 / 钢=次要；切片
  按源尺寸比例 x15%/y25% 兼容任意生成尺寸；≥150 CSS 宽启用，64 icon
  小件保持程序绘制；动态文案与 E2E rect 断言零影响）
- [x] **瞄准上弹音效**：素材落地（sonilo 同 prompt 首发挂 20 分钟失败、
  重发成功）；requestAim 守卫全过后播（no-op 不响）
- [x] 视觉抽查脚本扩至 7 帧（+Online icon 手机帧、+弹道末段红方基地
  对齐帧）；资产台账更新见 `docs/ArtDesign/FIRST_LOOK_ASSETS.md`
- [x] 全量 E2E 回归（改 WorldBuilder/MenuButton/PlayerHud/
      TouchControls 共享组件）：含反馈修复轮后终验复跑
      **130 passed / 0 failed** 全绿

### 真机试玩反馈轮（2026-09-29，Mac ↔ iPhone 联机实测）

- [x] **飞行口哨无限循环修复**：真机复现「Host 发射命中后 Guest 端口哨
  不断重复」——循环只在 impact/out-of-bounds 停，而 desync 恢复
  clearInFlightSimulations 静默清场无 impact 事件 → 循环永不停止；
  用户拍板**飞行音效单次播放**，SfxBus 循环句柄机制整体删除（该
  bug 类连根拔除；发射时 whistle 播一次）
- [x] **弹体头尾朝向修复**：素材喷嘴端默认朝右 + 速度角原样旋转 →
  喷嘴冲前（双方都反）；速度角 **+180°**——圆头（弹头）朝飞行方向、
  喷嘴拖尾（多模态截图复核：上升段 nose 领先 up-right ✓，下降段随
  速度自动转头）
- [x] **爆炸期弹体隐藏**：exploding 分支无条件 setScale/setAlpha 把
  beginImpact 已隐藏的弹体抬回 alpha≈1 随爆炸放大——改为仅 Graphics
  回退路径保留占位放大；美术路径 beginImpact `setVisible(false)`
  弹体即隐，爆炸视觉全归 explosion 图层

- [x] **7 个音效全部生成并接入**（generate_sound_effect，sonilo 模型，
  复古街机卡通风与像素海港美术同调；`public/assets/sfx/*.mp3`，7 文件
  md5 全不同）：
  - launch（发射 pneumatic THOOMP）→ `ProjectileSystem.onLaunched`
  - projectile（飞行口哨，发射时单次播放）→ onLaunched
  - explosion（爆炸 boom）→ onImpact
  - hit（命中金属 clank+thud，有伤害才播）→ onImpact 结算
  - turn（回合切换双音上行）→ 回合横幅（断线/同步失败时不播）
  - victory / defeat（胜负 jingle，本地视角；Local 2P 恒庆祝；DRAW
    按 defeat）→ gameOver 横幅
- [x] **SfxBus**（`src/game/audio/SfxBus.ts`）：UserSettings.soundEnabled
  播放时门禁（菜单 SOUND 开关即时生效）+ 素材缺失静默跳过（同美术
  Graphics 回退原则）+ 单循环句柄幂等管理 + SHUTDOWN 兜底清理；
  BootScene 预加载；事件驱动接线（规则层零感知）；联机双端各播本地
  模拟一次、权威 TURN_RESULT 路径不重复触发（不双播）

增加：

- [x] launch sound
- [x] projectile sound
- [x] explosion
- [x] hit sound
- [x] turn sound
- [x] victory
- [x] defeat
- [x] camera shake（Phase 7 已有：`cameraController.shake()`，爆炸时触发）
- [x] impact freeze / hit stop（70ms 角色表现停顿，物理与网络继续）
- [x] particles（喷口火焰、烟尾、冲击环、爆炸烟团与火星）
- [x] player reaction（呼吸、移动起伏、后坐力、受击压缩与恢复、结算胜负姿态）
- [x] UI transitions（复用 220ms 场景淡入淡出，统一菜单/联机/结算美术）

这里重点优化：

“命中爽感”。

### 美术反馈修复轮（2026-09-29，第二批真机反馈）

- [x] **菜单上下压暗条移除**：上压暗框 + 副标题装饰（"HARBOR
      SKIRMISH / 01"）+ 底部深色条全部移除 —— MenuArtwork 只保留
      海港背景与蓝红角色构图
- [x] **按钮底板弃 NineSlice 改 Image 等比**：NineSlice 真机实测
      渲染 2.5 倍超标（~150px 高、压住输入框）；改 setDisplaySize
      等比铺满命中区（素材自带透明边距，可见药丸 ~50px 紧凑）；
      BUTTON_SLICE 常量与切片接线删除（ArtAssets / MenuButton）
- [x] **蓝基地甲板硬切修复**：素材甲板层实测在图高 ~92% 而非贴底，
      per-side 锚点（蓝 0.99 / 红 0.86）下蓝方甲板浮起 → 底边直切
      穿帮；锚点统一沉 **0.90** —— 甲板没入不透明地面条被遮盖
      （宁沉勿浮：下沉瑕疵被地面遮挡，浮起露缝必穿帮）
- [x] **红基地重生成**：杂物去红化 —— 只留兔子头横幅 + 旗，
      消除杂物群红色噪音（base-red.png 重生成替换）
- [x] 验证：typecheck / test（487）/ build 全绿 + E2E 全量复跑
      **130 passed / 0 failed**

---

### Phase 17 概念对齐与特效重制（2026-09-29）

- [x] 新生成并接入瞄准/取消双态图集、独立码头、金属头像框、烟雾粒子，共 4 张透明 PNG；旧按钮原图保留但停止预加载。
- [x] HUD 大头像、铆钉边框、队伍铭牌、红色分段血条与真实扣血动画；HUD/瞄准按钮抵消世界相机缩放，保持 CSS 尺寸和输入热区一致。
- [x] 标题人物按可见脚底站在生成平台；Logo 完整显示；手机底部功能按钮让出人物脚部。
- [x] 取消贯穿世界的钢板，左右基地甲板分别校准；仅两侧平台保留碰撞体，中间海域落弹按出界结束。
- [x] 火焰烟尾跟随速度反向；爆炸闪光、火团、冲击环、火星、烟团分层；修复贴图绝对 scale 导致的异常放大。
- [x] 下落镜头不再露出海面下方空画布；高空保留蓝色天空底层。
- [x] **相机顶界 clamp（用户试玩反馈：炮弹高飞时相机跟出背景图外露空白）**：
      PROJECTILE_FOLLOW 垂直上界 = 背景图顶（height − backgroundMinHeight，
      GameConfig 与 WorldBuilder 铺图同源常量）——炮弹过高时相机停在图顶
      等它回落，与左右 World Bounds 同语义；下界贴地构图保留
      （followClampedCenterY 纯函数吸收双界，cameraBounds 单测 9 → 13 项）。
      修复后 typecheck / 491 项单测 / build + 全量 E2E 复跑
      **130 passed / 0 failed** 全绿。
- [x] 类型检查、487 项单测、构建通过；完整 E2E 130/130；最终桌面/手机专项通过真实按钮双态、命中扣血、中场落弹、结算和联机页切换，无 pageerror。
- [ ] 整个 Phase 17 的用户视觉验收和真实手机性能验收；独立视差层与走路以外的完整逐帧角色动作仍保留为后续精制项，不冒充已生成。

制作记录、提示词和验证边界：`docs/ArtDesign/PHASE17_POLISH_REWORK.md`。

### 基地受损表现轮（2026-09-29，用户需求：HP 越低火烟越重）

- [x] **分档冒烟/起火**：HP 10–9 完好 → ≤8 轻烟 → ≤6 浓烟 → ≤4 烟+小火
      → ≤2 大火大烟（死亡同档 4）；阈值在 `GameConfig.baseDamageFx`
      （hpToBaseDamageTier 纯函数，tests/systems 5 项单测：边界 + 全 HP
      表 + 单调不回退）
- [x] **BaseDamageEffects 系统**（State 驱动纯视觉，同 PlayerHud 每帧幂等
      刷新模式）：每方基地烟/火双发射器，换档时重建（每局至多 8 次）；
      烟自结构上部升腾渐大渐淡，火苗 fx-spark 橙红短命窜动；发射点几何
      与铺图同源（WorldBuilder 导出 baseDockGeometry，消除公式重复）；
      调参集中在 TIER_PARAMS 表
- [x] debug 句柄新增 baseDamageTier（P1/P2 档位观测口，供 E2E/调试）
- [x] 验证：typecheck / test（496，42→43 files）/ build + 全量 E2E 复跑
      **130 passed / 0 failed** 全绿
- [ ] 真机视觉验收 + TIER_PARAMS 手感调参（烟量/火势/升速按反馈微调）

### 火焰序列与水波轮（2026-09-29，真机反馈）

> 水面遮挡方案已由后续「长支架与标题菜单精修」替代，当前不再加载前景水面条带；以下保留历史记录。

- [x] **火焰换 16 帧循环 sheet**（用户需求：替换粒子火苗）：全能耀斑生成
      `base-fire.png`（4×4 网格、原生透明、多模态复核连贯循环可用）；
      BootScene 运行时切帧编号 0…15（沿用 platform/aimControls 模式，
      `SHEET_GRID` 常量）；BaseDamageEffects 档 3 两处 / 档 4 四处
      火焰精灵（错帧 + 随机翻转移除同拍），fx-spark 粒子降级为
      缺素材回退
- [x] **码头前景水**（真机反馈：支腿底边"齐根切断"无近景水面衔接，
      腾空感）：首版两排 16 帧动画水波真机否定——用户拍板**静态图层**
      ——seedream 生成 8:1 宽幅水面条带 `water-strip.png`（6144×768，
      JPEG 顶区 Pillow 泛洪抠图转透明：泡沫剪影顶缘 + 不透明水体；
      多模态 + 程序双重校验：顶区零残留、水体零咬穿）；
      `buildForegroundWater` 与场景底图同宽镜向循环平铺（同远景板
      模式，天然无缝），水面线 ~1030 世界 px——走道下 70px 不挡
      角色、水体盖死支腿切边；水波 sheet 与精灵逻辑整体移除。
      截图复核：横铺连续、腾空消除、泡沫线自然、零遮挡；
      后续反馈轮：水体 HSV 色相 +19°（190°→209°）调至与背景海
      一致（HSV 采样驱动，白泡沫低饱和不受影响）
- [x] 验证：typecheck / test（496）/ build + 全量 E2E **130 passed /
      0 failed**（⚠️ 首跑 113/1 失败为 E2E 期间并行 vite build 触发
      puppeteer "detached Frame" CDP 竞态——E2E 与任何写 dist 的任务
      禁止并行；干净串行重跑全绿，静态水面版复跑亦全绿）
- [ ] 真机视觉验收（火焰动画观感 / 长支架平台观感）

### HUD 头像框渐变填色（2026-09-29，真机反馈）

- [x] **头像框内加从下往上渐变填色**：Graphics `fillGradientStyle`
      四角顶点色——底部队色（P1 0x3f8cff / P2 0xff5063）→ 顶部深色
      0x0d1520；56×56 圆角恰嵌 78×78 金属框内窗（下留铭牌带），
      画在头像之下（plate → fill → avatar → frame），头像透明边距
      透出渐变；零新素材纯程序绘制。截图复核：双框生效、下亮上暗
      方向正确、不溢出不遮铭牌血条、头像清晰、幅度克制
- [x] 验证：typecheck / test（496）/ build + 全量 E2E
      **130 passed / 0 failed** 全绿

### Rematch 等待提示强化（2026-09-29，真机反馈）

- [x] **「WAITING FOR OPPONENT…」醒目化**：16px 灰蓝 → **24px 粗体
      暖金 #ffe19a + 深描边 + 650ms 呼吸脉冲**（1↔0.5，同瞄准按钮
      节奏语义）；状态分色——等待=金色脉冲 / 对方已准备=金色常亮 /
      对方已离开=警示红 #ff8b7a 常亮；脉冲随状态机启停 + alpha
      复位，statusPulse 进 init 复位清单（Phase 11 场景复用防御）
- [x] 验证：typecheck / test（496）/ build + 全量 E2E
      **130 passed / 0 failed** 全绿（Phase 16 Rematch 流程断言走
      rematchPhase debug 句柄，不受文案样式影响）

### 中央章鱼触手（2026-09-29，用户新玩法特性）

- [x] **出现条件**：任一方 HP ≤ 4（`GameConfig.octopus.hpThreshold`，
      `shouldOctopusEmerge` 纯函数 + 4 项单测：边界/双端/死亡兜底/单调
      翻转）——与基地档 3 起火同阈值，终局叙事：双方起火 + 海怪升起
- [x] **阻挡玩法**：静态 Matter 碰撞体（450×0.5 宽 × 750×0.92 高 @
      x=2500），新增 `COLLISION_CATEGORY.OBSTACLE` + 炮弹引信激活后
      掩码并入——撞上即爆；中央爆炸距双方基地 >2000px = 零伤害，
      被挡 = 浪费回合 → 逼双方改打高抛物线（贴边擦过/擦顶可过 =
      "一定程度"阻挡）
- [x] **联机确定性**：出现条件只由 PlayerState HP 驱动，HP 只在回合
      结算更新 → 炮弹飞行期间触手状态恒定，双端本地模拟一致不破坏
      stateHash；碰撞体激活即时生效（升起 900ms 动画纯表现层）
- [x] **待机表现**：16 帧序列 sheet（两轮生成：首版帧间轮廓跳变会
      抽动 → 重生成剪影恒定版；生命感由程序补——底枢 ±1.4° 慢摆，
      剪影恒定 = 视觉与碰撞体永远匹配）+ 自海中升起渐显；
      素材缺失时特性整体关闭（不造隐形墙）
- [x] debug 句柄新增 octopus（E2E/调试观测口）
- [x] 验证：typecheck / test（**500**，+4）/ build + 全量 E2E
      **130 passed / 0 failed** 全绿——数学预验证最短基地对射
      （850↔4150）45° 精确解顶点恰在 x=2500、y≈6，高于碰撞体顶
      344px，终局击杀弹全数越过
- [ ] 真机验收（触手观感 / 摆幅 / 阻挡手感）
- [ ] **Known Issue**：SP AI 不感知触手（TrajectorySolver 无障碍
      规避），低血量局 AI 平射可能被挡浪费回合——V0.1 AI「陪打完」
      标准下可接受，后续 AI 升级时处理

### 章鱼血量与终局激光（2026-10-01）

- [x] 15 HP，沿用普通爆炸直击 2 / 溅射 1；击败立即移除 Matter 碰撞体，1100ms 顶部向下消融、84颗大光晕/拖尾碎屑与三层亮边后清理精灵/水面装饰，本局不重生。资源缺失时使用可见的程序触手并保留消融。
- [x] 击败开始时怪兽吼叫只播一次，遵守 SOUND 开关；新版中频吼叫平均音量提高约12dB、Sfx增益0.95，文件名更新避免缓存。激光到达基地时单次播放爆炸声；恢复/退出不重放旧演出。777单测/类型检查/构建，手机章鱼66项、真实WebRTC双端128项通过，包含音频解码、RMS/增益链、端点时刻和恢复去重。
- [x] 触手出现回合不计，之后满 5 个行动回合开始，每回合一次激光，任一方随机扣 1 HP；炮弹出界也推进计数，重复结算幂等。当前炮弹击败触手或已结束比赛时不再攻击。
- [x] 镜头先移动到触手 450 ms，再顶端粒子汇聚 500 ms、停顿 200 ms，从朝向目标侧、偏离竖直向下 30° 的角度扫到基地 800 ms；镜头跟随扫射，到达基地时显示扣血，完整演出后才切换回合或展示胜负。旧拖拽不抢镜头，视口变化时保持地面对齐。
- [x] Host 权威状态、TURN_RESULT / STATE_SNAPSHOT 必填字段、深拷贝和 hash v3；Guest 只表现，不额外扣血。恢复跳过历史攻击，旧消息不能让血量与回合历史倒退。
- [x] 规则 / 联机测试和手机尺寸真实触摸发炮测试覆盖击杀、激光、终局、再战；具体最终验证数量见 README 最新记录。
- [ ] iPhone Chrome 真机验收血条可读性、激光镜头与音效。

### 长支架与标题菜单精修（2026-09-29）

- [x] 生成并导入 `dock-platform-tall.png`：纵向立柱与交叉撑延长，战场及菜单共用同一透明裁切比例，保留站立线与移动判定。
- [x] 移除前景水面条带的预加载与绘制；海港原背景保持，立柱自然延伸出画面底部。
- [x] 标题放大，模式按钮缩至 244×52 CSS px；声音和全屏为右下角 48×48 图标，包含静音与退出全屏状态。
- [x] 修复 Pages 构建产物本地预览 base 路径不一致，生产预览可正常加载。
- [x] typecheck / 500 单测 / build；桌面与手机尺寸美术专项验收通过（声音切换、桌面全屏、瞄准、射击、命中、落海、结算、联机入口，无页面错误）。
- [x] 本轮完整 E2E：**147 passed / 0 failed**（桌面、移动端、AI、真实 WebRTC 对战、Desync 恢复与 Rematch）。
- [ ] 真机视觉确认及 Phase 18 设备 QA；浏览器手机模拟不替代真机结论。

素材来源、提示词、尺寸与截图：[制作记录](docs/ArtDesign/DOCK_MENU_REFINEMENT.md)。

### 走路、火焰与触角序列优化（2026-09-30）

- [x] 蓝红角色各 8 帧走路图集：位移驱动换帧，左右翻转，按实测脚底锚点对齐；停下回 idle，瞄准切回原抬枪图。
- [x] 大小火各 8 帧：HP≤4 三处小火，HP≤2 六处大小火混合，分布于屋顶、结构中层与下部；错帧和不同播放速度消除同步感。
- [x] 火焰与触角创建时先选择单帧再设置显示尺寸，修正按整张图集缩放造成的尺寸偏小。
- [x] 新触角 16 帧卷曲循环；从画面下方 1.5 秒向上升起，海面裁切控制揭露，根部局部泡沫柔化切边，无全屏水带。
- [x] 500 项单测、类型检查和构建通过。
- [x] 最终双角色动画专项：桌面/手机通过；原生裁切修复后完整 E2E：**147 passed / 0 failed**，含真实 WebRTC 对战、Desync、Rematch；未出现 WebGL 遮罩警告或页面脚本异常。
- [ ] 真机观感 / 性能确认；触角碰撞激活时机、HP 阈值及联机权威规则沿用原实现。

制作记录、资源来源与截图：[动画精修](docs/ArtDesign/ANIMATION_REFINEMENT.md)。

### 图片操作按钮与基地内自由移动（2026-09-30）

- [x] 生成并导入透明金属移动方向盘，左右镜像；手机按钮跟随基地两侧，视觉为角色投影高度的 82%，触控至少 48 CSS px，避让固定 UI。
- [x] 新金色/红色瞄准图：举枪角色、右上到右下的手指滑动箭头，激活态保留取消提示。
- [x] 红色头像取消错误镜像，与蓝色相向。
- [x] 取消旧 250px 每回合累计预算，行动阶段基地内自由往返；保留速度、边界、瞄准及发射后锁定。AI 与联机共用新规则，协议旧字段保留有限数值 0。
- [x] 最终 630 项单测、类型检查及构建通过；本轮完整浏览器 E2E **188 passed / 0 failed**；移动专项验证长按累计路程超过 1000px，松手停止且不越基地边界。独立审查已修复矮屏文字遮挡。
- [ ] 实机与 Safari 观感/手感确认。

素材、提示词与验证：[操作按钮制作记录](docs/ArtDesign/CONTROL_ART_UPDATE_2026-09-30.md)。旧 Phase 的移动预算说明为历史记录，以本轮新规则和当前 GameConfig 为准。

### 瞄准剪影与顶部小地图（2026-09-30）

- [x] 瞄准图内人物改黑色持枪剪影，手指/箭头从身体右上滑向左下；红方共用整图水平镜像，金/红两态均生效。
- [x] 删除“己方／敌方”快速定位按钮及其输入区域，手机/桌面顶部中央显示简易小地图，标出双方基地、人物实时位置与当前回合。
- [x] 小地图只读现有 GameState，不增加联机消息；配套调整回合横幅，避开 HP、瞄准和安全区。
- [x] 652 单测、类型检查和构建通过；完整 E2E 190/190；独立复核已修复极矮屏提示遮挡与字号问题，最终重跑包含 180px 高度的美术专项。
- [ ] 真机视觉与手感确认。

素材与提示词：[剪影和小地图制作记录](docs/ArtDesign/MINIMAP_AIM_REFINEMENT_2026-09-30.md)。

### 圆形瞄准、红方交替步态与小地图扩展（2026-09-30）

- [x] 新生成圆形简化持枪角色按钮：2026-10-01 调整为两态内容均彩色，待机银框 + 外侧闪烁光晕、激活金框且光晕消失；手机保持 64 CSS px，圆形命中，红方两态共用水平镜像。
- [x] 弃用缺少换脚的 16 帧尝试；红方重新制作 8 个步态关键帧，左右腿交替完成接触、承重、经过、前摆，两次经过相遮挡反转。
- [x] 按每帧脚底与水平锚点对齐，左右镜像同步锚点；红方全周期改为 240px，减少过快抖脚，蓝方保留 96px。
- [x] 小地图增加飞行炮弹标记和真实相机视野白框；读取现有双端模拟，不增加消息，命中/销毁/恢复后标记随状态清除。
- [x] 663 单测、类型检查和构建通过；完整 E2E 194/194，包含双端炮弹显示及结算清除。
- [x] 最终素材重跑桌面/触屏美术与动画专项，完整红方 8 帧、左右走与停步通过，实际行走录像归档；独立复核无 P0/P1/P2。
- [ ] 真机视觉与手感确认；红方第 6 帧较夸张的 Q 版抬膝可继续精制。

素材、提示词与预览：[本轮更新](docs/ArtDesign/ROUND_AIM_WALK_MINIMAP_2026-09-30.md)。

### 联机按钮与返回按钮重设计（2026-10-01）

- [x] 主菜单 ONLINE 入口与联机页创建、加入、连接、复制、重试、进入战斗、返回统一为深海蓝嵌板、切角金属框和铆钉，主操作黄铜边、次操作钢边，配动作图标。
- [x] 返回按钮保留 64×64 CSS px 触控区；窄屏按钮适配可用宽度，文字按实际高度留间距，成功状态横排与安全区布局通过。
- [x] 767 单测、类型检查和构建通过；五尺寸浏览器检查48/48、真实房间码联机55/55、桌面48/48；独立审查无 P0/P1/P2。
- [ ] iPhone 真机观感与点击体验确认。

### 建房失败启动提醒（2026-10-01）

- [x] 首次建房的信令连接/服务器失败显示金色提示框：“房间服务器正在启动，请10秒后重试”；保留 TRY AGAIN 手动重试。
- [x] 加入失败、非法房间码与已有房间恢复失败继续保留原错误；重试清除旧房间身份，重新建房能再次展示提醒。
- [x] 767 单测、类型检查与构建通过；五尺寸真实 WebSocket 浏览器检查76/76，覆盖失败、重试、成功建房、过期恢复、加入和返回；正常房间码联机55/55，独立审查无剩余 P0/P1/P2。
- [ ] iPhone 真机显示确认。

---

# Phase 18 — Mobile QA & V0.1 Release Hardening（2026-09-29 重定义）

> 本阶段不开发新 Gameplay Feature（禁新武器 / Item / 地图机制 / Wind / 选人 / 商店 / 排行榜 / 新章鱼 / 新 AI）。
> AI 不感知章鱼障碍 = Known Issue / V0.2，仅当导致 AI 无法完成游戏才扩 scope。
> Phase 17 边界：真机视觉验收并入本阶段；视差层 / 走路以外的完整角色动作 / AI 感知章鱼 = Phase 17 follow-up，非阻塞。
> 完成即 **V0.1 Release Candidate**。

## 旧六项状态（Phase 6.5 起已实现 —— 只验不建）

- [x] Responsive Canvas —— **IMPLEMENTED — VERIFY ON DEVICE**（Scale.NONE + ViewportService：位图=CSS×DPR、显式 canvas style、visualViewport 优先）
- [x] Touch Camera Drag —— **IMPLEMENTED — VERIFY ON DEVICE**（InputRouter window 级 Pointer Events + GestureArbiter，UI > AIM > MOVEMENT > CAMERA）
- [x] Touch Aim Drag —— **IMPLEMENTED — VERIFY ON DEVICE**（AimController 触屏起始半径 150 CSS px + 14px 死区，死区内松手静默取消）
- [x] Prevent Browser Scroll —— **IMPLEMENTED — VERIFY ON DEVICE**（touch-action:none / overscroll-behavior:none / iOS gesture 事件拦截 / dblclick+contextmenu preventDefault）
- [x] Landscape Warning —— **IMPLEMENTED — VERIFY ON DEVICE**（OrientationGate DOM 覆盖层，仅 BattleScene 门禁；Menu/Online 允许竖屏）
- [x] Safe Area —— **IMPLEMENTED — VERIFY ON DEVICE**（viewport-fit=cover + env() insets ×DPR，各 Scene 布局消费）

## Step 1 审计结论（2026-09-29，Main Agent 只读复核）

**ALREADY IMPLEMENTED**（代码级确认）：ViewportService（visualViewport 优先 / 幂等 applyViewport / destroy 清理）、DeviceProfile（UA-free 能力检测）、OrientationGate（Battle-only shouldGate）、InputRouter（client→画布坐标换算 / pointerId 多指仲裁 / pointercancel / blur releaseAll / DOM 覆盖层天然拦截）、TouchControls（88px 移动钮多指追踪 / 隐藏即清 heldPointers / 相位门禁）、AimController（死区 / 相机模式守卫中止 / 最小力度门禁）、CameraController（FREE_VIEW 拖拽 + 双向 clamp）、DPR 高清渲染（含 canvas CSS 滞留坑修复与 E2E deviceScaleFactor 断言）、浏览器手势防御全套、Online textarea（挂 body + touch-action:auto + user-select:text 显式重开 —— Step 9 关注点已处理）、Fullscreen（feature-detect + 失败兜底）、移动端 E2E 既有 29 项（含 DPR 路径 / 画布偏移回归 / 竖屏覆盖层）。

**NEEDS FIX（代码级缺口 —— 2026-09-29 已全部处置）**：
- [x] F1：聚焦按钮命中区 24 → **48 CSS px 下限**（视觉保持 24；FOCUS_GAP 8→24
      使相邻命中区零重叠；移动钮 88 已达标不动）—— 既有 E2E 硬编码坐标
      经数学验证仍落在新命中区内
- [x] F2：音频 unlock —— **Phaser 4 内建**（源码验证：body 级 touchstart/
      mousedown/keydown → context.resume()，首手势即解锁；iOS 17/18 后台
      返回 VISIBLE → suspend+resume 兜底 phaserjs#6829）—— 无需自定义，
      留真机复验
- [x] F3：粒子观测口 —— `countAliveParticles()`（场景 ParticleEmitter
      存活计数总和）→ DebugOverlay `Particles` 行 + `__RR_DEBUG__.particles`
      句柄（QA 记录 / E2E 粒子预算断言口）
- [x] 验证：F1/F3 后 typecheck / test（500）/ build 全绿（E2E 随 Step 16 一起跑）

**NEEDS VERIFICATION（真机项，代码无法自证）**：DPR3 清晰度、刘海/灵动岛/Home Indicator 实机遮挡、iOS Safari WebAudio 首交互解锁、后台/前台恢复（各相机模式）、工具栏伸缩（visualViewport 监听已接，行为待验）、中低端机性能、跨网移动 WebRTC、瞄准手感（命中区/死区/最大力度反馈）、740×360 小屏视觉。

## Step 3-17 QA 矩阵

### 视口/渲染（Step 3）—— Canvas CSS size / bitmap / game size / zoom / 指针坐标五一致性
- [ ] 冷启动 / resize / 旋转双向 / 工具栏伸缩 / 全屏进出 / 后台返回 / DPR2 / DPR3
- [ ] High-DPI：iPhone DPR3 / Android DPR2-3 不糊，不得回退 CSS 位图方案
- [ ] 动态相机：不同宽高比横向范围不同、纵向构图恒定；禁改 World/Physics/移动/爆炸参数

### 安全区（Step 4）—— 四 Scene 全覆盖（不只 Battle）
- [ ] MainMenu / Battle / OnlineConnection / Result；P1/P2 HUD、瞄准钮、移动钮、聚焦钮、返回/Copy/Connect/Rematch/MainMenu

### 触控 QA（Step 5-7）—— 触摸相机 / 移动 / 瞄准
- [ ] 相机：拖向自然 / 不越界 / 指针离画布不卡死 / pointercancel / 切后台 / UI-Aim-Move 不误触相机 / 快速连拖无残留
- [ ] 移动：按住走 / 松手停 / 左右快速切换 / 双指各按 / 滑出释放 / cancel / 切后台 / 换回合 / 瞄准中 / 弹道中；无"持续走/按钮卡/预算扣/结束后仍动"
- [ ] 瞄准（P0）：15°-75° 双方各测；命中区足够 / 指指不遮反馈 / 死区 / 小拖不误射 / 满力可辨 / 出屏松手不卡 / cancel / Fire / 无二次 Fire / 相机不抢手势

### 触控目标审计（Step 8）：全部主要目标 ≥48 CSS px，主操作 ≥56
### 在线连接移动端（Step 9）：Create→Copy→切微信→回浏览器→Paste 全链真机；后台切换不销毁 RTC/session；textarea 选择/粘贴/键盘不受全局 touch-action 影响（代码已确认，真机复验）
- [ ] OnlineConnection 竖屏可用；连接成功进 Battle 时 Portrait → Rotate Overlay（非错位/非不可操作开局）

### 移动 WebRTC Smoke（Step 10）：跨网至少 4 完整回合 + 一次伤害 + Rematch/终局；记录 Connected/Ping/断线/Rematch；无法跨网则明确记 INTERNET MOBILE P2P NOT VERIFIED（禁假设成功）
### 音频移动端（Step 11）：首交互后可播；8 音效全检；Safari autoplay/AudioContext unlock；不得"第一炮静音第二炮才响"
### 性能（Step 12）：中低端机 FPS/长帧/内存/粒子数；最重场景（火焰+烟+章鱼+炮弹）；目标 ≥45 FPS 持续、近 60 理想、爆炸偶发 spike 可接受；粒子预算无无限增长、连续 Rematch 5 次无泄漏
### 后台/前台恢复（Step 13）：FREE_VIEW / AIMING / PROJECTILE_FOLLOW / 对手回合 各切后台 5s；无输入卡死/移动持续/Aim 持续/手势残留；Online 允许连接瞬态、不得 corrupt GameState
### 视觉 QA（Step 14，并入 Phase 17 验收）：HUD 可读 / 角色比例 / 弹道点 / 爆炸 / 基地烟火 / 前景水 / 章鱼 / Result / Rematch 等待 / 菜单 —— 重点 844×390 与 740×360
### 可用性 sanity（Step 15）：按钮文案可读、不靠 hover 表达；YOUR TURN / OPPONENT TURN / WAITING / CONNECTED / DISCONNECTED 均有文字/图形状态（非仅颜色）
### 自动化回归（Step 16，agent 侧 —— 2026-09-29 已落地）
- [x] E2E Mobile Viewport Flow：**932×430 @DPR3 新段 15 项**（设备矩阵
      iPhone 16 Pro Max 档）：DPR3 全断言组（uiScale=3 / 位图 2796×1290 /
      CSS=视口 / zoom≈1.194 / landscape / 覆盖层隐藏）+ AimButton 动态坐标
      （W−52, H/2）→ 瞄准 → 死区 → 发射 → PROJECTILE_FOLLOW → 换手 P2；
      844×390 全流程既有覆盖不变
- [x] Portrait Battle：Overlay visible / Landscape：hidden（既有断言，复核通过）
- [x] Pointer 回归：**双指各按 ◀/▶**（合成 PointerEvent 双 pointerId：净方向 0
      原地 → 松一指向右 → 全松即停）+ **pointercancel 释放**（拖拽被系统打断
      → 后续手势仍可平移，无残留 owner）；orientation resize / 画布坐标换算
      （既有竖屏往返 + 画布偏移回归覆盖）
- [x] 粒子预算基线断言（开局存活粒子 = 0，经 `__RR_DEBUG__.particles`）
- [x] 验证：test（500）/ build / 全量 E2E **145 passed / 0 failed**（130 → 145，
      串行独占跑，无并行写 dist 任务）

### 发布回归（Step 17）：全部修复后串行 typecheck / test / build / e2e（**禁与写 dist 任务并行** —— detached Frame 竞态已有实录）

## test-reviewer 验收记录（2026-09-29，agent 侧）

**判定：PASS WITH ISSUES（仅 P3×3，无 P0/P1/P2）—— agent 侧 Release Gate 就绪。**
独立复跑：typecheck ✅ / test **500/500** ✅ / build ✅ / `RR_E2E_ONLY=mobile` 段 **46/46** ✅（Phase 18 新 15 项全绿）。
关键复核结论：F1 命中区数学成立（新中心 398/446，硬编码 406/438 落新命中区余量 16px；740×360 最窄视口与移动钮/AimButton 无交集；zone 仲裁优先级未破坏）；F2 Phaser 内建 unlock 源码实锤（body 级 touchstart/touchend/mousedown/mouseup/keydown 五事件 → resume()，表述已按 reviewer 修正）；F3 零成本路径与发射器遍历完整性确认；E2E 合成 PointerEvent 与真实触摸同链路成立（claimant 无 isPrimary/pointerType 门）；PHASE18_DEVICE_QA.md 覆盖完整。

**P3×3 处置（验收后即修）**：
- [x] P3-1：pointercancel 用例补前置断言「首个合成拖拽确实平移了相机」（cMid ≠ cPre，cancel 用例非空洞通过）
- [x] P3-2：粒子基线 `===0` 配对新增「飞行期 > 0」计数器 sanity 断言（弹尾发射器活跃期）
- [x] P3-3：QA 文档补 A14 工具栏伸缩 / A15 全屏进出 / A16 旋转双向三个显式勾选项
- [x] P3 修复后复验：typecheck / build + 全量 E2E **147 passed / 0 failed**（145 → 147）

**剩余**：用户侧真机 QA（`docs/PHASE18_DEVICE_QA.md`，A-F 六段）→ 反馈按 Bug 路由派发 → 串行四命令复验 → Phase 18 = COMPLETE + V0.1 RELEASE GATE 更新（不自动进 V0.2）。

## Bug 路由与严重级
- Touch/Aim/Camera/Gameplay → gameplay-engineer；WebRTC/Session → network-engineer；Viewport/Scene/CSS/UI/发布集成 → Main Agent
- P0（crash/不可玩/触控失灵/画布尺寸错/瞄准不可用/状态损坏）与 P1（输入粘滞/刘海遮挡/严重掉帧/方向失效/音频全无/Rematch 泄漏）必须清零；P2/P3 记录不阻塞

## 验收标准（全部满足才 COMPLETE）
- [ ] 既有移动端设施已审计（本节 Step 1）
- [ ] Responsive Canvas / High-DPI / 触摸相机 / 触摸移动 / 触摸瞄准 真机通过
- [ ] 浏览器滚动/手势冲突无 P0/P1；Landscape Gate 真机通过；Online Connection 竖屏可用
- [ ] Safe Area 真机通过；iOS Safari baseline 通过或明确阻塞项；Android Chrome baseline 通过或明确阻塞项
- [ ] 后台/前台恢复无 P0/P1；音频移动端 baseline；性能无持续严重掉帧
- [ ] Rematch / Scene 生命周期无明显泄漏；Online Mobile 完成 REAL smoke test（或如实记录 NOT VERIFIED）
- [ ] SP / L2P / Online 无回归；typecheck / test / build / e2e 四绿
- [ ] test-reviewer PASS（或 PASS WITH ISSUES 且仅剩 P2/P3）

完成后：TASKS.md 标 Phase 18 = COMPLETE、更新 V0.1 RELEASE GATE，**不自动进入 V0.2**。

---

# Online Connection Migration（SG-0 ~ SG-8，分支 `dev_signaling_turn`）

> 状态：**SG-0 ~ SG-8 全部 ✅（2026-09-30 迁移代码侧完成；2026-10-01 合并 main 前复验：根 788/788 + server 43/43 + 全量 E2E 215/215）。公网 WSS 信令已部署验证（Render 单实例 `wss://ricochet-rivals.onrender.com`）；剩余 = coturn TURN（**尚未启用**）+ 真机验收矩阵（**尚未执行**）+ Manual SDP Cleanup —— 见章节尾「待办」。**
>
> **架构红线（本迁移全程有效）**：
> - WebSocket **只用于 Signaling**（房间配对 / SDP / ICE candidate 交换）；Gameplay
>   一律继续走 WebRTC DataChannel —— 本迁移是 WebRTC Connection Layer Upgrade，
>   **不是** Gameplay Networking Rewrite。
> - SignalingMessage（连接协议）与 NetworkEnvelope（Gameplay 协议）完全独立，互不 import。
> - Gameplay 禁止感知 Signaling Server；Signaling Server 禁止处理 Gameplay State。
> - 必须复用既有：NetworkTransport / WebRTCTransport / NetworkManager / OnlineSession /
>   OnlineGameCoordinator / Host Authority / GameCommand / State Sync / Snapshot
>   Recovery / Rematch。
> - Manual SDP 流保留为 **Debug fallback**（DEBUG_GAME 门控），迁移稳定后单独 Cleanup，
>   本阶段不删除任何已验证旧 WebRTC 代码。

## SG-0 Audit（只读，2026-09-30）✅

10 个目标文件全量精读（2772 行）+ 引用面 / 测试契约 / E2E 段核对。结论：

| 文件 | 分类 | 说明 |
|---|---|---|
| WebRTCTransport.ts | MODIFY | wire/状态机/生命周期全保；信令段改 Trickle（SG-3/4）、诊断口（SG-6）、restartIce（SG-8）；400 行红线 → 协商编排归 RoomConnectionController |
| WebRTCConfig.ts | MODIFY | 加 iceTransportPolicy；iceServers 已注入式（SG-6） |
| OnlineConnectionController.ts | DEBUG ONLY | 手动配对编排器 → Debug fallback；其 connectAndVerify/PING-PONG 验证/detach 语义为 SG-3 必须复用资产 |
| OnlineConnectionScene.ts | MODIFY | SG-5 新 UI 流 + debug 分支 |
| OnlineConnectionState.ts | MODIFY | 新增 room 流状态（建议独立 enum） |
| OnlineSession.ts | KEEP | 零改动；Signaling 不得触碰 |
| NetworkManager.ts | KEEP | SG-0~7 零改动（SG-8 走其下层） |
| ConnectionCodeCodec.ts | DEBUG ONLY | 纯手动流 |
| SignalingCodec.ts | MODIFY | ⚠️ 实为 SDP codec（与新 WS 信令协议防混淆）；encode/decode 双流共用，waitForIceGatheringComplete 降 debug-only |
| OnlineGameCoordinator.ts | KEEP | 零 signaling 知识；SG-8 时小幅挂钩（复用 Phase 15 恢复链，不建第二套 reconnect recovery） |

关键事实：手动流引用封闭（仅 Scene/Controller/两个 codec/Transport）；`disconnected`
瞬态处理已正确（后台 grace period 基础良好）；tests/network 三套 + E2E online 段钉住
Debug fallback 行为；分支无 `dev_websocket`，按规格自 `Dev` 拉 `dev_signaling_turn`。

**用户决策（2026-09-30）**：TURN 来源 = **自建 coturn**（`use-auth-secret` +
`static-auth-secret` 动态凭据；Shared Secret 只存 TURN server + Signaling server，
凭据 TTL 30~60 分钟；浏览器只拿临时 username/credential —— SG-6 落地）。
Signaling Server 部署 host 待 SG-2 后定（本地 Node WS server 先行）。

## SG-1 Signaling Protocol + SignalingClient ✅（2026-09-30）

新增（`src/game/network/signaling/`，环境无关纯 TS —— SG-2 Node Server 直接 import 同一协议文件，单一事实源）：

- [x] `RoomCode.ts`（31 行）— 6 位高可读码：alphabet 排除 0/O/1/I/L；
      `normalizeRoomCode`（大小写/空白/连字符容忍）+ `isValidRoomCode`
- [x] `SignalingMessage.ts`（299 行）— 协议契约：`{ v:1, type, ...payload }` JSON
      文本帧；出站 6 类型（CREATE_ROOM/JOIN_ROOM/OFFER/ANSWER/ICE_CANDIDATE/ICE_END）、
      入站 9 类型（ROOM_CREATED/ROOM_JOINED/PEER_JOINED/OFFER/ANSWER/ICE_CANDIDATE/
      ICE_END/PEER_LEFT/ERROR，含 iceServers/peerToken/expiresAt）；encode throw
      （内部 bug）/ decode Result 双轨（Untrusted Input 永不 throw）；
      `SignalingIceServer`/`SignalingIceCandidate` 结构兼容 RTCIceServer/
      RTCIceCandidateInit（测试含编译期断言；Node 侧无需 DOM lib）；ERROR code 前向兼容
- [x] `SignalingClient.ts`（535 行）— WS 客户端状态机（规格推荐 7 态）：
      DISCONNECTED → CONNECTING → CONNECTED →（Host: ROOM_CREATED → ROOM_WAITING →
      PEER_JOINED / Guest: ROOM_JOINED 直达）→ PEER_FOUND → NEGOTIATING → FAILED；
      connect() promise + 10s open 超时 + 重复调用复用；createRoom/joinRoom（非法码
      本端拒绝零帧发出）；Trickle 发送 API（sendOffer/sendAnswer/sendIceCandidate/
      sendIceEnd，首个协商帧自动入 NEGOTIATING）；失败分类（CONNECT_FAILED/
      CONNECT_TIMEOUT/WS_CLOSED/SERVER_ERROR —— SG-7 失败 UX 的原始输入）；
      close() 摘 listener→结清 pending→关 socket→清订阅（幂等）；FAILED/close 后
      不可复活（重连新建实例，同 transport 纪律）；handler 异常隔离（同 NetworkManager）
- [x] 语义决策：PEER_LEFT 只投事件不改状态（协商期生死 controller 裁决、对局期
      Phase 16 断线链处理，信令层不越权）；ERROR → FAILED 由 onFailure 承载、
      不重复投递 onMessage；未知 ERROR code 照常投递（前向兼容）

测试（`tests/network/signaling/`，新增 25，总 **525/525**）：

- [x] RoomCode：alphabet 逐一通过 + 排除字符全拒 + normalize 容忍 + 长度/非法字符
- [x] SignalingMessage：全类型 roundtrip、出站契约 throw、畸形帧拒绝矩阵
      （EMPTY/NOT_JSON/NOT_OBJECT/UNSUPPORTED_VERSION/UNKNOWN_TYPE 含出站类型回环/
      逐字段 INVALID_PAYLOAD）、ERROR 前向兼容、DOM 结构兼容编译期断言
- [x] SignalingClient（FakeWebSocket 注入）：连接 resolve/reject/超时（fake timers）/
      复用 promise、Host/Guest 双全流状态序列断言、joinRoom 非法码零帧、四类状态
      守卫（NOT_CONNECTED/NO_PEER/INVALID_STATE/TERMINAL）、ERROR→FAILED、PEER_LEFT
      不改状态、五类非法帧丢弃不崩、WS 中断双分类（握手期 CONNECT_FAILED /
      建立后 WS_CLOSED）、close 全清理（listener 计数断言 + 订阅清空）、handler
      异常隔离

验证（2026-09-30）：typecheck ✅ / test **525/525** ✅ / build ✅
（SG-1 纯新增模块未触 UI/Gameplay —— E2E 留待 SG-5 UI 集成时全量回归）

## SG-2 Signaling Server ✅（2026-09-30）

独立 workspace `server/signaling/`（Node 22 + TS + `ws`，与客户端零耦合：协议契约
直接 import `src/game/network/signaling/SignalingMessage.ts` —— 单一事实源；server
tsconfig 无 DOM lib 依赖；根 typecheck/test 不含 server，server 自带 `typecheck` /
`test` 命令）。**WebSocket 只做 Signaling**（房间配对 / SDP / ICE 转发），零 Gameplay
状态（架构红线）。

共享协议扩展（SG-2a，根工程测试 525 → 529）：

- [x] `decodeSignalingOutboundMessage`（Server 收 Client 帧的 Untrusted Input 防线，
      与入站 decode 对称的 Result 双轨）
- [x] `encodeSignalingInboundMessage`（Server 出口：ack/事件/转发帧编码 + 契约校验）
- [x] `JOIN_ROOM` 可选 `peerToken`（reconnect identity 载体）；`SignalingClient.joinRoom
      (roomCode, peerToken?)` 透传（SG-8 ICE restart 重信令复用同一入口）

服务端实现（`server/signaling/src/`）：

- [x] `socket.ts` — `SignalingSocket` 最小 surface（ws 适配 / 测试 fake 注入）+ `RoomRole`
- [x] `serverConfig.ts` — env fail-fast 配置：PORT / SIGNALING_WAITING_TTL_MS（默认
      10min，规格 5~10min）/ SIGNALING_SLOT_GRACE_MS（30s 重连窗）/
      SIGNALING_SWEEP_INTERVAL_MS / SIGNALING_ICE_SERVERS（JSON 注入；SG-6 换 coturn
      动态凭据，secret 永不入仓库）
- [x] `SignalingRoom.ts` — host/guest 双槽位实体：waiting 截止 / 断开保留期 / 槽位
      释放 / peerOf 转发寻址 / 删除判定（waiting-expired · host-grace-elapsed）
- [x] `RoomManager.ts` — 注册表：crypto 随机 6 位码（防枚举；碰撞重试）+
      randomUUID token；joinRoom 校验矩阵 + token resume；sweep（惰性 + 周期）；
      now / 码 / token 生成器全注入（FakeClock 直测，无 fake timers）
- [x] `SignalingRoomServer.ts` — 分发核心：绑定表 / CREATE_ROOM / JOIN_ROOM（成功 →
      ROOM_JOINED + 对端 PEER_JOINED）/ relay 转发 / PEER_LEFT / ERROR 回执 /
      runSweep 删房通知；duplicate join（已绑定 socket 再 CREATE/JOIN）→
      INVALID_MESSAGE
- [x] `bootstrap.ts` + `index.ts` — ws 接线（二进制帧丢弃）+ 周期 sweep + 优雅退出；
      port:0 可测（集成测试用）

语义决策（Host = 房间锚点，呼应 Host Authoritative 架构）：

- **角色由动作固化**：CREATE_ROOM = Host = P1 / JOIN_ROOM = Guest = P2，协议无角色
  声明字段 → 结构性杜绝 Guest 自称 Host；token 不匹配槽位一律按新 join 走占用检查
- **token resume**：断开后持 token 重入原位恢复（grace 30s）；槽位连接中同 token
  声明 → ROOM_FULL（双开 / 劫持保护）；guest 槽超窗释放后原 token 失效（新 join 新
  token）；host 槽在房间存续期不释放（host token 可随时 resume）
- **Host 断开**：对端即时 PEER_LEFT；grace 内可 resume；超窗房间删除（新 guest join
  无主房间 → ROOM_EXPIRED 'host disconnected'）
- **PEER_LEFT 发送时序**：peer 解析必须在 detach 之前（detach 后 socket 已离槽，
  peerOf 无从定位对端 —— 实测 bug 修复，RoomServer 测试 7/8 守住）

测试（`server/signaling/tests/`，**25/25** ✅）：

- [x] `RoomManager.test.ts`（11）：create（200 次唯一）/ 码碰撞重试 / join + token /
      INVALID_ROOM_CODE vs ROOM_NOT_FOUND / ROOM_FULL / waiting 过期惰性删 / sweep
      选择性删除 / 席位保留 + 超窗顶替 / guest·host 双向 resume / token 防劫持
      （双开 ROOM_FULL）/ host 断开矩阵
- [x] `SignalingRoomServer.test.ts`（12）：ROOM_CREATED ack 字段 / JOIN 双 ack +
      PEER_JOINED / malformed 四类 → INVALID_MESSAGE 且连接存活 / duplicate join
      双向 / relay 四类帧双向不回声 / NOT_IN_ROOM / PEER_LEFT + 静默丢弃 / resume
      端到端 / 房间隔离 / join 三错码矩阵 / sweep → ERROR ROOM_EXPIRED + 解绑 /
      EMPTY 帧
- [x] `Integration.test.ts`（2，真实 node:ws port:0）：create → join → 四类帧
      relay → PEER_LEFT 全链路 + ROOM_NOT_FOUND 回环

验证（2026-09-30）：server typecheck ✅ / server test **25/25** ✅ / 根 typecheck ✅ /
根 test **529/529** ✅ / 根 build ✅ / `tsx src/index.ts` 冒烟（监听日志 + 退出）✅

## SG-3 RoomConnectionController ✅（2026-09-30）

自动 SDP 编排（迁移规格推荐边界）：OnlineConnectionScene →
**RoomConnectionController** → SignalingClient + WebRTCTransport。Scene 只渲染
（接线在 SG-5）；Manual SDP 流不动（Debug fallback）。

新增：

- [x] `RoomConnectionState.ts`（71）—— 独立状态机（IDLE → CONNECTING_SIGNALING →
      CREATING_ROOM/JOINING_ROOM → ROOM_WAITING/NEGOTIATING → CONNECTING →
      CONNECTED → VERIFIED → FAILED/CLOSED）+ `RoomConnectionFailure` 十类分类
      （SIGNALING_FAILED / SERVER_ERROR(code) / INVALID_ROOM_CODE / SETUP_FAILED /
      OFFER_FAILED / ANSWER_FAILED / PEER_LEFT / CONNECT_FAILED /
      VERIFICATION_TIMEOUT —— SG-7 失败 UX 的原始输入）
- [x] `RoomConnectionController.ts`（682）—— 双角色全自动编排：
      * Host：createRoom() → resolve 于 ROOM_WAITING（房间码就绪）→ PEER_JOINED
        → createOffer → **sendOffer 自动外发** → 收 ANSWER → acceptAnswer →
        connectAndVerify
      * Guest：joinRoom(code) → resolve 于 NEGOTIATING → 收 OFFER → acceptOffer
        → createAnswer → **sendAnswer 自动外发** → connectAndVerify
      * 用户全程零感知 SDP / 连接码（SG-3 验收核心）
- [x] 复用判定（审计「禁止复制粘贴」的落地方式）：NetworkManager PING/PONG
      验证、OnlineSession 构造（Host=P1/Guest=P2）、VERIFIED → SessionManager
      交接、detach 所有权降级 —— 全部组合复用 Phase 12–14 原构件；验证语义
      沿用 Manual 流实战注释（connect 成功即清预算 / PONG 窗口 120s 手机后台
      税制 / VERIFIED 幂等）。超时设计：协商窗口 45s（自动流无人肉传码延迟）+
      PONG 窗口 120s
- [x] `OnlineSession.signaling?`（可选字段，Manual 流 undefined 不受影响）：
      SignalingClient 生命周期延伸到对局 —— 房间存活 + peerToken 即 SG-8 ICE
      restart 的重信令通道（玩家无需重输房间码）；`SessionManager.disposeSession`
      增收口 `signaling?.close()`（审计 KEEP → 小幅 additive MODIFY，理由：
      对局期信令所有权必须跨 Scene 存续，否则 SG-8 需要服务器房间复活机制）
- [x] 语义决策：PEER_LEFT 预 VERIFIED = 连接失败（协商期对端离开）；VERIFIED
      后归 Phase 16 断线链（信令层不越权）；ICE_CANDIDATE/ICE_END 入站预留
      debug 忽略（SG-4 接线点）；matchId = `online-room-${roomCode}` 双端确定
      性一致（真实对局 matchId 仍由 GAME_START 分配）
- [x] 实测修复（测试暴露）：① `fail()` 先以真实失败原因 settle 流程 promise
      再 destroyAttempt（否则被泛化 'attempt destroyed' 掩盖）；② deferred
      reject 后 handler 迟挂 = Node unhandled rejection（测试侧先挂 handler 再
      推进时间）

测试（新增 13，总 **542/542**；FakeWebSocket 自 SignalingClient.test 抽取为
`tests/network/signaling/fakeWebSocket.ts` 共享）：

- [x] Host/Guest 双全流（FakeWebSocket + FakeRTCPeerConnection 双 fake 驱动到
      VERIFIED + session 断言含 signaling 交接）
- [x] 失败矩阵：INVALID_ROOM_CODE（零帧发出）/ SIGNALING_FAILED / SERVER_ERROR
      （code ROOM_FULL 保留）/ PEER_LEFT（在飞 offer 静默中止）/ CONNECT_FAILED
      三路径（协商窗口超时 / transport 超时 / 通道中断 CHANNEL_CLOSED）/
      VERIFICATION_TIMEOUT
- [x] 生命周期：retry（旧信令彻底关闭 + 新尝试完整走通）/ back·dispose 幂等 /
      detach + SessionManager dispose 链（对局期 transport 存活、dispose 后
      signaling DISCONNECTED + 通道 closed）

验证（2026-09-30）：根 typecheck ✅ / 根 test **542/542** ✅（零 unhandled）/
根 build ✅ / server/signaling **25/25** ✅（协议未动回归确认）
（SG-3 未接 Scene —— E2E 留待 SG-5 UI 集成时全量回归）

## SG-4 Trickle ICE ✅（2026-09-30）

Manual 流（全量 gather SDP）与 Room 流（Trickle）并存：`createOffer/createAnswer`
行为不变（Manual fallback 零回归，30 个 transport+manual 测试全绿守住）；Room 流
切换到新 Trickle API —— **不因 candidate 未生成而阻塞 Offer/Answer**（规格核心）。

WebRTCTransport（378 → 479 行）新增：

- [x] `beginOffer()/beginAnswer()`：createOffer/createAnswer 改为其组合 +
      `waitForIceGatheringComplete`（Manual 语义不变，实现去重）；begin* 即返
      —— 本地 candidate 随后经事件流出
- [x] `onLocalIceCandidate(handler)`：browser contract 原样映射
      （`candidate === null` = 本端 gathering 完结 → 上层发 ICE_END）
- [x] `addIceCandidate(candidate)`：**remoteDescription 未 apply → 内部
      pending 队列，apply 后按序 flush**（candidate 先于 Offer/Answer 到达是
      Trickle 常态）；sdpMid+sdpMLineIndex+文本复合键去重（duplicate 零成本
      丢弃）；`pc.addIceCandidate` 失败（畸形候选）记录不崩、后续合法候选
      不受影响（Untrusted Input）；close 全清理扩展（listener 摘除 / 订阅
      清空 / 队列弃置）

RoomConnectionController 接线：

- [x] hostSendOffer/guestHandleOffer → `beginOffer/beginAnswer`（OFFER/ANSWER
      即时外发）
- [x] `onLocalIceCandidate` 订阅 → `sendIceCandidate`/`sendIceEnd` 逐帧外发
      （null → ICE_END）；fail/交接后余波防御（signaling null 短路）
- [x] 入站 `ICE_CANDIDATE` → `transport.addIceCandidate`（含 candidate 先于
      OFFER 到达的排队路径）；`ICE_END` = informational（ICE 不依赖显式 end）

测试（新增 7，总 **549/549**；两套 fake 同步扩展：addIceCandidate
'candidate:' 前缀校验=malformed 模拟 + addedCandidates 记录 + complete 补发
null candidate 事件）：

- [x] Transport 级（T4~T10）：begin* 不等 gathering（对照 createOffer 仍等待）/
      本地 candidate 映射 + null 完结 / candidate before remoteDescription 入队 /
      apply 后 flush 顺序保持 / 已 apply 直通 / duplicate 复合键去重（同文本
      不同 m-line 不算重复）/ malformed 不崩且后续合法可加 / close 清理
- [x] Controller 级：Host 全流补 trickle 断言（candidate 顺序外发 + ICE_END +
      对端畸形/合法候选落库）；Guest **candidate 先于 OFFER 同波到达** →
      队列 flush 端到端；PEER_LEFT 测试语义随 Trickle 更新（OFFER 已即时
      外发为正确行为，断言 fail 后 candidate 余波不再外发）

验证（2026-09-30）：根 typecheck ✅ / 根 test **549/549** ✅ / 根 build ✅ /
server/signaling **25/25** ✅（未动回归确认）

## SG-5 Room Connection UI + E2E ✅（2026-09-30）

正式 Online UI 切换为 Room 流（规格 Stage SG-5）：**ONLINE → CREATE GAME / JOIN
GAME → 房间码 + COPY → WAITING FOR OPPONENT → CONNECTING → CONNECTED → VERIFIED**；
用户全程不见 SDP / 连接码。Manual SDP 仅 Debug 构建 + `?manual-sdp` 查询参数可达
（E2E Debug fallback 回归入口；发布构建 DEBUG_GAME=false 时不可达）。

OnlineConnectionScene 双流接线：

- [x] 流程选择：`DEBUG_GAME && ?manual-sdp` → Manual（Phase 13 UI 原样，
      renderManualState）；默认 → Room 流（renderRoomState，SG-3/4 控制器）
- [x] Room UI 状态渲染：IDLE（CREATE/JOIN）→ JOIN GAME 展开 textarea 输入 +
      JOIN 按钮（控制器保持 IDLE，确认才 joinRoom）→ ROOM_WAITING（`ROOM CODE:
      XXXXXX` + COPY + WAITING FOR OPPONENT）→ CONNECTING_SIGNALING /
      CREATING_ROOM / JOINING_ROOM / NEGOTIATING / CONNECTING（CONNECTING…）→
      CONNECTED（verifying）→ VERIFIED（ENTER BATTLE，两流共用进局链）→ FAILED
      （分类文案 + TRY AGAIN/BACK）
- [x] 失败分类文案（SG-7 前置）：SIGNALING_FAILED / SERVER_ERROR（code 细分
      ROOM_NOT_FOUND·ROOM_FULL·ROOM_EXPIRED）/ INVALID_ROOM_CODE（**保留输入
      直接改码重试**）/ SETUP_FAILED / OFFER·ANSWER_FAILED / PEER_LEFT /
      CONNECT_FAILED / VERIFICATION_TIMEOUT → 简洁用户文案，技术细节只进 debug
- [x] Signaling 地址解析：`window.__RR_SIGNALING_URL__`（E2E 注入）>
      `VITE_SIGNALING_URL`（构建期部署配置）> `ws://127.0.0.1:8787`（本地开发）；
      新增 `src/vite-env.d.ts`（import.meta.env 类型）
- [x] 交接链共用：adoptSession（SessionManager 持有 + RTT 轮询）/ onEnterBattle
      / startOnlineBattle / leaveToMenu / onShutdown（detach vs dispose 流感知）；
      scene.start 复位清单补 room 字段（roomController / joinInputVisible /
      roomFailureMessage）；debug 句柄扩展（roomState / roomCode /
      roomFailureReason / flow + joinConfirm 按钮）

E2E（`scripts/e2e.mjs`）：

- [x] 既有 manual 段（P2P + Battle）补 `?manual-sdp` 导航（Debug fallback 回归）
- [x] **battle 驱动抽取**：runOnlineBattle 的 ENTER BATTLE → 回合循环 → Force
      Desync 恢复 → Rematch → Disconnect 主体提取为 `driveOnlineBattle(pageHost,
      pageGuest)`，配对方式与对战驱动解耦（Manual / Room 两段复用）
- [x] **online-room 新段**（31 项）：spawn 真实 Signaling Server（tsx，cwd 指
      server/signaling —— 根目录 npx 走 registry 下载实测超时坑）→ Signaling
      地址经 evaluateOnNewDocument 注入 `__RR_SIGNALING_URL__`（构建产物免重
      Build）→ 双页 CREATE/JOIN → 房间码 6 位 alphabet 校验 → 自动协商 VERIFIED
      → driveOnlineBattle 全链路（GAME_START / 回合 / Host 权威 / desync 恢复 /
      Rematch / Disconnect）；段注册 `RR_E2E_ONLY=online-room`
- [x] Signaling 就绪探测：TCP connect（Node 22.11 **无全局 WebSocket 构造器**，
      `WebSocket is not defined` 实测 —— 弃 WS 探测改 `node:net`）

**实测回归修复（SG-4 遗留 capture-time bug，全量 E2E 实锤）**：

- 现象：Manual 段 Host VERIFIED 超时（offer/response 均正常）——单段复现非 flake
- 诊断（临时脚本 + SDP 解码）：连接码内 SDP **零 `a=candidate:` 行** ——
  SG-4 把 `createOffer/createAnswer` 改为返回 `beginOffer()` 的序列化快照，
  该快照在 ICE gathering 等待**之前**定格；旧实现是等待后重读
  `pc.localDescription`（candidate 在 gather 过程中追加进 SDP）
- 修复：等待后经 `encodeCurrentLocalDescription()` 重读重编码；**FakeRTC 的
  SDP 恒定 → 单测盲区**（316 网络单测全绿仍回归），只有真实 Chrome 暴露 ——
  Room 流不受影响（trickle candidate 走独立信令帧）

验证（2026-09-30）：根 typecheck ✅ / 根 test **549/549** ✅ / 根 build ✅ /
server/signaling **25/25** ✅ / **全量 E2E 178 passed / 0 failed**（147 存量 +
31 room 新增；六段：desktop / mobile / sp / online-manual / battle /
online-room 全绿）

## SG-6 TURN Configuration + 诊断 ✅（2026-09-30）

规格 Stage SG-6 + Connection Diagnostics：Signaling 下发 `[STUN, TURN(临时凭据)]`；
secret 永不入库；iceTransportPolicy 缺省 all；DEBUG_FORCE_RELAY 验证选项；
DIRECT/RELAY 判定诊断。

Signaling Server（coturn REST API 契约，`server/signaling/src/`）：

- [x] `turnCredentials.ts` —— `username = <expiry unix 秒>`、`credential =
      base64(HMAC-SHA1(sharedSecret, username))`（now 注入可测）
- [x] `serverConfig.ts` 扩展：`SIGNALING_STUN_URLS`（逗号列表，默认 Google
      STUN）/ `SIGNALING_TURN_URLS`（turn:/turns:，udp/tcp/tls）/ 
      `SIGNALING_TURN_SHARED_AUTH_SECRET`（= coturn static-auth-secret，仅环境
      变量）/ `SIGNALING_TURN_CREDENTIAL_TTL_MS`（默认 30min，规格 30~60min）；
      **urls 与 secret 必须成对（fail-fast）**；移除 SG-2 的静态
      SIGNALING_ICE_SERVERS（双配置路径收敛）
- [x] `createIceServersProvider(config)` —— **每 ROOM ack 现生成凭据**（各
      peer 独立时间受限凭据）；SignalingRoomServer 改用 provider；README env
      表 + turnserver.conf 部署示例 + 验证步骤

客户端：

- [x] `WebRTCConfig.iceTransportPolicy?`（缺省 all；production 禁默认 relay ——
      能直连直连、TURN 兜底交给浏览器 ICE 自动选择）
- [x] `DebugConfig.DEBUG_FORCE_RELAY`（默认 false）→ Room 流 createTransport
      覆盖 'relay'（验证 TURN 用；E2E/production 不开）
- [x] `WebRTCTransport.getDiagnostics()`（Connection Diagnostics 规格）：
      ICE gathering/connection/signaling state 四层 + 本地 candidate 类型
      （handleIceCandidate 解析 typ host/srflx/relay）+ `icecandidateerror`
      计数/最近错误 + getStats 解析 selected candidate pair（local/remote
      类型/协议/地址/relayProtocol）→ **route = DIRECT / RELAY 直观判定**；
      close 清理扩展
- [x] `RoomConnectionController.getDiagnostics()` 委托（VERIFIED 交接后 null）；
      Scene debug 句柄 `awaitRtcDiagnostics()`（连接期走 controller / 交接后
      走 sessionManager 的 transport instanceof）

测试（server +6 = **31/31**；client +6 = **555/555**）：

- [x] Server：凭据向量（独立 HMAC oracle + TTL 数学 + 形态）/ config 矩阵
      （默认无 TURN、urls-secret 互斥 throw、scheme 校验、逗号解析）/
      provider（无 TURN 仅 STUN；有 TURN → username=unix 秒 + credential
      base64 + 每次现生成）
- [x] Client：policy 透传（factory 捕获断言）/ candidate 类型收集 +
      error 计数 / selected pair 注入解析（relay 对 → RELAY+tls、host↔host →
      DIRECT、无 stats → null）/ close 清理 / controller 委托与失败清场 null

E2E（online-room 段 +2 = **180/180**）：真实浏览器 getStats → selected pair
可读 + **本地 P2P 路由判定 = DIRECT**（无 TURN 部署时的基线断言；真实 TURN
relay 验证待 coturn 部署后按 README 步骤执行——Force Relay + route=RELAY）。

验证（2026-09-30）：根 typecheck ✅ / 根 test **555/555** ✅ / 根 build ✅ /
server/signaling **31/31** ✅ / **全量 E2E 180 passed / 0 failed**（六段全绿）

## SG-7 Connection Failure UX ✅（2026-09-30）

规格 Stage SG-7：失败不再只有 "Connection failed" —— 内部至少区分；正式文案
简洁；Debug Mode 输出具体 reason。

失败分类拆分（`RoomConnectionFailureReason`）：

- [x] `CONNECT_FAILED` 拆为 **`ICE_FAILED`**（ICE 协商失败 —— transport 丢失
      原因含 ICE/CONNECTION 系：NAT/防火墙阻断）+ **`DATA_CHANNEL_FAILED`**
      （协商 deadline 超时 / connect 超时无丢失 / 通道层中断 CHANNEL_*）+
      新增 **`TURN_UNAVAILABLE`**（ICE 失败且 icecandidateerror 命中 turn:
      URL —— 中继不可达，严格网络下最可操作的诊断）
- [x] `WebRTCTransport` 增同步信号：`lastLossReason`（handleConnectionLost
      记录；超时 = null）+ `hasTurnCandidateErrors`（SG-6 诊断字段复用）
- [x] 控制器分类：connect catch 读 transport.lastLossReason；onDisconnect 按
      reason 串分类（TURN 错误优先归 TURN_UNAVAILABLE）；deadline →
      DATA_CHANNEL_FAILED。SERVER_ERROR 保留 code 细分（ROOM_NOT_FOUND /
      ROOM_FULL / ROOM_EXPIRED —— 满足规格内部区分，避免 enum 爆炸）

Scene（正式文案简洁 + Debug 具体输出）：

- [x] 新 reason 文案：ICE_FAILED → "your network may block WebRTC" /
      TURN_UNAVAILABLE → "Relay server unavailable" / DATA_CHANNEL_FAILED →
      "Connection failed"
- [x] **DEBUG_GAME 时 FAILED 状态行追加技术后缀** ` [REASON:CODE]`（发布
      构建保持简洁 —— 规格「正式用户信息保持简洁；Debug Mode 输出具体
      reason」）
- [x] Debug 句柄：`roomFailure`（完整 {reason, code, detail}）+ `statusText`
      （状态行文本 —— E2E 断言用户可见文案）

测试（client +2 = **557/557**；原 CONNECT_FAILED 断言按新语义更新 3 处）：

- [x] ICE_FAILED：connect 期间 pc failed → lastLossReason 分类
- [x] TURN_UNAVAILABLE：turn: URL 采集错误 + ICE 失败 → 中继不可达优先

E2E（online-room 段 +2 = **182/182**）—— 失败 UX 全链路（真实服务器）：

- [x] 不存在码 ZZZZZ9 → FAILED(SERVER_ERROR/ROOM_NOT_FOUND) + 文案
      "not found" + Debug 后缀 `[SERVER_ERROR:ROOM_NOT_FOUND]`
- [x] TRY AGAIN → IDLE → 非法码 ABC1EF → FAILED(INVALID_ROOM_CODE) +
      **输入保留**（textarea 带码可直改）
- [x] 输入保留路径直接改真码再按 JOIN（onJoinConfirm 内 retry）→ 正常
      配对 VERIFIED → 后续 battle/rematch/disconnect 全链不受影响

验证（2026-09-30）：根 typecheck ✅ / 根 test **557/557** ✅ / 根 build ✅ /
server/signaling **31/31** ✅ / **全量 E2E 182 passed / 0 failed**

## SG-8 ICE Restart ✅（2026-09-30）

规格 Stage SG-8：`connectionState failed` / persistent disconnect → 限次
restartIce（当前协商方 `createOffer({iceRestart:true})` 经活信令通道交换）；
复用 peerToken 重连信令；恢复后走既有 STATE_SYNC_REQUEST/STATE_SNAPSHOT
—— 不建第二套 recovery；手机后台 grace period；限次耗尽 → Connection Lost。

实现（连接层恢复 = RoomRecoveryController；状态对账 = Phase 15 既有链）：

- [x] `WebRTCTransport` 恢复面：`restartOffer()`（iceRestart offer 即返，Trickle
      candidate 经 onLocalIceCandidate 流出）；`recoverConnect(timeoutMs)`
      （FAILED/DISCONNECTED 专用武装入口 —— 不改 connect() 的「重连需新建」
      契约）；**恢复完成判定 = connectionState 'connected' + channel open**
      （SCTP 跨 restart 存续、open 事件不重发）+ **防假成功门**（ICE 失败期
      通道 readyState 常仍 'open'，未 connected 不得 resolve —— 单测先行
      实测发现）；`recheckConnection()`（后台 missed 事件补查）；
      `debugSimulateConnectionLost()`（E2E 注入口，debugForceDesync 先例）；
      **`close()` 延后 `pc.close()`（pcCloseDelayMs 默认 300ms）**—— 立即关
      pc 会在 SCTP 流重置送达对端前杀死 DTLS：对端收不到 channel close、
      只见 pc failed → Room 流误入 60s 恢复窗（故意离开方对端应即时感知；
      全量 E2E 实测 2 次复现后单段分诊实锤，非负载 flake）
- [x] `OnlineSession.recovery?`（roomCode + peerToken，Room 流专属；Manual
      debug / 离线 undefined → BattleScene 不装恢复，即时断线旧 UX 不变）；
      `handleVerified` 交接时**逐个撤控制器自有订阅**（signaling 帧/失败 +
      trickle 外发 + 验证 PONG/断线）—— 修复 VERIFIED 后残留订阅对 restart
      帧输出误导 warn、恢复控制器无法独占信令帧的问题
- [x] `RoomRecoveryController`（468 行，连接层零 NetworkEnvelope）：
      * 限次主循环（默认 3 次 × 20s 窗 ≈ 60s 总预算）：ensureSignalingReady
        （活信令复用；死则新 client → joinRoom(roomCode, peerToken) token
        原位重入 + ROOM_JOINED ack 等待）→ recoverConnect 先行武装 →
        **Host restartOffer 外发（Host = 唯一发起端，角色由动作固化 —— 与
        初始协商 offerer 一致，双端同发互踩）**；Guest 被动应答 → PONG
        验证（10s 窗）
      * `shouldAttempt()` 分类：CONNECTION_FAILED / ICE_FAILED / CHANNEL_ERROR
        （网络断族）→ 可恢复；CHANNEL_CLOSED / PEER_CLOSED / ICE_CLOSED
        （对端主动离场）→ 立即终局旧 UX
      * 手机后台 grace：瞬态 disconnected 不误杀（Phase 12 既有）+ 60s 限次
        窗口 + visibilitychange visible → recheckConnection 补查 missed 事件
      * PEER_JOINED 恢复期立即重发 offer（对端信令重入 —— 原 offer 曾被
        relay 静默丢弃）；信令断（DataChannel 活）不自动恢复 —— 裁决归上层
      * dispose 打断在途等待（waitOrDisposed）—— Scene shutdown 不留悬挂
        尝试 / timer；owned 信令实例关闭、session 信令归 SessionManager
- [x] Phase 15 复用挂钩（规格红线「不建第二套 recovery」的落地）：
      * `StateSyncReason + 'CONNECTION_RECOVERED'`（wire 枚举前向兼容扩展，
        payload 守卫 Record 穷举同步）
      * Guest `requestPostReconnectSync()`：恢复已在途 → 重发
        STATE_SYNC_REQUEST（原 episode reason 复用）；空闲 →
        beginRecovery('CONNECTION_RECOVERED') —— 锁输入/清在飞模拟/
        SYNCHRONIZING 横幅全部复用既有恢复链
      * Host `setAckLadderSuspended()`：恢复挂起期 ACK 超时阶梯只 re-arm
        不进阶（断线窗口不因 ACK 超时误杀对局；恢复后阶梯自然继续：
        stage1 重发 TURN_RESULT → Guest 对账 ACK）；阶梯 stage1/2 sendOut
        包 TransportError 容错（**修复既有隐患**：断线期 resend 未捕获）
      * Coordinator 暴露 `requestPostReconnectSync` / `setConnectionRecoveryActive`
        两 API（Host no-op —— 权威端状态即事实）
- [x] BattleScene 接线：`session.recovery` + transport instanceof WebRTCTransport
      → 装配恢复控制器；`handleOnlineDisconnected` 改路由（可恢复 →
      RECONNECTING… 横幅 + 冻结 + `setConnectionRecoveryActive(true)` →
      await attemptRecovery → 成功解冻 + requestPostReconnectSync；失败/
      不可恢复 → `showOpponentLostUi()` 原 UX 主体提取共用）；SHUTDOWN
      dispose；debug 句柄 recoveryState / recoveryAttemptCount /
      forceConnectionLost；scene.start 复位清单补 roomRecovery
- [x] `signalingUrl.ts` 提取共享（E2E 注入 > VITE_SIGNALING_URL > 本地 8787
      —— 配对与恢复重信令同口径）

测试（+18 = **575/575**；双 fake 全矩阵）：

- [x] RoomRecoveryController（9）：Host/Guest 恢复全流（iceRestart 断言 /
      OFFER/ANSWER 帧 / trickle / PONG / 状态序列）、限次重试耗尽 FAILED、
      重信令 token 重入 + candidate 走新信令、重信令 ROOM_NOT_FOUND 失败
      矩阵、shouldAttempt 分类、PEER_JOINED 重发、visibility 补查、dispose
      在途收口 + owned/session 信令所有权
- [x] WebRTCTransport（+6，R1~R6）：restartOffer 选项/即返/CLOSED 拒绝、
      recoverConnect 三态 + 防假成功门、初连无回归、recheckConnection、
      debug 注入口、**close() 延后 pc.close()（SCTP 刷出窗口：channel 即关
      pc 存活至窗口后）**；FakeRTC 双处（本地 + 共享）补 createOfferOptions
      与 restoreConnection；测试工厂统一注入 pcCloseDelayMs: 0
- [x] Phase15Sync（+3，⑭~⑯）：空闲态对账全链（CONNECTION_RECOVERED →
      快照 → parity + recoveryCount）、在途重发（原 reason 复用；第二张
      快照幂等消费 = 无害双应用）、Host ACK 阶梯挂起不进阶 / 恢复后继续

E2E（online-room 段 +2 = **37**；`driveOnlineBattle` 增 `onMidBattle` 钩子
插 Turn 2 前 —— Room 段专用，Manual 段不传零影响）：

- [x] Host `forceConnectionLost` → **真实 createOffer({iceRestart:true}) 经
      真实 Signaling Server 全协商**（debug 注入只模拟失败事件路径，pc 存活
      —— 协商为真）→ RECOVERED + 对局未终局；恢复后**同一局继续**打完
      desync / rematch / disconnect（恢复不侵入后续机制的强集成断言）
- [x] Guest `forceConnectionLost` → RECOVERED → CONNECTION_RECOVERED →
      真实 STATE_SYNC_REQUEST → Host 权威快照 → 双端 turnId/HP parity

验证（2026-09-30）：根 typecheck ✅ / 根 test **575/575** ✅ / 根 build ✅ /
server/signaling **31/31** ✅ / **全量 E2E 184 passed / 0 failed**（六段全绿；
期间实测修复 2 项：close() 与页面销毁竞态的 E2E 顺序固化 + close() 延后
pc.close() 根因修复——SCTP close 送达后 CHANNEL_CLOSED 即时路径恢复）

语义决策：

- **Host = 唯一 restart 发起端**（与初始协商 offerer 一致；协议无角色声明 ——
  角色由动作固化的延续）
- **恢复成功 ≠ 状态一致**：对账一律走 Phase 15 既有链 ——
  CONNECTION_RECOVERED 只是新 reason，同一条 STATE_SYNC_REQUEST →
  STATE_SNAPSHOT → ACK 管道（零第二套 recovery）
- 在途恢复重发 → Host 回两张快照 → handleStateSnapshot 幂等消费（无害双
  应用，快照即权威）
- 信令断而 DataChannel 活 → 不自动恢复（WS_CLOSED 裁决归上层；恢复只在
  transport failed 系触发）
- Host 重信令超 grace（房间已删）→ ROOM_NOT_FOUND 快速失败 = Host 房间
  锚点语义的自然延续
- Offline / Manual debug 流零变化（recovery undefined → 不装配）

已知观测项（test-reviewer 验收 Low 级，不阻塞 —— FUTURE 改进）：

- 恢复尝试轮间不复核丢失原因：恢复期对端**优雅**离场（CHANNEL_CLOSED
  落在 CONNECTING → failConnect 刷新 lastLossReason）仍会烧满剩余尝试
  （最多多 ~40s）才 FAILED —— 轮间查 lastLossReason 命中离场族可快速终局
- Guest 的 restart OFFER 可能先于其 recoverConnect 武装到达（transport
  仍 FAILED → acceptOffer 拒绝）→ 靠 Host 下一轮重发兜底，最坏浪费一个
  20s 窗
- dispose 后 verifyLiveness 内层 timer 有界空触发（≤10s），无功能影响；
  waitForRoomAck 的 timer 已在本轮 P2 修复中随 dispose 清理

## 联机审查修复 ✅（2026-09-30）

- [x] P1 F1/F2：恢复快照补驱回合/相机，持续锁定移动、瞄准及发射，旧场景回调失效。
- [x] P2 F3：加入方移动改有符号增量，Host 限速并验证预算/边界；移动后立即发射从权威炮塔校正。27 帧实际计时下双方在 0/100/200ms RTT 均移动 125.333333px。
- [x] P2 F4/F7/F8：信令心跳释放半开连接，有效 token 接管旧槽且迟到关闭不伤新槽，TTL/grace 生效，房间删除统一通知与解绑。
- [x] P2 F5/F6：重建信令由 Session 跨结算/重赛持有，失败连接关闭，旧恢复器异步应答与迟到拒绝收口。
- [x] 最终客户端测试 611/611、服务端 41/41、类型检查与构建、完整浏览器 E2E 188/188；独立复核无剩余阻塞。浏览器新增 WS 重建→Result 超过测试 grace→Rematch→再次重建与对账。

详细根因、测试范围和部署限制见 [联机审查记录](docs/review/review-2026-09-30-dev_signaling_turn-network.md)。手机尺寸测试为 Chrome 模拟；真实 Safari、跨网切换与 TURN relay 仍按下列部署待办执行。

## 待办（公网信令已部署验证；剩余 = TURN 与真机验收）

- [x] 公网 WSS 信令部署与验证（2026-09-30 / 10-01）：Render 单实例
  `wss://ricochet-rivals.onrender.com`；9 项公网协议检查、34 项真实
  WebRTC 双端对战检查、已发布 Pages 的 5 项手机尺寸配对 / 进入对战
  检查通过（env 与服务细节见 `server/signaling/README.md`，发布回归
  记录见 `README.md`）
- [ ] **coturn TURN 落地**（当前公网服务仅下发 STUN，**TURN 尚未启用**；
  env 契约见 `server/signaling/README.md`）→ `DEBUG_FORCE_RELAY`
  真机验证 TURN relay
- [ ] **真机验收矩阵（尚未执行）**：两部真机 Wi-Fi↔5G / VPN / 后台切换 ×
  ICE restart 实网行为；浏览器手机模拟不替代真机结论
- [ ] 迁移验收清单（规格 Tests）：真机配对矩阵通过后 Room Code 流转正为
  官方 Online 模式
- [ ] Manual SDP 流删除（迁移稳定后的独立 Cleanup —— 本阶段不删；
  现仍为 DEBUG_GAME 门控 Debug fallback）

---

# Juice 补充轮：界面按钮 + 章鱼激光音效（2026-10-01）✅

用户需求：界面按钮加机械风格点击音；章鱼激光补音效（粒子聚集 + 激光扫射）。

- [x] **3 个新音效素材**（generate_sound_effect，sonilo；`public/assets/sfx/`）：
  - `click.mp3`（机械金属按钮：按下-释放-锁扣动作序列，多模态频谱复核
    判机械开关声；本地裁掉 0.127s 前导静音 → 按下即响）
  - `laser-charge.mp3`（电弧噼啪聚集声；裁到 **0.70s** = 蓄力 500ms +
    hold 200ms 窗口，扫射进入即让位，戛然而止即「释放出射」）
  - `laser-sweep.mp3`（下行光束 + 电滋声；去 0.06s 前导静音，0.93s
    覆盖 800ms 扫射段 + 命中余韵；与既有 `hit.mp3` 命中反馈衔接）
  - 校验：md5 三文件全不同（fileSize 元数据不可信，沿用实测口径）；
    ffmpeg silencedetect 客观包络 + 频谱图多模态复核
- [x] **SfxBus 扩容**：`SFX.click / laserCharge / laserSweep` 三键入
  SFX_FILES（BootScene 预加载零改动）+ 音量基线 0.4 / 0.5 / 0.55；
  组件自持实例改述（无状态，场景/UI/系统组件各持一例等价）
- [x] **界面按钮机械点击**：`MenuButton`（菜单/联机/结算/断线按钮全量
  19 处）+ `AimButton`（瞄准/取消）zone `onDown` 先播 click 再动作；
  不可见/失活 zone 本就不触发，SOUND 开关门禁沿用 SfxBus（按下时口径）
- [x] **章鱼激光双段音效**：`OctopusTentacle.playLaser` 相位切换处
  一次性触发——charging 进入播 charge、sweeping 进入播 sweep（标志位
  守卫 tween 逐帧推进不重复）；focusing 段保持安静；每段攻击重置；
  本地动画驱动 = 联机双端各播一次（与发射/爆炸同口径，权威结果路径
  不触发）
- [x] **测试**：OctopusTentacle 测试 fixture 补 `cache.audio.exists` /
  `sound.play` 桩；激光相位用例断言音效键序列
  `[laserCharge, laserSweep]`、focusing 段零播放、整段攻击各只一次、
  结束后 refresh 不再触发
- 验证：typecheck ✅ / test **767/767** ✅ / build ✅
- 已知取舍：charge 为恒定电弧质感（无音高爬升），粒子聚集语义可用；
  click 为 0.55s 机械动作序列（非单发短 click）——两者手感随试玩反馈
  迭代；TouchControls 移动钮（按住型玩法控件）未加点击音，待用户反馈

---

# 合并 main 前修复与文档校正轮（2026-10-01）✅

dev_signaling_turn（11 提交）快进合并 main 前的验证、修复与文档对齐。

- [x] **E2E 一帧竞态修复**：`联机双方结算后清除小地图炮弹标记` 在逻辑态
  waitFor 通过后**即时读** POST_RENDER 驱动的小地图快照，偶发早一帧
  （全量 214/1 唯一失败项；Phase 9 已知模式）——改为清除态独立
  waitFor（双端各 5s 预算），HP 一致性断言保持原读法
- [x] **Host 直推快照绕过在飞清理（联机卡死级 bug）**：battle 段单跑
  实锤 `2:impact@4482 → requestAim→cam=IMPACT` —— Host ACK 超时
  阶梯 #2 直推 STATE_SNAPSHOT（"推送即恢复"），Guest 侧只走
  APPLYING_SNAPSHOT、不经 DESYNC/SYNC_REQUESTED → 挂在这两态的
  clearInFlightSimulations 永不执行 → 后台冻结页的回合内模拟存活，
  回前台迟发 impact 把相机打回 IMPACT、卡死下一回合瞄准。修复 =
  `BattleScene.handleOnlineSyncStateChange` 的 APPLYING_SNAPSHOT
  分支同样清场 + presentationEpoch+=1（与 DESYNC 分支幂等重复；
  横幅仍按 APPLYING 静默设计）。诊断特征：相机环形日志出现
  sync=APPLYING_SNAPSHOT 但**无** DESYNC/SYNC_REQUESTED 前置条目
- [x] **文档校正（合并后口径）**：
  - `docs/GAMEPLAY.md` §1/§3：移动距离预算 250px → 已取消（阵地内
    自由往返；保留发射后锁定与速度/边界规则）
  - `CODELY.md` §1/§7/§11：同上 + 炮弹初速 MAX_LAUNCH_SPEED
    1400 → 2400（规则区经脚本精确字面替换，Structured Memories 区
    零触碰）
  - `TASKS.md` 头部状态行与 SG 章节状态：测试基线 575/31/184、
    652/190 → 2026-10-01 复验 788 / 43 / 215；部署状态 → 公网 WSS
    已部署验证，剩余 TURN 与真机验收（「待办」段同步重构）
  - `docs/横版…PRD.md` 与 `docs/review/` 保持历史原文（需求基线与
    评审记录，不回写历史）
- 验证：typecheck ✅ / test **788/788** ✅ / build ✅ / 全量 E2E
  **215/215** ✅（battle 段修复后单跑 31/31，全量收口确认）

---

# 转场节奏修复轮：章鱼攻击后近距快转（2026-10-01）✅

用户反馈：章鱼攻击完后停顿约 1 秒才进入下一回合。

- [x] **根因**（静态链路追踪实锤）：激光终结于被打基地束点 → 相机已停在
  下一位玩家附近（激光目标 50% 为下一位玩家；普通回合爆炸也多落在下一位
  玩家附近）→ `transitionToPlayer` 仍跑全长 **600ms** 转场 tween = 位移≈0
  的纯空转（画面静止），叠加回合横幅淡入 ≈ 感知 1 秒停顿
- [x] **修复（近距快转）**：`GameConfig.camera` 新增
  `turnTransitionNearPx: 500` / `turnTransitionNearMs: 150`；
  `CameraController.transitionToPlayer` 按位移选时长 —— 相机已在新
  玩家附近 → **150ms 快转**（回合即刻开始，章鱼攻击后停顿从 ~600ms+
  横幅 ≈ 1s 收敛到 150ms+横幅）；跨图/远距保持 600ms 全长平移（观感
  不变）；普通回合同类空转（爆炸驻留即下一位玩家阵地）一并受益
- [x] **测试**：CameraControllerResolution 新增 2 用例（激光收尾停在
  打侧基地 clamp 位置 → 快转 + 完成即 FREE_VIEW；500/501 阈值边界 +
  跨图全长）；E2E 转场断言全部 waitFor 化、无时长假设，零改动
- 验证：typecheck ✅ / test **790/790** ✅ / build ✅ / 全量 E2E
  **215/215** ✅

---

# V0.1 RELEASE GATE

以下全部通过才能称为 V0.1：

- [ ] Single Player 完整可玩
- [ ] Local 2P 完整可玩
- [ ] WebRTC P2P 完整可玩
- [ ] Camera Free View
- [ ] Return Home
- [ ] Angry Birds Aim
- [ ] Projectile Follow
- [ ] Explosion
- [ ] HP
- [ ] Turn System
- [ ] Game Over
- [ ] Rematch
- [ ] npm run typecheck PASS
- [ ] npm run test PASS
- [ ] npm run build PASS

---

# FUTURE — V0.2

当前不要开发：

- Air Items
- Heal Item
- Damage Boost
- Split Projectile
- Shield
- Wind
- Multiple Weapons
- Obstacles
- Random Map Elements

---

# FUTURE — V0.3

- Wind Zones
- Bounce Walls
- Portals
- Moving Platforms
- Gravity Zones
- Advanced Weapons
- Different Characters

---

# Core TypeScript Contracts

建议以下接口作为架构契约。

具体实现允许调整，但不能破坏整体分层。

## IDs

```ts
export type PlayerId = "P1" | "P2";

export type TurnId = number;

export type MatchId = string;
```

---

## PlayerState

```ts
export interface PlayerState {
  id: PlayerId;

  side: "left" | "right";

  x: number;
  y: number;

  hp: number;
  maxHp: number;

  moveRemaining: number;

  hasFired: boolean;

  isAlive: boolean;

  weaponId: WeaponId;
}
```

禁止保存：

Sprite

Matter Body

Camera

Scene。

---

## WeaponId

```ts
export type WeaponId =
  | "normal";
```

未来：

```ts
"split"
"heavy"
"bounce"
```

---

## GameState

```ts
export interface GameState {
  matchId: MatchId;

  seed: number;

  turnId: TurnId;

  currentPlayerId: PlayerId;

  phase: TurnPhase;

  players: Record<PlayerId, PlayerState>;

  items: WorldItemState[];

  gameOver: boolean;

  winnerId: PlayerId | null;
}
```

---

## TurnPhase

```ts
export enum TurnPhase {
  START = "START",

  ACTION = "ACTION",

  RETURN_HOME = "RETURN_HOME",

  AIM = "AIM",

  PROJECTILE = "PROJECTILE",

  RESOLVE = "RESOLVE",

  END = "END",

  GAME_OVER = "GAME_OVER",
}
```

---

## CameraMode

```ts
export enum CameraMode {
  FREE_VIEW = "FREE_VIEW",

  RETURN_HOME = "RETURN_HOME",

  AIMING = "AIMING",

  PROJECTILE_FOLLOW = "PROJECTILE_FOLLOW",

  IMPACT = "IMPACT",

  TURN_TRANSITION = "TURN_TRANSITION",
}
```

---

# Commands

所有行为使用 discriminated union。

```ts
export interface MoveCommand {
  type: "MOVE";

  playerId: PlayerId;

  turnId: TurnId;

  targetX: number;
}
```

```ts
export interface FireCommand {
  type: "FIRE";

  playerId: PlayerId;

  turnId: TurnId;

  weaponId: WeaponId;

  startX: number;
  startY: number;

  velocityX: number;
  velocityY: number;

  seed: number;
}
```

```ts
export interface ReadyCommand {
  type: "READY";

  playerId: PlayerId;
}
```

```ts
export type GameCommand =
  | MoveCommand
  | FireCommand
  | ReadyCommand;
```

未来所有系统：

Human

AI

Network

都产生：

GameCommand。

---

# InputSource

```ts
export interface InputSource {

  readonly playerId: PlayerId;

  setEnabled(enabled: boolean): void;

  update(deltaMs: number): void;

  destroy(): void;
}
```

可能实现：

```ts
HumanInputSource

AIInputSource

NetworkInputSource
```

---

# CommandBus

```ts
export interface CommandBus {

  dispatch(command: GameCommand): void;

  subscribe(
    handler: (command: GameCommand) => void
  ): () => void;
}
```

---

# MovementSystem

```ts
export interface MovementResult {

  accepted: boolean;

  previousX: number;

  nextX: number;

  distanceConsumed: number;

  remainingMovement: number;

  reason?: string;
}
```

```ts
export interface MovementSystem {

  execute(
    state: GameState,
    command: MoveCommand
  ): MovementResult;
}
```

---

# AimState

```ts
export interface AimState {

  active: boolean;

  originX: number;
  originY: number;

  pointerX: number;
  pointerY: number;

  directionX: number;
  directionY: number;

  power: number;

  velocityX: number;
  velocityY: number;
}
```

---

# TrajectoryPoint

```ts
export interface TrajectoryPoint {
  x: number;
  y: number;
  time: number;
}
```

---

# TrajectoryCalculator

尽量保持纯逻辑。

```ts
export interface TrajectoryInput {

  startX: number;
  startY: number;

  velocityX: number;
  velocityY: number;

  gravityX: number;
  gravityY: number;

  duration: number;

  steps: number;
}
```

```ts
export interface TrajectoryCalculator {

  calculate(
    input: TrajectoryInput
  ): TrajectoryPoint[];
}
```

---

# ProjectileState

```ts
export type ProjectileStatus =
  | "spawn"
  | "flying"
  | "impact"
  | "exploding"
  | "destroyed";
```

```ts
export interface ProjectileState {

  id: string;

  ownerId: PlayerId;

  weaponId: WeaponId;

  x: number;
  y: number;

  velocityX: number;
  velocityY: number;

  status: ProjectileStatus;

  ageMs: number;
}
```

---

# ExplosionEvent

```ts
export interface ExplosionEvent {

  sourcePlayerId: PlayerId;

  weaponId: WeaponId;

  x: number;
  y: number;

  radius: number;

  turnId: TurnId;
}
```

---

# DamageResult

```ts
export interface PlayerDamageResult {

  playerId: PlayerId;

  distance: number;

  damage: number;

  hpBefore: number;

  hpAfter: number;
}
```

```ts
export interface DamageResult {

  explosion: ExplosionEvent;

  players: PlayerDamageResult[];
}
```

---

# DamageSystem

```ts
export interface DamageSystem {

  calculate(
    gameState: GameState,
    explosion: ExplosionEvent
  ): DamageResult;

  apply(
    gameState: GameState,
    result: DamageResult
  ): void;
}
```

建议：

calculate 尽量是 pure。

---

# TurnManager

```ts
export interface TurnManager {

  readonly currentPlayerId: PlayerId;

  readonly phase: TurnPhase;

  readonly turnId: TurnId;

  startMatch(): void;

  beginTurn(
    playerId: PlayerId
  ): void;

  requestAim(): void;

  cancelAim(): void;

  notifyProjectileLaunched(): void;

  notifyProjectileResolved(
    result: DamageResult
  ): void;

  endTurn(): void;
}
```

TurnManager：

不能直接处理 Phaser input。

---

# CameraController

```ts
export interface CameraTarget {

  x: number;
  y: number;
}
```

```ts
export interface CameraController {

  readonly mode: CameraMode;

  setMode(
    mode: CameraMode
  ): void;

  enableFreeView(): void;

  returnToPlayer(
    playerId: PlayerId
  ): Promise<void>;

  followProjectile(
    projectileId: string
  ): void;

  focusImpact(
    target: CameraTarget
  ): Promise<void>;

  transitionToPlayer(
    playerId: PlayerId
  ): Promise<void>;

  stopFollowing(): void;
}
```

---

# SeededRandom

```ts
export interface RandomSource {

  next(): number;

  range(
    min: number,
    max: number
  ): number;

  integer(
    min: number,
    max: number
  ): number;
}
```

```ts
export class SeededRandom
  implements RandomSource {

  constructor(seed: number);

  next(): number;

  range(
    min: number,
    max: number
  ): number;

  integer(
    min: number,
    max: number
  ): number;
}
```

---

# Networking

Game Logic 禁止依赖：

RTCPeerConnection。

必须依赖抽象 Transport。

```ts
export type PeerRole =
  | "host"
  | "guest";
```

```ts
export enum NetworkMessageType {

  PLAYER_READY = "PLAYER_READY",

  GAME_START = "GAME_START",

  MOVE_REQUEST = "MOVE_REQUEST",

  MOVE = "MOVE",

  FIRE_REQUEST = "FIRE_REQUEST",

  FIRE = "FIRE",

  TURN_RESULT = "TURN_RESULT",

  TURN_END = "TURN_END",

  STATE_SYNC_REQUEST = "STATE_SYNC_REQUEST",

  STATE_SNAPSHOT = "STATE_SNAPSHOT",

  REMATCH = "REMATCH",

  DISCONNECT = "DISCONNECT",
}
```

---

# NetworkEnvelope

```ts
export interface NetworkEnvelope<T = unknown> {

  version: 1;

  type: NetworkMessageType;

  matchId: MatchId;

  turnId: TurnId;

  senderId: PlayerId;

  sequence: number;

  timestamp: number;

  payload: T;
}
```

---

# NetworkTransport

```ts
export interface NetworkTransport {

  readonly connected: boolean;

  connect(): Promise<void>;

  send(
    message: NetworkEnvelope
  ): void;

  onMessage(
    handler: (
      message: NetworkEnvelope
    ) => void
  ): () => void;

  onDisconnect(
    handler: () => void
  ): () => void;

  close(): void;
}
```

实现：

```ts
WebRTCTransport
```

测试时：

```ts
MockTransport
```

可以增加：

```ts
LocalLoopbackTransport
```

---

# TurnResultPayload

```ts
export interface TurnResultPayload {

  turnId: TurnId;

  authoritativeState: {

    players: Record<
      PlayerId,
      Pick<
        PlayerState,
        "x" | "y" | "hp" | "isAlive"
      >
    >;

    currentPlayerId: PlayerId;

    nextTurnId: TurnId;
  };

  stateHash: string;
}
```

---

# WorldItemState

V0.1 只定义。

不实现 Gameplay。

```ts
export type WorldItemType =
  | "heal"
  | "damage_boost"
  | "split"
  | "shield";
```

```ts
export interface WorldItemState {

  id: string;

  type: WorldItemType;

  x: number;
  y: number;

  active: boolean;
}
```

---

# GameConfig

所有 Gameplay 参数集中。

建议：

```ts
export const GAME_CONFIG = {

  world: {
    width: 5000,
    height: 1080,
  },

  player: {
    maxHp: 10,

    maxMovePerTurn: 250,

    leftBounds: {
      minX: 100,
      maxX: 850,
    },

    rightBounds: {
      minX: 4150,
      maxX: 4900,
    },
  },

  aiming: {
    maxDragDistance: 180,

    minPower: 0.15,

    minLaunchSpeed: 550,

    maxLaunchSpeed: 1400,

    previewDuration: 0.8,

    previewPoints: 12,
  },

  physics: {
    gravityX: 0,
    gravityY: 1000,

    projectileLifetimeMs: 8000,
  },

  explosion: {
    radius: 140,

    directDamageRadius: 60,

    directDamage: 2,

    splashDamage: 1,
  },

} as const;
```

如果 Phaser Matter gravity 单位实现不同：

允许在 Physics Adapter 层转换。

GameConfig 中 Gameplay 概念保持统一。

---

# Important Architectural Rule

禁止：

BattleScene.ts

变成：

2000 行 God Object。

BattleScene 应类似：

create():

initialize world

initialize systems

connect systems

create HUD

update():

input.update()

systems.update()

Camera、Damage、Turn、Network：

分别维护。

---

## 战斗设置与确认退出（2026-10-01）

- [x] 1P 头像下增加 48 CSS px 齿轮，设置窗口使用深海蓝金属底板与金/银边框。
- [x] 按反馈打磨为同组手绘素材：生成透明钢铜齿轮，复用主菜单金/钢按钮，头像框边轨重复铺贴、底部独立铭牌与机械声音滑槽；784 单测、设置74项及真实双端33项通过，安全区与更矮视口已检查。素材与提示词见 `docs/ArtDesign/BATTLE_SETTINGS_REFINEMENT_2026-10-01.md`。
- [x] 声音开关保存到既有用户设置；关闭时停止正在播放的声音。
- [x] 返回主界面需再次确认，可取消并继续当前对局。
- [x] 弹窗持续拦截本地移动、瞄准和相机拖动，释放已有手势与键盘状态；AI 和远端回合继续运行。
- [x] 退出锁定转场、释放联机会话，并拦截旧恢复/快照/结算回调；普通结算的再战交接保留。
- [x] 新设置浏览器回归 74 项、真实 WebRTC 双端 33 项、真实 Room 重连期间退出 20 项、原单人/AI 16 项通过；已检查手机设置与确认截图。
- [x] 784 单测 / 65 文件、类型检查与构建通过；7 项新增场景生命周期回归覆盖快照期间恢复、旧续体及退出/结算淡出竞争，独立审查无剩余问题。
- [ ] iPhone Chrome 实际触控与声音输出验收。

## 程序启动加载图（2026-10-01）

- [x] 生成海港双角色启动插画，保存仓库内优化 JPEG，完整提示词见 `docs/ArtDesign/STARTUP_LOADING_2026-10-01.md`。
- [x] HTML 最早首屏、真实 Phaser 加载进度、主菜单首次渲染退场；手机横竖屏与缺图/缺 Logo 兜底。
- [x] 788 单测 / 66 文件、类型检查与构建通过；加载浏览器 59 项、原设置回归 74 项通过，独立审查无问题。
- [ ] iPhone 真机启动观感验收。

# Final Rule

每完成一个 Phase：

STOP。

不要因为“顺便”就进入下一 Phase。

先保证当前 Phase：

正确

可玩

可测试

可维护。

之后再继续。
