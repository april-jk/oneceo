# 2026-05-09 固定模板蓝图约束优化与 E2E 阶段报告

## 背景

本轮目标是继续向 Manus 式固定模板方案收敛，不再让部署壳、运行时和启动脚本在生成阶段漂移，而是把不稳定点进一步压缩到“模板内内容填充”的准确性与收敛速度。

本报告对应的设计文档为：

- `/Users/watson/codingProj/oneceo/docs/部署工作台功能设计/06_生成应用部署基线/28_Manus固定模板收敛部署方案_[20260508-1039已采用].md`

## 本轮明确要求

### 要求 1：固定通用模板壳

用户要求：

- 参照 Manus 的设计理念，使用固定模板壳。
- 规定好前端、后端的固定运行位置。
- 固定启动脚本与部署契约，做到“只要正确填充，就能用同一个脚本启动”。
- 避免在运行时动态调整启动脚本。

### 要求 2：只约束代码编写路径与规范

用户要求：

- 不靠强硬限制内容表达，而是约束代码写入路径与实现规范。
- 固定前端、后端、共享代码的写入边界。
- 不允许生成阶段随意扩 runtime、扩目录、改部署契约。

### 要求 3：编写前必须先有蓝图型 todo

用户要求：

- 新建网站任务在写代码前，必须先形成完整蓝图型 todo。
- todo 需要覆盖前端、后端、路径、完成项。
- 做完一项打勾一项，最终对照 todo 做收尾检查。

### 要求 4：todo 必须完整，但不能僵化限条数

用户补充要求：

- todo 必须根据任务规模自适应。
- 不能一刀切限制“最多几条”。
- 标准是完整覆盖主路径，不是控制条目数量。

### 要求 5：完成后只做宏观自检，避免 token 浪费

用户补充要求：

- 自检必须是宏观一致性检查。
- 避免逐文件全文重读。
- 重点检查：路径、契约、主模块、运行时漂移、结束条件。

## 本轮实际实现

### 1. 固定模板壳锚点已加入系统 Prompt

修改文件：

- `/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-prompt-service.ts`

新增锚点：

- `ONECEO_FIXED_SHELL_ANCHOR`
- `ONECEO_WEBAPP_TODO_BLUEPRINT_ANCHOR`
- `ONECEO_WEBAPP_MACRO_REVIEW_ANCHOR`

实际效果：

- 明确固定模板壳是部署契约，而不是建议。
- 明确 `client/` 负责浏览器 UI，`server/` 负责 HTTP 与接口，`shared/` 负责共享常量或类型。
- 明确 `package.json`、`oneceo.manifest.json`、`vite.config.ts` 属于契约文件，默认不得漂移。

### 2. 新建 deployable web app 任务默认进入蓝图型 todo 流程

修改文件：

- `/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-prompt-service.ts`
- `/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-setup-service.ts`

实际效果：

- 对于新建 deployable web app 任务，只要不是澄清态，就会强制进入 `deployable_web_app_blueprint` todo 原因分支。
- 不再只把 todo 当作 debug 或 integration 的附属机制。
- 让网站类任务在“开始写代码前”就进入蓝图约束。

### 3. 蓝图型 todo 的约束已落入 Prompt

实际加入的约束包括：

- todo 需要覆盖主要前端工作流、后端工作流、集成工作流、验收工作流。
- todo 需要绑定目标路径，例如：
  - `client/src/App.jsx`
  - `client/src/styles.css`
  - `server/index.ts`
  - `shared/...`
- 弱约束网站在缺少细节时，默认以：
  - hero
  - 核心价值/服务
  - 证明区/案例区/作品区
  - CTA/联系区
  作为默认页面骨架。

### 4. 宏观自检约束已加入 Prompt

实际加入的收尾要求包括：

- 检查 todo 承诺的路径是否都已落地。
- 检查固定模板壳契约是否仍成立。
- 检查主要用户要求模块是否存在。
- 检查是否出现非预期 runtime、启动脚本或目录漂移。
- 明确要求“高层复核”，避免逐文件全文重读。

### 5. 设计文档已同步更新并补锚点

修改文件：

- `/Users/watson/codingProj/oneceo/docs/部署工作台功能设计/06_生成应用部署基线/28_Manus固定模板收敛部署方案_[20260508-1039已采用].md`

