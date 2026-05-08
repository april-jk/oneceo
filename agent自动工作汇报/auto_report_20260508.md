## 2026-05-08

- 基于已采用的 Manus 固定模板方案，开始把 OneCEO 的 deployable web app 主链收敛到固定模板策略。
- 更新 Altus managed prompt：新建可部署网站时强制使用 `client/server/shared + vite build + node dist/index.js` 的固定模板壳，不再把 Java / PHP / Python 视为新网站 runtime 选择。
- 在模板合规与项目画像中增加官方固定模板识别：
  - `template-compliance-service` 能检测 OneCEO 官方固定模板壳，并为自动生成的 manifest 固定 `oneceo_fixed_vite_node_shell` stack。
  - `task-session-project-profile-service` 新增 `templateFamily`，区分官方固定模板与 legacy/custom 项目。
- 补了固定模板相关单测，并完成 `pnpm exec tsx --test ...` 与 `pnpm --filter api type-check` 验证。
- 当前仍未收缩 deploy tool 执行层，只先把“生成约束 + 模板识别 + 合规锚点”落稳，下一轮可以继续把部署主链真正向固定模板收拢。
- 继续推进部署 preflight：`altus-managed-deployment-tool-service` 现在会优先看 `templateFamily`，并且只对 `frontend_dist + legacy/custom` 的 web app 触发官方固定模板修复要求，不影响非当前主链的已有栈项目。
