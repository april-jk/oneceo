# 部署主链稳定性与 Railway / Umami / Agent 执行层修复方案 [20260417-2327已采用]

## 1. 目标

本方案只解决主链稳定性问题，不引入兼容分支，不增加新的部署供应商，不做补丁式兜底。

要一次性收敛的点只有四个：

1. Railway 部署资源要能稳定创建、修复、读取。
2. Umami 模板注入与 website 绑定要稳定落到真实部署产物，而不是只在检查面“看起来已接入”。
3. “部署”标签卡必须和 agent 执行层读取同一份部署绑定状态，不能一个报错、一个空白。
4. agent 必须把“模板问题”和“平台资源问题”分开处理，不能在 Railway 资源失效时继续做本地模板修补。
5. 部署成功必须以“公网真实可用”为准，不能把 Railway 的 `SUCCESS` 直接当成交付成功。

## 2. 范围

本次方案覆盖：

- `apps/api/src/services/platform-deployment-account-service.ts`
- `apps/api/src/services/task-session-deployment-runtime-service.ts`
- `apps/api/src/services/railway-deployment-service.ts`
- `apps/api/src/services/task-creation-deployment-source-service.ts`
- `apps/api/src/services/deployment-template-bootstrap-service.ts`
- `apps/api/src/services/task-session-deployment-analytics-service.ts`
- `apps/api/src/services/altus-managed-deployment-tool-service.ts`
- `apps/api/src/services/altus-run-coordinator.ts`
- `apps/web/client/src/components/OpencodePreviewPanel.tsx`

本次方案不覆盖：

- 新增其他部署平台
- 恢复旧 KVM 主链
- 为旧模板保留多套兼容注入逻辑

## 3. 现状证据

### 3.0 2026-04-19 新增真实回归证据：服务端模板会被误判为缺少 analytics 入口

在 `WD-PY-01` 真实回归中，生成产物是 Flask + Jinja 服务端模板站点，deploy run `4473829d-4ac6-4c4c-b55c-aaeef6fc0a99` 的多次 `deploy_application` 返回相同 repair 结论：

1. `repairChecks` 包含 `missing_analytics_entry`
2. baseline 已经补齐了 `start.command=gunicorn --bind 0.0.0.0:$PORT app:app`
3. healthcheck 与 build contract 已满足
4. 唯一剩余失败点是“未找到 HTML 入口文件，无法注入默认 analytics bootstrap”

进一步核对真实工作区可见，项目使用的是 `templates/home.html`、`templates/about.html` 等服务端模板，而不是固定 `templates/index.html`。

这说明当前模板基线还有一个新的结构性缺口：

- 注入逻辑按固定文件名查找模板
- 合规检测逻辑也按固定文件名查找模板
- 结果是 Flask/Jinja 这类正常 Web 项目会被误判为“没有 analytics 入口”

该问题已经通过平台修复收敛：模板入口从“固定候选”升级为“固定候选 + 服务端模板目录扫描”，并已由 `WD-PY-01`、`WD-PHP-01` 真实通过验证。

### 3.1 真实 session 证据

针对用户提供的 session `e45631d3-414d-4fd8-a1af-bcc08d06c8d8`，已通过带登录 cookie 的接口读取会话、部署、模板和消息记录，现象一致：

1. `/api/task-creation/sessions/:id/deployment/template` 返回 `status=ready`，`analyticsMode=platform_injected`，说明“模板基线检查面”认为当前模板可发布。
2. 同一 session 的消息历史里，`deploy_application` 连续两次返回：
   - `status=fatal_error`
   - `summary=发布暂未完成，内部调试信息已记录。`
   - `debug.rawError=Project not found`
3. 同一 session 的 `/api/task-creation/sessions/:id/deployment` 却返回：
   - `configured=false`
   - `canDeploy=true`
   - `message=首次部署时将自动准备托管仓库与部署资源，并发布当前工作区内容。`

这说明当前系统不是“单点失败”，而是三个面已经分叉：

- 模板检查面认为可发
- agent 执行面实际在 Railway 资源层失败
- 部署展示面却退回到了“从未部署”的初始态

### 3.2 代码层证据

#### 证据 A：per-user Railway project 没有做有效性重校验

`platform-deployment-account-service.ts` 里的 `ensureUserProject()` 只要本地已有 user project 记录，就直接返回，不会去 Railway 再确认这个 `projectId` 是否仍然存在。

