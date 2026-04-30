## 2026-04-30

- 修复 oneceo.space 默认部署域名绑定链路：Railway 自定义域名除了 CNAME 外，还需要写入 ownership TXT 验证记录，后端现在会读取 `verificationDnsHost` / `verificationToken` 并同步到 Cloudflare。
- 修复部署面板状态收敛：`pending_dns` / `pending_certificate` 会继续触发 live refresh，Railway 证书生效后平台状态会更新为 `active`，并统一展示 `oneceo.space 默认域名已生效`。
- 验证会话 `737373f7-7f5a-4e31-b3f5-f78126045931`：Railway custom domain 已 verified，平台部署接口返回 `domainStatus=active`，浏览器可打开 `https://app-737373f7-7f5-dd76de-3bc30f.oneceo.space/`。
- 修复部署统计域名错位：Umami 绑定和注入配置现在优先使用 oneceo.space public URL / publicDomain，旧 Railway websiteName 会在 live refresh 时收敛为 oneceo.space。验证该会话统计接口返回 `tracking`，`pageviews=7`、`visits=7`、`visitors=6`。
- issue `#60` 已认领并开始修复 Altus managed 部署完成条件与公网收敛判定。
- 部署链新增 4 个收口点：显式部署意图不允许停在代码完成、发布前统一执行 deployable workspace 预检、provider success 与 public readiness 分层、`public_settling` 超时后才升级成公网失败。
- 代码落地位置：`altus-run-coordinator.ts`、`task-session-deployment-runtime-service.ts`、`altus-managed-deployment-tool-service.ts`、`railway-deployment-service.ts`、`internal-admin-deployment-routes.ts`。
- 回归结果：`pnpm --dir apps/api run type-check` 通过；`altus-run-coordinator`、`task-session-deployment-runtime-service`、`altus-managed-deployment-tool-service`、`altus-managed-prompt-service` 组合测试 `86/86` 通过。
- 真实验收：启动本地 API 后执行 `pnpm --dir apps/api run test:deployment-main-chain:e2e` 通过，生成报告：
  - `apps/api/tests/e2e/reports/deployment-main-chain-2026-04-30T16-33-20-394Z.json`
  - `apps/api/tests/e2e/reports/deployment-main-chain-2026-04-30T16-33-20-394Z.md`
- 真实链路会话：`172af17b-7212-4687-ac45-6cc87cfb3d1d`；e2e 验证项包含 run 完成、部署状态持久化、公网 URL 可达、analytics 状态可读、DB session 记录存在。
