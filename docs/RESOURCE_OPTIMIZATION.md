# 0.2.4 正式构建资源优化

日期：2026-10-04。从 `codex/crazygames-release-prep` 的 `f8e2138` 中仅提取资源清单、压缩脚本、资源加载路径与SVG标识。目标为main和dev_signaling_turn的正式Pages构建；中文、全屏、三档单人、道具、章鱼和Host权威联机行为保持原样，英文与CrazyGames平台构建留在准备分支。

## 范围与体积

| 内容 | 优化前 | 优化后 |
| --- | --- | --- |
| 实际运行资源 | 48,034,960字节 | 10,655,687字节，减少77.82% |
| 完整本地构建 | 64,931,907字节/76文件（0.2.3基线） | 12,381,787字节/63文件，减少约80.93% |
| 图像 | 41张PNG/JPEG | 41张WebP，尺寸不变 |
| 声音与其他 | 18音效、出处、SVG | 原样复制，SHA256一致 |

WebP q90、alpha100，不裁剪/缩放源图；角色、场景、机械按钮与动画保留生成的原美术。已核对本机41图的尺寸与透明通道逐像素一致，浏览器实际解码保持原尺寸。图集帧、碰撞、输入和相机几何均未改动。SVG仅为503字节的浏览器标识；原图仍在public，历史生成素材和提示词不删除。

减少的是下载/构建体积，图像解码RGBA约265 MB，纹理内存没有下降。表格为本地文件大小，不是ZIP、CDN传输量或手机首包测量；Linux编码器版本可能令最终线上字节略有差异，以Actions产物统计为准。

## 构建与路径

```bash
# Node 20+，另需cwebp（macOS: brew install webp；Ubuntu: apt-get install webp）
npm ci
npm run build
npm run preview
# 仅更新优化缓存
npm run assets:optimize
# dev使用原PNG/JPEG，不依赖cwebp
npm run dev
```

Ubuntu编码器使用[官方webp包](https://packages.ubuntu.com/en/noble/graphics/webp)。Pages工作流在构建前安装它；本地缺少编码器时明确失败，避免发布引用WebP但只含PNG的半成品。

- `RuntimeAssets.ts`从现有美术/声音清单列出全部61份资源，包含HTML启动图、DOM设置齿轮/边框/按钮以及声音出处。
- `asset-optimization.mjs`写入`.optimized-assets`，按编码器版本、q90、源/输出SHA256复用缓存并清除过期文件；`.asset-optimization-report.json`留在构建机，不进入dist或Git。
- Vite dev使用public；build/preview使用优化目录。`assetUrl`仅在PROD时切换WebP，保持Pages的`/Ricochet-Rivals/`前缀；HTML启动图片由构建插件转换，文案仍为中文。
- `validate-built-assets.mjs`核对当前清单、原始源和dist哈希，拒绝缺失/额外/陈旧资源、PNG/JPEG启动引用与非中文入口。上传dist只含实际资源、HTML与构建脚本。
- SfxBus保留原导出，纯声音清单移到SfxAssets供构建脚本读取；播放、循环、静音和音频解锁逻辑没有变化。

## 本批验证

Browser插件未提供，沿用frontend-testing-debugging技能和仓库Puppeteer。Chrome本机headless，手机为触屏/DPR/安全区模拟；真实iPhone/Safari、跨网和性能仍需真机验收。

- 客户端1075/1075单测（83文件）、类型检查、正式构建通过。
- 加载59/59：JavaScript前HTML、真实进度、横竖屏、缓存、WebP插画/Logo失败回退、菜单进战斗/返回通过。
- 设置74/74：手机/桌面、贴图、声音、退出确认、输入隔离和退场清理通过。
- 完整浏览器289/289；道具/七组手机安全区/真实双端380/380（含基地HUD253项），五道具与制导/空袭音频通过。
- 独立复审：类型检查、45项相关单测、61资源源/缓存/dist SHA、41图解码、dev原图/prod WebP、中文/原全屏/DOM设置通过；P2 Windows缓存路径分隔符已修复并重验，无未关闭P0/P1/P2。

## 发布核对（2026-10-04）

资源合入提交 `6f130e0cde1d8379b52df2e94dea2693efddddbb` 已同步推送到main和dev_signaling_turn；CrazyGames准备分支保持 `f8e2138`，没有合入平台功能。文档补记作为后续提交同步。

- [Pages工作流37207563674](https://github.com/ljq61/Ricochet-Rivals/actions/runs/37207563674) build/deploy均success，CI83测试文件通过；Linux编码运行资源10.67 MB，完整产物63文件/12.39 MB（与本机编码版本的微小差异）。
- 线上[正式游戏](https://ljq61.github.io/Ricochet-Rivals/)引用 `assets/index-FSCfxU0g.js`，与本地已验证脚本SHA256一致：`fa9f2d6f3ee9fab2822e8d0052d837edee8c57251c51e7d1b3ececf4b5beeca0`。
- 公网Chrome 844×390/DPR2触屏验证13/13：非空正确页面、无框架错误层、中文与原全屏、单人→普通→触屏移动→三格背包→回血保留正常射击→设置/声音/恢复通过。
- 41张图实际HTTP200、Content-Type为image/webp，没有PNG/JPEG下载、资源/console/runtime错误。截图和临时报告保留在本机系统临时目录；实际扬声器输出、Safari/真机和跨网体验仍是独立验收。

