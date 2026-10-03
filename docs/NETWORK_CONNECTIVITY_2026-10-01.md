# 跨网络联机验收与 TURN 接入（2026-10-01）

## 本次真机结果

- 用户报告：同局域网联机正常。
- 先前失败记录：iPhone Chrome 使用蜂窝网络创建房间，家中 Wi-Fi 笔记本加入；Connecting 后显示 `ICE_FAILED`。当时运营商和 VPN 条件未完整说明。
- 最新补充：上海电信光纤 ↔ 上海电信移动网络，双方均不挂 VPN，用户报告可以联机。这是该具体条件下的跨网连接成功记录。
- 主客方向、PING、完整对局、后台恢复和再战结果尚未补充；不将连接成功扩展为完整跨网验收完成。
- 未确认先前失败是否开启 VPN，不能把 VPN 认定为确定根因；也不能把一次成功扩展为所有运营商和 VPN 组合均可用。
- 仓库部署记录为 Render WebSocket 信令 + STUN；TURN 按之前决定暂缓。此轮未重新读取 Render 环境配置。

## 已确认与推断

`ICE_FAILED` 来自浏览器 ICE 的失败状态，或连接失败的同类归因；不等同于房间服务器正在启动。
STUN 帮助收集直连地址，但不转发游戏数据。直连不可达时，需要 TURN 提供中继路径。
说明见 [WebRTC 官方 TURN 文档](https://webrtc.org/getting-started/turn-server)、
[MDN ICE 状态说明](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/iceConnectionState)。

先前失败可能符合“跨网直连不可达、缺中继兜底”，但缺少两端真机候选与连接统计，
无法判定具体运营商 NAT 类型，也不能断言 STUN 被屏蔽或 VPN 导致失败。
最新无 VPN 的上海电信光纤/移动网络成功说明，至少这组条件下跨网连接可达；
不能再将“蜂窝与 Wi-Fi 无法连接”作为一般结论。TURN 仍是其他不可直连网络的候选兜底方案，尚未启用。
换 Host/Guest、增加等待或 ICE restart 不会新增中继路径；多一个 STUN 也不能替代 TURN。

## 沿用既有 coturn 方案

1. 确定可运行 coturn 的公网服务器、公开 IP、证书与防火墙。支持 UDP/TCP，并提供 TLS 路径及 relay 端口。
2. 使用 coturn REST 临时凭据；Render 的 `SIGNALING_TURN_URLS` 与
   `SIGNALING_TURN_SHARED_AUTH_SECRET` 必须成对，secret 与 coturn 一致，仅置于服务器环境变量。
3. 新建房间获得 STUN/TURN 列表。现有 Room ack → transport → RTCPeerConnection 接线已实现，
   首次接入不需要重写游戏协议。
4. 测试构建先强制 relay：必须实际看到 `relay` 候选、选中路线 `RELAY`，并通过 PING/PONG；
   再用正常策略重复用户的蜂窝 Host → Wi-Fi Guest、反向主客和完整对局。
5. 同时验证后台切微信、断线恢复和再战；30 分钟凭据过期后的恢复仍需单独验证。

具体部署项见 [信令服务器 TURN 配置](../server/signaling/README.md#turnsg-6coturn-部署)。
服务器与带宽费用要按用户现有资源确定；此轮未开通中继、创建凭据或更改公网环境。

## 后续诊断与接入检查

- Connecting 期间采集双方的候选类型、候选错误、ICE 状态和选中 pair；不要记录或公开 peerToken、
  TURN credential、shared secret 或完整 SDP。失败后的 transport 已清理，现接口通常返回空诊断。
- 现有 `hasTurnCandidateErrors` 仅检查最后一条错误并匹配 `turn:`，
  可能漏识别 `turns:` 或被后续 STUN 错误覆盖；应在启用 TURN 时补全错误分类验证。
- Room 重入 ack 中的新 `iceServers` 尚未写回原 RTCPeerConnection；
  凭据过期后的 ICE restart 不能仅凭首次 relay 成功判定正常。
- 本轮仅核对源码并记录用户真机反馈，未改产品代码；已记录上述条件下连接成功，完整对局及 relay 验收仍未完成。

## 无现有 VPS 时的费用对比

用户确认没有现成公网服务器，先查看方案和费用。以下价格于2026-10-01查阅官方资料，
美元标价，不含税、域名及其他现有服务费用；没有创建服务或凭据。

| 方案 | 中继增量成本 | 超额与控制 | 接入工作 |
| --- | --- | --- | --- |
| Cloudflare Realtime TURN | 每月前1,000GB免费，超出部分US$0.05/GB | Budget alerts仅通知，不暂停或封顶；不能承诺永远零费用 | 不租VPS；信令后台调用Cloudflare API签发短期凭据，客户端沿用iceServers |
| coturn + DigitalOcean Basic VPS示例 | 512MiB/1vCPU/500GiB出站配额：US$4/月；1GiB/1vCPU/1,000GiB：US$6/月 | 超出出站配额US$0.01/GiB；月费上限仅指计算套餐，不能当总账单封顶 | 租服务器，部署coturn、TLS、防火墙与监控，复用现有HMAC临时凭据 |

定价来源：[Cloudflare TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/)、
[Cloudflare 月度免费额度](https://www.cloudflare.com/products/turn-sfu/)、
[Cloudflare Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)、
[DigitalOcean VPS 套餐](https://www.digitalocean.com/pricing/droplets)、
[DigitalOcean 流量计费](https://docs.digitalocean.com/platform/billing/bandwidth/)。
Cloudflare Realtime用量需结合账户内TURN/SFU使用核算；DigitalOcean配额按团队累计，
按月运行的上述套餐以完整月配额举例，短期运行按实际累计额度结算，不应当作赠送整个自然月流量。

Cloudflare计费例子：假定该计费周期完整1,000GB免费额可用，100GB为US$0，
1,100GB为US$5，1,500GB为US$25。游戏只中继命令和快照，不通过TURN下载图片、音频或视频；
正常游戏流量预计较小，但当前没有真实relay流量测量，不能给出实际人数/局数额度保证。

建议：先考虑Cloudflare托管方案，原因是用户无现成VPS，可省固定月费与系统维护；
这是对原coturn自建方案的替代建议，未切换。若更重视自行掌握服务器及流量停用控制，
可选择US$6/月的1GiB自建套餐。两者都需要用户这组蜂窝网络/家庭Wi-Fi真机验证，不能承诺必达。

### 托管方案的执行边界

1. 用户选择方案并接受超额计费规则后，再启用服务。Cloudflare凭据必须由信令后台API生成，
   不能直接把现有coturn HMAC逻辑换一个服务器地址；长效API token不进入浏览器或Git。
2. 凭据仅向有效房间签发，限制签发频率；增加用量观测、告警和紧急撤销能力。
   用量统计有延迟、已发凭据可能仍有效，因此这些控制不能被描述为平台保证的硬费用上限。
3. 同步补齐错误诊断与凭据续期，再强制relay验证和真机跨网完整对局。
   失败则撤销测试凭据并回到原STUN模式，不能把“创建成功”当作接入完成。

Cloudflare接入参考：[短期凭据生成与撤销](https://developers.cloudflare.com/realtime/turn/generate-credentials/)。
Render现有Web Service仅公开HTTP端口，适合继续做信令，不具备公网coturn所需的UDP/TCP及relay端口部署条件：
[Render 端口说明](https://render.com/docs/web-services#port-binding)。
