# Phase 17 试玩反馈修订（2026-09-30）

本轮针对手机横屏试玩调整了角色行走、受损火焰、触手入水、移动操作、Online 页面和飞行音效。角色与联机规则均沿用原有状态和指令链，改动集中在素材与表现层。

| 项目 | 当前落地 |
| --- | --- |
| 红方行走 | 新增 `public/assets/art/red-walk-v2.png`，4×2 共 8 帧，统一头部、武器与服装轮廓，交替迈步；脚底锚点按上下两行分别校准。原 `red-walk.png` 保留为制作记录。 |
| 基地受损 | 小火 3 处、大火混合 5 处，缩小单团比例并把火根贴到建筑结构，烟雾分布改到建筑中上部。 |
| 触手入水 | 升起和碰撞逻辑保持不变；根部以局部暗色水影、断续泡沫和短波纹遮住直切边，不铺整条前景海面。 |
| 手机移动 | 左右实体金属按钮各 48 CSS px，按当前回合阵营着色，沿当前基地外侧的甲板下缘显示；相机平移时跟随基地投影，离屏时贴边保留操作，屏幕绘制与触控热区共用同一位置，并避开中央聚焦按钮。 |
| Online | 创建/加入页分离标题、说明、输入与按钮；房间码输入框收为 320×52 CSS px 上限，主操作按钮 56 CSS px，ENTER BATTLE 与 BACK TO MENU 留出 24 CSS px；短视口和非法房间码重试布局单独处理。 |
| 飞行音效 | 保留发射与命中音；取消飞行口哨的加载和播放，移除旧 `projectile.mp3`。 |

红方素材使用内置 `image_gen`，参考 `red-chibi.png` 与旧 `red-walk.png`。提示词要点：`EIGHT distinct coherent walk-cycle frames arranged in exactly 4 columns by 2 rows`；同一二头身红发角色始终面向右侧、双手持炮，头部/躯干/炮身保持一致，仅双腿、靴子与少量马尾跟随运动；每格等大、脚底统一基线、透明背景、无地面阴影和文字。生成原图位于 Codex 生成目录，运行时使用仓库内的 `red-walk-v2.png`。

验证：`npm test` 49 文件、575 项通过；`npm run build` 通过；`npm run e2e` 184 项通过，覆盖手机触控、双人自然对局、Online 房间配对、联机回合与恢复；`scripts/animation-acceptance.mjs` 与 `scripts/art-acceptance.mjs` 的桌面/手机画面检查通过，Online 额外检查了 320、360、390、520 CSS px 高度。截图可通过两条 acceptance 脚本在 `scripts/art-acceptance-output/` 重建（该目录不入库）。真实手机、Safari 的主观手感仍需下一轮真机复验。