新增内容：

- `6.0 锚点`
- `6.4 固定路径所有权`
- `7.3 Altus 必须先写蓝图型 todo`
- `7.5 Altus 结束前只做宏观自检`

## 本轮验证

### 单测

通过：

- `pnpm exec tsx --test tests/altus-managed-prompt-service.test.ts`
- `pnpm exec tsx --test tests/altus-managed-setup-service.test.ts`

覆盖点：

- deployable web app 是否进入蓝图型 todo 分支
- Prompt 是否包含固定模板壳锚点
- Prompt 是否包含蓝图 todo 约束
- Prompt 是否包含宏观自检约束

### Type Check

通过：

- `pnpm type-check`

## E2E 回测结果

### A. 强约束 case：企业官网固定模板

报告文件：

- `/Users/watson/codingProj/oneceo/apps/api/tests/e2e/reports/deployment-main-chain-2026-05-08T16-18-40-979Z-strong_constraints-strong-enterprise-official-shell-mox47do4.md`
- `/Users/watson/codingProj/oneceo/apps/api/tests/e2e/reports/deployment-main-chain-2026-05-08T16-18-40-979Z-strong_constraints-strong-enterprise-official-shell-mox47do4.json`

实际通过的阶段：

- `health`
- `login`
- `create_session`
- `runtime_start`
- `runtime_session_meta`
- `managed_input_submit`
- `managed_run_completed`
- `workspace_tree`

关键结论：

- 固定模板壳已经成功进入工作区，`hasOfficialShellShape=true`。
- 说明“运行时起不来”已经不是当前首阻塞。
- 当前失败点变成：marker 没有稳定落在 E2E 允许识别的标准入口文件中。

实际失败信息：

- `workspace should contain marker in a supported entry source`

这说明：

- 强约束下，模型已经可以进入固定壳并完成 run。
- 但模板内内容填充的落点准确性仍然不够稳定。

### B. 弱约束 case：设计工作室官网

本轮重新发起了新的弱约束主链回测，会话信息如下：

- task session: `27594bce-c795-46f8-a363-efdee41c650c`
- run id: `b4a403f6-b879-4e6e-a747-0d43f2118c66`
- model: `deepseek-v4-flash`

实际观察到的阶段：

- `health` 通过
- `login` 通过
- `create_session` 通过
- `runtime_start` 通过
- `managed_input_submit` 通过
- run 进入 `running`

实际运行信号：

- API 侧持续出现多轮 `POST /api/llm-proxy/v1/chat/completions`
- run 长时间停留在生成阶段
- 已出现持续 token 消耗迹象，因此人工终止并清理了该会话，避免继续空转

对该弱约束会话做的宏观检查结果：

- 当时工作区仅看到根层：
  - `index.html`
  - `oneceo.manifest.json`
  - `package.json`
  - `tsconfig.json`
  - `vite.config.ts`
- 当时尚未进入要求的：
  - `client/`
  - `server/`
  - `shared/`
  固定模板壳结构

---

## 2026-05-09 部署链路继续修复补记

### 做了什么

1. 继续检查部署功能当前未提交改动，确认本轮核心在：
   - 用户态部署 URL 选择统一到 `publicUrl/publicDomain`
   - `deployment-main-chain.e2e.ts` 支持聊天触发部署与更宽松的 analytics 收敛验证
2. 补齐 `task-session-deployment-runtime-service.ts`、`altus-managed-deployment-tool-service.ts` 中仍然只认 `latestStaticUrl/latestUrl` 的出口，统一复用同一套优先级。
3. 调整 E2E 收敛条件：当部署面板进入 `public_settling` 且已经返回可探测公网地址时，继续执行公网探测，而不是卡在“面板尚未 fully ready”的超时分支。
4. 同步更新部署 skill 文档与部署链路验收手册，补充聊天触发部署与 `public_settling` 回归约束。

### 遇到什么

- 当前仓库部署文档里同时存在“用户态优先 `publicUrl`”与“固定模板阶段优先 provider URL”两类表述，历史语义有叠层。
- 现状代码已经在用户态面板里引入 `publicUrl/publicDomain`，但部分状态文案、Altus 工具结果和 E2E 条件还停留在旧选择逻辑，导致链路表现不一致。

