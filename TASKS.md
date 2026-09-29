# Ricochet Rivals — Development Tasks

> 状态：**Phase 0 ～ Phase 15 已完成（2026-09-29，Phase 15 Desync Detection & State Recovery 落地——Guest 状态偏差自动检测 → 快照恢复 → 对局继续；待 test-reviewer 独立验收）**
> 验证：`npm run typecheck` / `npm run test`（475）/ `npm run build` / `npm run e2e`（123）全部通过。
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
- 发射原点 = 炮手脚底 + `player.launcher.offsetY`（-48，炮塔位置），Phase 5 炮弹从此出生
- AimController：AIMING + 未发射 + 炮手 180px 内 pointerdown 开始；拖拽持续/释放走 window 监听（移出 Canvas 不丢）；低于最小力度松手 = 静默取消；Esc/右键取消瞄准时自动中止
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

Player ✅（引信距离 100px 内不激活，避免发射瞬间自爆；激活后回落砸发射者同样爆炸）

Obstacle（V0.1 无障碍物，FUTURE）

World Exit ✅（左右/穿地越界直接销毁）

## Lifetime

最大：

8 seconds ✅（超时原地爆炸）

## 实现说明（2026-09-28）

- Matter gravity 单位坑修复：Matter gravity 1 ≈ 1000 px/s²，GameConfig 的 px/s² 在 PhaserGameConfig 层 ÷1000 适配（Phase 0 遗留隐患）
- 炮弹刚体 frictionAir=0：与 TrajectoryCalculator 预览同一抛体模型，预览即真实前 0.8s
- FireCommand velocity（px/s）→ Matter setVelocity（px/step，÷60）适配在 Projectile 内
- 玩家碰撞体（28×76 静态矩形）每帧从 PlayerState 同步；不参与移动物理
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
      桌面保持 startRadius(180) 世界距离；aimMath 纯函数未动。
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
- [x] 距离 = 爆炸中心到玩家身体中心（x, y − collision.height/2）

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
      身体中心几何、双玩家结果、阵亡免疫、hpAfter clamp、
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
60 CSS px（与 Mobile 同一防御；仍在 180 世界 px 起始半径内，
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

# Phase 16 — Disconnect / Rematch

支持：

Opponent disconnected

显示提示。

支持：

Return Menu

支持：

Rematch

Rematch 必须重新：

gameSeed

GameState

Turn State

---

# Phase 17 — Juice / Polish

基础美术素材替换 Placeholder。

增加：

- [ ] launch sound
- [ ] projectile sound
- [ ] explosion
- [ ] hit sound
- [ ] turn sound
- [ ] victory
- [ ] defeat
- [ ] camera shake
- [ ] impact freeze / hit stop
- [ ] particles
- [ ] player reaction
- [ ] UI transitions

这里重点优化：

“命中爽感”。

---

# Phase 18 — Mobile Preparation

不是完整移动版。

只处理基础：

- [ ] Responsive Canvas
- [ ] Touch Camera Drag
- [ ] Touch Aim Drag
- [ ] Prevent Browser Scroll
- [ ] Landscape Warning
- [ ] Safe Area

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