而 `ensureProjectAccount()` 在首次为 session 创建环境 / 服务 / token 时，会继续依赖这个 per-user project。

这意味着一旦：

- Railway 侧 project 被手动删除
- workspace 关系变化
- 历史 project id 已失效

后续新 session 的首次部署就会在“创建 environment / service / token”之前或过程中直接报 `Project not found`，并且由于 session 级 account row 还没成功持久化，部署标签卡只能读到“空白初始态”。

这是当前最符合现象的高概率主因。

#### 证据 B：部署执行链和部署展示链读取的不是同一层状态

当前：

- 执行链走 `ensureProjectAccount()`
- 展示链走 `getProjectAccount()`

如果 session 级 account row 没持久化成功，展示链直接返回“首次部署”的空状态；但执行链已经在 Railway 资源准备阶段失败。

也就是说，“部署标签卡拿不到数据”并不等于没有发生过部署，而是当前读模型没有覆盖“资源准备失败 / 绑定失效”这类中间态。

#### 证据 C：Umami 注入契约仍然依赖 `%VITE_*%` 占位符

`deployment-template-bootstrap-service.ts` 注入到 HTML 的 bootstrap 仍然写入：

- `%VITE_ANALYTICS_ENABLED%`
- `%VITE_ANALYTICS_HOST%`
- `%VITE_ANALYTICS_ENDPOINT%`
- `%VITE_ANALYTICS_WEBSITE_ID%`
- `%VITE_ANALYTICS_TAG%`
- `%VITE_PUBLIC_DOMAIN%`

而 `task-creation-deployment-source-service.ts` 里只有静态模板 fallback server 会在运行时替换这些占位符。

这说明当前主链仍然存在契约漂移：

- 检查面看到的是“已经注入 bootstrap”
- 真实部署产物是否拿到可解析的 tracker 配置，则取决于具体模板、构建方式和 Railway 运行时

这与 `12_Umami站点统计不可用修复方案_[20260416-2140已采用].md` 的目标并不一致。

#### 证据 D：模板检查会在临时导出目录里注入，不等于真实发布产物已稳定注入

`inspectTaskSessionDeploymentTemplate()` 是在临时导出的 sourceDir 上执行 `ensureDeploymentTemplateBootstrap()`。

这会导致：

- “检查结果”可以显示 `platform_injected`
- 但这个状态本身并不能证明真实工作区或真实发布产物已经具备同样的注入结果

也就是说，检查面和发布面虽然调用了同一个 bootstrap 逻辑，但缺少同一份“最终发布契约产物”的对账结果。

#### 证据 E：Analytics 面板把“能读 Umami API”当成“统计已工作”

`buildTaskSessionAnalyticsPanel()` 只要能用 websiteId 读到 Umami `stats` 和 `active`，就直接返回 `status=ready`。

但这最多说明：

- Umami website 存在
- Umami API 可访问

并不证明：

- 线上站点真的加载了 tracker
- tracker 用的是最终 host / websiteId
- 线上域名和 Umami website domain 已最终对齐

现在缺的不是“再读一次 metrics”，而是“部署后真实 tracker 已触发”的验证状态。

#### 证据 F：agent 对平台资源错误的分类不够强约束

当前 `altus-managed-deployment-tool-service.ts` 在 baseline 仍为 `ready` 时会把错误归为 `fatal_error`，这本身没问题。

问题在于更上层对用户和模型暴露的信息仍然过于泛化：

- 对用户是“发布暂未完成，内部调试信息已记录”
- 对模型只有“不要 complete_task，继续修复或重试发布”

这会让模型在 Railway 资源层失败时继续尝试本地调试、改模板、跑本地 server，而不是先修复平台绑定。

用户提供的 session 里已经出现了这类行为：`Project not found` 之后，agent 继续做本地 `node server.js` 检查。

#### 证据 G：Railway 成功不等于最终公网可用

在 2026-04-19 的真实回归用例 `WD-NODE-01` 中，平台出现了新的稳定性缺口：

1. Railway deployment panel 返回 `latestStatus=SUCCESS`
2. task session deployment panel 返回 `bindingState=ready`
3. Altus deploy run 因此直接 `complete_task`
4. 但公网首页实际返回 500
5. Railway 运行日志明确报错：`layout is not defined`

这说明当前系统把“供应商层发布完成”错当成了“最终交付完成”。

