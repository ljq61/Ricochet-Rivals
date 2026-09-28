# Ricochet Rivals — Development Tasks

# Phase 0 — Bootstrap

- [ ] 创建 Vite + TypeScript 项目
- [ ] 安装 Phaser
- [ ] 配置 Matter Physics
- [ ] 配置 TypeScript strict
- [ ] 配置 Vitest
- [ ] 创建基础目录
- [ ] 创建 GameConfig
- [ ] 创建 Phaser Config
- [ ] 创建 BootScene
- [ ] 创建 BattleScene
- [ ] 添加 npm scripts：
  - [ ] dev
  - [ ] build
  - [ ] typecheck
  - [ ] test
- [ ] 创建基础 README
- [ ] 创建 docs/ARCHITECTURE.md
- [ ] 创建 docs/GAMEPLAY.md

验收：

- [ ] npm run typecheck
- [ ] npm run test
- [ ] npm run build

---

# Phase 1 — World & Free Camera

## World

- [ ] World Size = 5000 × 1080
- [ ] Ground
- [ ] Left Base
- [ ] Right Base
- [ ] P1 placeholder
- [ ] P2 placeholder

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

- [ ] Mouse Drag
- [ ] Horizontal Camera Movement
- [ ] World Bounds
- [ ] Prevent Browser text selection
- [ ] Correct pointer release behavior

## Debug

- [ ] FPS
- [ ] Camera X
- [ ] Current Player
- [ ] Turn
- [ ] Camera Mode

验收：

从 P1 基地能够平滑拖到 P2 基地。

---

# Phase 2 — Player Movement

实现：

Player

PlayerController

MovementSystem

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

## Movement

- [ ] acceleration / speed 参数 Config 化
- [ ] movement boundaries
- [ ] move budget
- [ ] movement animation placeholder
- [ ] face direction
- [ ] GameState sync

## Test

测试：

- [ ] P1 Bounds
- [ ] P2 Bounds
- [ ] Movement Budget
- [ ] Reverse Movement Still Costs Distance
- [ ] Movement Disabled After Fire

---

# Phase 3 — Camera Home & Aim Mode

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

---

# Phase 4 — Angry Birds Aim

实现：

AimController

AimRenderer

TrajectoryCalculator

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

1400

## Formula

drag:

pointer - launchOrigin

direction:

-normalize(drag)

power:

clamp(length(drag) / MAX_AIM_DRAG)

speed:

lerp(\
MIN_LAUNCH_SPEED,\
MAX_LAUNCH_SPEED,\
power\
)

velocity:

direction × speed

## Aim UI

- [ ] Drag line
- [ ] Power indicator
- [ ] Trajectory dots
- [ ] Maximum stretch indication

## Preview

大约：

12 points

只预测：

0.8 second

禁止显示完整落点。

## Tests

- [ ] power clamp
- [ ] direction inversion
- [ ] minimum power
- [ ] trajectory formula

---

# Phase 5 — Projectile

实现：

Projectile

ProjectileSystem

ProjectileFactory

第一种：

NORMAL

## Matter

使用统一：

gravity

collision categories

world bounds

## State

SPAWN

FLYING

IMPACT

EXPLODING

DESTROYED

## Fire

AimController 不直接创建 Projectile。

流程：

AimController

↓

FireCommand

↓

CommandBus

↓

ProjectileSystem

↓

Projectile

## Collision

支持：

Ground

Player

Obstacle

World Exit

## Lifetime

最大：

8 seconds

---

# Phase 6 — Projectile Camera

当 Projectile 发射：

CameraMode：

PROJECTILE_FOLLOW

实现：

Camera smoothly follows Projectile。

不要完全硬锁。

Projectile 碰撞：

Camera：

IMPACT

锁定爆炸点。

停留：

约 850ms。

随后通知：

TurnManager。

---
# Phase 6.5 — Mobile-First Interaction & Responsive UX

本 Phase 必须在 Explosion / Damage / TurnManager 之前完成。

目标不是“让手机勉强能玩”。

目标是：

手机横屏成为完整的一等平台，同时保持 Desktop Mouse + Keyboard 操作。

---

## 6.5.1 Responsive Viewport

保持 World：

5000 × 1080

Gameplay World Coordinates 不随设备变化。

增加：

ViewportService

负责：

- viewport width
- viewport height
- orientation
- resize
- visualViewport resize
- safe area
- camera zoom

推荐：

Canvas 使用 Phaser Scale RESIZE。

Camera 根据 viewport height 计算 zoom，使战场纵向逻辑尺寸保持稳定。

不同宽高比允许显示不同数量的横向世界内容。

禁止为了手机修改：

World Width

Projectile Physics

Player Position

Trajectory Physics。

---

## 6.5.2 Orientation

游戏正式战斗只支持 Landscape。

Portrait 状态：

显示 RotateDeviceOverlay。

内容：

“请旋转手机以继续游戏”。

旋转到 Landscape：

自动恢复游戏。

Desktop 不显示。

---

## 6.5.3 Separate World UI

建立明确：

World Camera

和：

Screen Space HUD

之间的分离。

HUD 不能受到：

