# Ricochet Rivals Web Game — Project Rules

## 1. Project Goal

开发一款横版 2D 回合制弹道对战网页游戏。

核心体验：

- Worms / 百战天虫式双方阵地对抗
- Angry Birds 式反方向拖拽瞄准和抛射
- 玩家可以自由横向拖动 Camera 观察整个战场
- 每回合可以在己方阵地内有限距离移动
- 每回合只能发射一次
- 发射时 Camera 必须回到己方炮手
- 炮弹飞行期间 Camera 自动跟随炮弹
- 命中后停留观察爆炸和伤害
- 随后切换对方回合
- 支持单机 AI
- 后续支持 WebRTC P2P 双人联机
- 后续支持空中可拾取道具

项目第一目标：

“先证明基础弹道对战本身好玩。”

不要过早增加内容系统。

---

# 2. Technology Stack

必须使用：

- TypeScript
- Vite
- Phaser 4.x
- Matter.js / Phaser Matter Physics
- Vitest
- HTML5 Audio / WebAudio
- WebRTC RTCDataChannel

不使用：

- Unity WebGL
- React 作为游戏运行时
- 后端数据库
- 传统游戏服务器

如果后续需要 signaling，可以增加独立的轻量 signaling 服务，但不能把核心游戏逻辑迁移到服务器。

---

# 3. Architecture Principle

必须严格分离：

Game Logic

Rendering

Input

AI

Networking

Physics

Camera

UI

禁止把核心逻辑全部写入 BattleScene。

BattleScene 只负责：

- Scene 生命周期
- 系统初始化
- 系统连接
- update 调度

---

# 4. Command Driven Architecture

所有玩家行为必须最终转换为 GameCommand。

输入可能来自：

- Local Human
- AI
- Remote Network Player

但核心 Game Logic 不应该知道命令来自哪里。

架构：

LocalInput\
↓

AIInput\
↓

NetworkInput\
↓

GameCommand\
↓

Game Logic

必须保证 Single Player 和 Multiplayer 共用同一套：

- GameState
- TurnManager
- DamageSystem
- ProjectileSystem
- GameCommand

---

# 5. Multiplayer Architecture

P2P 使用：

WebRTC RTCDataChannel

但是必须采用：

HOST AUTHORITATIVE

创建房间的人：

Host

加入房间的人：

Guest

Host 是最终 GameState 权威。

Guest 可以本地播放：

- Move
- Projectile
- Explosion
- Animation

但是最终：

- Damage
- HP
- Item State
- Turn Result
- Game Over

以 Host 发送的 authoritative state 为准。

原因：

Matter.js / JavaScript Physics 在不同设备和浏览器可能产生微小浮点误差。

因此不要假设两端物理模拟永远 100% deterministic。

---

# 6. Networking Rule

禁止逐帧同步 Projectile Position。

禁止发送：

60 FPS projectile x/y。

只同步：

- Commands
- Important Events
- Result Snapshot

例如：

MOVE\
FIRE\
TURN_RESULT\
TURN_END\
GAME_OVER

FIRE 必须包含：

- start position
- velocity
- weapon
- turnId
- seed

Guest 收到 FIRE 后本地播放弹道。

Projectile 结束后：

Host 发送 TURN_RESULT。

---

# 7. Gameplay Constants

初始世界：

WORLD_WIDTH = 5000

WORLD_HEIGHT = 1080

左侧基地：

100 ～ 850

右侧基地：

4150 ～ 4900

出生位置：

P1 ≈ 450

P2 ≈ 4550

初始生命：

MAX_HP = 10

每回合最大移动距离：

MAX_MOVE_PER_TURN = 250px

拖拽最大距离：

MAX_AIM_DRAG = 180px

最小发射力度：

MIN_FIRE_POWER = 0.15

建议基础炮弹速度：

MIN_LAUNCH_SPEED = 550

MAX_LAUNCH_SPEED = 1400

Gravity：

约 1000 px/s²

Projectile 最大生命周期：

8 秒

Explosion Radius：

140px

伤害：

distance <= 60px:\
2 damage

60px < distance <= 140px:\
1 damage

distance > 140px:\
0 damage

这些参数必须统一放在 GameConfig。

禁止散落 magic numbers。

---

# 8. Camera System

Camera 必须使用明确状态机。

CameraMode：

FREE_VIEW

RETURN_HOME

AIMING

PROJECTILE_FOLLOW

IMPACT

TURN_TRANSITION

---

## FREE_VIEW

允许：

鼠标拖动画面

触摸拖动画面

可以观察整张地图。

Camera 只能在地图 Bounds 内移动。

---

## RETURN_HOME

玩家准备瞄准时：

Camera 自动 Tween 回当前玩家炮手。

建议：

350ms 左右。

返回完成后才能正式进入 AIMING。

---

## AIMING

Camera 锁定己方附近。

禁止拖动世界 Camera。

玩家使用反方向拖拽操作 Projectile。

---

## PROJECTILE_FOLLOW

发射后：

Camera 自动跟随炮弹。

必须使用平滑 follow。

不要使用瞬间硬锁。

---

## IMPACT

爆炸后 Camera 停留在爆炸点。

大约：

700 ～ 1000ms

播放：

- Explosion
- Camera Shake
- Hit Reaction
- Damage Number
- HP Animation

---

## TURN_TRANSITION

Camera 平滑移动到下一位玩家。

完成后：