这不是模板建议问题，而是平台成功判定问题。

## 4. 外部产品契约依据

以下外部依据用于约束本方案，不作为“猜测性实现”：

1. Railway Public API 官方文档说明：
   - Railway Public API 是和 Dashboard 同一套 GraphQL API。
   - Project token 只作用于单个 project environment。
   - Project token 使用 `Project-Access-Token` 头，不是 `Authorization: Bearer`。
2. Railway 部署官方文档说明：
   - 可通过 Public API 查询 deployments、logs、redeploy、rollback。
3. Umami 官方文档说明：
   - Website 更新接口是 `POST /api/websites/:websiteId`。
   - Tracker 关键配置是 `data-website-id`、`data-host-url`、`data-domains`、`data-tag`。
   - `stats` / `active` 接口能证明 website 数据面可读，但不直接证明浏览器端 tracker 已经稳定注入并成功上报。

## 5. 根因链路归纳

### 5.1 根因一：Railway 用户级根资源失效后，主链没有自动重建

当前资源模型是：

- 每用户固定一个 Railway project
- 每 session 一个独立 environment / service / repo / project token

这个模型本身没问题，问题是“用户级 project”是 session 级资源的根。

只要这个根失效：

- 新 session 无法创建 environment
- 无法创建 service
- 无法创建 project token
- 无法持久化 session 级 account
- 部署标签卡自然也读不到 session account

所以本次修复的第一优先级不是模板，不是 UI，而是“用户级 Railway project 的重校验和自修复”。

### 5.2 根因二：部署执行状态和部署展示状态没有统一成一个读模型

现在系统没有显式表达下面这些状态：

- 用户级 project 失效
- session 级 service / environment 丢失
- session 级 account 尚未持久化，但当前 deploy 已经失败
- provider 资源错误已发生，等待平台修复

于是展示层只能二选一：

- 有 account 就显示数据
- 没 account 就显示“首次部署”

这在失败场景下是错误的。

### 5.3 根因三：Umami 注入还是“占位符注入”，不是“最终契约注入”

当前真正注入进去的是一段依赖 `%VITE_*%` 的 bootstrap。

这不是稳定主链，因为它要求后续构建 / 运行时继续帮我们完成变量解析。

稳定主链应该是：

- 发布前就把 tracker 关键配置写成最终可执行契约
- 发布后只补最终 public domain / website domain 对齐
- 不允许线上 bootstrap 继续依赖未解析占位符

### 5.4 根因四：agent 没有把“平台资源错误”视为独立修复类别

当前 agent 能分辨模板基线不满足，但还不能把以下问题收敛成独立的“平台资源修复”动作：

- Railway project 不存在
- Railway service / environment 不存在
- repo source binding 丢失
- deployment trigger 丢失

于是模型会把失败误当成“应用本身还不够可部署”，继续在 workspace 里修修补补。

### 5.5 根因五：公网健康验证失败被吞掉，导致成功态上浮

当前部署执行链虽然包含 `public_reachability` 阶段，但当公网探测失败时，会直接返回旧 panel，而不是把失败继续向上抛出。

结果就是：

1. deploy action 拿到的 panel 仍可能是 `ready + SUCCESS + publicUrl`
2. deploy tool 继续返回 success
3. Altus 直接把任务视为完成

这条链路必须改成：

1. 若 Railway 终态成功但公网验证失败，则视为失败，不允许上浮成 success
2. 将失败信息保留在 deployment state / deployment panel 中
3. 让 Altus 继续修复应用本身，而不是误报交付完成

## 6. 修复原则

1. 不做兼容式分叉，统一到一条主链。
2. 先修 Railway 根资源与状态模型，再修 Umami 注入，再修 agent 分类。
3. 展示面必须复用执行面的同一份绑定状态，而不是各自拼装。
4. Umami 状态必须区分“已绑定”和“已验证有流量”。
5. 供应商资源错误不能再被模板修复逻辑吞掉。

## 7. 修复方案

### 7.1 Phase A：补齐 Railway 根资源重校验与重建

新增统一入口：`ensureValidUserProject()`

要求：

1. 先读取本地持久化的 per-user project row。
2. 再用 Railway GraphQL 校验 project 是否存在且仍属于当前 workspace。
3. 若校验失败且错误为 `Project not found`：
   - 直接创建新的 per-user project
   - 覆盖旧的 user project row
   - 后续 session 资源全部挂到新 project 下