World Camera scroll

World Camera zoom

Projectile Follow

影响。

HUD 必须能够适配：

16:9

19.5:9

20:9

21:9。

---

## 6.5.4 Safe Area

HUD 必须尊重：

safe-area-inset-left

safe-area-inset-right

safe-area-inset-top

safe-area-inset-bottom

避免：

Notch

Dynamic Island

Rounded Screen Corners

覆盖 UI。

---

## 6.5.5 Unified Pointer Input

禁止分别维护：

Mouse Gameplay Logic

Touch Gameplay Logic。

统一通过：

Phaser Pointer API

处理。

Gameplay 最终仍然输出：

GameCommand。

建立：

DeviceProfile

InputRouter

TouchControls

DesktopControls。

---

## 6.5.6 Gesture Arbitration

增加：

GestureOwner

可能值：

NONE

UI

CAMERA

AIM

MOVEMENT

同一 pointer 同一时间只能属于一个 Owner。

优先级：

UI

>

AIM

>

MOVEMENT

>

CAMERA

一旦 Gesture 开始：

直到：

pointerup

pointercancel

才允许其它系统重新 Capture。

测试防止：

按 UI 同时拖 Camera

Aim 同时拖 Camera

Move 同时拖 Camera。

---

## 6.5.7 Touch Camera

FREE_VIEW：

单指拖动空白 World：

Camera Pan。

要求：

- 1:1 natural drag
- World Bounds
- drag threshold
- no accidental click after drag
- pointercancel safe
- pointer release outside canvas safe

允许轻量惯性。

不要加入强惯性。

---

## 6.5.8 Camera Shortcuts

Touch HUD 增加：

FOCUS_SELF

FOCUS_ENEMY

按钮。

用途：

减少玩家在 5000px World 中反复长距离滑动。

FOCUS_SELF：

平滑 Camera 到当前玩家。

FOCUS_ENEMY：

平滑 Camera 到敌人。

按钮不能修改 TurnPhase。

仅控制 Camera。

Desktop 可通过：

快捷键

或者同样 UI

使用。

---

## 6.5.9 Mobile Movement Controls

Touch 设备显示：

LEFT HOLD BUTTON

RIGHT HOLD BUTTON。

建议：

Button Visual Size：

56～72 CSS px。

Hit Area：

可以大于视觉区域。

按住：

持续移动。

松开：

停止移动。

必须继续遵守：

Movement Budget

Base Bounds

Turn State。

Desktop：

继续：

A / D

Arrow Left / Right。

Touch Buttons 不得复制 Movement Logic。

最终必须仍经过：

MovementSystem。

---

## 6.5.10 Mobile Aim

AIMING 状态：

Camera Locked。

扩大 Player Aim Hit Area。

不要要求手指精准点中角色 Sprite。

建议：

Visual Player Size 与 Touch Hit Area 分离。

Touch Aim：

pointerDown

↓

Capture AIM

↓

reverse drag

↓

Trajectory Preview

↓

pointerUp

↓

FireCommand

增加：

Aim Dead Zone。

建议：

12～18 CSS px。

如果：

Power < MIN_FIRE_POWER

pointerUp：

取消 Aim。

禁止误射。

---

## 6.5.11 Aim Feedback

Mobile Aim 时增强：

Trajectory Dot Size

Drag Direction Visibility

Power Indicator

Maximum Power Feedback。

必须保证：

手指遮挡发射点时

玩家仍然可以看懂：

Direction

Power

Trajectory。

Desktop 可以使用稍小 UI。

---

## 6.5.12 Browser Gesture Prevention

Game Surface：

touch-action: none

user-select: none

overscroll-behavior: none

阻止：

Browser Scroll

Text Selection

Double Tap Zoom

Browser Gesture Conflict

干扰 Gameplay。

但页面非游戏区域不要无条件禁止浏览器 Accessibility 行为。

---

## 6.5.13 Touch Target Policy

所有 Gameplay Touch Button：

实际 Hit Target 不小于：

48 CSS px。

主要按钮建议：

56～72 CSS px。

按钮视觉尺寸可以更小。

Hit Area 可以扩大。

Hover 不能成为理解 UI 的必要条件。

---

## 6.5.14 Fullscreen

增加可选：

Fullscreen Button。

Touch Device：

必须通过用户明确 Pointer Gesture 请求 Fullscreen。

Fullscreen Failure：

不能阻止游戏。

不要自动反复请求 Fullscreen。

---

## 6.5.15 Input Lock During Projectile

CameraMode：

PROJECTILE_FOLLOW

IMPACT

期间：

禁用：

Movement

Aim

Free Camera

保留必要系统 UI。

避免 Projectile Follow 时玩家误操作 Camera。

---

## 6.5.16 Device Test Matrix

至少测试以下 viewport：

1920 × 1080

1366 × 768

844 × 390

852 × 393

915 × 412

932 × 430

740 × 360

并进行至少：

iOS Safari

Android Chrome

Desktop Chrome

Desktop Safari / Edge

基础验证。

---

## 6.5.17 Acceptance Criteria

Phase 6.5 只有满足以下条件才能完成：

