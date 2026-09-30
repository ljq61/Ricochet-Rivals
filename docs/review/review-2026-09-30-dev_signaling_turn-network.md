# 联机功能审查 — 2026-09-30

## 范围与结论

- 分支：`dev_signaling_turn`；审查提交：`10644347f532c0fc6d7592cf76127e3697bf32b5`。
- 审查当前实现，不限于最近美术提交的 diff。覆盖房间创建/加入、WebRTC、信令服务、命令权限、回合结算、状态快照、断线恢复与重赛的调用链。
- 初次审查时正常本机房间配对和对局通过，异常恢复存在明显问题；后续已按用户授权修复 F1/F2，验证见文末。F3–F8 的后续修复与验证见文末。
- 初次审查未修改产品代码；后续 P1 修复包含场景、输入、快照接线和回归测试。

## Findings

### F1 [P1，已修复] 回合切换时恢复，加入方可卡在 END

- 位置：`src/game/network/online/OnlineGuestChannel.ts:273`、`:335`；`OnlineHostChannel.ts:321`；场景补驱入口 `src/game/scenes/BattleScene.ts:712`。
- 触发：旧回合 TURN_RESULT 已确认，Host 发出 TURN_END 并进入下一回合；Guest 在该消息投递之前发起恢复对账。
- 根因：Guest 恢复中丢弃 TURN_END，假设 Host 会在恢复 ACK 后重发；快照应用又清空 pendingTurnEnd，未调用 resumeNextTurn。Host 已清空旧回合等待，直接忽略新快照回合的 ACK。
- 实测：使用真实协调器、回环传输、GameLogic、TurnManager；恢复后双方 turnId=2，Host=`ACTION`，Guest=`END`，Guest 却报告 `SYNCED_AFTER_RECOVERY`。等待后也没有补驱转场。
- 修复：快照恢复必须按权威 phase 恢复场景、相机及回合表现；对已切换回合不能依赖 Host 重发旧 TURN_END。避免重复 endTurn 或重复转场。
- 回归：在 TURN_END 已发未投递的窗口启动 Guest 对账；断言双方进入同一可操作阶段，相机和输入解锁，且只转场一次。

### F2 [P1，已修复] 重连输入锁被下一帧重新打开

- 位置：`src/game/scenes/BattleScene.ts:660`、`:683`、`:803`。
- 触发：自己的操作回合开始连接恢复。
- 根因：beginOnlineRecovery 只禁用一次 controls；每帧 syncInputOwnership 根据本地回合重新启用，统一门禁没有包含 RECONNECTING。
- 浏览器实测：1280×800 Chrome，房间真实配对后，注入 failed 状态并暂停 restart offer 以保留恢复窗口。横幅与诊断均为 `RECONNECTING`，按住 D 350ms，Host 角色 x 从 450 变成 548.43，仍发出 MOVE。该探针保留底层通道，未出现 pageerror；不能把这项实验说成真实物理断网或已证明崩溃。
- 影响：恢复期间仍能修改对局状态、消耗移动预算，旧输入可能与随后快照恢复竞争。触屏按钮及瞄准入口也使用同一门禁，静态链同样受影响；本轮未单独实测手机触摸。
- 修复：将连接恢复状态纳入持续输入门禁；开始恢复时取消已有移动/瞄准手势，对账完成后统一解锁。
- 回归：保持恢复 pending 多帧，同时尝试移动、瞄准、发射；双方状态、预算和出站动作帧均不得改变。

### F3 [P2，已修复] 加入方移动速度随 RTT 明显下降

- 位置：`src/game/input/MoveInputCore.ts:96`；`src/game/network/online/GuestIntentBus.ts:63`；`OnlineHostChannel.ts:416`。
- 触发：Guest 持续按住方向键/移动按钮，存在正常网络往返延迟。
- 根因：每帧用最近收到的位置加单帧步长生成绝对 targetX；Guest 不预测当前位置。回包到达前连续帧重复同一附近目标，Host 只产生一次有效位移。
- 实测：固定 120 帧持续输入并等待在途消息收口，RTT 0/100/200ms 下 Host 均走完 250px；Guest 在主审复跑约为 250/98/53.33px。专项审查首次为 250/94.67/52.67px；计时调度造成小幅差异，趋势一致。此实验使用真实输入核心、总线、网络管理器、协调器和移动系统，不包含渲染。
- 修复：设计由 Host 积分的方向/持续时间输入，或可校正的预测目标；保留回合、速度、预算和去重约束，不能直接接受客户端任意位移。
- 回归：0/100/200ms RTT 下双方相同持续输入的有效位移应接近，松手后停止且预算正确。

### F4 [P2，已修复] 静默断网旧 socket 未释放，原 token 重入被拒绝