4. 不允许继续拿失效 projectId 进入 `ensureProjectEnvironment()` / `createService()` / `createProjectToken()`。

同时要求 `repairExistingAccount()` 补全真正的修复语义：

- project 丢失：走全量重建
- environment 丢失：重建 environment
- service 丢失：重建 service、source、trigger、domain
- token 缺失：重建 token

而不是只在“已有 row”时默认沿用旧 projectId。

### 7.2 Phase B：把部署状态统一成单一读模型

新增统一解析层，供下面三个入口共用：

- 部署标签卡接口
- Altus `get_application_deployment_status`
- 执行时 `buildTaskSessionDeploymentResponse()`

这个统一读模型必须显式输出：

- `bindingState`
  - `uninitialized`
  - `provisioning`
  - `ready`
  - `repair_required`
  - `provider_error`
- `providerErrorCode`
- `providerErrorMessage`
- `lastVerifiedAt`
- `resourceBinding`
- `provisioningPhase`

要求：

- 当 session account row 不存在，但当前用户已有 deploy 尝试记录，或者 user project 已检测为失效时，不能再返回“首次部署”。
- 必须返回“资源准备失败 / 绑定失效”的明确状态。

### 7.3 Phase C：把 Umami 注入从占位符注入改为最终契约注入

本次不再接受“注入了一段还依赖 `%VITE_*%` 的脚本”作为完成态。

改法：

1. 发布阶段生成 OneCEO 自己的运行时 analytics 契约产物，来源只允许是平台后端。
2. HTML bootstrap 只读取这个契约产物，不直接依赖 `%VITE_*%`。
3. 在首次部署前就可确定的字段：
   - enabled
   - host
   - websiteId
   - tag
4. 在公网 URL 稳定后再补齐并回写的字段：
   - publicDomain
   - Umami website domain

这里的关键收敛点是：

- 前端 tracker 是否能工作，不应再依赖模板自己怎么读 Vite env
- 模板检查与真实发布应基于同一个契约产物

### 7.4 Phase D：把 Umami 状态拆成“绑定成功”和“跟踪已验证”

Analytics 状态需要改成至少四层：

- `pending_domain`：还没有稳定公网域名
- `bound`：website 已绑定，配置已写入部署契约
- `tracking`：已确认线上页面真实上报过 tracker
- `error` / `unconfigured`

验证逻辑要求：

1. 部署公网可达后，抓一次公开页面 HTML，确认 tracker 配置已落到真实页面。
2. 再做一次最小真实访问验证：
   - 通过浏览器访问公开页面，触发一次 pageview
   - 轮询 Umami `active` 或 `stats` 窗口
3. 只有验证通过，状态才允许从 `bound` 升到 `tracking`。

现在的“能读 Umami API 就算 ready”要取消。

### 7.5 Phase E：把 agent 的错误分类改成平台资源优先

managed deployment tool 结果需要明确分成三类：

1. `template_repair_required`
2. `resource_binding_repair_required`
3. `supplier_fatal`

处理规则：

- 只有 `template_repair_required` 才允许 agent 回到 workspace 修模板、补健康检查、补 manifest。
- `resource_binding_repair_required` 必须优先走平台资源修复逻辑，禁止继续本地模板修补。
- `supplier_fatal` 直接中止当前 deploy loop，并把 provider 错误显式反馈到部署面板和内部调试信息。

对应地，用户可见文案也不能再只有“内部调试信息已记录”，至少要暴露错误归类，例如：

- `Railway 资源绑定失效，平台正在重建部署 project / environment / service。`
- `Railway 已拒绝当前资源访问，请检查平台托管绑定。`

### 7.6 Phase F：让部署标签卡真正展示“失败中的资源态”

部署标签卡需要新增的不是按钮，而是状态真相：

- 当前绑定的 project / environment / service 是否存在
- 最后一次 provider 错误是什么
- 失败发生在 provision / publish / source-sync / deploy / public-reachability / analytics-finalize 哪一步
- analytics 当前是 `bound` 还是 `tracking`

只有这样，用户才能区分：

- 代码没有准备好
- 平台资源失效
- 网站能访问但统计还没开始

## 8. 实施顺序

按风险和依赖顺序，必须这样做：

