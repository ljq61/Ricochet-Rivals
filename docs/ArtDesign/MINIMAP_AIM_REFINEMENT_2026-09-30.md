# 瞄准剪影与顶部小地图（2026-09-30）

本轮修正上一版操作图描述，并用小地图替换底部“己方／敌方”快捷定位。

> 此页记录第一版效果；后续圆形双色图、红方交替步态、炮弹与视野标记见 [本轮更新](ROUND_AIM_WALK_MINIMAP_2026-09-30.md)。

## 当前效果

- 瞄准图片内的持枪角色改为纯黑剪影，枪口朝右上；浅色内板提供对比。触摸起点在身体右上，手指和箭头跨过身体滑向左下，箭头保留明确指向。
- 蓝方使用原方向；红方将整张按钮水平镜像，金色待机和红色取消两态都镜像。按钮命中区、瞄准流程和取消方式保持原逻辑。
- 手机、桌面都显示顶部中央的小地图：蓝红条带代表双方基地，人物标记显示实时位置，金色轮廓表示当前行动方。采用简洁绘制，不增加位图资源。
- 删除旧定位按钮的绘制、触控区域、回调和底部布局保留区。小地图为只读信息显示，点击不跳转镜头；仍可拖动场景和使用瞄准入口回到当前炮手。
- 地图每帧读取现有 GameState，移动、回合切换、联机快照恢复和再战都沿用现有状态；不发送新的联机消息、不改变移动及射击规则。

## 素材

内置 `image_gen` 编辑上轮金色按钮，再由本轮金色图生成红色态；两张已复制到 `public/assets/art/` 替换旧图片。原图均为 1254×1254 RGBA，保留透明背景。

| 文件 | 有效裁切 x/y/w/h |
| --- | --- |
| `aim-gesture-ready.png` | 48 / 57 / 1160 / 1143 |
| `aim-gesture-active.png` | 48 / 54 / 1160 / 1147 |

原图文件名分别为 `exec-5c41bed8-7cfc-497e-93c2-d7a991902279.png` 和 `exec-bfb7b14e-8d1f-4f4e-8dfa-ea49183c886e.png`，保存在当前聊天 Codex `generated_images` 中。游戏加载仓库内文件。

## 预览与验证

- [蓝方与顶部小地图](previews/minimap-mobile-blue.png)
- [红方镜像取消态](previews/minimap-mobile-red-aim.png)

最终单测 55 文件、652 项通过，类型检查及构建通过；布局与文字定向测试 37 项通过。完整浏览器 E2E：190 passed / 0 failed，覆盖触控、旧定位按钮移除、地图实时位置与当前行动方、红方镜像、只读地图点击，以及双端 WebRTC、快照恢复和再战。

美术专项验证左右移动累计超过 1000px 后地图标记同步、金/红按钮实际点击和双阵营镜像、命中/落海/结算与 Online 入口。独立复核补充极矮横屏的紧凑回合提示；最终修订后重新构建并运行含 320×180、844×180、320×240 的专项检查（正常尺寸入局后缩小视口），检查实际字体至少 10 CSS px、背景描边与地图/瞄准/移动热区不相交。手机画面为 Chrome 触控/DPR 模拟，真实手机与 Safari 观感、手感仍需确认。

## 提示词

### 金色图

```text
Use case: precise-object-edit. Asset type: Ricochet Rivals mobile aiming gesture instruction button, READY gold state. Edit the supplied badge. KEEP its square outline, brass/steel pixel-painted casing, rivets, true transparent outside, compact size and no text. REPLACE the colored character with ONE unmistakable SOLID BLACK silhouette of a two-head-tall chibi character holding a chunky gun aimed diagonally UP RIGHT, full body boots and gun legible. No face, no colored clothes, no details inside silhouette. Change inset to a light muted warm steel/sand tone so BLACK silhouette remains readable. Replace gesture with a clear white finger pictogram starting at UPPER RIGHT of the character body, and a thick cream arrow traveling DIAGONALLY DOWN LEFT ACROSS THE BODY to LOWER LEFT; large arrowhead POINTS DOWN LEFT at the lower-left endpoint, white fingertip/hand near this endpoint. One small white start touch-ring at upper-right near shoulder/gun, dotted diagonal route from UPPER RIGHT to LOWER LEFT, arrow crosses in FRONT of silhouette. Essential directional constraint: endpoint MUST be LEFT of the starting ring, arrow head must point southwest / bottom-left, NOT bottom-right or straight down. Keep figure separate readable as black silhouette beneath cream arrow; minimal bold diagram intended 84 CSS pixels. No letters/words/numbers, no multiple buttons, no scene, no other characters. True transparent exterior. The final badge will be horizontally mirrored for the red team in runtime.
```

### 红色图

```text
Use case: precise-object-edit. Edit target: the supplied gold square aim instruction badge. Create its ACTIVE / CANCEL variant. Keep EXACTLY this composition: solid BLACK full-body chibi holding gun pointing upper right, light sand inset for contrast, upper-right white touch ring and dotted diagonal route crossing body to lower-left, large cream arrowhead pointing DOWN LEFT, white finger hand at lower-left. Keep silhouette solid black without face or clothes. Preserve all positions, proportions, square metal border/rivets and transparent outside. Change only gold outer rim to warm RED copper metal/enamel with small brass highlights. Light beige/steel inset stays LIGHT to keep black silhouette readable. Add a small cream X in the empty upper-left inset, at most 10% badge width, not obscuring silhouette, route or hand. No text or letters, no colored character, no repositioned gesture, no down-right arrow. One single transparent-background badge, crisp pixel-painted edges, same framing/canvas as reference. Runtime will horizontally mirror for red team.
```
