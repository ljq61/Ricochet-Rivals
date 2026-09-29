# Phase 17 首屏样片资产

2026-09-29。使用内置 `image_gen` 制作，原始生成 PNG 已复制进 `public/assets/art/`，运行时不依赖 Codex 私有目录。没有裁切概念图或引入外部下载素材。以下是当前可运行样片，不是全部 A 批次或完整 Phase 17。

| 文件 | 实际尺寸 | 用途 | 制作方式 |
| --- | --- | --- | --- |
| `harbor.png` | 1672 × 941 | 菜单背景、战场远景 | 内置 image_gen，新生成、不透明 |
| `blue-chibi.png` | 1254 × 1254 | 蓝队二头身角色、菜单装饰 | 内置 image_gen 编辑，真实透明 |
| `red-chibi.png` | 1254 × 1254 | 红队二头身角色、菜单装饰 | 内置 image_gen 编辑，真实透明 |
| `harbor-tower.png` | 1254 × 1254 | 塔楼装饰（基地素材缺失时的回退） | 内置 image_gen，新生成、真实透明；右侧镜像复用 |
| `normal-projectile.png` | 1254 × 1254 | NORMAL 投射物视觉，运行时显示 165 × 165 世界像素（内容可见宽 ~60） | 内置 image_gen，新生成、真实透明；中心旋转轴 |
| `explosion-impact.png` | 1254 × 1254 | 命中爆炸视觉，运行时按伤害半径放大 | 内置 image_gen，新生成、真实透明；中心锚点 |
| `blue-aim15/30/45/60/75.png` | 1024 × 1024 | 蓝方抬枪姿态序列（锚点见下文） | 全能日辉，参考 blue-chibi 生成，真实透明 |
| `red-aim15/30/45/60/75.png` | 1024 × 1024 | 红方抬枪姿态序列（锚点见下文） | 全能日辉，参考 red-chibi 生成，真实透明 |
| `aim-ready.png` | 2048 × 2048 | 触屏瞄准按钮：待命态（金色准星金属盘） | seedream + 原生分割，参考 projectile 调性 |
| `aim-active.png` | 2048 × 2048 | 触屏瞄准按钮：激活态（红热准星 + 中心上膛炮弹 + 呼吸脉冲） | seedream + 原生分割 |
| `base-blue.png` | 2048 × 2048 | 蓝方基地（concept01 §05 废铁要塞，甲板贴画布底 → 锚点 0.99） | seedream + 原生分割，参考 concept01 整图 |
| `base-red.png` | 2048 × 2048 | 红方基地（concept01 §05 工坊，甲板下支柱区 → 锚点 0.86 宁沉勿浮） | seedream + 原生分割，参考 concept01 整图 |
| `avatar-blue.png` / `avatar-red.png` | 1024 × 1024 | HUD 头像（concept_UI 玩家卡；框与角签程序绘制） | 全能日辉，参考 chibi 生成，真实透明 |
| `logo.png` | 1328 × 496 | 主菜单标题（拼写多模态校验通过；O 为准星造型） | 全能日辉，参考 concept_UI，真实透明 |
| `button-gold.png` / `button-steel.png` | 4096 × 1024 | 菜单按钮 9-slice 无字底板（金=主操作 / 钢=次要；切片比例 x15%/y25%） | seedream + 原生分割，参考 concept_UI |

六张 PNG 共约 7.1 MiB。当前保留生成原图作为可追溯制作源；未做纹理压缩与图集打包，也没有分层绘画工程。来源为本次 AI 生成记录。

角色按透明通道实测校正脚底锚点：蓝队 top/bottom=`136/1229`，红队=`65/1228`。战斗画布以 180 世界像素高对齐显示，碰撞体为 120 × 180，发射原点为脚底上方 64px。动作仍复用原有移动起伏和受击闪烁，尚无逐帧动画。