1. Railway 根资源重校验与重建
2. 部署执行 / 展示统一读模型
3. Umami 注入契约去占位符化
4. Analytics `bound -> tracking` 验证链
5. agent 错误分类与提示修正
6. 回归测试与真实 session 复跑

不能把第 3、4、5 步提前到第 1、2 步之前，否则仍然会出现“模板已经绿了，但根资源还是坏的”。

## 9. 验收标准

### 9.1 Railway 资源层

1. 当 per-user Railway project 被外部删除后，下一次 deploy 会自动重建 project，并继续完成 session deploy。
2. 当 session service / environment 被删除后，deploy 能自动修复或明确落到 `resource_binding_repair_required`，不会退回“首次部署”。
3. 部署标签卡始终能显示当前资源状态和最后一次 provider 错误。

### 9.2 Umami 注入层

1. 发布产物中不存在未解析的 `%VITE_ANALYTICS_*%` 占位符。
2. 公开页面 HTML 能读到最终 tracker 配置。
3. Umami website domain 会在稳定公网 URL 出来后完成回写。
4. Analytics 面板能区分 `bound` 和 `tracking`。

### 9.3 Agent 执行层

1. 当 Railway 返回 `Project not found` 时，agent 不再去做本地模板修补或本地 `node server.js` 自测。
2. 只有 baseline 真有问题时，agent 才进入模板修复回路。
3. `complete_task` 仍然必须建立在 deploy success 之后。

## 10. 测试计划

### 10.1 单元测试

- stale per-user project row -> 自动重建 project
- stale session account row -> 自动修复 environment / service / token
- `/deployment` 在 account 缺失但 provider 失败已存在时返回 `repair_required`，而不是“首次部署”
- bootstrap 产物不再包含 `%VITE_*%`
- analytics 状态从 `pending_domain` -> `bound` -> `tracking`
- `Project not found` 被归类为 `resource_binding_repair_required`

### 10.2 集成验证

- 真实 Railway 测试 workspace 中手动删除 project，再跑 deploy
- 手动删除 service / environment，再跑 deploy
- 真实 Umami website 绑定、public domain 回写、tracker 验证

### 10.3 回放验证

- 以 `e45631d3-414d-4fd8-a1af-bcc08d06c8d8` 同类场景复跑
- 确认：
  - 不再出现 deploy fatal 后标签卡空白
  - 不再出现 deploy fatal 后 agent 继续本地模板修补
  - Umami 状态能从绑定推进到真实 tracking

## 11. 风险与取舍

### 风险一：根资源重建会影响当前所有部署用户

这是必要风险，因为 per-user Railway project 是当前资源模型的根。

控制方式：

- 所有重建逻辑必须 idempotent
- 仅在 provider 明确返回 not found / access invalid 时触发重建

### 风险二：tracking 验证存在时间窗口

Umami `stats` / `active` 有采样与聚合时间窗口，因此“页面访问后立刻看到数据”可能有秒级延迟。

控制方式：

- 把 `bound` 和 `tracking` 拆开
- 验证阶段允许短时间轮询，而不是把尚未出数误报成失败

### 风险三：不能再同时维护两套注入契约

这是刻意取舍。

如果继续同时支持：

- 占位符注入
- 模板自带 analytics
- 静态 fallback server 动态替换

主链只会越来越不稳定。

本次必须收敛到一套平台生成的运行时 analytics 契约。

## 12. 参考资料

- Railway Public API: https://docs.railway.com/integrations/api
- Railway Manage Deployments: https://docs.railway.com/integrations/api/manage-deployments
- Railway CLI Deploying: https://docs.railway.com/cli/deploying
- Umami Websites API: https://docs.umami.is/docs/api/websites
- Umami Website Statistics API: https://docs.umami.is/docs/api/website-stats
- Umami Tracker Configuration: https://docs.umami.is/docs/tracker-configuration

## 13. 结论

本问题现在不能再继续按“模板偶发不稳定”理解。

更准确的结论是：

1. Railway 根资源绑定已经可能失效，且没有自动重建。
2. 部署读模型没有覆盖“资源失败中间态”，导致部署标签卡假装自己什么都不知道。
3. Umami 注入仍然停留在占位符契约，检查面和真实发布面没有完全闭环。
4. agent 仍然会把平台资源错误误投到本地模板修复。

因此后续代码修复必须按本方案顺序推进，先修主链资源状态，再修注入契约，再修 agent 分类。
