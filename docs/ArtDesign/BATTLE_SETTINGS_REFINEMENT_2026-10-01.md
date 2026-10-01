# 战斗设置材质统一（2026-10-01）

设置入口和弹窗原先使用光滑圆角卡片及扁平齿轮，与主菜单、移动按钮和头像框的手绘金属素材不一致。本轮改为同组黄铜、深色钢板、青绿珐琅和铆钉细节。

## 素材与实现

- 新齿轮：[`public/assets/art/settings-gear.png`](../../public/assets/art/settings-gear.png)。以内置 `image_gen` 编辑既有 `move-arrow.png`，保留外围钢框、黄铜环和磨损，只把中央箭头换成齿轮。生成原图保留在 Codex 的 `generated_images` 目录，游戏只引用仓库文件。
- 交付为 256×256 RGBA，约 117 KiB；不透明有效边界为 x=11、y=15、w=234、h=228。标准缩小处理保留透明通道，48 CSS px 触控区域内显示约 44×43 px 实际图形。
- 设置与确认窗口共用既有 `portrait-frame.png` 金属边框；角落切片保持独立尺寸，边轨重复铺贴避免铆钉拉伸，底部标识使用独立钢色铭牌，深蓝内衬填充中央区域。
- 标题、继续游戏、确定返回复用主菜单 `button-gold.png`，文字使用相同的深墨色 `#151c22`；其余操作使用 `button-steel.png`。
- 声音开关增加喇叭符号和金属滑槽，开启/关闭文字与滑块位置同时表达状态。
- 素材地址使用 `import.meta.env.BASE_URL`，兼容开发根路径和 GitHub Pages `/Ricochet-Rivals/` 子路径。
- 保持原设置状态、声音持久化、二次确认、输入拦截、键盘焦点及联机退出清理；动作目标至少 48 CSS px，小屏可在弹窗内滚动。

## 最终生成提示词

模式：内置工具编辑；参照/编辑对象为 `public/assets/art/move-arrow.png`，`transparent_background=true`。

```text
Use case: precise-object-edit. Asset type: transparent game UI settings button sprite for Ricochet Rivals. Edit target: the supplied existing circular movement-button sprite. Replace ONLY the large central right-pointing arrow with a chunky, immediately readable six-to-eight-toothed golden brass gear/cog symbol with a dark circular hub hole. Keep the original front-facing circular composition, thick segmented worn dark steel outer frame, golden brass inset ring, four large golden rivets, teal-blue enamel background, scratches and rust, crisp blocky pixel-painted illustrated game style and light from upper left. The central cog must be large (approximately half the button diameter), bold and clearly legible at 48px display size. Match the same scale, steel/brass materials, contrast, and pixel edge rendering as the supplied sprite, so it looks like a sibling button in the same game. Preserve actual transparent alpha outside the circular button, keep all outer metal details intact. No text, no lettering, no arrows, no additional objects, no flat vector icon, no smooth modern app gradients, no drop shadow beyond the sprite bounds. Square tightly framed sprite with a thin transparent margin.
```

## 验证

- 客户端 784 单测 / 65 文件、类型检查与构建通过。
- 设置浏览器回归 74 项：844×390 DPR 2、568×320 DPR 2、1280×720 DPR 1，覆盖声音、焦点、遮罩、取消/确认退出和再次入场。
- 真实 WebRTC 双端设置回归 33 项通过，含对方回合继续运行和双方分别退出。
- 独立审查补查模拟安全区和 568×260 / 568×240：触摸滚动可以访问下方动作；关闭后焦点恢复，所有引用素材可加载。
- 实际画面对照主菜单检查金/钢按钮材质、齿轮清晰度和确认状态；iPhone 实际触控、扬声器及 GPU 表现仍需真机试玩。

可重复运行：先 `npm run build`，再 `npm run e2e:settings` 和 `npm run e2e:settings-online`。
