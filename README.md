# Ricochet Rivals

横版 2D 回合制弹道对战网页游戏。
Worms 式双方阵地对抗 + Angry Birds 式反方向拖拽瞄准发射。

当前进度（2026-10-01）：**Phase 0～16 完成；Phase 17 美术持续精修；Phase 18 代码侧加固已落地，真实设备 QA 待完成**。联机信令迁移 SG-0～8 的代码已完成，公网信令已部署并接入 GitHub Pages，支持房间码配对、对局期 ICE Restart、状态恢复与联机再战。

最新美术调整：圆形持枪角色瞄准按钮（两态内容均为彩色，待机银框带闪烁光晕、激活金框且光晕消失，红方镜像）、红方 8 帧左右脚交替走路，以及小地图炮弹标记和白色视野框，见 [本轮素材与验证记录](docs/ArtDesign/ROUND_AIM_WALK_MINIMAP_2026-09-30.md)。基地大小火各 8 帧，按血量分层布点；章鱼触角 16 帧卷曲，从海面下方升起，见 [动画制作与验证记录](docs/ArtDesign/ANIMATION_REFINEMENT.md)。此前的 [长支架与标题菜单](docs/ArtDesign/DOCK_MENU_REFINEMENT.md) 保持。独立视差层及走路以外的完整角色动作仍为后续精制项。

章鱼触手仍在任一方 HP ≤ 4 的回合结算时出现，血量为 **15 HP**，炮弹直击扣 2、溅射扣 1。击败时立即移除碰撞体，播放 **1.1 秒顶部向下消融与大颗粒光晕、拖尾碎屑**，同时播放怪兽吼叫；动画结束后才切换回合，本局不再出现。出现回合不计，之后满 5 个行动回合开始，每回合随机向一方发射一次激光：镜头先移到触手（0.45 秒），顶端粒子汇聚 0.5 秒、停顿 0.2 秒，再从朝向目标侧、偏离竖直向下 30° 的方向向基地扫射 0.8 秒，镜头跟随扫射。激光到达基地时播放爆炸声并显示扣 1 格血，完整演出结束后再切换回合或展示胜负。目标由比赛种子和回合号确定，联机由 Host 结算；快照恢复不重复播放旧攻击或死亡音效。

战斗设置美术与主菜单统一：齿轮使用与移动按钮配套的透明手绘钢铜素材，弹窗使用铆钉框、金/钢按钮底纹和机械声音滑槽，见[素材、生成提示词与验证记录](docs/ArtDesign/BATTLE_SETTINGS_REFINEMENT_2026-10-01.md)。

程序启动即显示新生成的海港双角色插画、现有标志和实际资源进度；主菜单首次渲染后收起，手机横竖屏适配。素材与完整提示词见[启动加载图记录](docs/ArtDesign/STARTUP_LOADING_2026-10-01.md)。

## 在线试玩与部署状态

