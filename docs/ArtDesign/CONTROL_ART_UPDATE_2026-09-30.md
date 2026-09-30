# Phase 17 图片操作按钮与基地内自由移动（2026-09-30）

按试玩反馈替换移动、瞄准操作图，调整红色头像朝向，并取消每回合累计移动距离限制。使用内置 `image_gen` 生成三张透明素材，风格参考 `concept_UI.png`；运行时直接加载仓库素材。

## 落地效果

- 手机左右移动采用同一张金属方向盘图片，左向镜像；位于当前基地平台两侧，随相机和基地投影变化，离屏时贴边。视觉高度为角色碰撞体投影高度的 82%，触控区域至少 48 CSS px。按下缩小、提亮，松手停止；避让 HUD、聚焦按钮、瞄准图及其文字。
- 瞄准图内有二头身角色举枪、右上起点、手指和向右下滑动的箭头。待机为金色，瞄准时为红色并带取消标志，点击红色按钮退出瞄准；桌面使用同组图片和文字提示。
- 红色 HUD 头像保留素材原本的左向姿态，与蓝色头像面对面。
- 行动阶段允许在己方基地范围内任意往返。移动速度、边界、当前回合归属、瞄准锁定、发射后锁定仍生效；AI 同样可选择整个基地内的位置。
- 联机沿用 Host 权威移动、限速、序号与回合校验。旧 `moveRemaining`/`maxMovePerTurn` 字段保留有限数值 `0` 兼容快照及协议，不使用 `Infinity`；距离消耗字段只记录实际路程。

## 素材与裁切

三张原图均为 1254×1254 RGBA。运行时按透明有效边界建立 `button` frame，避免透明留白影响大小与热区。

| 文件（`public/assets/art/`） | 有效边界 x/y/w/h | 用途 |
| --- | --- | --- |
| `move-arrow.png` | 55 / 76 / 1143 / 1113 | 右箭头；左箭头镜像 |
| `aim-gesture-ready.png` | 50 / 59 / 1154 / 1140 | 金色瞄准态 |
| `aim-gesture-active.png` | 49 / 57 / 1156 / 1142 | 红色取消态 |

旧 `aim-controls.png` 保留为历史素材，不再预加载。生成原图位于本聊天的 Codex `generated_images` 目录；交付素材均已复制到仓库，不依赖该目录。

## 验证

玩法测试覆盖同回合反复走完整个基地、累计路程超过旧限额、边界反向移动、AI 大于旧限额移动与从新位置发射。联机测试覆盖 0/100/200ms RTT 下超过 750px 往返、快照恢复后继续移动，以及 JSON 快照/重赛兼容。

布局测试覆盖 DPR 1/2、窄屏/矮屏、240/250/260 CSS px 高度和极端相机平移。浏览器美术专项覆盖按钮实际尺寸、长按左右累计超过 1000px、松手停止、瞄准/取消/射击、命中/落海/结算/Online 入口。

最终单元测试：53 文件、630 项通过；类型检查和构建通过。完整浏览器回归：188 passed / 0 failed，覆盖双人 WebRTC、恢复与再战；最终布局微调后重跑美术专项。独立复核的标签遮挡问题已修复。手机验证使用 Chrome 触控/DPR 模拟；真实手机与 Safari 手感仍需实机确认。

可通过 `npm run build` 后运行 `node scripts/art-acceptance.mjs` 重建专项截图。验收预览保存在 `previews/controls-mobile-blue.png`、`previews/controls-mobile-red.png`、`previews/controls-mobile-aim.png`。

## 生成提示词

### 移动图（参考 `concept_UI.png`；透明背景）

```text
Use case: stylized-concept. Asset type: production mobile game movement button, one single square isolated UI icon. Reference image is STYLE ONLY: Ricochet Rivals warm industrial harbor pixel-painted metal, chibi artillery game. Generate ONE solid round/octagonal steel-and-brass pushbutton with a very large clear cream RIGHT-POINTING arrow (only one arrow). Thick dark steel beveled casing, warm brass rim, 4 small rivets, distressed dark teal enamel center, crisp painted pixel-like edges, upper-left highlight, shallow compact shadow within silhouette, strong readability when displayed at 54 CSS pixels. Arrow occupies 60% of center. No letters, no text, no character, no scene, no glow outside, no extra icons, no paired buttons or sheet. Centered symmetric casing, full button fills 92% of square canvas with small even transparent margin. True transparent background. This one sprite will be mirrored for the left direction.
```

### 金色瞄准图（参考 `concept_UI.png`；透明背景）

```text
Use case: stylized-concept. Asset type: ONE single game aim/tutorial button icon, intended 84 CSS pixels. Reference is STYLE ONLY: Ricochet Rivals pixel-painted chibi industrial harbor, weathered brass and dark steel. Create one square rounded metal badge, thick dark steel bevel and warm golden brass border, very simple rich dark navy inset. Inside: on LEFT, a clear large TWO-HEAD-TALL chibi blue-capped goggle-wearing artillery character holding a chunky short cannon pointed diagonally up-right; full body recognizable, head/boots/gun bold shapes. On RIGHT of character body, show an unmistakable WHITE index-finger touch gesture pictogram plus a bright CREAM curved swipe arrow: begins near the character's UPPER RIGHT at shoulder/head level, sweeps downward along the RIGHT SIDE of the body, and ends at the LOWER RIGHT with a large DOWNWARD arrowhead. One small pale starting touch ring at upper right and index-finger hand at bottom right; dotted/short stroke connects start to hand, all on the right side of character; arrow must demonstrate a finger dragging from UPPER RIGHT to LOWER RIGHT (not up, not circular, not left). Leave clear separation between gun/character and gesture. Bold legible instructional composition occupying inset, no small decorative clutter. Brass READY state. No letters or words, no text or numbers, no scene, no other button, no mockup, no watermark. All artwork contained in badge, centered badge fills 92% of square canvas, small transparent margin. True transparent background.
```

### 红色取消图（编辑金色图；透明背景）

```text
Use case: precise-object-edit. Edit target is the supplied single Ricochet Rivals AIM tutorial badge. Create its ACTIVE/CANCEL state variant. Keep EXACTLY the same square dimensions, badge outline/corners/rivets, chibi character identity/pose/cannon, start touch ring at upper right, dotted trajectory, big arrow sweeping DOWN the RIGHT SIDE ending DOWNWARD at LOWER RIGHT, and finger at lower right; preserve spatial layout and transparent outside silhouette. Change only the gold outer rim to warm RED copper enamel with restrained brass highlights, change deep navy inset to rich dark burgundy, cream swipe arrow and touch hand stay clearly legible. Add a very small clean cream X/cancel mark in empty top-left inset ABOVE the character's cap, inside badge (at most 12% badge width), without covering character or gesture. Crisp painted pixel style, thick legible outlines. No text, no words, no new button or sheet. True transparent background, no outside shadow/glow. This is pressed aiming mode; it must look like the same original button with a distinct red active state.
```