远景按原图比例放大到至少 1800 世界像素高，底边贴世界底部，顶部延伸到 `y=-720`；按当前 5000 世界像素宽度铺两片相邻镜像，覆盖炮弹上升时的额外视野。天空和岛屿目前在同一张远景图内，未实现独立视差层。地面与旗帜使用 Phaser Graphics；塔楼为纯装饰，不增加碰撞。金属按钮皮肤由程序绘制，保留 InputRouter 热区。

与概念图的主要差距：暂无独立红队基地、角色头像 HUD、像素 Logo、丰富场景杂物、专用弹体动画序列；当前已接入单帧 NORMAL 弹体和爆炸视觉，角色动作仍是静态姿态。下一轮优先补基地细节、逐帧角色动画和爆炸序列。

## 验证记录

- `npm run test`：41 文件、484 项通过。
- `npm run build`：通过（包含 TypeScript 检查）；Vite 仍提示 Phaser 主包大于 500 kB。
- 资源导入：BootScene 统一预加载 6 张 PNG；Projectile 使用 `normal-projectile.png`，命中使用 `explosion-impact.png`，缺资源时保留 Graphics 回退。
- 首轮完整 `npm run e2e`（Q 版改动前基线）：130 passed / 0 failed，含单机、本地、触屏、WebRTC、同步恢复、再战和断线。
- Q 版改动后的首轮完整 E2E：123 passed / 1 failed；唯一失败是 Guest Turn 4 等待相机回 `FREE_VIEW` 的转场时序超时，需在稳定预览环境复跑。
- 修复轮定位（cameraEventLog 实锤）：失败根因是 desync 恢复不清在飞本地模拟炮弹 —— 后台冻结的旧回模拟在回前台后迟发 impact 把相机打回 IMPACT 且无重试 → 永久滞留（真实用户后台化页面可中招）。修复 = 恢复入口 `clearInFlightSimulations`；修复 + 抬枪序列 + 返回 icon + 炮弹放大 + 7 音效后全量 E2E：130 passed / 0 failed。
- 完整 E2E 后的调整：手机菜单排版、角色脚底锚点、血条面板、调试面板显示开关、塔楼装饰；随后构建与截图复验通过，最终触屏 E2E 为 31 passed / 0 failed。
- Chrome / Puppeteer 桌面 1440 × 900 @1x、手机模拟 844 × 390 @2x：菜单 → 本地双人正常；画面非空，无 Vite 错误覆盖层，无 JavaScript pageerror。唯一 HTTP 404 为项目原有未提供的 `/favicon.ico`，首批六张美术资源均加载成功。
- 浏览器像素读取确认蓝 / 红角色透明区域分别为 1,096,169 / 1,068,061 像素。
- 自动化手机模拟不等同于真机验收；本轮未做真机、Safari、音效、全部屏幕尺寸或内存性能基准。

## 瞄准抬枪序列（2026-09-29 用户反馈修复轮）

10 张新姿态 PNG（1024 × 1024，真实透明）：以既有 `blue-chibi.png` / `red-chibi.png` 为参考图，由全能日辉模型（frontier_sunburst，MCP generate_image + 原生背景分离）按「Same character as the reference image … barrel raised at exactly {15/30/45/60/75} degrees … facing right … feet at the bottom」生成，蓝红各 5 个仰角。

| 文件 | 实测内容边界（top/bottom，画布 1024） | 接入 |
| --- | --- | --- |
| `blue-aim15/30/45/60/75.png` | 99/990 · 64/994 · 94/981 · 105/980 · 64/988 | `ArtAssets.AIM_POSE_BOUNDS.P1` |
| `red-aim15/30/45/60/75.png` | 70/980 · 51/980 · 81/978 · 106/971 · 13/1009 | `ArtAssets.AIM_POSE_BOUNDS.P2` |