### 计划如何解决

1. 先用聚焦测试验证这次 URL 收口与 `public_settling` E2E 条件调整没有回归。
2. 如果测试通过，再根据结果决定是否继续清理剩余 provider/public URL 语义分层文档，避免后续开发再次混用。

这说明：

- 新增的蓝图型 todo 约束，对弱约束任务还没有形成足够强的“模板壳牵引力”。
- 弱约束任务目前仍可能先走根层 Vite 直写路径，而不是立即收敛到 Manus 式固定模板路径。

## 当前结论

### 已经确认有效的部分

1. 固定通用壳方向是对的。
2. 系统 Prompt 已经具备了明确的固定壳、固定路径、蓝图 todo、宏观自检锚点。
3. 强约束 case 已经能够稳定进入固定壳，不再卡在 runtime/start 或 Express 缺失一类基础壳问题上。

### 仍然存在的主要边界

1. 强约束下，内容填充落点还不够稳定。
2. 弱约束下，模型还没有被稳定牵引进 `client/server/shared` 模板路径。
3. 弱约束任务仍存在生成阶段长尾，表现为：
   - 多轮 LLM 调用
   - 收敛速度偏慢
   - token 持续消耗

## 对下一步优化方向的建议

### 建议 1：把“固定模板壳 materialize”前置成更强的执行前动作

当前 Prompt 层已经要求使用固定壳，但弱约束 case 的现场观察说明，仅靠 Prompt 约束还不够。

建议方向：

- 在 Altus 真正开始写代码前，更强地确保工作区已 materialize 出 `client/server/shared` 固定壳。
- 后续修改默认只允许围绕壳内路径进行。

### 建议 2：进一步压实“弱约束任务默认骨架”

当前 Prompt 已加入默认页面骨架，但从现场表现看，对弱约束收敛牵引仍偏弱。

建议方向：

- 继续强化“弱约束官网任务默认信息架构”。
- 让模型更少把时间花在决定“做什么形态的网站”，更多花在按固定路径填充内容。

### 建议 3：增加“标准入口落点约束”

当前强约束 case 的失败点是 marker 没稳定出现在标准入口文件。

建议方向：

- 明确要求首页主内容必须落在标准入口之一：
  - `client/src/App.jsx`
  - `client/src/App.tsx`
  - `client/src/main.jsx`
  - `client/src/main.tsx`
- 避免模型把关键内容落到非主入口或只落到中间构建产物。

## 本轮实际做了什么

简要汇总：

- 实现了固定模板壳相关 Prompt 锚点
- 实现了 deployable web app 的蓝图型 todo 触发逻辑
- 实现了宏观自检约束
- 更新了设计文档
- 跑通了相关单测与 type-check
- 跑了新的强约束 E2E
- 发起并观察了新的弱约束 E2E
- 对长尾弱约束 run 做了人工止损与会话清理

## 当前最值得确认的一点

本轮最核心的判断是：

**部署通用壳已经基本站住，当前主要问题已经转移到“模板内内容填充的入口准确性”和“弱约束任务进入固定壳的牵引力”上。**

这意味着下一层优化，应该重点放在：

- 固定壳前置 materialize 的强制性
- 弱约束任务默认骨架的收敛力
- 标准入口文件落点的硬约束

## 追加修复：源码型网站也先铺固定壳

基于上述审计结论，已追加一轮修复：

1. `不要部署，只完成源码` 的网站任务不再被归为非网站产物，而是保持为 `deployable_web_app`，同时 `deploymentAllowed=false`。
2. 官方固定模板 materialize 不再要求 `deploymentAllowed=true`；只要是新建 deployable web app，就可以在空工作区先铺 `client/`、`server/`、`shared/` 固定壳。
3. Prompt 与模板预置说明中增加硬约束：首页主内容、用户验收标识、hero、核心模块与浏览器交互必须写入 `client/src/App.jsx` 或 `client/src/App.tsx`，`client/src/main.*` 只负责挂载。

这次修复的目的不是放开部署权限，而是把“源码交付”和“在线部署”分开：源码交付也使用固定壳，部署工具仍然只在用户明确要求部署时才允许调用。

## 追加 E2E 回测：固定壳填充已通过到部署成功

