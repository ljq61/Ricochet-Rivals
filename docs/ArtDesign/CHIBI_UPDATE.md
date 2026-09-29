# 二头身 Q 版与判定调整

2026-09-29，按用户要求替换双方角色并同步扩大实际判定。

- 内置 image_gen 编辑原蓝 / 红角色，保留队色、护目镜、围巾、机械师服装与武器；改成大头、短躯干、短腿的二头身 Q 版。
- 新资源：`public/assets/art/blue-chibi.png`、`red-chibi.png`，均为 1254 × 1254 真透明 PNG。旧 idle 文件保留作为来源，运行时不再加载。
- 实际可见角色高度统一到 180 世界 px；旧版可见高度约 87–91 px，因此约放大两倍。按 alpha >128 的边界校正脚底：蓝队 top=136 / bottom=1229，红队 top=65 / bottom=1228。装饰头发和围巾允许少量伸出矩形。
- Matter 碰撞体从 28 × 76 改为 120 × 180；仍以玩家脚底为基准，左右双方一致。
- 发射点从脚底上方 48 改为 64 px；桌面瞄准起始半径 180 → 220 世界 px；移动端已采用 150 CSS px 的屏幕热区，本轮保留该热区。
- 引信激活距离 100 → 180 世界 px，确保炮弹离开扩大后的玩家矩形再启用玩家碰撞；回落自伤仍可用。
- 伤害距离改为爆心到玩家 AABB 的最近距离。内部为 0，身体边缘外 ≤60px 为 2 点、≤140px 为 1 点；HP 仍为 10，直伤 / 溅射数值不变。这个改动扩大了身体周围的有效伤害覆盖，不再以小角色的身体中心当判定目标。
- Host / Guest 使用同一配置和伤害逻辑，未修改 wire 协议。联机测试时两端均需刷新到新版本。

验证：484 单测通过（新增头顶 / 角落 / 移动后判定与引信安全检查），类型检查与构建通过。桌面 1440×900 与手机模拟 844×390 @2x 的菜单、战斗截图已检查。Q 版改动后的全量 E2E 首轮为 123 passed / 1 failed：唯一失败是 Guest 在 Turn 4 等待 `FREE_VIEW` 的转场时序超时，需在稳定预览环境复跑；详见 TASKS.md。暂无真机验收。

## 原始编辑提示词

### blue-chibi.png

输入：`public/assets/art/blue-idle.png`；transparent_background=true。

Edit this blue-team game character into an EXTREME TWO-HEAD-TALL CHIBI sprite. Preserve identity: blue aviator cap, brass goggles, brown hair, blue scarf, tan mechanic jacket, navy trousers, brown boots, compact olive launcher, facing RIGHT. Completely change body proportions: enormous round head takes exactly HALF the total standing height, the entire tiny torso plus stubby legs takes the other half. Very short toddler-like cartoon limbs but adult adventurer character, big expressive eyes, cute round cheeks, compact broad silhouette. A 2-head-tall Q-version, NOT a 3-head or 4-head character. Full body isolated on true transparent background, feet flat on same baseline, no shadow, no ground, no text. Crisp high-quality pixel art matching reference colors and lighting. Square canvas with 8% margin, center the body horizontally, head top around y=100, chin around y=620, boots bottom around y=1140 on a 1254px canvas. Weapon small and close to body, not obscuring face. One character only.

### red-chibi.png

输入：`public/assets/art/red-idle.png`；transparent_background=true。

Edit this red-team game character into an EXTREME TWO-HEAD-TALL CHIBI sprite. Preserve identity: red ponytail, brass aviator goggles, red scarf, tan mechanic jacket, burgundy trousers, brown boots, compact olive launcher, facing RIGHT. Completely change body proportions: enormous round head takes exactly HALF the total standing height, the entire tiny torso plus stubby legs takes the other half. Very short cartoon limbs but adult adventurer character, big expressive eyes, cute round cheeks, compact broad silhouette. A 2-head-tall Q-version, NOT a 3-head or 4-head character. Full body isolated on true transparent background, feet flat on same baseline, no shadow, no ground, no text. Crisp high-quality pixel art matching reference colors and lighting. Square canvas with 8% margin, center the body horizontally, head top around y=100, chin around y=620, boots bottom around y=1140 on a 1254px canvas. Weapon small and close to body, not obscuring face. One character only. Same proportions as a matching blue-team chibi aviator.
