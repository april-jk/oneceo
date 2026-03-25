# 2026-03-20 管理后台 KVM 管理 · Sandbox 页面重设计方案

## 目标

重做 `apps/admin_management` 中 `KVM 管理 · Sandbox` 页面，使其不再只是 E2B 原始能力的浅包装，而是基于 oneceo 当前真实 sandbox 使用方式的“运行态管理控制台”。

本次设计覆盖：

- 页面布局
- 视觉与信息层级
- 管理功能重组
- 后台接口补充范围
- 前后端实现边界

本次设计不覆盖：

- 非 Sandbox 的 KVM 页面
- task 页面主产品流程
- OSAC / OpenCode / Codex 底层执行逻辑重构

## 现状问题

当前 `KVM 管理 · Sandbox` 页存在以下结构性问题：

1. 页面模型错误  
   现有页面以 “E2B sandboxes + templates + tools” 为中心，但 oneceo 实际使用 sandbox 的主对象不是“孤立 sandbox”，而是：
   - `taskSessionId`
   - `orchestratorSessionId / sandboxId`
   - `executor`（`opencode` / `codex` / `claudecode` 预留）
   - `workspace / state / archive`
   - `OSAC / OpenCode / App Server` 运行链路

2. 关键管理信息缺失  
   当前页几乎看不到：
   - sandbox 与 task session 的绑定关系
   - executor 类型和 execution mode
   - OSAC 连接地址 / token / host port
   - OpenCode base URL / traffic access token
   - 最近活跃时间、活跃原因、dirty 状态
   - archive / restore 状态
   - workspace 与 state 路径
   - warm pool / reusable sandbox / degraded 状态

3. 功能视角偏底层 SDK  
   当前 `Tools` 区是 E2B SDK action passthrough，适合调试，不适合作为主要管理入口。
   管理后台应该优先提供“平台语义动作”，而不是“底层函数调用面板”。

4. 模板管理与运行实例混排  
   运行中的 sandbox、模板构建、模板动作、原始工具执行放在同一页层级，导致阅读路径混乱。

## oneceo 当前 Sandbox 使用链路

根据代码与文档，当前平台的 sandbox 使用方式至少包括以下链路：

### 1. 环境创建

- 统一通过 `apps/api/src/connectors/e2b-connector.ts`
- 由 `sandboxEnvironmentService` / `sandboxAgentProvisionService` 创建
- 默认模板来自 `apps/api/src/config/e2b-config.ts`
- metadata 中会写入：
  - `sandboxProvider`
  - `taskSessionId`
  - `sandboxExecutor`
  - `codexExecutionMode`
  - `e2b.sandboxId / template / timeoutMs / sandboxDomain / trafficAccessToken`
  - `opencodeBaseUrl`
  - `osacEndpoint / osacHostPort / osacAuthToken`
  - `lastActiveAt / lastActiveReason`

### 2. 执行器运行

- `sandboxExecutorRegistry` 负责按 executor 路由
- 当前主执行器：
  - `opencode`
  - `codex`
- `claudecode` 预留但未接入

### 3. 运行态活跃与状态更新

- `touchSandbox()` 更新 `lastActiveAt` / `lastActiveReason`
- `markSandboxDirty()` 与 `clearSandboxDirty()` 管理 archive dirty 状态
- `sandbox_execution_environments` 是平台内部的运行态记录表

### 4. 归档与恢复

- `sandbox-archive-service.ts` 负责 workspace/state 归档与恢复
- archive 目标是 R2
- 会记录：
  - `archiveStatus`
  - `archiveDirty`
  - `pendingArchiveUpdate`
  - `archivePendingSince`
  - `r2ArchiveKey`
  - `workspaceRoot`
  - `stateRoot`
  - `codexArchiveHome`
  - `codexDotCodexPath`

### 5. 运行模式差异

- OpenCode HTTP / SSE
- OSAC relay
- Codex SDK / WS(App Server) 模式

这意味着 Sandbox 管理页必须面向“平台运行链路”，不能继续停留在“E2B list + detail”层。

## 新页面定位

新的 `KVM 管理 · Sandbox` 页面定位为：

**Sandbox Runtime Console**

用于管理以下对象：