回测命令：

- `ONECEO_E2E_CASE_FILTER=strong-enterprise-official-shell ONECEO_E2E_PUBLIC_FETCH_TIMEOUT_MS=5000 ONECEO_E2E_URL_TIMEOUT_MS=60000 pnpm --filter api run test:deployment-matrix:e2e:local`

报告文件：

- `/Users/watson/codingProj/oneceo/apps/api/tests/e2e/reports/deployment-main-chain-2026-05-08T17-24-49-798Z-strong_constraints-strong-enterprise-official-shell-mox6hy2r.md`
- `/Users/watson/codingProj/oneceo/apps/api/tests/e2e/reports/deployment-main-chain-2026-05-08T17-24-49-798Z-strong_constraints-strong-enterprise-official-shell-mox6hy2r.json`

实际通过阶段：

- `health`
- `login`
- `create_session`
- `runtime_start`
- `runtime_session_meta`
- `managed_input_submit`
- `managed_run_completed`
- `workspace_tree`
- `workspace_marker_source`
- `deployment_template_baseline`
- `deployment_trigger`
- `deployment_state_persisted`

关键证据：

- session: `430f1e17-b8bd-4cc7-990f-18b82360903d`
- run: `0e778cc4-bdc7-481c-b57b-cf87d130ee83`
- orchestrator: `iiokl9l8ljjdiw8ctfbp9`
- `workspace_tree.hasOfficialShellShape=true`
- marker 稳定落在 `client/src/App.jsx`
- `deploymentStatus=SUCCESS`
- `publicUrl=https://app-430f1e17-b8b-e01145-d579ae.oneceo.space`

本次失败点：

- E2E 最终失败在本机 Node `fetchPublicHtml(publicUrl)`，错误为 `TypeError: fetch failed`。
- 失败时平台侧部署状态已经是 `SUCCESS`，绑定状态是 `public_settling`，说明这次不是固定壳生成、App 入口填充、模板校验或部署触发失败。

补充验证：

- 普通沙箱内 `curl` 访问同一公网 URL 时无法解析域名，表现为 `Could not resolve host`。
- 在允许外部网络访问的环境下访问同一 URL，返回 `HTTP/2 200`，响应服务为 `railway-edge`。
- 公网 HTML 返回的是 Vite 入口壳，页面 marker 不在 HTML 直出中，而是在构建后的 JS bundle 中。
- 抓取 `/assets/index-iRzsaYNp.js` 后确认包含 `ONECEO_E2E_MARKER_mox6hydy`。

当前判断：

- “固定壳预铺 + App 路径填充 + 部署触发”主问题已被推进到可验证通过。
- 下一层风险已经转移到 E2E 公网抓取环境、CSR bundle marker 验收、public settling 状态推进、analytics 从 `bound` 到 `tracking` 的最终验收闭环。

## 2026-05-09 追加：浏览器运行时与 Umami tracking 闭环

本轮继续把部署验收从 `deploy=SUCCESS` 推进到真实浏览器访问：

- E2E 新增真实 Playwright 浏览器访问公网 URL。
- E2E 记录并要求 `analytics.oneceo.ai/api/send=200`。
- E2E 在 strict 模式下等待 `/deployment?refresh=1` 变为 `analyticsStatus=tracking`。
- E2E 默认要求 `pageErrors=[]`，避免页面实际白屏但部署状态成功的假阳性。

发现的问题：

- 强约束企业官网最终通过。
- 弱约束餐厅官网最终通过。
- 弱约束设计工作室官网首次部署成功但浏览器报 `React is not defined`。
- 失败 bundle 显示 React 包已经被打进产物，但业务组件里仍有裸 `React.createElement(...)`，说明 Altus 弱约束下可能生成显式 React 命名空间调用，而不是 JSX。

已修复：

- 部署归一化阶段的 React 导入补偿从 `.jsx/.tsx` 扩展到 `.js/.jsx/.ts/.tsx`。
- 只在源码里出现 `React.*` 或 JSX 信号时补 `import React from 'react';`，避免无差别改所有 JS 文件。
- 新增回归测试覆盖 `App.js` / `main.jsx` 中显式 `React.createElement(...)` 的形态。

验证结果：