进入 FREE_VIEW。

---

# 9. Camera Interaction UX

玩家正在观察敌方基地时：

不能直接从屏幕外瞄准自己的炮手。

提供固定 UI：

“回到炮手 / 瞄准”

Desktop shortcut：

Space

触发后：

FREE_VIEW\
→ RETURN_HOME\
→ AIMING

如果取消瞄准：

AIMING\
→ FREE_VIEW

只要尚未发射，可以再次观察地图。

---

# 10. Turn System

TurnPhase：

START

ACTION

RETURN_HOME

AIM

PROJECTILE

RESOLVE

END

ACTION 阶段玩家可以：

- Free View
- Move
- 查看敌人
- 再移动
- 点击 Aim

一旦 FIRE：

立即进入：

PROJECTILE

本回合不得再移动或发射。

Projectile 完成：

RESOLVE

处理 Damage。

随后：

END

切换玩家。

---

# 11. Movement

角色第一版只能水平移动。

不允许：

- Jump
- Climb
- Vertical movement

P1 永远不能离开：

100 ～ 850

P2 永远不能离开：

4150 ～ 4900

移动消耗按照实际移动距离累计。

例如：

向右 100px

再向左 40px

消耗：

140px

不是净位移 60px。

---

# 12. Aim Interaction

使用 Angry Birds 操作逻辑。

鼠标：

pointer down

↓

drag opposite direction

↓

show trajectory preview

↓

pointer up

↓

fire

计算：

drag = pointer - launcher

direction = -normalize(drag)

power = clamp(length(drag) / MAX_AIM_DRAG)

velocity = direction × launchSpeed(power)

必须支持取消 Aim。

---

# 13. Trajectory Preview

显示预测虚线。

不要显示完整落点。

建议：

- 10～14 个点
- 预测未来约 0.7～0.9 秒
- 后面的点逐渐变小
- 后面的点逐渐透明

Trajectory Preview 必须使用与 Projectile 尽可能相同的：

- Gravity
- Velocity
- World parameters

不要单独写一套完全不同的“假轨迹”。

---

# 14. Projectile

V0.1 只实现：

NormalProjectile

状态：

SPAWN

FLYING

IMPACT

EXPLODING

DESTROYED

爆炸条件：

- Ground collision
- Player collision
- Obstacle collision
- Lifetime exceeded

掉出 World Bounds：

销毁，并结束当前攻击。

---

# 15. Damage

DamageSystem 是独立系统。

Projectile 不应该直接修改 Player HP。

流程：

Projectile impact

↓

ExplosionEvent

↓

DamageSystem.calculate()

↓

DamageResult

↓

GameState 更新

↓

UI / Animation 响应

这样以后可以扩展：

- Shield
- Poison
- Critical
- Damage Boost
- Armor

而不需要重写 Projectile。

---

# 16. Randomness

所有影响 Gameplay 的随机数必须使用 seeded RNG。

禁止 Gameplay 使用：

Math.random()

使用：

SeededRandom

例如：

Mulberry32

Match 创建时：

Host 产生 gameSeed。

AI、Items、Map Random 等全部使用 SeededRandom。

纯视觉粒子允许 Math.random()。

---

# 17. Future Item System

V0.1 不实现 Item Gameplay。

但代码必须预留：

WorldItem

ItemSystem

ItemEffect

未来 Projectile 穿过 Item 时可以触发：

HEAL

DAMAGE_BOOST

SPLIT

SHIELD

Item 应该鼓励玩家改变最佳攻击弹道。

不要默认把所有 Item 放在正常命中路径。

---

# 18. AI

V0.1 AI 目标：

“能正常陪玩家打完一局。”

不要开发复杂 AI。

AI：

1. 选择移动位置
2. 计算基础弹道
3. 增加随机误差
4. 发射

Normal：

Angle Error ≈ ±8°

Power Error ≈ ±12%

AI 必须通过 GameCommand 操作游戏。

禁止 AI 直接调用 Player 内部方法修改状态。

---

# 19. Code Quality

所有 TypeScript：

strict = true

禁止无理由使用：

any

核心业务逻辑尽量：

pure functions

或者可独立测试。

重要 Enum、Interface 和 Config：

单独文件维护。

避免 cyclic dependencies。

类职责单一。

如果某个文件超过约 400 行：

优先考虑拆分。

---

# 20. Testing

每完成一个 Phase：

必须运行：

npm run typecheck

npm run test

npm run build

出现失败必须先修复。

禁止：

“先忽略错误继续做下一阶段”。

关键系统至少测试：

- Damage calculation
- Movement budget
- Movement bounds
- Trajectory calculation
- Turn switching
- Seeded random
- Command validation
- Network message parsing

---

# 21. Development Discipline

不要一次实现全部功能。

必须按照 TASKS.md Phase 顺序开发。

每完成一个 Phase：

1. 更新 TASKS.md
2. 标记完成项
3. 运行 tests
4. 运行 build
5. 总结：
   - 修改文件
   - 实现内容
   - 测试结果
   - 当前已知问题
6. 停止
7. 等待下一 Phase

除非用户明确要求连续开发。

---

# 22. Scope Control

V0.1 禁止开发：

- Account
- Login
- Database
- Ranking
- Matchmaking
- Shop
- Skins
- Character Selection
- Equipment
- Skill Tree
- Destructible Terrain
- Weather
- Wind
- Multiple Weapons
- Item Gameplay
- Chat
- Spectator
- Season System

