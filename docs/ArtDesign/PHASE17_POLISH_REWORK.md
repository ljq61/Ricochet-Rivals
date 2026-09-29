# Phase 17 概念对齐与特效重制

2026-09-29。本轮针对 concept_UI / concept01 的实际游戏反馈，已导入以下资源并修改对应表现。不是整张概念图直接裁成游戏界面。

后续更新：本批短支架平台已由[长支架平台](DOCK_MENU_REFINEMENT.md)替换；以下为原批次制作记录。

## 新生成资源

制作工具：内置 imagegen；参考来自用户提供的概念图。保留原始输出，运行时注册 frame 去除透明边距，不修改生成原图。4 张 PNG 合计约 3.8 MiB（压缩文件大小，不是 GPU 内存）。不新增外部素材授权承诺。

| 文件（public/assets/art） | 画布 | 用途与锚点 |
| --- | --- | --- |
| aim-controls.png | 1774×887 | 两态图集。ready frame=(44,44,790,790)，cancel=(940,44,790,790)。手机 64 CSS px，桌面图标 46 CSS px；文字由代码绘制 |
| dock-platform.png | 2172×724 | deck frame=(25,263,2128,241)；顶部为站立线。战场宽 900 世界像素，覆盖移动区外各 75px；菜单复用 |
| portrait-frame.png | 1254×1254 | 78px 头像外框，内置头像 50px；外框透明中心，P1/P2 为真实文字 |
| smoke-puff.png | 1254×1254 | 世界空间烟尾及爆炸烟团；粒子数量与寿命有上限 |

原始输出目录：`/Users/jackie/.codex/generated_images/01a0eb4a-a5ec-7620-844d-3ec40897d9bf/`。

- aim-controls：`exec-80c14854-5774-48b2-bc80-a61009d1d614.png`
- dock-platform：`exec-09d58aed-0b2c-4b7c-a319-7ead09b721c5.png`
- portrait-frame：`exec-2d9a81ca-28e6-481d-86c4-084bf4ed2f9e.png`
- smoke-puff：`exec-931a0fa5-4a6c-48d1-93c6-47f23c83d804.png`

### 生成提示词

**aim-controls**（参考 concept_UI，transparent_background=true）

> Create a production game UI sprite sheet, exactly two circular buttons side by side in equal square cells, on true transparent background. Refined pixel-art industrial pirate harbor artillery game. LEFT: amber/gold enamel convex button face, chunky dark gunmetal rim, brushed gold bevel, four tiny steel rivets, centered bold ivory crosshair with dark outline. RIGHT: matching exact silhouette red vermilion enamel face, warm gold rim highlights, centered ivory curved return arrow (cancel aim), NOT a projectile, NOT fire action. Clean restrained detail, readable at 64px, premium hand painted pixel game UI, no text, no letters, no surrounding decoration or glow outside rim. Both circles same diameter, centered at 25% and 75% of canvas width, centers at 50% height; horizontal wide 2:1 canvas, each circle fills 88% of its square cell. Transparent outside circles. Use concept reference only for material style.

**dock-platform**（参考 concept01，transparent_background=true）

> Production 2D side-scrolling pixel art game asset: ONE isolated wide scrapyard harbor dock platform on true transparent background. Straight orthographic side elevation, absolutely horizontal walkable top, no perspective tilt. Width 4 times height. Entire platform occupies middle of canvas with generous transparent margin. Warm weathered timber top planks, thick rusted metal beam underneath, dark steel diagonal bracing, a few hanging ropes, bolts and barnacles, dark teal and warm gold rusty palette. Solid rectangular deck top is perfectly flat across whole width, nothing protrudes above walkable top. All supports beneath deck. Ends neatly capped. No buildings, no barrels on top, no characters, no sea, no background, no shadows outside object, no text. Refined dense hand-painted pixel illustration matching concept01 section05 industrial island base. Asset to support feet of characters at top deck line. Wide 3:1 output.

**portrait-frame**（参考 concept_UI，transparent_background=true）

