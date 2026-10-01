# 程序启动加载图（2026-10-01）

## 美术交付

- 方式：内置 image_gen 生成新插画，以现有海港与主菜单为风格和角色参考。
- 游戏素材：`public/assets/art/loading-harbor.jpg`，1672 × 941，JPEG 85，约 757 KiB。
- 生成原图保留在 Codex generated_images 中；游戏仅引用仓库内素材。
- 图片不含文字和界面；标题使用现有 logo，进度由程序绘制。

## 完整提示词

```text
Use case: stylized-concept
Asset type: new landscape 16:9 startup loading illustration for the browser game Ricochet Rivals, polished production artwork.
Primary request: Create a beautiful exciting harbor duel illustration consistent with the existing game.
Input images: Image 1 is a reference for the harbor environment and painted pixel-art treatment. Image 2 is a reference for the exact two playable characters and the game's brass/steel visual identity; do not reproduce its buttons, logo, or menu layout.
Scene/backdrop: A fantastical maritime harbor with blue ocean, distant rocky arches, steampunk cranes and wooden docks, luminous cream clouds, warm late afternoon sunlight.
Subject: The existing blue-team boy with brown hair, blue cap, brass goggles and blue outfit, and the existing red-team girl with red hair, red cap, brass goggles and red outfit, each carrying their oversized brass-and-steel hand cannon. Maintain their recognizable chibi proportions and character details. They face each other across the harbor from opposite docks, with a playful, adventurous rivalry. A graceful glowing projectile trail arcs across the water.
Style/medium: Premium hand-painted pixel-inspired 2D game key art, crisp deliberately shaped pixel clusters and sculpted warm highlights, richly detailed environment, clean readable silhouettes, no photorealism.
Composition/framing: Wide 16:9 full illustration. Blue character on left middle foreground, red character on right middle foreground; both fully legible and grounded on docks. Keep the upper center sky comparatively calm and open for a separately overlaid existing game logo. Keep the bottom central water comparatively uncluttered for a separately overlaid loading progress bar. Layered depth and cinematic composition without excessive clutter.
Lighting/mood: Bright adventurous atmosphere, golden sunlight on brass and dock edges, luminous turquoise water, cool deep navy shadows.
Constraints: This is a new illustration, use references for style and identity only. No text, letters, logo, menu buttons, progress bars, borders, watermark, or interface elements in the image. Do not add other characters. Do not render UI screenshots.
```

## 接入与验证

- HTML 在程序模块下载前显示插画、现有 Logo 和金属进度板；主图预加载，高优先级请求。
- BootScene 使用 Phaser loader 的真实完成比例。MainMenu 完成创建并首次 POST_RENDER 后立即移除加载层，不设置强制等待；第一次进入菜单跳过黑色淡入，之后返回菜单保留原淡入。
- 手机横屏铺满画面；竖屏显示完整双角色插画，使用同图暗色模糊背景和上下渐隐衔接。文字与进度避开安全区。
- 插画缺失仍显示背景与进度；Logo 缺失显示文字标题。图片不作为启动完成的等待条件。
- loader 的进度监听在 Boot shutdown 时解绑；待执行的退场监听在 MainMenu shutdown 时取消，游戏销毁时清理 DOM。
- 类型检查与生产构建通过，788 项单测 / 66 文件通过；4 项新生命周期测试覆盖真实进度、首帧、取消和幂等清理。
- `npm run e2e:loading`：59/59，真实 Chrome 截住程序代码与游戏素材，验证提前首屏、真实进度、菜单交接、暖缓存、缺图、缺 Logo、竖屏旋转、入场与确认退出后不再出现加载层。覆盖 1280×720、844×390、568×320、390×844 @ DPR 1/2；在生产 `/Ricochet-Rivals/` 子路径执行。
- `npm run e2e:settings`：74/74，声音保存、关闭设置后键盘恢复、退出确认及再次开局通过。
- 已检查实际浏览器手机横屏/竖屏截图；独立 test-reviewer 无 P0/P1/P2/P3。手机同 Wi-Fi 开发地址与新素材 HTTP 200。
- 手机使用 Chrome 触控模拟，iPhone 真机加载观感仍需试玩；本轮不更改联机协议或对局状态，不表示 main/Pages 已发布本改动。
