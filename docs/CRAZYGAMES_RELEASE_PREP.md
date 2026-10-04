# CrazyGames 发布准备

核对日期：2026-10-04。准备分支：`codex/crazygames-release-prep`，基线为 `main` 的 `d44421899c8cc6b940d71affd8873c70cef5d462`（0.2.3）。本轮完成分支与发布差距梳理，尚未创建平台提交、上传包或接入SDK；本文件不代表已通过CrazyGames审核。

## 目标与路径

先准备 Basic Launch 候选版本，保持单人三档难度、本地双人、房间码联机及现有道具玩法。当前没有需要大量玩家才能启动的匹配模式；按[官方联机要求](https://docs.crazygames.com/requirements/multiplayer/)，含单人内容且不依赖大量测试玩家的联机游戏一般先走 Basic Launch，最终由平台QA决定。

Basic Launch 的SDK是可选项、变现关闭；入选 Full Launch 后再完成SDK、广告及适用的账号/联机集成。依据：[发布流程与要求](https://docs.crazygames.com/requirements/intro/)。Basic阶段不为发布新增付费基础设施；公网信令与现有STUN配置先沿用，真实跨网可用性单独验证。

## 当前差距

| 项目 | 当前证据 | 准备动作 |
| --- | --- | --- |
| 独立构建 | `vite.config.ts` 的生产base固定为 `/Ricochet-Rivals/`；现有Pages构建不可直接当平台上传包 | 增加平台构建目标，使用相对base、根目录index.html及独立输出目录，验证随机嵌套路径 |
| 资源体积 | 当前已有dist为76文件、64,931,907字节（64.93 MB / 61.92 MiB）；public为74文件、63,206,186字节 | 打包排除无运行引用的历史素材，保留全部实际图像、DOM设置素材和声音署名；再做不改变像素几何的压缩 |
| 启动加载 | BootScene一次加载29张基础图、10张瞄准姿态图和18项音频；57文件合计47,138,356字节 | 该数字不包含JS、HTML启动图和设置DOM素材，不能当首包实测；统计冷缓存网络传输和到首次可操作战斗的时间 |
| 英文支持 | 难度标题/说明、瞄准、道具、回合、旋转提示等存在中文运行文案 | 建立英文默认文案，保留中文；图片内文字同样检查，保证英文完整而非只翻译主菜单 |
| 全屏按钮 | MainMenuScene在fullscreenEnabled时创建自有全屏按钮 | 平台构建隐藏自有全屏入口，使用CrazyGames提供的全屏；原Pages入口仍可保留 |
| 生产联机地址 | resolveSignalingUrl未配置env时回退 `ws://127.0.0.1:8787`；Pages工作流才注入公网地址 | 平台构建明确注入 `VITE_SIGNALING_URL=wss://ricochet-rivals.onrender.com`，校验HTTPS页面无本地WS或混合内容 |
| SDK | 未发现CrazyGames接入 | 先完成无SDK的Basic体积评估；若接SDK，使用v3异步init和真实Gameplay start事件，不能在主菜单假报开始 |
| iframe与浏览器 | 现有回归覆盖本机Chrome多种触屏尺寸及本机双端WebRTC | 增加平台iframe、DPR1桌面、Chrome/Edge/Safari、手机真机、切后台与声音恢复验证 |
| 商店素材 | 有游戏Logo、启动插画和美术生成记录；没有本次平台要求的完整封面/视频交付记录 | 三种封面、横竖预览视频、英文描述和操作说明，附资源出处与许可记录 |
| 平台预览 | 本轮未进入Developer Portal或CrazyGames Preview | 候选包准备好后在平台实际Preview验收，再提交审核 |

体积为本地已有产物的原始文件统计，不是ZIP大小、网络压缩量或CrazyGames实际首包测量；本轮未重新运行构建或游戏回归。上轮0.2.3证据见[V0.2 QA](V0.2_QA.md)，不能替代平台验收。

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
- [ ] 平台构建、英文实现、瘦身、SDK、封面/视频与真实平台验收。
- [ ] 实际Developer Portal上传及提交审核。
