# Phase 18 — 真机 QA 交接清单（V0.1 Release Hardening）

> Agent 侧已完成：基础设施审计（3 缺口全处置）、E2E 扩展至 145 项全绿（含 932×430@DPR3 / 双指 / pointercancel / 粒子预算）。
> 本清单 = 剩余真机验证项（Step 3-15）。按优先级 P0（iOS Safari）→ P0（Android Chrome）→ P1（Desktop Safari/Edge）顺序走。
> 环境：dev server `npm run dev:host`，手机访问 `http://192.168.71.58:5173/`（同 Wi-Fi）；桌面侧 Online 测试前 Chrome 需
> `--disable-features=WebRtcHideLocalIpsWithMdns` 冷启动。
> 反馈格式：项目 + 严重级（P0 不可玩 / P1 明显坏 / P2 小问题 / P3 打磨）+ 截图即可，其余交给 agent。

## A. iOS Safari（P0，iPhone 竖横全测）

- [ ] A1 冷启动进游戏：加载页 → 菜单，无白屏/错位/模糊（DPR3 字体与图标清晰）
- [ ] A2 竖屏打开菜单 → 点 ONLINE 进连接页 → 竖屏可用（textarea 可点、可长按粘贴、系统键盘正常、选择文本正常）
- [ ] A3 竖屏进 Battle（连接后不转屏）→ 显示「请旋转设备」覆盖层；转横屏 → 覆盖层消失、对局正常（不错位、不误开局）
- [ ] A4 触摸相机：FREE_VIEW 单指拖动顺滑、不越界、方向自然；快速连拖无残留；拖到一半切后台再回 → 不卡死
- [ ] A5 触摸移动：◀/▶ 按住走、松手停；快速左右切换、双指各按；瞄准中按钮隐藏；换回合不粘键
- [ ] A6 触摸瞄准（**P0 核心**）：15°/30°/45°/60°/75° 双方各打一遍——命中区够大（不用瞄准多次才中）、死区不误射、满力圈可辨、拖出屏幕松手不卡瞄准、取消/发射顺畅、无二次发射
- [ ] A7 弹道与相机：发射后跟随流畅、命中停留、爆炸反馈、转场顺滑；高抛越顶视角不露图外
- [ ] A8 安全区：刘海/灵动岛不遮 HUD（双方血条/头像）、Home Indicator 不遮移动钮/聚焦钮/瞄准钮；菜单四角按钮不压圆角
- [ ] A9 音频：**第一次点按钮后有声音**（菜单点击→进战斗发射：launch 音应响，不存在第一炮静音）；8 音效逐个确认（launch/projectile/explosion/hit/turn/victory/defeat/上弹）
- [ ] A10 后台/前台：分别在对局 FREE_VIEW / 瞄准中 / 炮弹飞行中 / 对手回合 切后台 5 秒再回——无输入卡死、无移动持续、无瞄准残留、联机不崩（允许短暂断线提示自愈）
- [ ] A11 性能：正常对局目测流畅；把一方打到 4 血以下（烟+火+章鱼+炮弹齐飞的最重场景）观察——持续掉帧/卡顿即 P1；DebugOverlay（如开）看 FPS ≥45
- [ ] A12 生命周期：Result → REMATCH 连续 5 次 → 无越来越卡/声音异常/画面残留；Battle→菜单→Battle 反复 3 次正常
- [ ] A13 触感汇总：整体操作是否跟手；明显难受的点直接记录
- [ ] A14 工具栏伸缩：对局中收起/展开 Safari 底部工具栏（visualViewport 变化）→ 布局即时自适应、HUD 不跳位不遮挡
- [ ] A15 全屏进出：菜单 FULLSCREEN 进入 → 布局正确；退出 → 恢复正常
- [ ] A16 旋转双向：Battle 横→竖（覆盖层立即出现）→横（消失）快速连续 3 次 → 无错位/无残留覆盖层

## B. Android Chrome（P0，任意中端机）

- [ ] B1 冷启动 + 菜单（DPR2-3 清晰度）
- [ ] B2 竖屏连接页 textarea（粘贴/键盘/选择）
- [ ] B3 竖屏 Battle 覆盖层 / 转横恢复
- [ ] B4 触摸相机/移动/瞄准 三件套（同 A4-A6 抽查 45° 一种即可）
- [ ] B5 安全区（挖孔/手势条）
- [ ] B6 音频首交互
- [ ] B7 后台/前台一轮（FREE_VIEW + 飞行中）
- [ ] B8 性能目测（最重场景）

## C. 跨网移动 WebRTC（Step 10，关键 REAL smoke）

- [ ] C1 桌面 Wi-Fi Host ↔ 手机 5G Guest（或手机 Wi-Fi ↔ 手机 5G）：连接成功、PING 显示
- [x] C1a 用户实测：上海电信光纤 ↔ 上海电信移动网络，双方不挂 VPN，可以联机（主客方向及 PING 未补充）
- [ ] C2 完整 4+ 回合（双方各移动/瞄准/发射）、至少一次命中扣血
- [ ] C3 中途切微信再回浏览器：连接不断（或断线提示正确）
- [ ] C4 REMATCH 一次或完整终局
- [ ] C5 无法跨网测则明确记录：**INTERNET MOBILE P2P NOT VERIFIED**

2026-10-01 用户实测：同局域网联机正常；最新补充上海电信光纤与上海电信移动网络
在双方不挂 VPN 时可以联机，记录为 C1a 的跨网连接成功。完整对局、PING、恢复和再战仍待补充。
先前 iPhone Chrome 蜂窝 Host → 家中 Wi-Fi 笔记本 Guest 出现 `ICE_FAILED`，
当时运营商/VPN条件未完整说明，作为历史失败保留，不据此断言蜂窝与 Wi-Fi 均无法联机或 VPN 是确定根因。
TURN 仍按此前决定暂缓；如后续接入，需实际证明 relay 路线可用，并复测各真机组合。
诊断事实、推断与 coturn 接入项见 [跨网联机记录](NETWORK_CONNECTIVITY_2026-10-01.md)。

## D. Desktop 回归（P1：Safari / Edge 各一轮）

- [ ] D1 Safari：菜单/SP 完整一局/瞄准拖拽/音频
- [ ] D2 Edge：同上抽查
- [ ] D3 全分辨率目测：1920×1080、1440×900、1366×768（无布局破）

## E. 视觉验收（Step 14，Phase 17 遗留并入；手机横屏重点 844×390 与 740×360）

- [ ] E1 HUD 可读（血条/头像/名字/回合数）
- [ ] E2 角色/炮弹/弹道点比例；爆炸可见性
- [ ] E3 基地烟/火分档过渡（8/6/4/2 血）；章鱼升起观感与阻挡手感
- [ ] E4 前景水面与背景海颜色衔接
- [ ] E5 Result 页 / Rematch 等待提示（金色呼吸脉冲）/ 菜单

## F. 可用性 sanity（Step 15）

- [ ] F1 所有按钮文案可读、无 hover-only 功能（触屏无 hover）
- [ ] F2 YOUR TURN / OPPONENT'S TURN / WAITING / CONNECTED / OPPONENT LEFT 均有文字或图形状态（非仅颜色区分）

---

**记录表**：直接在本文档勾选 + 异常写「编号 + 现象 + 截图」，反馈后由 agent 按 Bug 路由派发（Touch/Aim/Camera → gameplay-engineer；WebRTC → network-engineer；Viewport/UI → Main Agent），修完串行四命令 + test-reviewer 终审。