- 正在被任务使用或曾被任务使用的 sandbox runtime
- sandbox 与 task session / executor / connector 的绑定关系
- sandbox 的活跃、归档、恢复、连接、模板和调试状态

## 页面信息架构

页面拆成 4 个一级工作区，不再只用 `Sandboxes / Templates` 二分法。

### A. 运行总览

目标：一分钟内看清当前运行态风险。

内容：

- 摘要卡
  - 总环境数
  - 运行中
  - 已暂停
  - 待归档更新
  - 归档失败
  - 连接异常
- 风险列表
  - 长时间未活跃但仍 running
  - OSAC endpoint 缺失
  - OpenCode base URL 缺失
  - archive dirty 持续未清理
  - taskSession 绑定缺失
- 分布图
  - executor 分布
  - template 分布
  - archiveStatus 分布
  - 最近活跃趋势

### B. Runtime 列表

目标：以 oneceo 语义管理每个 sandbox runtime。

每行字段：

- Sandbox ID / orchestratorSessionId
- Task Session ID
- Executor
- Execution Mode
- Template
- Runtime Status
- Archive Status
- Last Active At
- Last Active Reason
- Created At
- 关键操作

行级操作：

- 查看详情
- 刷新状态
- 延长超时
- 暂停 / 恢复
- 终止
- 触发归档
- 触发恢复

筛选器：

- executor
- status
- archiveStatus
- template
- hasTaskSession
- lastActive 超时区间
- search（sandboxId / taskSessionId / endpoint / vmName）

### C. Runtime 详情 Inspector

目标：针对单个 sandbox 做排障和治理。

详情拆成 6 个 tab：

1. `Overview`
   - sandbox 基本信息
   - task session 绑定
   - executor / mode
   - timeout / public traffic / internet access
   - current status / closedAt

2. `Connectivity`
   - osacEndpoint / osacHost / osacHostPort / auth token 是否存在
   - opencodeBaseUrl / port / trafficAccessToken 是否存在
   - sandboxDomain
   - 最近连接错误
   - 一键连通性检查

3. `Workspace & Archive`
   - workspaceRoot
   - stateRoot
   - archiveStatus
   - archiveDirty / pendingArchiveUpdate
   - archive keys
   - 最近归档时间 / 恢复时间
   - 一键触发 archive / restore

4. `Runtime Metadata`
   - 标准化展示 metadata，不先丢整块 JSON
   - 原始 metadata 折叠查看

5. `Metrics & Activity`
   - CPU / memory / disk 曲线
   - 最近活跃时间线
   - 关键 activity reason 分布

6. `Advanced`
   - 工具直调区（保留，但降级为高级调试）
   - 只面向内部排障，不作为主入口

### D. 模板治理

目标：模板构建与运行态分离，模板管理成为独立工作区。

内容：

- 模板摘要
  - 模板总数
  - 默认模板
  - 最近构建失败数
- 模板列表
  - templateId
  - alias
  - status
  - updatedAt
  - build count
- 模板详情
  - template 信息
  - builds
  - logs
  - update / rebuild / delete
- 别名与标签管理

## 重点功能设计

### 1. 平台语义动作

页面优先提供以下平台语义动作，而不是 SDK 原语动作：

- `刷新运行态`
- `延长 timeout`
- `暂停`
- `恢复`
- `命令执行与输出回显`
- `文件下发 / 目录查看 / 文件读取`
- `进程列表 / 杀进程`
- `端口查看 / host 映射查询`

## 本轮落地情况

已在 `apps/admin_management` 和 `apps/api` 落地以下能力：

- 管理后台新增 `Runtime Registry` 视图，按 `taskSessionId / sandboxId / executor / archive / risk` 聚合展示运行态
- 新增 `Runtime Detail` inspector，覆盖：
  - `Overview`
  - `Connectivity`
  - `Archive`
  - `Metrics`
  - `Advanced`
- 管理后台新增运行态动作：
  - `archive`
  - `restore`
  - `connectivity-check`
  - `refresh-runtime`
- 管理后台后端新增聚合接口：
  - `GET /api/sandbox-management/runtime-registry`
  - `GET /api/sandbox-management/environments/:sandboxId/runtime-detail`
  - `POST /api/sandbox-management/environments/:sandboxId/archive`
  - `POST /api/sandbox-management/environments/:sandboxId/restore`
  - `POST /api/sandbox-management/environments/:sandboxId/connectivity-check`
  - `POST /api/sandbox-management/environments/:sandboxId/refresh-runtime`
