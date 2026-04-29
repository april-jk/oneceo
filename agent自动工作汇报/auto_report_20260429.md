# 2026-04-29 自动工作汇报

## 部署 Umami 统计 ID 错位排查

- 问题：新部署会话 `a8a09e77-89cd-423c-83ae-3daf18987686` 的面板查询 `ed13ea9f-833f-4ccd-9bfe-e1c279fe6368`，但线上页面实际注入并上报 `a7901c57-a927-49c6-a9c3-c3faa1e868dd`，导致面板显示 0。
- 处理方向：发布注入和前端 dist 运行时注入均改为替换旧 `ONECEO_ANALYTICS` 块；部署成功后的最终绑定改为重新读取最新 sandbox metadata，并增加公网页面实际注入配置回读校验，必要时以已发布页面的 `websiteId` 修正面板 metadata。
- 验证：已通过部署模板相关 19 个单测、`git diff --check` 和目标运行时文件诊断；全量 API type-check 仍受既有 `altus-managed-setup-service.ts` 类型错误阻断。
- 复查补强：Umami `listWebsites(teamId)` 可能漏列真实存在的 website，已改为先通过 `/api/websites/:id` 读取详情并校验 `teamId`，同 team 才复用更新；跨 team 或 not found 才回退到域名匹配/创建，避免再次创建新 ID 或误改平台站点。

## 非 HTML 部署类型覆盖检查

- 问题：HTML 部署链路已趋于稳定后，需要继续确认 Vite/Node/Python/PHP/Java 等其他网站类型不会被 HTML 专用逻辑影响。
- 处理：部署模板扫描补充 `.jinja2` 模板识别，合规检查同步纳入 `.jinja2`；新增 Python Flask/Jinja2 单测，确认 analytics bootstrap 可以注入并被合规检测识别。
- 验证：`pnpm --filter api exec tsx --test tests/deployment-template-bootstrap-service.test.ts tests/deployment-template-baseline-service.test.ts` 通过 21 项；`pnpm --filter api exec tsx --test tests/altus-managed-deployment-tool-service.test.ts tests/task-session-deployment-analytics-service.test.ts tests/umami-analytics-service.test.ts` 通过 18 项。
- 真实链路：已启动 `WD-JS-01` Vite/JS 真实部署矩阵测试，生成阶段完成并进入部署阶段；后续轮询 `/api/altus-managed/sessions/:id/runs/latest` 时遇到 500。复查 `http://oneceo.ai:3000/api/system/health` 和 `/api/auth/login` 同样返回 500，因此当前阻断是线上 API 服务层异常，暂不能归因到 Vite 部署模板。
- 补充：顺手修正 `src/services/altus-managed-setup-service.ts` 中一个不改变行为的窄类型比较，`pnpm --filter api type-check` 已恢复通过。

## 多类型部署真实链路复测与修复

- 覆盖：在服务重启后重新跑了 Vite/JS、Node、Python、PHP、Java/Spring Boot 五类非纯 HTML 网站部署链路，并补跑 Umami 注入/统计验证。
- 主要修复：E2B 文件读写增加重试并在连接异常后清理缓存 sandbox；Railway redeploy/rollback GraphQL 补齐返回字段；API 入口忽略可恢复的 `EPIPE`/`ECONNRESET` socket 断连；运行时 analytics 注入移除过期 `data-domains`；Java/Spring Boot 补充 `src/main/resources/templates` 与 `static` 扫描，并将平台健康检查标准化为 `/`。
- 验证：Vite/JS、Node、Python、PHP、Java 均已真实部署到 Railway 且公网 200；JS/Node/Python/Java 的 Umami e2e 均确认面板进入 `tracking` 并读到 pageviews/visits/visitors；PHP 完整统计脚本曾遇到一次公网 TLS 瞬断，但通过真实页面上报与后端查询确认 `pageviews=1`、`visits=1`、`visitors=1`。
- 本地检查：`pnpm --filter api exec tsx --test tests/deployment-template-baseline-service.test.ts tests/deployment-template-bootstrap-service.test.ts` 通过 24 项；`pnpm --filter api type-check` 通过。
- 遗留观察：Java 统计脚本额外触发过一条 redeploy，面板历史列表中仍可见非当前的 `BUILDING` 记录；当前绑定为 `ready`、线上版本为 `SUCCESS`、`activeDeploymentPending=false`，不影响当前可用性。

## Railway 线上地址短时间后 404 排查

- 问题：已发布成功的 Railway 公网地址在后续一段时间后出现 `x-railway-fallback: true` / 404。
- 根因：部署成功后 runtime 会调用跨资源键的 `pruneSupersededProjectResources`，按同一用户 Railway project 删除其他 Environment/Service。正确模型应是 OneCEO 用户 -> 一个 Railway Project，OneCEO 用户项目 -> 一个 Railway Environment；跨用户项目删除会误删其他项目线上服务，导致旧 URL 变为 Railway fallback 404。
- 处理：移除部署成功、重部署/回滚成功后的跨 session 清理调用，并删除 `pruneSupersededProjectResources` 入口；普通 `provider_error`、`FAILED`、`CRASHED` 不再先删 service 再重建，只有明确的 `railway_environment_not_found` / `railway_service_not_found` 资源缺失才允许回收重建。
- 补强：禁用“服务创建额度到顶时复用其他 session service”的路径，避免新项目覆盖旧项目；公网验证阶段的 `deployment_provider_error` 保留资源用于诊断/恢复，不再立即删除刚创建的 service 导致慢启动变 404。
- 模型修正：部署资源键优先使用 `session.projectId`，只有未绑定用户项目的临时会话才回退到 `taskSessionId`；资源绑定标记更新为 `environmentModel=per_user_project`。
- 保留：失败部署的当前 session 资源清理仍保留，避免首次部署或替换部署失败后留下持续计费资源。
- 验证：`rg` 确认源码/测试无剩余 `pruneSupersededProjectResources` 或跨 session 复用入口；`pnpm --filter api exec tsx --test tests/platform-deployment-account-service.test.ts tests/task-session-deployment-runtime-service.test.ts` 通过 25 项；`pnpm --filter api type-check` 通过；`pnpm --filter web check` 通过；`git diff --check` 通过。
