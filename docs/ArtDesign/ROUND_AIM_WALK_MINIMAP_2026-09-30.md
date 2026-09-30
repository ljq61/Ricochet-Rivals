# 圆形瞄准、红方交替步态与小地图扩展（2026-09-30）

本轮根据手机试玩反馈，替换瞄准按钮两态图片和红方行走序列，并增加炮弹标记、当前视野的白色描边框。

## 落地效果

- 瞄准图采用简化持枪 Q 版角色，保留右上触摸起点、跨过身体向左下的箭头与手指。手机圆形图标从 84 缩到 64 CSS px，命中区也为圆形；灰色为待机，彩色为激活，激活态附小取消符号。红方将整张图片镜像。桌面按钮内圆形图为 60 CSS px。
- 红方重新制作 8 个完整步态关键帧：接触、承重、经过、前摆，然后左右腿交换完成另一半周期。第 2 帧是远腿经过，第 6 帧是近腿在前景经过，避免同一只脚重复摆动。根据真实位移播放，红方 240 世界像素完成周期，最高速度下约 0.75 秒；停下回闲置，左右行走翻转，瞄准继续使用原抬枪序列。蓝方保留原素材与 96px 周期。
- 小地图保留双方基地、人物与当前行动方，新增金色飞行炮弹点和白色相机视野框。视野框在相机预渲染完成后读取真实 `worldView`，拖动、缩放、旋转及追弹均使用同帧范围。
- 炮弹点读取现有 ProjectileSystem 飞行状态，命中、销毁、快照恢复后随状态清除。联机沿用现有 FIRE 广播与双端模拟，不增加消息或改变权威结算。
- 高抛炮弹超出地图世界高度时，标记钳在地图上边缘；视野框表示当前视野与地图世界范围的交集。

## 资源与裁切

使用内置 `image_gen` 生成或编辑，参考 `concept_UI.png` 和 `red-chibi.png`。两张圆形图为 1254×1254，红方序列为 1774×887，均为 RGBA；游戏加载 `public/assets/art/` 内文件。

| 素材 | 有效裁切或切帧 |
| --- | --- |
| `aim-gesture-ready.png` | x=46, y=50, w=1162, h=1154 |
| `aim-gesture-active.png` | x=46, y=54, w=1160, h=1148 |
| `red-walk-v3.png` | 4 列 × 2 行，列宽 443；行范围 0–443、443–887（右端不包含） |

BootScene 按上述透明行缝裁切，未修改 PNG 像素。红方可见高度按 427px 固定缩放，每帧足底锚点为 `[437,438,441,436,425,425,426,425]`。持枪位置横向锚点为 `[220,211,228,237,223,227,226,238]/443`，镜像时同步镜像锚点，减少整个人和枪的左右抖动。

16 帧尝试被用户指出缺少左右脚交替，已弃用，未提交或推送；切帧与播放测试通过不等于步态正确。后续 8 帧稿经单格修正，重点核对近远腿的遮挡关系及两次经过相。最终走路原文件 `exec-04da5005-9ed4-4547-8945-ac471a2ab5d9.png`；彩色图 `exec-7ba86b2f-e66e-43fe-ad12-9f282fc962a8.png`；灰色图 `exec-4cbadc08-2d88-4cdd-b107-1b34999cd993.png`。原图保存在本聊天 Codex generated_images。旧 `red-walk-v2.png` 保留但不再预加载。第 6 帧采用较明显的 Q 版抬膝，后续可进一步精制为更小幅度的自然步态。

## 提示词

### 彩色激活瞄准图

```text
Use case: stylized-concept. ONE round circular AIM instruction icon, active colored state, intended 64 CSS pixels. Reference Ricochet Rivals concept_UI. Perfect circle, thin brass/dark steel beveled rim, tiny rivets, dark teal inset, transparent outside. VERY simple two-head-tall character: olive cap, tan face with two eyes, orange jacket, dark trousers and boots; chunky brass/olive gun pointing UP RIGHT. Three or four broad readable color masses, no tiny accessories or hair detail. White finger pictogram at LOWER LEFT, white touch ring at UPPER RIGHT, cream diagonal arrow from UPPER RIGHT across the body to LOWER LEFT, with large down-left arrowhead and short dotted route. Tiny cancel X in upper-left inset. Colorful active state. No square, black silhouette, text, multiple icons, background scene or other characters. Runtime red team mirrors the whole icon horizontally.
```

### 灰色待机瞄准图

```text
Use case: precise-object-edit. Edit the supplied colorful round aim icon into its inactive READY GRAY state. Keep exactly the same circle, simple character with visible face, hat, gun pointing UP RIGHT, upper-right to lower-left gesture and arrow. Neutral grayscale ALL artwork: silver steel rim, charcoal inset, gray hat/jacket/gun, pale face, white gesture. No color anywhere, not washed out or translucent. Remove the upper-left cancel X and fill with matching inset. Character must not become a black silhouette. Preserve all other positions, proportions and transparent exterior. No text, square outline or additional icons.
```

### 弃用的 16 帧初稿

```text
Use case: stylized-concept. Production transparent walking sprite atlas for the supplied red-haired two-head-tall Ricochet Rivals mechanic. Same red hair, goggles, olive/brown outfit, boots and chunky gun. Exactly 16 consecutive walk poses in 4 columns by 4 rows, read left to right then top to bottom. Face RIGHT in every frame, fixed character scale, stable head/torso/gun, alternating left/right leg stride with contact, passing and lift phases. Entire character inside its own cell, x10–90%, y8–92%, planted sole at 90% cell height. Clear transparent gutters, no letters, numbers, grid lines, shadows, background or extra characters. Do not clip hair, gun or boots.
```

