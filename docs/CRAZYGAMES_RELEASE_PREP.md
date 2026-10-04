# CrazyGames 发布准备

核对日期：2026-10-04。准备分支：`codex/crazygames-release-prep`，基线为 `main` 的 `d44421899c8cc6b940d71affd8873c70cef5d462`（0.2.3）。当前开发包为 **0.2.4候选**，英文、相对路径构建、资源瘦身、平台全屏适配与上传ZIP已实现；尚未提交CrazyGames、合入main或创建v0.2.4标签。本文件不代表平台审核通过。

## 目标与路径

先准备 Basic Launch 候选版本，保持单人三档难度、本地双人、房间码联机及现有道具玩法。当前没有需要大量玩家才能启动的匹配模式；按[官方联机要求](https://docs.crazygames.com/requirements/multiplayer/)，含单人内容且不依赖大量测试玩家的联机游戏一般先走 Basic Launch，最终由平台QA决定。

Basic Launch 的SDK是可选项、变现关闭；入选 Full Launch 后再完成SDK、广告及适用的账号/联机集成。依据：[发布流程与要求](https://docs.crazygames.com/requirements/intro/)。Basic阶段不为发布新增付费基础设施；公网信令与现有STUN配置先沿用，真实跨网可用性单独验证。

## 实现与剩余差距

| 项目 | 当前候选证据 | 剩余工作 |
| --- | --- | --- |
| 独立构建 | `npm run build:crazygames` 使用 `./` base、优化资源目录、`dist-crazygames` 输出；ZIP根入口为index.html | 真平台嵌入/托管验收 |
| 资源体积 | 源运行资源48,034,960字节→10,655,687字节（减少77.82%）；完整包63文件/12,383,595字节，ZIP11,007,048字节 | 平台实际下载测量与移动网络体验 |
| 启动加载 | 本机Chrome冷缓存到菜单约878～1080ms，仅本地HTTP，不是平台/移动网络首包或进入战斗时间 | 实际Preview/慢网/手机性能测量 |
| 英文 | 平台默认英文；难度、瞄准、道具、回合、设置、退出、旋转和连接提示已覆盖；`?lang=en/zh`覆盖，Pages默认中文 | 平台玩家理解度试玩，后续SDK locale对接 |
| 全屏 | 平台模式隐藏自有按钮，iframe允许fullscreen时仍不显示；Pages入口保留 | 真平台全屏/浏览器工具栏变化 |
| 生产联机 | `.env.crazygames`明确公网WSS；游戏规则、权威、协议与hash未改变 | HTTPS平台房间码及真实跨网验收；当前本机双端测试不替代公网 |
| SDK | Basic候选无SDK/无广告；符合SDK可选路径 | Full阶段生命周期、广告/好友集成 |
| 浏览器与手机 | 解压实际ZIP、随机嵌套iframe、DPR1桌面、手机触控；优化包完整道具/双端回归 | Edge、Safari、真机、4GB Chromebook、高刷新率与后台恢复 |
| 商店素材 | 英文描述/操作草稿；源美术与音效出处保留 | 三种封面、横竖视频及实际商店资料 |
| 平台预览 | 本地候选包与清单可复核 | Developer Portal Preview及正式提交 |

初始基线dist为76文件/64,931,907字节，public为74文件/63,206,186字节。以上原始文件大小不是ZIP、网络压缩量或平台首包测量；旧轮次证据见[V0.2 QA](V0.2_QA.md)。

## 构建与资源管理

```bash
# Node 20+；需 cwebp、zip、unzip。macOS: brew install webp
npm ci
npm run build:crazygames
npm run preview:crazygames
npm run e2e:crazygames
RR_CRAZYGAMES_ITEMS=1 npm run e2e:crazygames
# 原Pages构建继续使用原始PNG/JPEG、项目base与中文
npm run build
```

- 上传候选：`artifacts/ricochet-rivals-crazygames-0.2.4.zip`。构建清单：`artifacts/crazygames-build-report.json`（每文件字节/SHA256及ZIP哈希）。这些生成文件、优化缓存与报告不进Git，干净checkout由同一脚本重建。
- 当前ZIP SHA256：`60c62dda9cb803796fc7ead9c283c990e93b2e227e9b6a9959457673532334ae`，对应JS `assets/index-KrUdVG5c.js`。ZIP文件时间不同可能使重新构建的ZIP哈希变化，交付时核对当次清单。
- `RuntimeAssets.ts`统一列出41张图、18个音效、声音出处与SVG。优化目录只包含运行资源；历史美术保留在public，避免丢失源资产。DOM设置与HTML启动图同样包含。
- WebP采用q90、alpha100，保持原始尺寸，不裁图或缩图，保证图集帧、动画、锚点和物理几何一致。全部41张图已逐像素比较透明通道：0差异，尺寸0差异；Chrome实际解码尺寸同样通过。深蓝底合成比较最低PSNR29.59dB，最大RGB平均绝对误差5.17/255；已检查人物、飞机、按钮和道具图集观感。
- 音效、音效许可出处、503字节SVG原样复制并校验哈希。新SVG仅用于浏览器标识；既有CSS/Phaser图形继续用矢量，生成的角色、场景和机械按钮保留画风。
- 编码器版本、图像质量、源SHA256和输出SHA256共同控制缓存；缓存运行约0.43秒。过期文件清理已验证。打包前检查清单一致、源/输出哈希、根入口/路径、文件数/总量与ZIP完整性，拒绝过期或额外文件。
- 此轮优化下载/存储体积；图像解码RGBA仍约265,035,272字节，没有降低纹理内存。真机性能验收继续保留。

## 当前验证（2026-10-04）

Browser插件未提供，按frontend-testing-debugging技能优先使用仓库已有Puppeteer。环境为本机Chrome 154.0.8037.95、Node20.20.2；浏览器为headless，不能替代真机听感或真实网络。独立review只读进行，无未关闭P0/P1/P2。

| 检查 | 结果与边界 |
| --- | --- |
| 客户端单测 | 1079/1079，84文件 |
| 信令 | 类型检查、43/43；初次沙箱回环EPERM，允许本地回环后重跑通过 |
| 构建 | 客户端类型检查、Pages与CrazyGames两目标通过；保留Phaser现有大chunk提示 |
| 原Pages完整浏览器 | 289/289；单人难度、本地/联机、恢复与再战 |
| 上传ZIP/iframe | 72/72；解压实际ZIP，在 `/upload/random-session/index.html` 中测试，不依赖Vite路径兜底 |
| 优化ZIP游戏回归 | 380/380；7组手机安全区/双阵营、五道具、制导/空袭音频、真实WebRTC双端权威与晚演出；其中基地按钮HUD253项 |
| 独立复审 | 105项相关单测、类型检查、61资源源/缓存/dist哈希、41图实际解码、ZIP完整性；3种手机尺寸实际触控通过 |

iframe测试覆盖821×462、907×510、1216×684（DPR1），844×390和568×240（DPR2触屏）；独立复审补667×320、844×390 DPR3。页面身份、非空菜单/战斗、无框架错误覆盖层、无runtime/console/resource错误、截图与实际输入都通过。交互为单人→普通难度→战斗→触屏移动→展开3格→回血→设置/声音→取消退出→确认返回；完整道具专项另覆盖火力/范围/制导/空袭、AI控件隐藏、基地随镜头离屏且旧位置无效、双方状态一致与恢复。

截图/临时测试结果在系统临时目录，未混入上传包。568×240设置面板底部按钮需要滚动，滚动后48px按钮可点击，属于既有短屏表现（P3）。真实CrazyGames Preview、手机Safari、实际音频输出/性能、跨网与后台恢复仍待人工验收。

## 官方门槛与工程验收

[技术要求](https://docs.crazygames.com/requirements/technical/)：

- 初始下载不超过50 MB；申请手机首页资格时不超过20 MB。
- 未接SDK时，总文件大小用于上述判断，不能只计算Boot加载清单。接SDK时，以首次进入可玩状态的Gameplay start测量首包；菜单阶段不算可玩状态。
- 接SDK后的总文件大小上限250 MB，文件数不超过1500；当前文件数不是问题，体积需要处理。
- 包内资源引用须为相对路径；Chrome与Edge应可用，Safari和4 GB RAM Chromebook兼容需实测。

[玩法要求](https://docs.crazygames.com/requirements/gameplay/)：

- 必须有英文；多语言接SDK时依据locale，缺失时回退英文。
- 平台自动提供全屏，自有全屏按钮禁止；检查DPR1的文字可读性和高刷新率物理一致性。
- Full Launch应直接进入可玩状态，特殊情况最多一次点击。现有“单人→难度→进入”是未来Full准备差距；Basic阶段保留难度选择，后续设计默认普通难度的快速开始。

[SDK v3](https://docs.crazygames.com/sdk/intro/)与[Game模块](https://docs.crazygames.com/sdk/game/)：若本阶段接入，init须等待完成；Gameplay start/stop跟随真正进入战斗、返回菜单、终局以及实际暂停/恢复。现有设置弹窗会拦截玩家操作，但AI/联机对手继续，不能直接把“设置打开”视为整个对局暂停。SDK异常或disabled环境保持可玩；SDK状态不进入比赛确定性状态和网络哈希。

[联机要求](https://docs.crazygames.com/requirements/multiplayer/)：Full/Friends阶段再实现updateRoom、邀请参数/链接、instant multiplayer、平台昵称及同组再战。现有房间码/再战属于可复用基础，尚不能称平台好友集成完成。任何相关接入需分别验证Host权威、Guest请求、重复/迟到事件、恢复和清理。

## 实施顺序

1. **英文基础与平台配置**：覆盖完整进局→瞄准→道具→终局→再战文案；平台全屏入口、构建base和生产WS地址隔离。保留0.2.3玩法及现有手机触控布局。
2. **构建与资源清理**：独立输出并生成上传候选包；按实际引用清理历史素材，检查设置DOM资源不被误删。以不超过50 MB为Basic硬门槛，目标首包不超过20 MB。
3. **必要SDK生命周期**：在英文与可运行包稳定后决定是否提前接v3；若接入，验证init/disabled/失败、事件顺序与真实开始时机。Basic无广告；Full再做广告中断、声音、输入及网络时钟的恢复。
4. **平台QA**：本地随机嵌套路径iframe→Chrome/Edge→Safari/手机真机→平台Preview；覆盖音频解锁/恢复、resize/全屏、安全区、电脑控件隐藏、基地箭头/背包、5种道具、章鱼、终局与再战。联机另外跑本机双端和记录网络条件的真机跨网。
5. **商店材料与审核包**：封面/视频、英文描述与操作、支持设备/横屏、2人房间、来源/署名记录；保留构建SHA、文件清单、字节大小、冷启动测量和平台Preview证据，然后提交审核。

每个实现批次按仓库AGENTS执行开发检索门禁、相关单测/类型检查/构建、浏览器交互与独立复审。准备分支的提交先推到同名开发分支，满足验收后再决定合入发布分支；不把本清单当成已完成的平台功能。

## 商店材料规格与文案草稿

[官方封面/视频规范](https://docs.crazygames.com/requirements/game-covers/)要求三张封面：1920×1080横版、800×1200竖版、800×800方版；视觉一致，只保留游戏名，使用有权使用的素材。预览视频提供1080p横版16:9与竖版2:3，15～20秒、每个不超过50 MB、无声音，封面作为开头，避免黑边、鼠标指针和推广文字。新图按项目偏好参照概念美术生图，保留完整提示词与出处；现有音频许可见[声音署名](../public/assets/sfx/SOURCES.md)。

英文描述草稿：

> Ricochet Rivals is a turn-based artillery duel set in a colorful harbor. Aim your shots across the sea, collect parachute supply crates, and use healing, damage boosts, wider blasts, homing shots, or airstrikes to outsmart your opponent. Practice against three AI difficulty levels, share a device for a local duel, or challenge a friend online. Watch out for the sea monster between the bases!

操作说明草稿（最终需对照英文候选构建实际复验）：

- Desktop: move with A/D or the arrow keys. Select Aim, drag in the opposite direction of your shot, then release to fire. Press Esc or right-click to cancel aiming.
- Mobile: use the arrows beside your base to move. Tap Aim, drag to set your shot, and release to fire. Tap the backpack to open your items.
- Items: shoot through supply crates to collect items. Carry up to three and use one item per action turn. An airstrike leaves your normal shot available.
- Online: create a room and share its code, or join with your friend's code. A room supports two players.

这些草稿不是战役模式、账号云存档或自动匹配的宣传；仅描述当前对战功能。Basic指标参考[官方指标指南](https://docs.crazygames.com/resources/basic-launch-metrics/)；先改善加载速度、操作引导和再战，再根据实际试玩决定战役与长期成长内容。

## 本轮完成记录

- [x] 基于最新main/0.2.3创建CrazyGames准备分支。
- [x] 核对官方发布、技术、玩法、SDK、联机和商店素材要求。
- [x] 记录本地字节体积、路径、英文、全屏、联机地址和平台验证差距。
- [x] 给出实施顺序与英文商店描述/操作草稿。
- [x] 平台构建、英文实现、相对路径、WebP瘦身、平台全屏与ZIP候选。
- [x] 单测、双目标构建、上传ZIP/iframe及完整浏览器/道具/双端回归、独立复审。
- [x] Basic选无SDK/无广告路径；Full集成后续处理。
- [ ] 封面/视频、真实设备、平台Preview与实际平台验收。
- [ ] 实际Developer Portal上传及提交审核。
