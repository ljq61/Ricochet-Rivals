# 版本管理

当前开发版本为 **0.2.4 候选**（2026-10-04），位于 `codex/crazygames-release-prep`，尚未创建v0.2.4标签、合入main或提交平台。公开 Pages 版本与标签仍为 **0.2.3 / v0.2.3**，历史标签保留。客户端与信令服务的开发包/锁文件统一0.2.4；依赖版本独立保留。

## 版本来源

- 客户端：根目录 `package.json` 的 `version`。
- 信令服务：`server/signaling/package.json` 的 `version`。
- 两份 `package-lock.json` 的顶层 `version` 和 `packages[""].version` 必须同步。
- `CHANGELOG.md` 记录用户可见变化、日期、验证与已知限制；README 标明当前版本。
- Git 附注标签 `vX.Y.Z` 固定该版本对应的提交，已有版本标签不移动或覆盖。

## 升级规则

| 改动 | 下一版本示例 |
| --- | --- |
| 修复问题、性能或小幅表现调整 | `0.1.0` → `0.1.1` |
| 新增游戏功能或较大的玩法调整 | `0.1.x` → `0.2.0` |
| 仍处于 0.x 的不兼容改动 | 升级次版本，并在更新日志说明迁移或刷新要求 |
| 达到稳定公开版本标准 | `1.0.0`，之后不兼容改动升级主版本 |

开发中先写入更新日志的“未发布”；确定发布版本后再更新版本号、日期并打标签。只有文档修改时，无需自动增加游戏版本。

## 升级流程

以下以从 0.1.0 升级到 0.2.0 为例，在仓库根目录执行；其他版本替换为相应版本号。

```bash
# 更新两个包及锁文件，先不自动提交或打标签
npm version 0.2.0 --no-git-tag-version
npm --prefix server/signaling version 0.2.0 --no-git-tag-version
```

然后同步 README 版本，把 CHANGELOG 的“未发布”内容归入 `0.2.0`，写明日期、验证结果和未完成验收。共享协议、初始状态或规则改变时，明确联机双方需要使用同一版本；仅版本号一致不能替代协议兼容性测试。

```bash
npm test
npm run build
npm --prefix server/signaling test
npm --prefix server/signaling run typecheck
# 按改动运行相关浏览器检查；全量回归使用：
npm run e2e
git diff --check
```

确认待提交文件范围，避免混入其他工作；将版本声明、锁文件、更新日志和相关 README 改动与本轮功能一起提交。

```bash
# 功能和文档已提交后，给实际发布提交打附注标签
git tag -a v0.2.0 -m "Ricochet Rivals v0.2.0"
git push origin dev_signaling_turn
git push origin v0.2.0
git ls-remote origin refs/heads/dev_signaling_turn 'refs/tags/v0.2.0*'
```

附注标签的 `refs/tags/v0.2.0^{}` 是目标提交，应与预期发布提交一致。

## 开发基线与线上发布

`dev_signaling_turn` 保存当前开发迭代。版本标签保存可回溯的代码快照。

0.2.0 玩法规则为 `0.2-items-v3`，旧客户端在握手时会被拒绝并提示刷新。联机双方必须使用相同玩法构建；包版本与信令服务版本一致不代表旧客户端可混玩。

当前 GitHub Pages 工作流只在推送 `main` 或手动触发时部署；推送开发分支或标签不会自动更新线上游戏。正式上线时，将经过验证的版本合入 `main`，检查 Actions 结果和线上页面，再记录实际部署状态。信令服务的部署结果需单独验证。


0.2.0 发布顺序：先验证并推送 `dev_signaling_turn`，再将同一发布提交合入 `main`，为该提交创建附注标签 `v0.2.0`。核对开发分支、main 与标签目标提交，检查 Pages Actions，最后检查线上 HTML、脚本和新增素材确实来自该构建，并在手机尺寸进入单人游戏核对 AI 控件。发布验收与部署结果以最终 Actions 和线上核对为准，测试通过不替代真机、跨网与平衡验收。