### 弃稿留白修复

```text
Use case: precise-object-edit. Production GRID REPAIR of the supplied 16-frame transparent atlas. Keep 4 columns, 4 rows and all 16 poses. Shrink ALL characters uniformly to 75% of current size with fixed scale; each cell content must remain within x12–88%, y10–88%. Planted sole at 88% cell height, body center at 50%. Restore cropped hair tips. Preserve identity, costume and gun facing RIGHT, stabilize head/torso/gun, retain smooth consecutive alternating stride. No letters, grid, shadow or opaque gutters. Do not enlarge characters.
```

### 最终 8 帧步态及定点修订

按下列顺序使用内置 image_gen，编辑结果继续作为下一次参考；每次检查近远腿身份，而非仅检查脚尖移动。

```text
Use case: stylized-concept. Production TRUE WALK CYCLE, exactly8 consecutive animation poses in4columns2rows on a wide transparent canvas. Reference red-chibi only for identity/outfit/gun, not its static legs. All characters faceRIGHT, same scale and hip center, steady upper body/gun. Near leg light, far leg dark. Frame0 near leg forward heel contact, far leg behind toe contact;1 near supports while far lifts behind;2 far bends and passes under hip while near supports;3 far reaches forward while near trails;4 far forward heel contact and near behind toe;5 far supports while near lifts;6 near bends and passes inFRONT of far support leg;7 near reaches forward while far trails. Frame7 loops to0. The same two anatomic legs alternate, not eight variations of one forward boot. No text/grid/shadow/ground, clear transparent gutters.
```

```text
Use case: precise-object-edit. Preserve8heads/torsos/guns/grid, correct lower legs. Track one continuous near leg and one far leg across all8cells. Frame0 near bootRIGHT grounded/far bootLEFT on toe;1 near supports/far lifts;2 near supports/far passes under hip;3 near trailsLEFT/far reachesRIGHT;4 opposite of0, near trailsLEFT/far landsRIGHT;5 far supports/near liftsLEFT;6 far supports/near passes;7 far trails/near reachesRIGHT. Fix cell4 forward far heel on the shared baseline, rear near toe touches with heel raised. Keep legs separate and consistent, no mirroring torso or swapping gun direction.
```

```text
Use case: precise-object-edit. Remove bright red round knee pads from all8sprites, replacing with consistent brown/olive trousers. Change only leg poses in column3 of both rows to genuine PASSING: one boot grounded below hip, other boot tucked close to pelvis with bent knee and visibly offground. Top row: near leg supports, far bends and passes; bottom row: far supports, near bends and passes IN FRONT. Leave remaining6 poses, bodies, guns and transparent layout unchanged. No forward kick or wide separation in passing cells.
```

```text
Use case: precise-object-edit. Edit ONLY ROW2 COLUMN3, bottom-row third character. Keep other7sprites and this character's upperbody unchanged. Reverse support and swinging legs in this one cell. FAR DARK leg straight weight-bearing, DARK boot flat beneath pelvis. NEAR BRIGHT brown leg bent and lifted, passing visibly IN FRONT of dark supporting shin. Raised bright boot RIGHT and ABOVE planted dark ankle, partially covering dark shin. Bright thigh/knee/shin/boot on TOP, not behind. Opposite of top-row third sprite where dark leg lifts behind bright support leg. No lifted dark boot behind body on screenLEFT. Planted dark boot x52% baseliney97%; raised bright boot x61% y84%, toesRIGHT. Preserve8frames and true transparency, no labels/grid.
```

## 验证与预览

- 最终 57 文件、663 单测通过，类型检查与构建通过。
- 完整 E2E 194 passed / 0 failed，包含真实 WebRTC 双端的炮弹标记显示、结算清除、回合同步、恢复与再战。浏览器隐藏页可能停渲染，显示检查逐页切到前台，不要求不可见页面持续绘图。
- 最终素材上重跑美术专项：64px 圆形中心实际点击、透明角不触发、灰/彩切换与双阵营镜像，移动超过 1000px、炮弹点的世界投影、相机真实 worldView 框、命中/落海/结算/Online 入口与 180px 高极矮屏均通过。
- 最终动画专项按每个真实渲染帧观察，桌面与手机尺寸均出现完整红方 8 帧，覆盖两次不同腿的经过相、左右朝向与停下回闲置。重复截图会停顿观察并漏帧，因此改为渲染帧观察与连续游戏录像。大小火、章鱼升起及恢复清理回归通过。
- 步态与代码分别独立复核，无 P0/P1/P2；第 6 帧较夸张的抬膝保留为 P3 精制项。

预览：[灰色待机](previews/round-aim-mobile-ready.png)、[红方彩色激活](previews/round-aim-mobile-red-active.png)、[炮弹与白色视野框](previews/minimap-shell-view.png)、[红方行走](previews/red-walk-v3-mobile.png)、[实际左右行走录像](previews/red-walk-v3-mobile.webm)。

手机画面采用 Chrome 触控与 DPR 模拟，真实手机及 Safari 仍需试玩确认。本地手机试玩服务为 `http://192.168.71.34:5173/`，需与电脑同 Wi-Fi，横屏打开；地址随电脑局域网 IP 变化。