- 位置：`server/signaling/src/bootstrap.ts:39`；`RoomManager.ts:124`、`:140`。
- 触发：断网未向服务端送达 close/FIN，旧信令 socket 被保留，客户端用原 token 新建连接尝试恢复。
- 根因：服务端没有 ping/pong 存活检测，仅依赖 close/error。room sweep 不会释放被标记为 connected 的槽；同 token 也因槽仍连接而收到 ROOM_FULL。bootstrap 的“半开由 ws 兜底”注释不符合实际代码行为。
- 实测：真实 ws 探针暂停旧 Guest socket、保留旧槽，另开 socket 用原 token JOIN；得到 `ROOM_FULL / guest slot occupied`，未观察到服务端发 ping。此为半开条件模拟，未做真实手机切网。
- 修复：加入服务端心跳与超时清理；明确 token 重入与旧连接替换策略，避免新旧 socket 竞争释放同一槽。
- 回归：旧连接不发送 close 的故障注入，存活预算后可以用原 token 重入；重复/迟到旧连接关闭不破坏新连接。

### F5 [P2，已修复] 恢复时新建的信令不能跨结算/重赛保留

- 位置：`src/game/network/RoomRecoveryController.ts:265`、`:184`；`OnlineSession.ts:38`；`src/game/scenes/BattleScene.ts:1147`。
- 触发：Host 曾在恢复中重建信令，随后正常进入 Result，停留超过服务端 grace，再重赛并需要网络恢复。
- 根因：新 client 仅存入恢复控制器 activeSignaling/ownedSignaling，Session 仍持有原失效 client。正常交接 Result 也 dispose 恢复器，关闭新 client；Host 槽宽限到期会删除房间。
- 影响：重赛还能使用保留的 RTC，但后续恢复使用旧会话上下文入房，会遇到 ROOM_NOT_FOUND。
- 证据范围：完整生命周期代码链确认；没有运行跨 grace 时间的浏览器复现。
- 修复：活信令归 Session 生命周期所有，重建时更新该引用；转 Result/Rematch 保留，真正退出会话时关闭。
- 回归：WS 重建成功 → Result 停留超过 grace → Rematch → 再次恢复，应仍能重入并完成对账。

### F6 [P2，已修复] 信令失败丢弃引用，却未关闭底层 socket

- 位置：`src/game/network/signaling/SignalingClient.ts:472`。
- 触发：服务器发 ERROR，或客户端连接等待超时。
- 根因：fail 摘监听并把 ws 置空，没有关闭它；之后 controller/Session 调用 close 也找不到旧 socket。
- 实测：现有 FakeWebSocket 正常 open → 收 `ROOM_NOT_FOUND` ERROR → client.close；client 为 DISCONNECTED，底层 readyState 仍为 1，监听已全部摘除。服务端 sendError 路径也不会主动关 socket。
- 影响：反复输错房间或重试可保留无用连接；超时后迟到建立的连接也无法由 Back 清理。
- 修复：失败清理时保留局部引用、摘监听后关闭底层 socket，同时保证 reject/通知幂等。
- 回归：ERROR、连接超时及 Back/Retry 后，旧 socket 已关闭且不能迟到复活。

### F7 [P2，已修复] 房间 TTL 与重连 grace 环境配置未生效

- 位置：`server/signaling/src/bootstrap.ts:32`。
- 根因：构造 RoomManager 只传 now，漏传 config.waitingTtlMs/config.slotGraceMs。
- 真实 ws 实测：配置两者为 100ms，实际分别仍为 600000ms/30000ms。
- 修复：将已加载配置传入 RoomManager，保留测试注入 manager 的优先级。
- 回归：经 bootstrap 启动服务，验证自定义 TTL/grace 实际决定房间和槽释放时间。

### F8 [P2，已修复] JOIN 惰性删除过期房间，遗漏 Host 通知和解绑

- 位置：`server/signaling/src/RoomManager.ts:114`；`SignalingRoomServer.ts:105`、`:138`。
- 触发：房间 TTL 已过，下一次 sweep 尚未执行时，有 Guest JOIN。
- 根因：joinRoom 直接删除 rooms 中的房间，没有走 runSweep 的绑定清理和通知；后续 sweep 已找不到该房间。
- Fake clock/socket 实测：rooms=0，但 bindings=1，Host 没收到 ROOM_EXPIRED；Host 原 socket 再 CREATE 收到 `INVALID_MESSAGE / already in room`。
- 影响：Host 界面停留失效房间等待，原连接保留过期绑定。
- 修复：统一所有房间删除的通知/解绑收口。
- 回归：过期 JOIN 和 sweep 两条删除入口，均通知绑定双方并释放绑定，不能重复通知。

## 部署与测试边界