- oneceo API 新增 sandbox 运维接口透出：
  - `POST /api/sandbox/environment/:sessionId/archive`
  - `POST /api/sandbox/environment/:sessionId/restore`
  - `POST /api/sandbox/environment/:sessionId/connectivity-check`

当前仍保留原始 `Advanced` 工具面板，用于内部排障，但已经降级为次级入口，不再作为页面主结构。

## Debug Workbench 补充设计

`Runtime Inspector > Advanced` 继续下沉成 `Debug Workbench`，面向真实调试动作而不是裸 action/payload：

- `Command Console`
  - 输入 shell 命令
  - 执行并回显 stdout / stderr / exitCode
  - 允许查看当前命令进程列表
- `File Ops`
  - 输入目标路径
  - 查看目录内容
  - 读取文件
  - 直接下发文本文件到 sandbox
- `Process Manager`
  - 拉取运行进程列表
  - 输入 pid 直接 kill
- `Port Inspector`
  - 查看监听端口
  - 按 port 查询 `sandbox.host()` 对外映射
- `Raw Action`
  - 保留原始 tool action 面板
  - 仅作高级兜底，不作为默认操作流
- `终止`
- `标记并触发归档`
- `从 archive 恢复`
- `检查 OpenCode 可达性`
- `检查 OSAC 可达性`
- `检查 workspace/state 路径`

### 2. 运行风险识别

新增 runtime 风险标签：

- `unbound_task_session`
- `missing_osac_endpoint`
- `missing_opencode_base_url`
- `archive_pending_too_long`
- `archive_failed`
- `inactive_but_running`
- `missing_executor_metadata`
- `template_mismatch`

这些标签应出现在：

- 概览风险列表
- Runtime 列表行标签
- Runtime 详情页头部

### 3. 任务绑定视角

Sandbox 管理页必须支持按 `taskSessionId` 管理，而不是只按 `sandboxId` 管理。

原因：

- 平台用户关注的是“哪个任务的 runtime 出问题了”
- 归档/恢复/连接/调试均围绕 task session 进行

因此需要：

- 列表支持 taskSessionId 搜索
- 详情直接展示 taskSessionId
- 能跳转到对应会话详情页

### 4. Archive 生命周期管理

当前系统已有归档能力，但后台没有可操作的生命周期面板。

需要补以下功能：

- 查看 archiveStatus
- 查看 dirty / pending 状态
- 查看 archive key / snapshot key / metadata key
- 手动触发 archive
- 手动触发 restore
- 查看最近 archive / restore 结果

### 5. 连接治理

当前系统中 sandbox 的关键可用性来自连接链路，而不是单纯实例是否 running。

必须增加：

- OSAC 连接信息
- OpenCode HTTP 信息
- trafficAccessToken 存在性
- App Server / Codex mode 信息
- 最近检查结果

## 后台接口补充建议

当前 `apps/admin_management/server/services/sandbox-management-service.ts` 只提供：

- overview
- environment detail
- metrics
- close / pause / resume
- tool action
- templates

这不足以支撑新页面，需要补一组平台语义接口。

建议新增：

### 1. `GET /api/sandbox-management/runtime-registry`

返回平台内部 runtime registry，数据源优先使用 `sandbox_execution_environments`，再补充 E2B 实时状态。

字段建议：

- sandboxId / orchestratorSessionId
- taskSessionId
- executor
- codexExecutionMode
- template
- status
- sandboxState
- archiveStatus
- archiveDirty
- pendingArchiveUpdate
- lastActiveAt
- lastActiveReason
- opencodeBaseUrl
- osacEndpoint
- osacHostPort
- trafficAccessTokenPresent
- createdAt / updatedAt / closedAt
- riskTags

### 2. `GET /api/sandbox-management/environments/:sandboxId/runtime-detail`

返回面向页面的聚合详情：

- DB environment
- E2B info
- metadata summary
- binding summary
- archive summary
- connectivity summary

### 3. `POST /api/sandbox-management/environments/:sandboxId/archive`

手动触发 archive。