任何时候发现这些需求：

记录为 FUTURE。

不要自行实现。

---

# 23. UX Priority

优先级：

1. Aim 手感
2. Projectile 飞行反馈
3. Camera
4. Hit Feedback
5. Turn Flow
6. Network
7. 内容数量

不要为了代码架构牺牲操作体验。

也不要为了临时视觉效果破坏架构。

---

# 24. Definition of Done

一个功能只有同时满足：

- 能正常运行
- TypeScript 无错误
- Build 成功
- 必要测试通过
- 没有破坏旧功能
- 符合本文件架构规则

才视为完成。

# Mobile-First Cross-Device Interaction

# 25. 从 Phase 6.5 开始：

Mobile Landscape 是一等目标平台。

Desktop 与 Mobile 必须共享：

- GameState
- GameCommand
- MovementSystem
- Aim Calculation
- Projectile Physics
- TurnManager
- DamageSystem

平台差异只能存在于：

- Input Adapter
- HUD Layout
- Viewport / Safe Area
- Touch Feedback
- Desktop Keyboard Shortcuts

禁止复制两套 Gameplay Logic。

所有 Pointer Interaction 优先使用 Phaser Unified Pointer API。

输入优先级：

UI > AIM > MOVEMENT > CAMERA。

同一个 Pointer 在一次 Gesture 生命周期中只能由一个系统拥有。

手机端：

- Landscape only gameplay
- Touch Camera Pan
- Large Movement Buttons
- Enlarged Aim Hit Area
- Aim Dead Zone
- Self / Enemy Camera Shortcut
- Safe Area HUD
- Browser Gesture Prevention

桌面端继续支持：

- Mouse Camera Pan
- Mouse Aim
- A / D
- Arrow Keys
- Space
- Escape

不要通过 User Agent 决定 Gameplay。

应根据实际 Input Capability 和 Viewport 决定 UI / Control Profile。

World Gameplay Coordinates 不因为 Device Resolution 改变。

Responsive Layout 只能改变：

Viewport

Camera Zoom

HUD Layout

而不能改变：

Physics

Damage

Movement Distance

Projectile Trajectory。

# Subagent Delegation Policy

本项目使用三个项目级专业 Subagent：

gameplay-engineer

network-engineer

test-reviewer

Main Agent 是唯一的：

Technical Lead / Integrator。

Main Agent 负责：

- 理解用户需求
- 决定当前 Phase
- 拆分任务
- 选择 Subagent
- 处理跨系统设计
- 审查 Subagent 输出
- 最终代码集成
- 最终 Phase 验收
- 更新 TASKS.md

Subagent 不负责决定整个项目路线。

---

## gameplay-engineer

用于：

- Gameplay
- AI
- Trajectory
- Movement
- Aim
- Projectile
- Damage
- Turn Flow
- Gameplay Balance
- Gameplay bug

AI Phase 必须优先委托 gameplay-engineer。

gameplay-engineer 不负责 WebRTC。

---

## network-engineer

用于：

- WebRTC
- P2P
- NetworkTransport
- Protocol
- Host Authority
- State Sync
- Desync Recovery
- Disconnect
- Rematch Networking
- Signaling abstraction

Phase 12 之前，除非 Main Agent 需要网络架构评审，否则不要让 network-engineer 修改项目。

network-engineer 不负责 Gameplay Balance 和 AI。

---

## test-reviewer

用于每个重要 Phase 完成后的独立验收。

test-reviewer 默认是 Read Only Reviewer。

它：

- 可以读取项目
- 可以运行测试
- 可以运行 typecheck
- 可以运行 build
- 可以报告问题

但不能直接修改业务代码。

如果 test-reviewer 返回 FAIL：

Main Agent 必须根据问题领域重新委托：

Gameplay Issue
→ gameplay-engineer

Network Issue
→ network-engineer

Integration Issue
→ Main Agent

修复后：

必须再次运行 test-reviewer。

---

# Delegation Workflow

对于 Gameplay Phase：

Main Agent
→ gameplay-engineer implementation
→ Main Agent integration review
→ test-reviewer verification
→ if FAIL: gameplay-engineer fix
→ test-reviewer re-check
→ Main Agent closes Phase

对于 Network Phase：

Main Agent
→ network-engineer implementation
→ Main Agent integration review
→ test-reviewer verification
→ if FAIL: network-engineer fix
→ test-reviewer re-check
→ Main Agent closes Phase

对于跨 Gameplay + Network 的任务：

禁止两个 Agent 同时修改重叠文件。

Main Agent 必须先定义 Interface Boundary。

通常顺序：

gameplay-engineer
→ establish gameplay contract

network-engineer
→ implement networking against that contract

test-reviewer
→ integration verification

Main Agent
→ final integration

---

# Parallel Delegation Rule

只有修改范围明确不重叠时才能并行调用 Subagents。

例如：

允许：

gameplay-engineer 分析 AI

同时

test-reviewer 检查现有 Phase 0–9 regression

不允许：

gameplay-engineer 修改 TurnManager

同时

network-engineer 修改同一个 TurnManager。

避免不同 Agent 同时编辑同一文件或同一接口。

---

# Agent Authority

Subagent 的建议不是最终架构决定。

如果 Subagent 提议：

- 大规模重构
- 修改公共 Contract
- 改变 GameCommand
- 改变 GameState
- 改变 TurnPhase
- 改变 Networking Authority Model