- 当前仓库 Pages workflow 只构建前端，未注入 `VITE_SIGNALING_URL`（`.github/workflows/deploy-pages.yml:40`）；默认解析为 `ws://127.0.0.1:8787`（`src/game/network/signaling/signalingUrl.ts:9`）。仓库没有已落地的公网 WSS/coturn 部署。不能从本机通过得出手机公网联机已就绪。
- 本次信令日志为 STUN=1、TURN=0，浏览器链路为 DIRECT。本次未验证真实 TURN relay、不同 NAT/运营商、手机 Safari、Wi-Fi 与移动网络切换。
- 现有 E2E 通过 debug 注入 FAILED，但真实 pc 仍活；覆盖恢复编排和快照链，不证明真实断网后可恢复。E2E 禁用了后台节流和 mDNS 隐藏，不能替代普通浏览器/真机验收。
- TURN 临时凭据默认 30 分钟；长局过期后的凭据刷新、ICE restart 尚需专项验证，未列为已实测缺陷。
- 没有确认的死代码；本轮不因重复、命名或抽象风格提出无功能影响的重构。

## 本轮验证

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 客户端单元测试 | 575/575 通过 | 包含联机权限、协议、同步、恢复等现有测试 |
| 前端 typecheck + build | 通过 | 构建仅保留已知大包警告 |
| 信令单元/真实 ws 集成测试 | 31/31 通过 | 初次沙箱 EPERM 为环境限制；开放本机端口后重跑通过 |
| 信令 typecheck | 通过 | 服务端源码 |
| Room 浏览器 E2E | 37/37 通过 | 创建/错误加入/正常加入、移动射击、结算一致、模拟恢复、desync 对账、重赛、主动关闭 |
| 回合切换恢复故障探针 | 复现 F1 | Host ACTION / Guest END / Guest SYNCED_AFTER_RECOVERY |
| 浏览器恢复输入探针 | 复现 F2 | 恢复状态持续时角色仍移动；无 pageerror |
| 移动延迟探针 | 复现 F3 | Guest 位移随 RTT 减少 |
| 服务端配置/旧槽/惰性过期探针 | 复现 F4/F7/F8 | 真实 ws + 可控 clock/socket，范围见各 finding |
| 信令失败清理探针 | 复现 F6 | FakeWebSocket，失败后旧 socket 仍 OPEN |

浏览器环境：系统 Chrome，1280×800，localhost 的独立 preview 与信令服务。未提供 Browser skill，使用仓库已有 Puppeteer E2E，不安装依赖。可见场景正常、有内容，无构建错误遮罩；故障探针显示 RECONNECTING 横幅与可操作瞄准按钮。

本轮临时证据（系统临时目录，不作为可长期保存的版本化文件）：

- `/tmp/rr-network-audit-unit.log`、`rr-network-audit-build.log`、`rr-network-audit-server.log`、`rr-network-audit-room.log`。
- `/tmp/rr-recovery-input-probe.mjs`、`rr-recovery-input-probe.log`、`rr-network-recovery-input.png`。
- `/tmp/ricochet-reconnect-turnend-audit.ts` / `.mjs`、`ricochet-network-movement-audit.ts` / `.mjs`。
- `/tmp/rr-signaling-review.mjs`；过期 JOIN 的可控时钟实验由专项审查复核，复现步骤和输出记录在 F8。

## 修复与验收顺序

1. F1/F2：恢复回合/相机/输入闭环，补真实失败回归后跑 Room E2E。
2. F3：解决加入方延迟下移动变慢，网络与玩法分别复核权限、预算、预测和最终位置。
3. F4–F8：统一信令会话所有权、失败与房间删除清理，补服务端黑洞和重赛后再恢复用例。
4. 配置公网 WSS 与 TURN，强制 relay 验证，然后两台真实手机跨网络与切网测试；这些结果才用于判断公网可用性。

## Re-review 2026-09-30 — P1 修复

F1/F2 已完成修复并通过独立复核，未发现本次修复新增的 P0/P1。

- 快照成功应用后先发送 ACK，再按 END/ACTION 恢复场景转场或自由观察，不再等待旧 TURN_END 重发。重复权威快照只补 ACK，不重复转场；新恢复 episode 和 validator 重试仍可应用相同快照。
- 在恢复和 Scene shutdown 时使旧表现回调失效；旧爆炸停留/转场不能迟到推进新回合。Host 的在飞炮弹保留原有权威结算。
- 重连输入锁纳入持续门禁；进入恢复即取消已认领的移动/瞄准手势、回家 Tween。AimController 在认领、移动、释放及更新时都检查门禁，解锁后旧指针不能恢复发射。
- 恢复后的输入按回合归属和对账锁解锁。被抑制的新回合横幅不提前消费 turnKey，不覆盖 RECONNECTING/SYNCHRONIZING 提示。