### 4. `POST /api/sandbox-management/environments/:sandboxId/restore`

手动触发 restore。

### 5. `POST /api/sandbox-management/environments/:sandboxId/connectivity-check`

执行：

- OSAC endpoint basic check
- OpenCode health check
- workspace/state path check

### 6. `POST /api/sandbox-management/environments/:sandboxId/refresh-runtime`

从 E2B + DB 重新同步关键运行态并回写 metadata 摘要。

## 前端实现建议

### 结构调整

现有 `App.tsx` 中 Sandbox 区块建议重构为：

- `renderSandboxOverview()`
- `renderSandboxRuntimeRegistry()`
- `renderSandboxInspector()`
- `renderSandboxTemplateGovernance()`

不建议继续把所有布局直接堆在同一个 JSX 块里。

### 组件建议

建议新增但控制在最小必要数量：

- `SandboxRuntimeTable`
- `SandboxRiskList`
- `SandboxInspector`
- `SandboxConnectivityCard`
- `SandboxArchiveCard`
- `SandboxTemplatePanel`

### 样式方向

- 延续当前管理后台亮色商务风
- Sandbox 页面比普通页面更强调“状态、风险、结构化排障”
- 列表优先，不做大面积炫技图形
- JSON 原始数据全部折叠到二级层

## 交付边界

本次重设计按两阶段推进：

### 第一阶段：结构重做 + 现有能力重组

- 重做页面布局
- 加入 runtime registry 视角
- 重组现有 sandbox / template / metrics / detail
- 增加风险标签与详情面板

### 第二阶段：补后台语义接口

- archive / restore
- connectivity-check
- runtime-registry
- runtime-detail 聚合

## 验收标准

1. 用户能在 1 分钟内判断当前 sandbox 是否存在风险。
2. 用户能按 `taskSessionId` 找到对应 runtime。
3. 用户能看到 archive / restore / connectivity 的关键状态。
4. 模板治理与运行实例不再混在同一工作区。
5. 高级调试能力仍保留，但不再成为页面主路径。

## 开发前确认

按仓库协作规则，这份文档需要你确认后，我再开始开发。

请你确认两点：

1. 是否接受新页面从“E2B 列表页”升级为“oneceo Sandbox Runtime Console”。
2. 是否允许我在本轮同时补后台接口（archive / restore / connectivity-check / runtime-registry），而不是只做前端重排。

## 2026-03-22 实现更新

`Runtime Inspector` 已进入基于设计稿语言的统一收口阶段，当前状态如下：

- 顶部五个标签卡已统一为 `stitch` 方案对应的浅灰导航卡语言，包含编号、激活态主色和更强的秩序感。
- 五个标签页下方内容区已切到同一套容器体系：
  - `inspector-stat-grid`
  - `inspector-card`
  - `inspector-card-header`
  - `inspector-kv-grid`
  - `inspector-log-shell`
- `Overview / Connectivity / Archive / Metrics / Advanced` 不再各自使用割裂的小块样式，改为统一的“摘要卡 + 主内容卡 + 日志/结果区”结构。
- `Connectivity` 的配置区与日志区、`Archive` 的状态卡与快照表、`Metrics` 的摘要与主图、`Advanced` 的命令区与工具区，现已使用统一边框、留白、标题层级和滚动容器。
- 本轮重点不是新增功能，而是把已有功能放进统一的后台工作台视觉系统里，避免标签切换后像进入五个不同页面。

### Advanced 终端化与文件菜单化调整（2026-03-22）

- `Advanced` 的结果台已重构为 `Runtime Terminal`，命令输入改为终端底部发送框，执行回显直接写入终端窗口。
- 命令执行功能不再独立占用卡片，统一并入终端交互流（`显示回显 -> 继续输入下一条命令`）。
- 文件能力改为 `File Manager` 菜单样式：
  - 左侧目录菜单与快速动作（刷新目录、读取文件、保存文件）
  - 右侧文件路径与编辑区
- `文件结果` 独立面板已移除，文件管理不再依赖 JSON 回显区域。
- 进程和端口结果改为各自卡片内就地展示，避免单独结果台造成信息重复。

当前前端验证结果：

- `apps/admin_management` 下 `npm run type-check` 通过
- `apps/admin_management` 下 `npm run build` 通过