Main Agent 必须先评估影响。

不要自动接受跨系统架构修改。

---

# Phase Completion

任何核心 Phase 不允许仅因为实现 Agent 声称成功就标记完成。

必须经过：

Implementation Agent

+

test-reviewer

+

Main Agent Final Review

之后才能：

更新 TASKS.md 为完成。

## Codely Structured Memories

### User

### Feedback
- [2026-09-28 14:01:03] 内置 web_search 工具已失效（2026-09-28 实测返回 410 Gone："Legacy web search endpoint is disabled"）。替代方案：已知 URL 直接用 web_fetch（GitHub release 页等抓取正常）；未知关键词改用 websearchplus skill；查 npm 包信息直接 `npm view <pkg> version/dependencies/versions --json`，无需联网搜索。
- [2026-09-28 14:23:22] Vitest `toBe` 使用 Object.is 严格比较：`expect(x).toBe(0)` 在 x 为 -0 时失败（-dragY/length、Math.sign(0) 负零等场景常见）。断言零值用 `toBeCloseTo(0, 6)` 或比较 `x === 0`，勿用 toBe(0)。（2026-09-28 Ricochet Rivals aimMath 测试实测踩坑）

### Project
- [2026-09-28 14:38:00] Phaser 4 技术要点（2026-09-28 实测，Ricochet Rivals）：最新 4.x = 4.2.1；Matter Physics 内置（config `physics:{default:'matter',matter:{gravity:{x,y}}}`，MatterWorldConfig.gravity 为 Vector2Like）；类型定义 node_modules/phaser/types/phaser.d.ts（约 14.8 万行，用 rg 定位）；`declare module 'phaser'{export=Phaser}` → tsconfig 需 esModuleInterop，`import Phaser from 'phaser'` 可用；MouseManager 默认只监听 canvas（MouseInputConfig.target）→ canvas 内拖拽类交互必须 window 级 DOM 监听，否则鼠标移出 canvas 后 move/up 丢失、拖拽卡死；FPS 用 game.loop.actualFps；camera.scrollX / Phaser.Scale.RESIZE / Phaser.Scenes.Events.SHUTDOWN 均可用。键盘（Phase 2 实测）：`keyboard.addCapture('A,D,LEFT,RIGHT')` 可阻止方向键触发浏览器滚动等默认行为；`keyboard.addKeys('A,D,...')` 返回类型是 object，strict TS 下需断言为 `Record<'A'|'D'|..., Phaser.Input.Keyboard.Key>`。坐标与命中（Phase 3/4 实测）：`camera.getWorldPoint(x, y, output?)` 屏幕→世界转换可用（配合 canvas.getBoundingClientRect() 修正偏移）；`input.hitTestPointer(pointer)` 返回指针下交互对象数组，用于区分"点 UI"与"点世界"（拖拽/瞄准启动前过滤）；Container 需手动 `setInteractive(new Phaser.Geom.Rectangle(...), Phaser.Geom.Rectangle.Contains)` 才有命中区。Matter 物理（Phase 5 实测）：①gravity 单位 y=1 ≈ 1000 px/s²（内部 gravityScale 0.001 px/ms²），GameConfig 的 px/s² 必须 ÷1000 后传 config，直接传 1000 = 百万 px/s²；②`Body.setVelocity` 单位是 px/step（60Hz），px/s 需 ÷60；③BodyType 上没有 collisionCategory/collisionMask 属性（仅 create 配置项），body 实际字段是 `collisionFilter?: {category,mask,group}`——创建时经 MatterBodyConfig.collisionFilter 传入，事后整体赋值 body.collisionFilter；④`MatterJS` 命名空间全局可用（`MatterJS.Body.setPosition/setVelocity(body,vec)`），Phaser.Physics.Matter.Matter 在 Phaser 4 类型中是空 namespace 别用；⑤matter.add.circle/rectangle 返回 MatterJS.BodyType；⑥frictionAir 默认 0.01（有空气阻力），弹道要与解析式预览一致必须设 0；⑦collisionstart 事件用 event.pairs 遍历（pairs[].bodyA/bodyB）。
- [2026-09-28 17:37:37] [2026-09-28 16:10] Phaser 4 相机 zoom / Scale / 指针 / E2E 补充要点（2026-09-28 Phase 6.5 实测，源码验证，补充同日早前的 Phaser 4 条目）：①camera.zoom 围绕视口中心缩放：midPoint = scroll + viewport/2 与 zoom 无关，可见世界矩形 worldView = midPoint ± viewport/(2·zoom)（cameras/2d/Camera.js preRender）→ 多 zoom 相机数学一律中心锚定，scroll = center − viewport/2 只是写入换算；getWorldPoint 走矩阵求逆，zoom 感知正确。②Scale.RESIZE 事件参数是 (gameSize, baseSize, displaySize, prevW, prevH) 而非 (w,h)；CameraManager 也监听同一事件按 baseSize 改相机尺寸 → resize 处理器别依赖参数顺序，直接读 scale.gameSize + 兜底 camera.setSize。③window 级 PointerEvents（pointerdown/move/up/cancel）统一鼠标+触摸+触控笔，pointerId 天然支持多指仲裁；puppeteer/CDP 注入的 mouse/touch 都会产生对应 PointerEvent；`event.target === canvas` 判断让 DOM 覆盖层天然拦截游戏手势。④E2E 工具链：puppeteer-core 25 + 系统 Chrome headless 可跑完整 Phaser 游戏；Windows `vite preview` 默认绑 ::1 → 127.0.0.1 连接被拒，必须 `--host 127.0.0.1`；spawn(npx,{shell:true}) 的 kill() 只杀 cmd 包装层，清理需 `taskkill /pid X /T /F`（spawnSync 同步，防孤儿 vite 占端口）；puppeteer setViewport({isMobile,hasTouch}) 使 pointer:coarse + maxTouchPoints 生效，可实测触屏分支；page.evaluate 序列化返回值丢对象方法（getter 变数据、函数消失）→ 调试句柄只暴露 getter。⑤真机坐标坑（2026-09-28 手机实测发现，E2E 全绿也挡不住）：clientX/Y ≠ 画布/游戏坐标 —— 真机上画布 rect 可能与页面坐标空间有偏差（fixed 元素 width/height:100% 百分比链在手机浏览器上与可见视口解析不一致），直接拿 clientX/Y 比对游戏坐标的命中判定会出现"画面在 A、点击在 B"；正确做法 = 在统一指针入口做 client→画布坐标换算（canvas.getBoundingClientRect() × gameSize），物理手感判定（死区等）保留 client 坐标；桌面/headless 恒等所以 E2E 测不出，必须加"故意偏移画布后点视觉位置"回归用例。配套：游戏容器布局用四边拉伸（position:fixed + top/left/right/bottom:0）替代百分比链；iOS 工具栏收起/旋转时序下 window resize 可能不触发 —— ViewportService 直接监听 visualViewport resize 驱动重算。⑥高分屏清晰渲染（2026-09-28 iPhone 17 Pro 实测字体发糊的根因）：Phaser 3/4 全引擎不使用 devicePixelRatio（仅 Matter debug 渲染器引用），RESIZE 模式画布位图 = CSS 像素（ScaleManager：canvas.width = baseSize；RESIZE 分支 gameSize=baseSize=displaySize=parentSize，zoom 不参与）→ DPR 3 手机位图被浏览器拉伸 3 倍发糊。正确做法：Scale.NONE + 手动驱动 —— `scale.resize(cssW×dpr, cssH×dpr)`（NONE 专用方法：位图=传入值、style=值×zoom、派发 RESIZE）+ `scale.setZoom(1/dpr)` + **显式写死 canvas.style.width/height = css px**（关键坑：ScaleManager 只在 styleSize≠gameSize 时才写样式，zoom=1 的 DPR1 桌面会跳过 → CSS 滞留占位值导致画布压扁、rect≠gameSize，E2E 曾复现 45° 射击全失准，加"画布 CSS 尺寸=视口"断言守住）；游戏坐标空间=物理像素，HUD/字号/触摸瞄准半径等屏幕手感常量 ×uiScale(=dpr)，世界相机 zoom=物理高/构图高（DPR 被 zoom 精确补偿、构图不变），可见视口取 window.visualViewport 优先（iOS 工具栏感知）；E2E 用 setViewport({deviceScaleFactor:2}) 实测 DPR 路径 + 断言 canvas.width==css×dpr。