验证结果：

| 检查 | 结果 |
| --- | --- |
| 全量单元测试 | 589/589 通过；新增 7 项快照恢复、7 项瞄准门禁回归 |
| 类型检查 + 构建 | 通过；保留原有大包警告 |
| 完整浏览器 E2E | 186/186 通过，0 失败 |
| 新增浏览器 F1 探针 | Guest 应用前截停 TURN_END 并启动恢复，成功进入新回合 ACTION / FREE_VIEW；后续正常对战与重赛通过 |
| 新增浏览器 F2 探针 | 持续重连期间禁止移动、重新瞄准及旧拖拽释放发射；恢复后可继续正常对战 |
| 手机尺寸触摸故障探针 | 844×390 Chrome 触摸模拟，持续重连时移动按钮隐藏，触摸后位置保持 x=450，无 pageerror |
| 独立审查与差异检查 | 通过；审查提出的恢复横幅 P2 已一并修正 |

临时日志：`/tmp/rr-p1-unit-final.log`、`rr-p1-build-final.log`、`rr-p1-e2e-final.log`、`rr-p1-mobile-recovery.log`。本次没有修改信令服务、移动同步协议或 TURN 部署；此前 F3–F8 和真实手机跨网/切网验证仍未完成。


## Re-review 2026-09-30 — P2 修复

本轮处理 F3–F8，并修正复核发现的恢复异步回调清理问题。

- F3：Guest 发送有符号移动增量，Host 在权威位置上累加，再由现有移动系统处理阶段、边界和路径预算。Host 使用单调时钟限制速度，允许 100ms 调度突发；去重与回合归属仍由既有消息链校验。移动回包未到时，发射起点只允许匹配当前回合最近 2 秒、最多 128 条已接受的移动位置，最终一律从当前权威炮塔发射。
- F4：有效 token 可以立即接管原槽，服务端解绑并终止旧 socket；旧 socket 的迟到消息和关闭不影响新槽。增加 ping/pong 检测，默认 5 秒发 ping、10 秒超时释放半开连接；无需等到心跳清槽才能重入。
- F5：重建信令在成功 JOIN 后交给 OnlineSessionManager；Battle → Result → Rematch 保留，真正退出关闭。未完成或失败实例由恢复器及时关闭；退出后的旧恢复器不能继续发送异步 OFFER/ANSWER，连接等待的迟到拒绝也被收口。
- F6：失败路径摘除监听后关闭底层 socket；ERROR、拨号超时和主动退出后不能靠迟到事件恢复实例。
- F7：bootstrap 透传 waitingTtlMs / slotGraceMs，注入 RoomManager 仍优先。
- F8：JOIN 惰性删除与 sweep 共用通知、解绑收口；Host 超宽限和房间等待过期均释放绑定，不再留在失效房间。

验证结果：

| 检查 | 结果与范围 |
| --- | --- |
| 全量客户端单元测试 | 611/611，通过；新增 16 项移动延迟/权限/发射回归、5 项恢复生命周期回归、1 项增量 payload 校验 |
| 信令服务测试与类型检查 | 41/41，通过；新增 10 项配置、半开连接、接管、删房与 shutdown 回归 |
| 前端类型检查与构建 | 通过；保留已知大包警告 |
| 完整浏览器 E2E | 188/188，通过；桌面、手机尺寸、单人、手动联机、房间联机及重赛；最终构建另复跑 Room 41/41，通过 |
| 实际计时移动探针 | 27 帧短按，Host / Guest 在 RTT 0/100/200ms 均为 125.333333px，剩余预算均为 124.666667px；未靠耗尽预算掩盖差异 |
| WS 重建 → Result → Rematch → 再恢复 | 真实 WS 关闭重建；Result 等待 2100ms，超过测试 grace=1500ms + sweep=200ms；新信令仍 OPEN，重赛再次重建并完成 Guest 快照对账 |
| 独立审查 | F3–F8 全部通过，无剩余 P0/P1/P2 阻塞；复核中的旧异步应答与迟到 rejection 已修正 |

新 Guest 同时携带 deltaX / targetX，旧 Host 可继续读取 targetX，新 Host 优先增量；混旧版本仍保留旧版移动迟滞，修复完整生效需双方使用新构建。

临时证据：`/tmp/rr-p2-unit-final.log`、`rr-p2-build-final.log`、`rr-p2-e2e.log`、`rr-p2-room-final.log`、`rr-p2-recovery.log`、`ricochet-network-movement-short-audit.ts` / `.mjs`。服务端黑洞测试使用真实 WS 暂停接收且不发送 FIN；浏览器 RTC failure 仍通过 debug 注入，底层 RTC 保留存活。本轮未进行公网 TURN relay、Safari 真机或 Wi-Fi↔移动网络切换验收。