- 游戏：[GitHub Pages](https://ljq61.github.io/Ricochet-Rivals/)。手机建议横屏，发布更新后刷新页面。
- 公网信令：`wss://ricochet-rivals.onrender.com`，Render Singapore 单实例。只交换房间、SDP 与 ICE 信息；对战数据走 WebRTC DataChannel。
- 联机流程：双方选择 **ONLINE** → 一方 **CREATE** 并分享 6 位房间码 → 另一方 **JOIN** 输入房间码 → 配对完成后双方进入对战。
- 等待好友加入时，切去微信分享后返回浏览器会恢复原房间码；恢复过程中保留 COPY 并显示 Reconnecting。尚未配对的房间按创建时的有效期保留（默认 10 分钟），重连不延期。完整刷新页面或服务重启后需重新创建。
- 配对成功后展示绿色 CONNECTED 卡片，网络质量使用信号格和实际对手往返延迟：低于 100ms 为绿、100～199ms 为黄、200～399ms 为橙、400ms 起为红；未测量或样本过期显示灰色。手机短横屏的进局/返回按钮并排，并避开安全区。
- 红方（P2）回合的瞄准按钮在左侧，蓝方（P1）在右侧。音效在首次触摸时解锁，失败保留后续手势重试，切回浏览器也尝试恢复；声音开关仍按用户设置生效。
- 战斗中点击 1P 头像下的齿轮打开设置，可切换并保存声音开关、继续游戏或返回主界面；返回前需再次确认。弹窗拦截本地操作，AI 和联机对方的回合继续运行；确认退出会关闭联机会话。
- **TURN 暂缓配置**（2026-09-30 用户决定）。coturn 临时凭据接口已实现，但当前公网仅下发 STUN，没有启用 Cloudflare TURN；部分严格 NAT / 跨运营商网络可能无法直连。
- Render 免费实例空闲后可能休眠，首次连接需等待唤醒；房间保存在内存中，服务重启后需重新创建。
- Pages 构建使用公网信令地址，仓库 Actions 变量 `VITE_SIGNALING_URL` 可覆盖；改地址后需重新发布。本地开发默认 `ws://127.0.0.1:8787`。详见 [信令服务配置](server/signaling/README.md)。

## 最近验证记录

2026-10-01 启动加载图：**788 单测 / 66 文件**、类型检查与构建通过；加载浏览器 **59/59**、设置回归 **74/74**。覆盖代码下载前首屏、待加载资源时真实进度、首次菜单绘制后退场、暖缓存、缺图/缺 Logo、横竖屏旋转，以及退出返回菜单不重新显示加载层。已检查浏览器截图和生产子路径，独立审查无剩余问题；iPhone 真机观感待试玩。专项命令 `npm run e2e:loading`，先 build。

2026-10-01 设置美术打磨：客户端 **784 单测 / 65 文件**、类型检查与构建通过；设置手机/小屏/桌面 **74/74**、真实 WebRTC 双端 **33/33**。对照主菜单检查素材与文字颜色，额外验证安全区、568×260 / 568×240 的弹窗滚动和 Pages 素材子路径；独立审查无剩余问题。新齿轮为内置生图素材，交付 256×256 透明 PNG 约117 KiB；声音、二次确认和联机清理行为保持。iPhone 真机观感及扬声器仍需试玩。

2026-10-01 战斗设置与确认退出：客户端 **784 单测 / 65 文件**、类型检查与构建通过；浏览器 **143/143**（设置手机/小屏/桌面74、真实 WebRTC 双端33、真实 Room 重连期间退出20、原单人/AI16）。覆盖声音保存、弹窗拦截操作、关闭后键盘恢复、取消/确认退出、对端回合继续和重新入场。新增场景生命周期回归，验证合法快照不打断重连、旧恢复续体不复活页面，以及退出优先于已排队的结算淡出。独立审查发现的焦点与恢复守卫问题均已修复；已检查手机截图，iPhone 真机触控及扬声器输出仍待试玩。专项命令为 `npm run e2e:settings`、`npm run e2e:settings-online`，先执行 build。

2026-10-01 章鱼15HP与视听加强：客户端 **777 单测 / 64 文件**、类型检查与构建通过；章鱼浏览器 **194/194**（手机66、真实 WebRTC 双端128）。消融改为84颗大碎屑、光晕/拖尾与三层明亮边缘；吼叫换为中频更强的新文件，平均音量约提高12dB、播放增益0.65→0.95，避免旧音频缓存。新增真实音频解码、RMS/增益链检查，以及激光基地端点单次爆炸声的双端/致死路径验证；15HP八次直击、静音、恢复与再战通过，独立审查无 P0/P1/P2。已检查手机画面，iPhone实际扬声器与帧率待试玩。联机双方需刷新到同版本。

2026-10-01 章鱼20HP与击败消融/吼叫：客户端 **776 单测 / 64 文件**、类型检查与构建通过；章鱼浏览器 **188/188**（手机66、真实 WebRTC 双端122）。覆盖十次实际直击扣完20HP、渐进消融、碰撞体立即移除、回合等待、真实解码音频缓冲单次播放、静音、快照恢复不重播、激光演出及再战重置。独立审查未发现 P0/P1/P2；已检查本地动画截图，iPhone 扬声器输出与观感仍需真机试玩。联机双方需刷新使用同版本；旧10HP客户端缓存不兼容新版初始状态。

2026-10-01 建房失败启动提醒：首次建房遇到信令连接或服务器错误时，用金色大字提示“房间服务器正在启动，请10秒后重试”，保留 TRY AGAIN；加入失败与已建房后的恢复失败保留原错误。**767 单测 / 64 文件**、类型检查与构建通过；浏览器 **131/131**（五尺寸失败/重试/恢复检查76、正常房间码联机55），独立审查无剩余 P0/P1/P2。已检查手机横竖屏及窄屏截图，iPhone 真机显示待验收。

2026-09-30 的完整发布回归：客户端 **663 单测 / 57 文件**、信令服务 **41 单测 / 5 文件**、类型检查与构建通过；完整浏览器 E2E **194/194**。后续公网信令接入验证：9 项公网协议检查、34 项真实 WebRTC 双端对战检查，以及已发布 Pages 的 5 项手机尺寸配对 / 进入对战检查通过。浏览器测试包含移动、开火、回合同步、状态恢复和再战。

手机尺寸验证使用 Chrome 模拟，不能替代两部真机的 Wi-Fi / 蜂窝网络、Safari、后台切换验收；公网 TURN relay 未验证。后续按 [设备 QA 清单](docs/PHASE18_DEVICE_QA.md) 执行。`TASKS.md` 保留各阶段历史测试基线。

2026-10-01 等待房间后台恢复修复：客户端 **683 单测 / 58 文件**、信令服务 **43 单测 / 5 文件**、两端类型检查与构建通过；房间码浏览器 E2E **49/49**。新增覆盖隐藏时 WS 关闭超过 grace、旧 OPEN 连接接管、好友先加入后 Host 返回，以及恢复中的再次后台切换；手机竖屏 COPY 按钮居中且完整位于视口内。原对局、ICE Restart、状态对账和再战回归通过。生命周期由 Chrome 模拟，iPhone Chrome 切微信仍需真机验收。

2026-10-01 瞄准布局、联机状态和首触音频修复：客户端 **694 单测 / 60 文件**、类型检查和构建通过；相关浏览器 E2E **158/158**（手机 55、桌面 48、房间码联机 55）。新增验证红方左侧按钮的实际瞄准/取消命中、首触恢复真实 AudioContext、首次发射创建运行中的音频缓冲，以及连接成功卡片在竖/横屏和不对称安全区的布局；独立审查通过。Chrome 模拟验证音频播放链，实际 iPhone 扬声器输出仍需设备验收。

2026-10-01 章鱼血量与终局激光：客户端 **758 单测 / 63 文件**、类型检查和构建通过；相关浏览器检查 **239/239**（章鱼手机 33、章鱼真实 WebRTC 双端 48、原手机 55、桌面 48、房间码联机 55）。覆盖五次直击击败触手、碰撞体移除、5 回合阈值与连续激光、0.5/0.6 秒动画、延迟显示扣血、结果去重、快照恢复、激光致死与再战重置；独立审查无剩余 P0/P1/P2。新增专项命令 `npm run e2e:octopus`、`npm run e2e:octopus-online`，均需先 build。手机表现使用 Chrome 模拟，真机验收仍待完成。

2026-10-01 激光演出顺序修正：客户端 **767 单测 / 64 文件**、类型检查和构建通过；相关浏览器检查 **226/226**（章鱼手机 57、章鱼真实 WebRTC 双端 114、原手机 55）。验证 0.45 秒镜头移动 → 0.5 秒顶端粒子汇聚 → 0.2 秒停顿 → 0.8 秒角度扫射、镜头跟随和基地终点、命中后显示扣血、双端等待整段演出、激光致死和快照取消。新增镜头回归覆盖旧拖拽接管与视口变化，独立审查无剩余 P0/P1/P2；已录制并检查本地演出，iPhone 真机观感仍待验收。

2026-10-01 瞄准按钮彩色银框与待机光晕：客户端 **767 单测 / 64 文件**、类型检查和构建通过；手机 E2E **59/59**、桌面 **48/48**，另有 **16/16** 本地画面与交互检查（844×390、740×360、1280×720）。覆盖待机光晕明暗变化、激活立即消失、取消恢复和原触摸操作；已检查两态截图，独立审查无 P0/P1/P2。按钮位置、命中区和联机状态逻辑保持；iPhone 真机观感仍待验收。

2026-10-01 联机按钮与返回按钮重设计：统一深海蓝嵌板、切角黄铜/钢框、铆钉和动作图标，覆盖主菜单 ONLINE 入口及联机页所有动作，返回保留 64 CSS px 命中区。常规按钮随可用宽度收缩，窄屏标题、说明和提示按实际文字高度留间距。**767 单测 / 64 文件**、类型检查与构建通过；浏览器 **151/151**（五尺寸按钮/输入/返回检查 48、真实房间码联机 55、桌面 48），包含成功状态、复制、安全区、恢复与再战；已检查前后画面，独立审查无 P0/P1/P2。仅既有 favicon 404，无游戏运行错误；iPhone 真机观感待试玩。

## 技术栈

- TypeScript (strict) + Vite
- Phaser 4.x + Matter Physics
- Vitest 客户端与独立信令服务测试 + puppeteer-core E2E（桌面、手机尺寸、单人、手动配对、在线对战及房间码 / ICE Restart 回归）
- WebRTC RTCDataChannel P2P 联机（Host 权威）+ Render 公网 WebSocket 信令；coturn TURN 临时凭据接口保留，公网 TURN 暂缓

## 开发

```bash
npm install --include=dev   # 本机 npm 全局 omit=dev，必须带 --include=dev

npm run dev        # 启动开发服务器
npm run typecheck  # tsc --noEmit（strict）
npm run test       # vitest run（788 项；不含信令服务器测试）
npm run build      # 类型检查 + 生产构建
npm run preview    # 预览构建产物
npm run e2e        # 全量 E2E（desktop / mobile / sp / online 配对 / online 对战 / online-room 房间码）
                   # 调试单场景：RR_E2E_ONLY=battle|online|online-room|sp|mobile|desktop npm run e2e

# 房间码联机模式需另起 Signaling Server（缺省 ws://127.0.0.1:8787）：
cd server/signaling
npm install --include=dev
npm run dev        # 信令服务器（tsx watch）；生产部署地址经根 VITE_SIGNALING_URL 构建变量注入
npm test           # 信令单测 + 真实 ws 集成（41 项）
npm run typecheck
```

## 游戏模式

- **Single Player**：P1 vs AI（三档难度：easy / normal / hard，seeded RNG，纯函数决策）
- **Local 2 Player**：热座双人（共用键鼠 / 触屏，回合切换横幅提示）
- **Online P2P**（房间码自动配对，SG-5 起默认流）：Host 点 CREATE → 展示 6 位房间码（31 字符表，剔除易混 0/O/1/I/L）→ 微信 / 口头发码 → Guest 输码 JOIN → WebSocket 信令服务器自动交换 SDP Offer/Answer 与 Trickle ICE candidate → 双方 VERIFIED 进局，用户全程不接触 SDP。真实 WebRTC DataChannel 直连；**Host = P1 = 权威**，Guest 为意图客户端（本地仅做表现播放，HP / 伤害 / 回合切换一律以 Host 广播为准）。**TURN 兜底接口（SG-6，当前暂未配置）**：配置 TURN 后，房间 ack 按需下发 coturn 时限 REST 凭据（HMAC-SHA1；secret 仅存环境变量，永不入库），严格 NAT 走中继；`DEBUG_FORCE_RELAY` 强制 relay 验证，Debug 句柄含候选类型 / selected pair route（DIRECT/RELAY）诊断。**失败分类（SG-7）**：ICE_FAILED / DATA_CHANNEL_FAILED / TURN_UNAVAILABLE → 简洁文案 + TRY AGAIN（输入保留），Debug 构建状态行附 `[REASON:CODE]` 后缀。**对局期断线恢复（SG-8）**：网络连接中断 → RECONNECTING… → 限次 ICE Restart（3×20s 窗，Host 发起 restart offer 经活信令交换、信令死则持 peerToken 原位重入）→ 恢复后自动走既有 Desync 快照对账继续对局；手机后台短暂切走可恢复；对端主动离场则立即 OPPONENT DISCONNECTED。手动 SDP 配对（Phase 13 流程及其真机复制优化）保留为 Debug 门控回退（`DEBUG_GAME && ?manual-sdp`，E2E 回归入口）。**Desync 防护（Phase 15）**：回合边界 stateHash 比对 → 偏差自动请求权威快照恢复（Host 永远权威）→ 对局继续；Turn Result ACK 同步屏障保证 Host 不超前 Guest；超时有限重试后安全终止。**Online Rematch（Phase 16）**：对局结束双方点 REMATCH → 复用同一 WebRTC 连接重新开局（握手同 Lobby，Host 每局全新 matchId + seed），等待对方期间显示 WAITING / OPPONENT READY；对端 Result 期离开 → OPPONENT LEFT 提示回菜单

## 玩法要点

- 5000 × 1080 超宽世界，左右两个基地；行动阶段可在己方基地内不限距离往返，一回合限一次发射
- 鼠标拖动 / 触屏拖动自由观察战场；顶部中央小地图显示双方基地、人物与飞行炮弹位置，白色描边表示当前视野；Space 或圆形持枪角色按钮「回到炮手 / 瞄准」（彩色银框待机带外侧闪烁光晕 / 彩色金框激活无光晕，350ms 相机回家 → 锁定）
- Angry Birds 式反向拖拽瞄准：拖线 + 力度条 + 12 点轨迹预览，松手发射；Esc / 右键 / 再点按钮取消
- 炮弹飞行相机自动平滑跟随，命中后爆炸点停留 850ms（抖动 + 伤害数字 + 受击闪烁）
- 伤害分层：距爆心 ≤60px 直伤 2 点，≤140px 溅射 1 点；10 HP 制，先清零对方获胜
- 回合状态机：START → ACTION → RETURN_HOME → AIM → PROJECTILE → RESOLVE → END → 下一回合
- 联机同步：只同步命令与权威快照（MOVE / FIRE 参数 + TURN_RESULT），**绝不逐帧同步炮弹坐标**；双方本地模拟弹道，结果以 Host `TURN_RESULT` 为准（stateHash v2 双端比对：位置归一化 0.01 精度防物理微差假报）；回合切换由 Host `TURN_END` 授权，且需 Guest `TURN_RESULT_ACK` 同步确认（Sync Barrier）；Guest 状态偏差 → `STATE_SYNC_REQUEST` → Host 权威快照恢复 → 对局继续（Phase 15）
- 断线处理：连接故障期间冻结输入并限次执行 ICE Restart，必要时重建信令并持 peerToken 重入；恢复后同步权威快照继续对局。对端主动离场或恢复失败时显示 OPPONENT DISCONNECTED 并允许返回菜单

## 平台

- Desktop：A / D 移动、鼠标瞄准 / 相机拖动、Space 瞄准、Esc / 右键取消
- Mobile Landscape（一等目标）：触屏方向按钮、拇指范围大热区瞄准（死区防误触）、Safe Area HUD、高 DPR 清晰渲染、竖屏门禁（连接流程除外）
- 输入能力（pointer/hover）决定控制档位，不用 User Agent 猜测；世界坐标与物理参数跨设备恒定

## 架构

命令驱动：Human / AI / Network 输入统一转 `GameCommand` → `CommandBus` → `GameLogic` → 系统层（单一 validate+execute 路径，Game Logic 不感知命令来源）。严格分层：GameLogic / Rendering / Input / AI / Network / Camera / UI 互不渗透；联机协议层与信令客户端（`src/game/network/online/` + `signaling/`）见 `docs/ARCHITECTURE.md` §6。

## 文档

- `CODELY.md` — 项目长期架构与开发约束（顶层规则）
- `docs/ARCHITECTURE.md` — 分层架构与关键决策（含联机协议、Phase 14 落地架构与房间码信令迁移）
- `server/signaling/README.md` — 信令服务器运行 / 房间语义 / coturn TURN 部署环境变量
- `docs/GAMEPLAY.md` — 玩法规则与参数表
- `docs/ArtDesign/ANIMATION_REFINEMENT.md` — 走路、大小火和触角动画制作与验证
- `docs/ArtDesign/ROUND_AIM_WALK_MINIMAP_2026-09-30.md` — 圆形瞄准、红方交替步态、小地图炮弹与视野框，以及最新验证记录
- `docs/ArtDesign/DOCK_MENU_REFINEMENT.md` — 长支架与标题菜单精修记录
- `TASKS.md` — Phase 开发计划与完成状态（Phase 0～18）
- `docs/横版回合制弹道对战网页游戏 V0.1 PRD.md` — 产品需求
- `docs/TASKS.md + Core TypeScript Contracts.md` — 原始规划草稿

## 目录

```
src/
  main.ts                 # 入口（组合根：OnlineSessionManager 注入 game.registry）
  game/
    config/               # GameConfig / DebugConfig / PhaserGameConfig / Palette
    state/                # 纯数据层（GameState 等，零 Phaser 依赖）
    commands/             # GameCommand（MOVE / FIRE / READY）+ CommandBus
    scenes/               # Boot / MainMenu / Battle / Result / OnlineConnection
    entities/             # Player / Projectile（视觉+Matter 实体）
    systems/              # WorldBuilder / Movement / Fire / Projectile / Damage /
                          # Explosion / TurnManager / GameLogic（含 onOutcome 广播源）
    physics/              # aimMath / TrajectoryCalculator / projectileRules（纯函数）
    input/                # InputRouter / KeyboardMoveInput / AimController / TouchControls
    camera/               # CameraMode 状态机 / aimFlow / CameraController
    ai/                   # AIController / TrajectorySolver / AIInputSource（Phase 10）
    match/                # GameMode / MatchSetup / MatchFactory（Phase 11）
    network/              # Transport 协议层（Phase 12）+ online/ 协调器（Phase 14）
                          #   + online/sync/ desync 检测与快照恢复（Phase 15）
                          #   + signaling/ 房间码协议 + WS 客户端（SG-1）；
                          #     RoomConnectionController 房间码自动配对（SG-3~5）
    platform/             # ViewportService / DeviceProfile / OrientationGate
    settings/             # UserSettings（localStorage）
    random/               # SeededRandom（Mulberry32）
    ui/                   # AimButton / AimRenderer / TurnBanner / PlayerHud / DebugOverlay
    utils/                # MathUtils
tests/                    # Vitest 纯逻辑测试（66 文件 788 项，含双端 loopback 集成、
                          #   Phase 15 desync 恢复全链与 Phase 16 Rematch 握手）
server/signaling/         # 自托管 WebSocket 信令服务器（SG-2：房间管理 + SDP/ICE 转发
                          #   + coturn REST 凭据下发；独立 workspace，41 项单测）
scripts/e2e.mjs           # E2E（desktop / mobile / sp / online 配对 / online 对战 / online-room 房间码）
```