Desktop Mouse Camera Drag 正常。

Desktop Keyboard Movement 正常。

Desktop Mouse Aim 正常。

Touch Camera Drag 正常。

Touch Movement 正常。

Touch Aim 正常。

Aim 不会误触 Camera。

Movement Button 不会拖 Camera。

UI 不会被 Notch 遮挡。

Portrait 显示 Rotate Overlay。

Landscape 自动恢复。

Safari 页面不会因为游戏 Drag 而滚动。

Projectile Follow 期间无法误操作 Camera。

Camera Shortcut 能快速查看双方。

Resize / Rotate 后 Pointer Coordinate 正确。

Trajectory Physics 不因不同屏幕比例改变。

npm run typecheck PASS。

npm run test PASS。

npm run build PASS。

完成后：

在至少一个真实手机或 DevTools Mobile Simulation 中完整执行：

移动

↓

查看敌方

↓

回到自己

↓

Aim

↓

Fire

↓

Projectile Follow

这一整套 Flow。

然后停止。

不要开始 Phase 7。
----

# Phase 7 — Explosion & Damage

实现：

ExplosionSystem

DamageSystem

DamageResult

## Radius

<= 60：

2 Damage

60 ～ 140：

1 Damage

> 140：

0 Damage

Player：

10 HP。

## Feedback

Placeholder 即可：

- [ ] Explosion Circle
- [ ] Camera Shake
- [ ] Damage Number
- [ ] Character Flash
- [ ] HP HUD Animation

注意：

Projectile 不直接执行：

player.hp -= damage

必须：

ExplosionEvent

↓

DamageSystem

↓

DamageResult

↓

GameState

---

# Phase 8 — Turn Manager

实现完整回合：

START

ACTION

RETURN_HOME

AIM

PROJECTILE

RESOLVE

END

## START

- Reset move budget
- Reset hasFired

## ACTION

允许：

Move

Free Camera

Aim

## AIM

Aim Control。

## PROJECTILE

禁止：

Movement

Free Camera

Second Fire

## RESOLVE

Damage

Result

Game Over Check

## END

Switch Player。

Camera：

TURN_TRANSITION

移动到新玩家。

随后：

ACTION。

## Test

- [ ] Turn increments
- [ ] Current Player switches
- [ ] Move resets
- [ ] Fire once only
- [ ] Dead player triggers game over

---

# Phase 9 — Full Local 2P Prototype

暂时两个玩家都使用同一电脑。

P1 Turn：

Human

P2 Turn：

Human

确保：

完整 Battle Loop 可以从：

P1

↓

P2

↓

P1

一直运行。

这一步是重要 Gameplay Review Gate。

在这里调整：

- Gravity
- Launch Speed
- Camera Speed
- Explosion Radius
- Damage
- Movement Distance

直到弹道“有手感”。

不要在这一阶段加入 AI。

---

# Phase 10 — Single Player AI

实现：

AIController

TrajectorySolver

AIInputSource

AI 必须产生：

GameCommand。

禁止直接控制 Scene。

## AI Flow

Turn Start

↓

Evaluate Position

↓

Optional MoveCommand

↓

Calculate Shot

↓

Apply Error

↓

FireCommand

## Normal AI

Angle：

optimal + ±8°

Power：

optimal × random(0.88, 1.12)

Random 使用：

SeededRandom。

## AI UX

模拟思考：

500～900ms

避免瞬间开炮。

---

# Phase 11 — Menu & Game Modes

实现：

MainMenuScene

提供：

单机游戏

本地双人

联机游戏

当前：

Single Player

Local 2P

必须可用。

Online 可以显示：

Coming Soon

---

# Phase 12 — WebRTC Transport

实现独立：

NetworkTransport interface

WebRTCTransport

LocalLoopbackTransport

NetworkManager

禁止让 Game Logic import WebRTC。

架构：

Game\
↓\
NetworkManager\
↓\
NetworkTransport\
↓\
WebRTCTransport

---

# Phase 13 — Manual P2P Connection

第一版不用 Signaling Server。

Host：

Create P2P Game

↓

Create Offer

↓

显示 Connection Code

Guest：

Paste Offer

↓

Create Answer

↓

显示 Answer Code

Host：

Paste Answer

↓

Connected

显示：

CONNECTED

PING

HOST / GUEST

---

# Phase 14 — P2P Commands

同步：

PLAYER_READY

GAME_START

MOVE

FIRE

TURN_RESULT

TURN_END

REMATCH

DISCONNECT

Host：

authoritative。

Guest：

input client。

Guest FIRE：

Guest

↓

FIRE_REQUEST

↓

Host validates

↓

Host FIRE

↓

Broadcast FIRE

两边播放。

最终：

Host 计算：

TURN_RESULT

并广播 Snapshot。

---

# Phase 15 — Desync Protection

每个 TurnResult 包含：

stateHash。

Hash 至少覆盖：

turnId

currentPlayer

P1 position

P2 position

P1 HP

P2 HP

active items

Guest：

计算 state hash。

如果不同：

发送：

STATE_SYNC_REQUEST

Host：

返回：

STATE_SNAPSHOT。

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