- 边界由 `scripts/measure-art.mjs`（零依赖 PNG alpha bbox 测量）实测；bottom 为独占行号，与首屏角色锚点同口径（脚底锚点 = bottom/sourceHeight）。
- 运行时切换：`Player.setAimPose(elevationDeg | null)` 幂等换纹理（<7.5° 或 null 回 idle；姿态素材缺失回退 idle 不越级）；`BattleScene.updateAimPoseVisual` 每帧按 `aimState` 发射方向驱动仰角与朝向翻转。BootScene 追加预加载。
- 已知精度：75° 姿态实际枪口仰角约 60–65°（生成模型角度控制有限）；序列递进可读，后续素材批次统一重制时校正。
- 抽查方式：`scripts/visual-check.mjs` 截 45°/75°/15°向左三张瞄准帧 + 炮弹飞行帧，多模态复核（脚底贴地、翻转正确、尺寸可读）通过。

## 原始提示词

### harbor.png（transparent_background=false）

Create a production game background bitmap for Ricochet Rivals, a side-scrolling 2D artillery game. Wide 16:9 image. Detailed crisp pixel-art illustration, retro arcade craftsmanship: blue sky occupies upper 65%, towering warm cream and peach cumulus clouds, distant atmospheric blue island cliffs, abandoned industrial harbor cranes and tiny shipyards on islands along bottom third, calm deep blue sea along bottom 15%. Sunny warm afternoon, adventurous cheerful scrap-metal seaside world. Dark pixel outlines only on distant buildings, subtle atmospheric layering. Composition has quiet open blue sky at top center for menu title, distant island silhouettes towards left and right. No foreground platform, no characters, no projectiles, no UI, no lettering, no frames, no logos. Edge-to-edge art. This is a reusable distant background plate, not a screenshot or concept sheet. Match the prior concept images' high-detail pixel illustration look, warm clouds and blue sea.

### blue-idle.png（源提示词；当前运行时资产为 blue-chibi.png）

Production 2D side-view game character sprite, ONE blue-team young adult male mechanic artillery adventurer, cheerful determined face, brown hair, blue aviator cap with brass goggles, blue scarf, tan work jacket, navy trousers, brown oversized boots, compact olive grenade launcher held at waist pointing RIGHT. Full body exactly side-on facing right, relaxed ready idle pose, feet same horizontal baseline. Crisp detailed retro pixel art, visible square pixel clusters, dark outline, warm sunny highlights. Compact chunky proportions, head about one third of full height, readable silhouette. Isolated centered character, generous transparent margin, no shadow on ground, NO background, no ground, no text, no UI, no extra poses, no sheet. Real alpha transparency. Occupy roughly 75% of square canvas height with feet at 90% canvas height. Match warm industrial seaside arcade concept style.

### red-idle.png（源提示词；当前运行时资产为 red-chibi.png）

Production 2D side-view game sprite, ONE red-team young adult female mechanic artillery adventurer, cheerful determined face, bright red ponytail, brass aviator goggles on forehead, red scarf, tan work jacket, dark burgundy trousers, oversized brown boots, compact olive grenade launcher held at waist pointing RIGHT. Full body side-on facing right, relaxed idle ready stance, boots on same baseline. Detailed crisp retro arcade pixel art with visible square pixel clusters and dark outlines, warm sun highlights. Chunky proportions, head one third of total height, readable silhouette. Isolated centered full character with transparent margin, no ground shadow, NO background, NO ground, no text, no UI, no other poses. True alpha transparency. Occupy 75% of square canvas height with feet at 90%. Matching blue male aviator mechanic in same industrial seaside game.

### harbor-tower.png（transparent_background=true）

ONE isolated environment prop for a 2D side-view pixel-art artillery game: tall ramshackle abandoned seaside industrial watchtower and crane, weathered rusty steel scaffolding, brass pipes, blue corrugated metal panels, a tiny cabin, gears and hanging nautical chains, wood crates at base. Very detailed retro arcade pixel illustration with crisp square pixel clusters and dark outlines, warm afternoon light. Orthographic side elevation, full object visible, vertical composition within square transparent canvas. Structure occupies roughly 60% width and 85% height, feet on a flat horizontal base. No people, no weapons, no text, no UI, no ground plane, no landscape, no surrounding backdrop, genuine alpha transparency. Intended as a decorative foreground-layer prop at far edge of seaside game arena. Industrial whimsical adventure aesthetic matching the previously generated blue and red aviator mechanics.