> One production game HUD empty portrait frame. Square 1:1 true transparent PNG. Refined pixel-art pirate scrapyard industrial UI matching provided concept_UI. A thick square dark gunmetal outer frame with warm brass beveled inner trim, chipped paint, four silver rivets in corners, warm upper-left highlights. Large EMPTY TRANSPARENT square center occupying 76% width and 76% height, no character inside, no fill in center. Small dark steel nameplate attached along bottom edge with blank blue enamel stripe, no letters or text. Frame occupies 92% of canvas, centered. Sharp pixel edge clusters not blurred, readable at 64px, restrained texture, premium 2D hand painted metal not photorealism. No background, no glow, no drop shadow outside silhouette.

**smoke-puff**（无参考，transparent_background=true）

> ONE standalone round billowing smoke puff sprite for a 2D pixel-art artillery game particle system. True transparent background. Charcoal warm gray edges, softly lit pale warm gray center, clustered rounded lobes, chunky crisp pixel shading with 5 tones, not photorealistic, not blurry, no fire, no sparks, no ground, no text. Rough circular compact silhouette filling 80% canvas. Shape centered, isolated. Fits premium handpainted pixel pirate industrial harbor game. Transparency smoothly fades only at outermost few pixels.

## 接入与行为

- HUD：大头像、金属边框、蓝红铭牌、红色分段 HP。所有 HP 来自 PlayerState，350ms 过渡；消除世界相机 zoom 对 HUD 尺寸及定位的影响。
- 瞄准：金色准星进入瞄准，红色回转箭头取消。保留反向拖拽/松手发射。输入热区使用物理屏幕坐标，显示逆变换到相机坐标。
- 菜单：按 PLAYER_ART_BOUNDS 的脚底定位到独立码头。Logo 顶部不裁切，手机底部按钮不遮挡人物脚部。
- 场景：保留已有基地建筑，蓝/红甲板锚点分别约 0.88 / 0.765。移除整条钢板；两块码头可站立，海面无隐形地面。落海采用已有出界销毁/回合结束路径，不新增水面伤害。
- 镜头：跟随时限制下沿不露空画布；高空蓝色底层覆盖背景上方。原海港底图仍等比放大、两片镜像铺设。
- ProjectileEffects：火焰与烟尾按速度反向从喷口发出。火焰池上限 80、烟尾 50；停止后 700ms 销毁。爆炸包含 140ms 闪光、380ms 冲击环、按目标显示尺寸缩放的火团、28 火星、9 烟团；1200ms 清理。
- 角色：脚底锚定的呼吸、移动起伏、发射后坐力、70ms 受击表现停顿与弹性恢复；结算胜者轻摆、败者灰暗。不会暂停 Matter、网络或回合时钟。
- 场景皮肤：联机页使用压暗海港背景，结算复用人物和码头，复用已有 220ms 淡入淡出。连接码配对功能未变。

## 验证

- `npm run typecheck`：通过。
- `npm test`：42 文件，487 项通过。
- `npm run build`：通过；保留 Phaser 主包超过 500kB 的既有构建提示。
- `npm run e2e`：130 passed / 0 failed，覆盖自然完整对局、触屏、AI、真实 WebRTC、失步恢复与再战。此轮运行后仅继续修整菜单/视觉反馈，最终专项覆盖这些路径。
- `node scripts/art-acceptance.mjs`：桌面 1280×800 / 手机横屏 844×390 DPR2 均通过可见按钮中心点击、两态切换、发射、命中扣血 10→8、落海出界且 HP 不变、结算/菜单/联机页切换。无 pageerror。
- 截图：`scripts/art-acceptance-output/{desktop,mobile}-{menu,battle,aim-cancel,trail,explosion,red-base,result,online}.png`。结算专项使用 debug 降低 HP 加速截图，完整 E2E 的自然对局不注入 HP。

## 交付边界

本轮完成现有 Phase 17 juice 清单里的粒子、角色反馈、表现停顿与界面转场。角色使用程序动画配合现有静态/瞄准贴图，没有宣称已交付最初建议的完整逐帧 spritesheet。独立天空/远岛视差层也仍是后续精制资源；高空目前使用简化蓝色底层。真实手机性能、浏览器音频策略与用户视觉验收不能由桌面触屏模拟替代。
