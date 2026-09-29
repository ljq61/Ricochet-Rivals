# Ricochet Rivals — Gameplay

玩法规则与参数速查。所有数值以 `src/game/config/GameConfig.ts` 为唯一实现来源，
本文档与之同步维护。

## 1. 核心循环

```
回合开始
  → 自由拖动 Camera 观察战场
  → 在己方阵地内移动炮手（消耗移动预算）
  → 点击「瞄准 / 回到炮手」→ Camera 返回己方炮手
  → 反方向拖拽瞄准（力度 + 角度）
  → 松手发射（每回合限一次）
  → Camera 跟随炮弹
  → 碰撞爆炸 → 按距离结算伤害
  → Camera 停留展示命中反馈
  → 切换对方回合
```

胜负：任一方 `HP <= 0` 立即结束比赛。

## 2. 世界与阵地

| 参数 | 值 |
| --- | --- |
| World | 5000 × 1080 |
| 地面顶 | y = 960 |
| P1（左）阵地 | x ∈ [100, 850] |
| P2（右）阵地 | x ∈ [4150, 4900] |
| P1 出生点 | x = 450 |
| P2 出生点 | x = 4550 |
| 中场 | x = 2500 |

角色只能水平移动，禁止跳跃 / 攀爬 / 垂直位移。

## 3. 回合规则

| 参数 | 值 |
| --- | --- |
| 初始 HP | 10 |
| 每回合移动预算 | 250 px |
| 发射次数 | 每回合 1 次 |
| 移动操作 | A / D 或 Left / Right（按住移动） |
| 移动速度 | 320 px/s（加速度 2400 px/s²，松开即停） |
| TurnPhase | START → ACTION → RETURN_HOME → AIM → PROJECTILE → RESOLVE → END → GAME_OVER |

移动按**实际移动距离**累计消耗（向右 100 再向左 40 = 消耗 140），
不是净位移。发射后本回合禁止移动、瞄准、再次攻击。

## 4. 瞄准（Angry Birds 式）

操作：按住炮手 → 向发射反方向拖拽 → 松手发射。

```
drag      = pointer - launcher
direction = -normalize(drag)
power     = clamp(|drag| / maxDrag, 0, 1)
speed     = lerp(minSpeed, maxSpeed, power)
velocity  = direction × speed
```

| 参数 | 值 |
| --- | --- |
| 最大拖拽 | 180 px（超出后力度保持 100%） |
| 最小发射力度 | 0.15（低于则松手静默取消，不发射） |
| 炮弹初速 | 550 ～ 2400 px/s（原建议 1400 的 45° 射程仅 1960px，打不到对面，2026-09-28 调参） |
| 发起判定 | AIMING 中点击炮手 220px 内开始拖拽；触屏另有 150 CSS px 起始热区 |
| 发射原点 | 炮塔：脚底上方 64px（`launcher.offsetY`） |
| 轨迹预览 | 12 个点 / 0.8 秒 / 渐小渐透明 / 不显示完整落点 |

轨迹预览必须与真实 Projectile 使用同一套重力与初速公式。
支持取消瞄准（回到 FREE_VIEW），尚未发射前可反复观察 → 瞄准。
瞄准 UI：拖拽线（力度染色）、力度条（绿→黄→红）、180px 拉伸范围虚线圈；
力度不足时轨迹点隐藏，提示"还不能发射"。发射后本回合锁定移动与再发射。

## 5. 投射物与爆炸

| 参数 | 值 |
| --- | --- |
| 武器 | 仅 NORMAL（V0.1） |
| 半径 | 16 px |
| 重力 | 1000 px/s² |
| 最大生命周期 | 8 s（超时原地爆炸） |
| 引信距离 | 离发射点 180 px 内不与玩家碰撞（适配 120 × 180 角色体型），激活后保持 |
| 爆炸半径 | 140 px |

状态机：SPAWN → FLYING → IMPACT → EXPLODING → DESTROYED。

爆炸条件：碰地面 / 碰角色 / 超过 8 秒（原地爆炸）；
掉出 World Bounds（左右越界 / 穿地兜底）：直接销毁，不爆炸。
弹道与瞄准预览使用同一套重力与初速（frictionAir=0，预览即真实前 0.8s）。
伤害结算见 §6（Phase 7 接入，投射物本身不改 HP）。当前玩家判定体为 120 × 180 px，脚底为坐标基准。

## 6. 伤害结算

| 爆炸点到玩家碰撞矩形最近边缘距离 | 伤害 |
| --- | --- |
| ≤ 60 px | 2 |
| 60 ～ 140 px | 1 |
| > 140 px | 0 |

结算链路（Projectile 不直接改 HP）：

```
Projectile impact → ExplosionEvent → DamageSystem.calculate()
→ DamageResult → GameState → UI / 动画响应
```

未来扩展（Shield / Poison / Critical / Armor）不改 Projectile。

## 7. Camera 状态机

| 模式 | 行为 |
| --- | --- |
| FREE_VIEW | 拖动画面观察全图；横向 clamp 在 World 内 |
| RETURN_HOME | Tween 回当前炮手（约 350ms），完成前不能瞄准 |
| AIMING | 锁定己方炮手附近，禁止拖动世界 |
| PROJECTILE_FOLLOW | 发射后指数平滑跟随炮弹（速率 10/s 不硬锁；垂直自由，可跟到世界上方天空） |
| IMPACT | 平滑贴向爆炸点（速率 16/s）并停留 850ms，随后结束本攻击 |
| TURN_TRANSITION | 平滑移动到下一位玩家，完成进入 FREE_VIEW |

交互（Phase 3/6 已实现）：

- 屏幕底部固定按钮「回到炮手 / 瞄准」，快捷键 `Space` 发起
- 发起后：FREE_VIEW → RETURN_HOME（350ms Tween）→ 自动进入 AIMING
- AIMING 中相机锁定己方炮手（移动时跟随），禁止拖动世界
- 取消：`Esc` 或鼠标右键 → 回到 FREE_VIEW
- 尚未发射前允许反复：观察 → 瞄准 → 取消 → 观察
- 发射瞬间自动进入 PROJECTILE_FOLLOW；命中/超时爆炸进入 IMPACT 停留 850ms；
  飞出世界边界则直接结束攻击（无停留）；攻击结束后回 FREE_VIEW 观察

## 8. AI（后续 Phase）

V0.1 目标「能正常陪玩家打完一局」：
估算基础弹道 → 叠加误差（Normal：角度 ±8°、力度 ±12%）→ 经 GameCommand 发射。
所有误差使用 SeededRandom（禁止 Math.random 参与 Gameplay）。

## 9. V0.1 明确不做

Account / Login / DB / 排行 / 匹配 / 商店 / 皮肤 / 角色选择 / 装备 / 技能树 /
地形破坏 / 天气 / 风 / 多武器 / Item Gameplay / 聊天 / 观战 / 赛季。
发现相关需求一律记录为 FUTURE，不自行实现。

## 10. 长期设计原则

游戏核心差异化是 **弹道决策（Trajectory Decision）**：
一个优秀回合应让玩家在「直接命中 / 吃道具 / 吃强化 / 打墙反弹 / 换位置」之间权衡。
后续所有机制围绕这一点强化，而非数值堆砌。