- [2026-09-28 16:21:27] [2026-09-28 16:20] Ricochet Rivals Phase 7 实测要点（Phaser/Matter 平台事实，非代码内容）：①Phaser 4 `camera.shake(duration, intensity)` 是 preRender 阶段的渲染矩阵偏移（effects/Shake.js: `camera.matrix.translate(_offsetX, _offsetY)`），不改 scrollX/scrollY —— 与每帧手写 scroll clamp 的 CameraController 天然兼容，可放心在任意相机模式下叠加抖动。②Matter 半隐式 Euler 积分的抛体射程比解析式 v²/g（45°）系统性过冲 ≈ g·dt/(2·v_y0)，60Hz 下约 0.6~0.7%（dt=1/60、v_y≈1280 时 ~26px/3970px）——E2E 的 45° 求解瞄准与未来 Phase 10 AI TrajectorySolver 解算弹道时都要按同方向修正或留出直伤半径（60px）容差，不能假设解析式与模拟完全一致。③45° 是射程灵敏度驻点（∂R/∂θ=0），瞄准求解选 45° 可让角度误差二阶不敏感，只有力度一阶敏感（~42px 射程/世界px 拖拽）——scripts/e2e.mjs 的 solveFortyFiveRelease 即此原理，Phase 10 AI 评估可复用。
- [2026-09-28 18:23:09] [2026-09-28 18:30] Ricochet Rivals Phase 9 E2E 实测要点（Phaser/GestureArbiter 平台事实，补充同日早前条目）：①世界锚定交互点可被屏幕固定 UI zone 抢走 pointerdown——相机中心受世界边界 clamp（桌面 1280×800 zoom≈0.741 → 可见宽 1728px，中心左极限 864），玩家在阵地左缘（P1 x≈663）时炮塔屏幕位置 (490,676) 恰好落进 AimButton zone（x∈[490,790], y∈[668,724]）；GestureArbiter 优先级 UI > AIM，pointerdown 被按钮认领 = onTap = 取消瞄准，拖拽永远无法发射。E2E 防御：瞄准拖拽起点统一上移 60 CSS px（仍在 180 世界 px 起始半径内；瞄准向量按「指针−炮塔」计算，起点偏移不影响力度/方向）——Mobile 流程一开始就有此防御，Desktop 靠位置巧合躲过两轮才踩中。真人玩同样存在此交互（站最左侧瞄准、点按钮附近会取消瞄准），属可接受的布局固有行为，改动按钮位置前需评估。②E2E 断言一帧竞态：相机 FREE_VIEW 与 phase→ACTION（横幅 showTurn 在下一 update tick）隔一帧，waitFor 条件 A 通过后立即读关联效应 B（如 lastBannerText）会偶发读到旧值——B 必须用独立 waitFor（或并入同一 waitFor 条件）断言，直接读靠轮询运气，时序一变就翻车。**How to apply:** 新增屏幕固定 UI zone 或调整相机 clamp/按钮布局时重查与炮塔屏幕位置的覆盖；写 E2E 时任何跨帧关联效应一律 waitFor 化。
- [2026-09-28 19:07:45] [2026-09-28 19:10] Ricochet Rivals Phase 10 委托制实测要点:①项目级 Subagent:定义在 `.codely-cli/agents/*.toml`(gameplay-engineer/network-engineer/test-reviewer,含 system_prompt/model_config/工具白名单/输出协议),**用 task 工具按名字直接 dispatch 可用**(即使不在系统提示的内置 agent 列表里);TOML 的 [validation] input_schema 不是强制参数格式,prompt 自由文本即可。②gameplay-engineer MAX_TURNS=20 会在实现+写测试+集成+验证全流程下耗尽(Phase 10 实测 59 tool uses 后截断,验证和收尾未做)——大委托要么拆分(实现/集成分两次),要么在 prompt 明确"优先保证 typecheck/test/build 绿再收尾";截断后 Main Agent 必须亲自跑验证并 grep 重复/半成品痕迹。③Subagent 报告 replace 失败可能是假阴性(编辑实际已落盘)——重试会造成重复块(Phase 10 BattleScene.update 重复 syncInputOwnership 即此因);接手 subagent 半成品先 read 实际状态再改。④TS 严格模式两坑(GAME_CONFIG `as const`):`let lo = GAME_CONFIG.aiming.minLaunchSpeed` 推断为字面量类型 550,后续赋 number 报 TS2322——对 config 常量做二分/迭代必须显式 `: number` 注解;tests 开了 noUncheckedIndexedAccess,`arr[0].type`/discriminated union 字段访问前必须存在性守卫(`if (!cmd || cmd.type !== 'FIRE') throw`),仅靠 expect(length) 断言 TS 不认。⑤AI 委托经验:表现延迟与决策分离(InputSource 状态机 vs 纯函数 decide)可单测假时钟推进;回合无 pass 机制时 AI 无解必须兜底"尽力弹"否则死锁。**How to apply:** 后续 Phase 11+ 委托时按 ②拆分任务并要求先绿后收尾;接手半成品按 ③;写搜索/迭代代码按 ④。
- [2026-09-28 20:15:04] [2026-09-28 20:20] Ricochet Rivals Phase 11 实测要点(Phaser 4 平台事实,补充同日条目):①**Phaser GameObject setInteractive 在本项目不可用**:Scale.NONE + ViewportService 手动 canvas style 配置下,Phaser input 管线的指针坐标转换失效——实测 interactive 注册成功(interactiveCount=5)、pointerDown=true,但 activePointer.worldX/worldY 恒为 (0,0),hit test 永不命中。**所有屏幕 UI 命中一律走 window 级 InputRouter zone**(client→画布坐标归一化已在真机修复中验证),禁止新代码用 setInteractive/interactive hitArea。②**scene.start 复用 Scene 实例**:类字段初始化只在构造时执行一次,create/init 重跑不重置字段——对局级状态必须在 init() 显式复位清单(BattleScene 已把 24 个字段定性固化注释:条件赋值→必须复位、create 无条件重建→安全)。实测踩三处:transitioning 守卫(菜单死按钮)、bannerGameOverShown(吞第二局 gameOver 转场)、aiInput(**幽灵 AI 接管下一场 Local 2P**——旧实例闭包经 getState/commandBus 指向新局,reviewer 判 Critical);新增 scene 状态字段时必须过此清单。③**SHUTDOWN 时序陷阱**:场景关闭链中 scene.input、scene.matter.world 已为 null,destroy() 访问会抛 "Cannot read properties of null (reading 'off')" 并炸掉后续场景 create——CameraHotkeys/ProjectileSystem/Projectile 三处已加 `?.` 防御,新 destroy 同样要防。④E2E 排查:puppeteer 报 "Protocol error (Runtime.callFunctionOn): Internal error" 时优先怀疑页面 JS 崩溃(SHUTDOWN 错误即此类表象),用 page.on('pageerror') 监听 + 低频 probe(1.5s 间隔 evaluate)即可稳定复现并定位,别当 CDP 偶发。⑤MenuButton debug 句柄坐标输出时物理→CSS ÷uiScale,E2E 直接点击;scene 流断言用各场景 handle 的 scene 字段 waitForScene 化(跨帧关联效应一律 waitFor,同 18:23 条目)。**How to apply:** 写任何新 UI 用 InputRouter zone;新 scene 状态字段进 init 复位清单;destroy 全部 `?.`;E2E 崩溃先查 pageerror。
- [2026-09-29 00:03:52] [2026-09-29 09:00] Ricochet Rivals Phase 14 实测要点:①并行委托期间 Main Agent 禁止写入会破坏 typecheck 的半成品(如 import 尚未落地的模块、未完成的接线)——并行中的 subagent 各自跑 npm run typecheck 做"先绿"验证,会看到 Main Agent 的脏树,可能误判为自己失败或擅自"修复";安全做法是委托运行期只改与委托文件域零重叠且不依赖未落地实现的独立文件(UI 接缝/纯类型契约/工厂变体/测试),需要引用委托产物的接线等全部委托落地后再写(Phase 14 实测:gameplay-engineer ∥ network-engineer 并行期间按此纪律零干扰)。②TS 工厂重载坑:同一函数不同重载的可选第 2 参类型不同(createMatchSetup('online', role?) vs ('single_player', aiDifficulty?))时,实现签名该槽位必须写联合类型(arg2?: AIDifficulty | PeerRole)并在分支内窄化,否则 TS2394 "overload signature is not compatible with its implementation signature"(MatchFactory 实测修复)。**How to apply:** Phase 15+ 继续并行委托(如 desync 防护/状态同步拆分)时按①执行;新增带重载的工厂或工具函数时按②。
- [2026-09-29 00:35:19] [2026-09-29 01:30] Ricochet Rivals 委托策略深化(Phase 14 两次实测):①network-engineer 对"多文件实现型"委托连续两次在探索阶段耗尽预算(①读 8 个必读文件后仅落盘 1/5;②a 30 个 tool uses 全部读文件、零写入)——即使 prompt 已内联全部契约签名并附完整定稿设计仍如此;**已验证的更优模式:核心实现由 Main Agent 按自拟定稿直接写(①补尾 4/5 与②a 全部均一次成功且零返工),实现型委托拆分粒度按"必读文件数 × 交付物数"评估,≥3×3 就应再拆或亲写,测试编写类委托仍可派发**。gameplay-engineer 对小型契约委托(2 文件 + 测试)稳定可靠(Phase 10/14 两次成功)。②TS 泛型接口方法谓词坑:接口方法声明为类型谓径(guardInbound<T>(...): envelope is NetworkEnvelope<T>)时,实现类的同名方法也必须写成类型谓词(写 boolean 报 TS2416 "must be a type predicate");谓词让 Channel 层守卫后免断言收窄 payload,值得沿用。**How to apply:** Phase 15+ 委托 network-engineer 时默认走"Main Agent 定稿亲写实现 + 委托测试"或把实现拆到 ≤2 个必读文件 × ≤2 交付物;守卫类接口一律用泛型类型谓词方法。
- [2026-09-29 02:17:23] [2026-09-29 02:30] Ricochet Rivals Phase 14 双页联机 E2E 实测平台事实(补充 Phase 13 rAF 冻结条目):①headless 双页对战中后台页的精确行为边界——rAF 驱动的一切冻结(渲染/tween/Phaser time events 如 delayedCall),但 **DataChannel 消息接收、NetworkManager handler、纯逻辑状态写入、原生 setInterval(PLAYER_READY 1.5s 重发实测在后台生效)、page.evaluate 读取全部正常**;由此得出"前台舞蹈"编排:谁的本地模拟需要推进(炮弹飞行/爆炸 dwell/转场 tween)谁必须 bringToFront,后台页只做消息接收与状态写入。②双页对战断言策略:以"双端一致性(Host 权威)"为准,不依赖具体命中数值——后台恢复的炮弹首帧大 delta 可能隧穿 miss,但 HP/位置/stateHash parity 断言不受影响。③按键移动实测:350ms 按住 ≈ 90-95px(加速 2400/上限 320),位置断言阈值必须留余量(严格阈值 4440 实测翻车)。④WebRTCTransport 断线分类实测:进程异常关闭(渲染进程死)只到 ICE disconnected(瞬态不误杀,Phase 12 设计),failed 终局需数十秒;优雅关闭(DataChannel.close/关标签页)即时触发对端 onDisconnect——E2E 测断线用优雅路径(guest evaluate transport.close),异常崩溃路径记 Known Issue。**How to apply:** Phase 15+ 双页/重连 E2E 沿用前台舞蹈与 parity 断言;位置类断言阈值 ≥2× 预期误差;断线检测需求方要知道优雅/异常两条路径的感知时延差。
- [2026-09-29 02:17:32] [2026-09-29 02:35] Ricochet Rivals Phase 14 三个产品级 Bug 修复模式(联机架构通用教训,P2P E2E 实测定位):①**订阅时序丢失**:一次性握手消息(PLAYER_READY)在接收方订阅建立前投递即永久丢失→双端死锁;通用防线 = 低频重发直到握手完成(1.5s interval,接收方幂等短路,原生 setInterval 不受 rAF 冻结影响)——Phase 15 重连/Phase 16 rematch 握手同理。②**所有权转移后 dispose 降级**:OnlineConnectionScene→BattleScene 交接 session 后,连接场景 SHUTDOWN 的 controller.dispose()→destroySession() 把已移交的 transport/NetworkManager 就地杀死(症状:对端 send 抛 "manager disposed"+transport CLOSED);模式 = 所有权一经移交,原持有者的 dispose 必须降级为 detach()(只清自身 handler/计时器,带 detached 标志使后续 dispose no-op)。③**回调+返回值双驱动**:coordinator 的 applyTurnEnd 内部经 resumeNextTurn 回调驱动转场,而场景层又在 'proceed' 返回值分支重复 beginNextTurnTransition → 第二次 transitionToPlayer 的 setMode 把首个 tween 提前 resolve,phase 提前 ACTION 而相机滞留 TURN_TRANSITION → 后续 requestAim 被 aimFlow 静默拒绝(纯 TS 编译期无法发现,单测 harness 因 resumeNextTurn 是 vi.fn 而测不出,只有真实场景接线暴露);模式 = 同一副作用的"回调驱动路径"与"同步返回值路径"必须明确唯一驱动方。④**诊断利器**:BattleScene 内置 cameraEventLog 环形事件日志(30 条,turnId:事件→cam=当前模式)+debug 句柄暴露,一次运行定位双驱动(日志出现两条 beginTransition 即实锤)——跨帧时序类 bug(相机模式/相位不一致)的标配排查法。**How to apply:** Phase 15 状态恢复协议设计时按①加握手机制;任何跨 Scene/跨 owner 资源移交按②;回调 API 与返回值并存处按③审查;新联机时序 bug 先加环形事件日志按④。
- [2026-09-29 08:05:21] Ricochet Rivals 联机 WebRTC 环境事实（2026-09-29 Mac 实测）：Jackie 的 Mac 上 Chrome 的 mDNS host 候选（.local 假名）在本环境解析失败（headed/headless、同机双页均 ICE 必败），且 STUN 被网络劫持产出垃圾 srflx（128.1.x.x）→ 不加处理时任何 P2P 连接必超时。解法：`--disable-features=WebRtcHideLocalIpsWithMdns` 让 host 候选输出真实 IP（e2e.mjs 已内置；真机测试桌面侧需 ⌘Q 退干净 Chrome 后 `open -a "Google Chrome" --args --disable-features=WebRtcHideLocalIpsWithMdns http://localhost:5173` 冷启动）。ICE 只需单侧有真实 IP 候选即可建链（对端主动 check 打向真实 IP 即成对）。排查探针思路：puppeteer 双页裸 RTCPeerConnection + 打印 onicecandidate。
- [2026-09-29 08:58:22] Ricochet Rivals Web 剪贴板平台事实（2026-09-29 真机+探针实测）：①navigator.clipboard 仅安全上下文存在——局域网 HTTP 下 API 整个 undefined（访问 writeText 同步抛 TypeError，仍在点击手势内）；localhost 下也可能 NotAllowedError 写权限被拒（headless 必拒，grantPermissions 对非安全源直接报 "Permission can't be granted in current context"）。②document.execCommand('copy') 复制的是【当前选区】，选中空/错误元素会返回 true 却复制空内容——降级复制必须用临时隐形 textarea（fixed+opacity:0+readonly，iOS 要求元素在屏幕内不能移出）装载目标文本 + setSelectionRange 全选，禁止 select 页面上语义不同的输入框（曾因此 Host COPY 谎报 COPIED! 贴出空白）。③验证方法：puppeteer overridePermissions(['clipboard-read','clipboard-write']) + 包装 writeText/execCommand 记录调用链；headless 下 writeText 拒绝路径可用页内 readText 回读验证。完整修复记录见 TASKS.md Phase 13 真机修复轮。
- [2026-09-29 09:31:04] Ricochet Rivals 委托制补充实证（2026-09-29 Phase 15，补 09-28 Phase 10 条目）：①subagent 截断新判别信号：bg_task_done 的 result 字段若是"中途思考片段"（未完成语气，如 "One quick check on..."）而非结构化收尾报告 = 任务在探索阶段即断（network-engineer 委托①实测 15 tool uses / 87s 零落盘，status=completed 不代表任何代码写盘）——接手第一步必须 git status + grep 关键符号验证落盘状态，勿信 result 摘要。②应对策略实证有效：纯函数/纯协议类小任务 Main Agent 直接按原任务规格补尾最快（重发委托的 prompt 成本 > 自己写）；通道流程等复杂委托则继续用 network-engineer，但 prompt 必须三件套：完整接口回灌（禁探索）、文件白名单+禁读清单、先绿后收尾纪律。
- [2026-09-29 10:30:02] Ricochet Rivals loopback/E2E 测试写作坑（2026-09-29 Phase 15 实测）：①loopback 回合测试必须完整驱动 TurnManager phase 链：notifyProjectileLaunched→notifyProjectileResolved→applyRemoteTurnEnd 后再 notifyTurnTransitionComplete（END→ACTION，真实场景由相机转场回调驱动、测试须手动补）——漏任何一环 applyRemoteTurnEnd 会静默 no-op（phase 门禁）→ 触发 INVALID_LOCAL_STATE 恢复链假失败；Host 收口还需显式 hostTurn.endTurn()（'proceed' 返回值路径的场景等价行为）。②vi.useFakeTimers 先于 createOnlineHarness 会死锁（握手 flushLoopback 的 setTimeout 被 fake 拦截）——先建 harness 再 fake。③双页 E2E 前台轮换纪律：每个依赖场景推进（瞄准/炮弹物理/转场）的阶段，驱动页必须保持前台直到该阶段完成断言——中途 bringToFront 对端页会把驱动页物理冻结（Host 炮弹 25s 不落地）；恢复断言需收紧到具体回合的 reason（如 RECOVERED(turn:3)）防早期偶发恢复的粘性诊断态误判。完整记录见 TASKS.md Phase 15 章节。

### Reference