- `pnpm type-check` 通过。
- `pnpm exec tsx --test tests/deployment-template-baseline-service.test.ts tests/oneceo-official-web-shell-materialization-service.test.ts tests/task-session-deployment-runtime-service.test.ts tests/altus-managed-prompt-service.test.ts` 通过，72 个测试全绿。
- 强约束报告：`apps/api/tests/e2e/reports/deployment-prompt-strength-matrix-2026-05-08T19-56-18-124Z.md`，`analyticsStatus=tracking`，`browserPageErrors=[]`。
- 弱约束餐厅报告：`apps/api/tests/e2e/reports/deployment-prompt-strength-matrix-2026-05-08T20-12-00-004Z.md`，该 case 通过。
- 弱约束设计工作室回测报告：`apps/api/tests/e2e/reports/deployment-prompt-strength-matrix-2026-05-08T20-22-28-296Z.md`，`analyticsStatus=tracking`，`browserPageErrors=[]`。

剩余风险：

- 弱约束任务生成阶段仍明显偏慢，LLM 调用轮次偏多。
- 下一层优化建议转向“弱提示词默认蓝图和完成条件收敛”，减少生成长尾，而不是继续增加部署后补丁。

## 追加修复：公网 URL 与 analytics bootstrap 验收闭环

本轮继续优化后，解决了三类更深层问题：

1. E2E 不再只检查 HTML 直出 marker，而是会解析 Vite/React 的 JS bundle，在 CSR 场景下确认 marker 是否真实发布。
2. 部署面板不再把 TLS 未就绪的 oneceo.space 自定义域名作为主要交付 URL；当 Railway provider 域名可用时，优先用 `*.up.railway.app` 做 `latestUrl/latestStaticUrl`。
3. 官方固定 Web Shell 的 `server/index.ts` 增加运行时 analytics 注入能力，会在响应 HTML 时根据 `VITE_ANALYTICS_*` 环境变量替换 `ONECEO_ANALYTICS` 占位，避免发布空注释。

最终强约束 E2E 报告：

- `/Users/watson/codingProj/oneceo/apps/api/tests/e2e/reports/deployment-prompt-strength-matrix-2026-05-08T18-51-15-005Z.md`
- `/Users/watson/codingProj/oneceo/apps/api/tests/e2e/reports/deployment-main-chain-2026-05-08T18-51-14-945Z-strong_constraints-strong-enterprise-official-shell-mox9nvir.json`

最终结果：

- `strongPassed=1/1`
- `bindingState=ready`
- `deploymentStatus=SUCCESS`
- `publicReachabilityStatus=passed`
- `publicMarkerStatus=passed`
- `analyticsBootstrapStatus=passed`
- `analyticsStatus=bound`
- `publicUrl=https://app-c51da447-526-20ac63-app-c51da447-526-20ac63.up.railway.app`

当前仍未覆盖：

- 本轮 E2E 通过 fetch 验证 HTML 与 JS bundle，不执行浏览器 JS，因此 analytics 已确认 bootstrap 发布，但统计状态仍是 `bound`。
- 下一步如果继续推进，应使用真实浏览器访问 public URL，等待 Umami 事件入库，再要求 `analyticsStatus=tracking`。

## 追加：部署前本地运行验收门

本次继续补齐固定模板部署风险：

- 新增 `task-session-deployment-local-preflight-service`，在 Railway 发布前于 sandbox 内按 manifest 契约执行依赖安装、build、start、healthcheck 与 Playwright smoke。
- 门禁只覆盖当前优先保障的 node/js/html 快车道栈；Java/PHP/Python 等暂时跳过，避免影响非目标语言的既有路径。
- `deploy_application` 遇到本地预检失败会返回 `local_preflight` 修复项，日志包含 install/build/server/browser 输出，停止继续推 Railway。
- 同步修复 provider `FAILED/CRASHED/REMOVED` 被误包装为 `public_settling` 的问题，失败状态会立即收敛到 `repair_required`。

验证：

- `pnpm type-check` 通过。
- `pnpm exec tsx --test tests/task-session-deployment-local-preflight-service.test.ts tests/altus-managed-deployment-tool-service.test.ts tests/task-session-deployment-runtime-service.test.ts` 通过，39 个测试全绿。
