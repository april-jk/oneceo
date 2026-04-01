# 连接器模块参照 Suna Integrations 重构设计

更新时间：2026-04-01

## 1. 任务背景

当前 oneceo 已经有一套可工作的 Connector Center，但它本质上还是固定连接器的硬编码实现：

- 后端当前实际固定 `github / slack / notion / postgres`
- catalog、OAuth、运行时配置、活动匹配都写在一个 `connector-registry.ts`
- 用户态授权只支持“每个用户每个连接器一份配置”
- 会话绑定只支持“按 connectorKey attach / detach”

这套实现能跑，但和 `suna` 的 Integrations 相比，缺少下面几层能力：

1. 配置驱动的连接器目录，而不是写死在代码里
2. profile 化的连接器配置，而不是单连接器单账号
3. 连接器定义、认证配置、已连接账号、运行时挂载之间的分层
4. 连接器配置和运行时启用工具的分离
5. 通用的自定义 MCP 接入方式

用户这次的要求不是修补当前四个连接器，而是按 `suna` 的 Integrations 方式，重构 oneceo 的连接器模块，并把能直接复用的连接器能力加进来。

## 1.1 当前采用的下游子方案

连接器能力增强的当前采用子方案为：

1. [20260401_连接器隐式Skills挂载与后台管理设计_[20260401-1037已采用].md](/Users/watson/codingProj/oneceo/docs/agent研发文档/20260401_连接器隐式Skills挂载与后台管理设计_[20260401-1037已采用].md)

该子方案约束如下：

1. 首批只覆盖 `GitHub / Supabase / Vercel`
2. 用户态完全不展示隐式挂载的 skill 列表
3. 管理后台负责 connector implicit skills 的配置、发布、回滚和治理

## 2. 本设计的明确前提

这里必须先把边界说清楚，否则后续实现会偏航。

### 2.1 本设计默认前提

本设计默认：

1. **不把 Composio 作为新的平台级强依赖接入 oneceo**
2. **学习 `suna` 的连接器配置方式和模型分层**
3. **在 oneceo 现有 API / Web / OpenCode runtime / OSAC 链路内完成实现**
4. **连接器配置发生在 sandbox 外部，sandbox 内部只消费运行时投影后的连接器能力**

原因很直接：

1. `suna` 的大量 app integrations 实际依赖的是 `Composio` SaaS 和它的 Python 服务层，不是仓库里一组可直接复制的 TypeScript 连接器。
2. oneceo 当前主链路在 `apps/api`，运行时挂载依赖我们自己的 session、sandbox、OpenCode `/mcp` 热更新链路。
3. 直接把 `suna` 的 Composio 后端引入 oneceo，不是“学习配置方式”，而是新增一个外部平台依赖和一整条新认证链路，这已经是另一套系统方案。
4. 连接器配置、OAuth、profile 管理都应该发生在平台侧；sandbox 内不承担配置职责，只承接 runtime attach 后的 MCP 使用。

### 2.2 如果你要的不是这个前提

如果你真正要的是：

1. oneceo 直接接入 Composio
2. 直接复用 `suna` 的 toolkit 搜索、auth config、connected account、MCP URL 生成整条链路

那需要我改写本设计文档，方案会完全不同，且会新增外部平台依赖、Webhook、加密存储和新的服务边界。

## 3. 从 Suna 提炼出的可复用模型

我已阅读 `referance/suna` 中和 Integrations 直接相关的代码，核心结论如下。

### 3.1 Suna 的核心分层

`suna` 不是“连接器硬编码列表”，而是下面这条链：

1. `toolkit`
   - 代表某类集成，例如 GitHub、Slack、Gmail、Linear
   - 包含展示信息、auth scheme、categories、logo、描述
2. `auth config`
   - 代表某个 toolkit 的认证配置模板
   - 决定这个集成要走什么认证模式、有哪些字段
3. `connected account`
   - 代表某个用户发起的一次实际授权连接
   - 具有 OAuth redirect / status / connected_account_id
4. `credential profile`
   - 代表对某个集成的一份可复用配置档案
   - agent/runtime 不直接拿 token，而是引用 profile
5. `agent MCP config`
   - agent 里只保存 `profile_id + enabledTools + toolkit identity`
   - 真正运行时再通过 profile 解析出可用 MCP 配置

### 3.2 Suna 的配置方式精髓

`suna` 真正值得学的，不是它接了 Composio，而是下面几件事：

1. **定义层和实例层分离**
   - toolkit 是定义
   - profile / connected account 是实例
2. **agent/runtime 不直接依赖裸 token**
   - 它只依赖 profile id
3. **配置表单由 definition 驱动**
   - 字段不是前端写死，而是由 auth config / toolkit details 驱动
4. **运行时启用工具和认证配置分离**
   - enabled tools 可以变，但 profile 本身不必重建
5. **支持 custom MCP**
   - 允许用户把 HTTP/SSE MCP 直接加进系统
6. **配置与使用分离**
   - 集成在平台外部页面完成配置
   - runtime 在 sandbox 内部只按 profile 消费

### 3.3 Suna 中可直接为 oneceo 复用的思路

可直接复用的是“模型”和“配置方式”，不是 Python 代码本身。

oneceo 能直接吸收的部分有：

1. definition -> profile -> session binding -> runtime materialization 这条结构
2. profile 化存储，而不是单连接器单账号
3. custom HTTP / SSE MCP 的通用接入方式
4. 运行时只引用 profile，不直接散落 token
5. 工具白名单 `enabledTools` 的配置位置

不能直接照搬的部分有：

1. `ComposioClient`
2. `auth_config_service.py`
3. `connected_account_service.py`
4. `mcp_server_service.py`
5. 依赖 Supabase + Python 的 Composio profile 服务

这些都不是 oneceo 当前架构内的最短路径实现。

## 4. oneceo 当前实现存在的问题

### 4.1 定义和实例耦合

当前 `apps/api/src/services/connector-registry.ts` 同时承担：

1. 连接器目录
2. auth mode 定义
3. config field 定义
4. OAuth provider 定义
5. runtime config materialize
6. tool usage matcher

这会导致：

1. 每加一个连接器都要改核心文件
2. 前端字段和后端字段天然写死耦合
3. 无法扩展多 profile

### 4.2 用户配置模型过窄

当前 `user_connector_accounts` 的主键语义是：

`userId + connectorKey`

也就是：

1. 一个用户只能给一个连接器存一份配置
2. 不能同时保存多个 GitHub token / 多个数据库 / 多个 Notion workspace
3. 不能把“连接器定义”和“连接器实例”区分开

### 4.3 会话绑定模型过窄

当前 `task_session_connector_bindings` 只按 `taskSessionId + connectorKey` 绑定。

这意味着：

1. 会话不能选择某个连接器的具体 profile
2. 不能记录某个会话对某个连接器启用了哪些 tools
3. 无法对接 `suna` 风格的 runtime config 引用

### 4.4 前端 UI 被固定连接器卡死

当前前端：

1. `ConnectorCenterPanel.tsx`
2. `ConnectorDialog.tsx`
3. `connectors-client.ts`

都建立在固定 `ConnectorKey` 联合类型上。

这会导致：

1. 新连接器必须改 TS 类型
2. 新图标映射必须手工改
3. 表单和运行时状态都不具备 profile 粒度

## 5. 目标方案

## 5.1 目标一句话

把 oneceo 的连接器模块改成：

**定义驱动 + profile 驱动 + session 引用 profile + runtime 再 materialize 的结构。**

这就是 oneceo 版本的 `suna` Integrations。

## 5.2 本次必须达到的结果

1. 连接器定义不再硬编码在一个大文件里
2. 用户可以对同一连接器保存多个 profile
3. task session attach 的对象变成 `profile`
4. session binding 可以保存 `enabledTools`
5. 阶段一直接集成 `github / notion / slack / supabase / figma / vercel`
6. `supabase` 作为独立连接器接入，不替换成 `postgres` 的别名或变体
7. `postgres` 保留底层兼容与迁移能力，但暂时弃用，不出现在连接器选择菜单
8. 后续新增连接器时，原则上只需要新增 definition 文件和必要 provider

## 5.3 本次不做的事

1. 不接入 Composio
2. 不做 `suna` 那种在线搜索上千个 toolkit 的 marketplace
3. 不在本轮接入新的第三方 webhook 系统
4. 不改 OSAC / E2B 的服务边界
5. 不把 `supabase` 简化成单纯的 Postgres DSN 连接器

## 6. 目标架构

### 6.1 新的对象模型

在 oneceo 中，重构后的对象关系如下：

1. `ConnectorDefinition`
   - 描述某一类连接器的静态定义
   - 例如 `github`, `supabase`, `figma`, `vercel`
2. `ConnectorProfile`
   - 用户保存的一份连接器配置实例
   - 例如 “GitHub - 公司仓库 PAT”、“Supabase - Production”、“Vercel - Team A”
3. `TaskSessionConnectorBinding`
   - 会话里启用的某个 profile
   - 附带 `enabledTools`、runtimeStatus、desiredState
4. `ConnectorRuntimeConfig`
   - 运行时生成的 OpenCode MCP 配置

### 6.2 设计原则

1. definition 只定义“这个连接器是什么”
2. profile 只定义“这个用户配置了什么”
3. session binding 只定义“这个会话挂了哪个 profile，以及启用了哪些工具”
4. runtime materializer 只负责“把 profile + definition 组装成 OpenCode 可消费的 MCP 配置”
5. sandbox 内不出现“配置连接器”的入口或职责，只出现“使用已配置连接器”的运行时能力

这四层不再混在一起。

## 7. 数据模型改造

### 7.1 新增表：`user_connector_profiles`

新增用户 profile 表，替代当前“一用户一连接器一份账号”的限制。

建议字段：

1. `id`
2. `user_id`
3. `connector_key`
4. `profile_name`
5. `display_name`
6. `auth_mode`
7. `auth_status`
8. `config_json`
9. `secret_ciphertext`
10. `metadata_json`
11. `is_default`
12. `last_auth_at`
13. `last_error`
14. `created_at`
15. `updated_at`

约束：

1. `unique(user_id, connector_key, profile_name)`
2. `index(user_id, connector_key)`

说明：

1. `config_json` 保存非敏感配置
2. `secret_ciphertext` 保存敏感配置，继续沿用现有加密方案
3. `metadata_json` 保存 definition 额外元数据，例如远端 headers 模板展开参数、profile 来源、toolkit 信息

### 7.2 迁移现有表 `task_session_connector_bindings`

现有表要扩成“绑定 profile”，不再只绑定 connectorKey。

建议新增字段：

1. `profile_id`
2. `enabled_tools` `jsonb`
3. `definition_snapshot_json` `jsonb`
4. `session_config_json` `jsonb`

建议唯一约束调整为：

1. `unique(task_session_id, profile_id)`

保留字段：

1. `connector_key`
2. `desired_state`
3. `runtime_status`
4. `orchestrator_session_id`
5. `server_name`
6. `last_used_at`
7. `last_error`

说明：

1. `connector_key` 继续保留，便于快速聚合与兼容已有统计逻辑
2. `definition_snapshot_json` 用于记录 attach 当时的定义快照，避免 definition 未来变更导致运行态语义漂移
3. `session_config_json` 保存“这个会话如何使用该 profile”的额外约束
4. 对 GitHub，`session_config_json` 的最小结构为：

```json
{
  "repositories": ["owner/repo-a", "owner/repo-b"]
}
```

5. `repositories` 只属于 session binding，不属于 profile
6. profile 表示“哪个 GitHub 账号 / token”
7. session binding 表示“当前会话允许使用这个账号访问哪些仓库”

### 7.3 调整 `connector_auth_requests`

OAuth 事务表新增：

1. `profile_id` 可空
2. `profile_draft_json` 可空

原因：

1. OAuth 现在不再总是覆盖单个 connector account
2. 一次 OAuth 要明确落到哪个 profile

## 8. 代码结构改造

### 8.1 后端目录调整

新增或重构：

1. `apps/api/src/connectors/definitions/`
   - 每个连接器一个 definition 文件
2. `apps/api/src/connectors/definitions/index.ts`
   - 统一导出 definition 列表
3. `apps/api/src/services/connector-definition-registry.ts`
   - 管理 definition catalog
4. `apps/api/src/services/connector-profile-service.ts`
   - 取代 `user-connector-service.ts` 的主体职责
5. `apps/api/src/services/connector-runtime-materializer.ts`
   - 单独负责 runtime config 生成
6. `apps/api/src/services/session-connector-service.ts`
   - 从“按 connectorKey attach”改为“按 profile attach”

### 8.2 旧文件职责收缩

`apps/api/src/services/connector-registry.ts` 不再保留现在这种大而全职责。

它会拆成三层：

1. definition catalog
2. OAuth provider resolver
3. runtime materializer

## 9. Connector Definition 设计

### 9.1 统一 definition 结构

每个连接器定义至少包含：

1. `key`
2. `name`
3. `description`
4. `icon`
5. `category`
6. `auth`
7. `configFields`
8. `runtime`
9. `tooling`
10. `availability`

建议类型结构：

```ts
type ConnectorDefinition = {
  key: string;
  name: string;
  description: string;
  icon: string;
  category: 'built_in' | 'custom_mcp' | 'remote_adapter';
  auth: {
    mode: 'oauth' | 'token' | 'dsn' | 'none' | 'custom';
    provider?: string;
    supportsMultipleProfiles: boolean;
  };
  configFields: ConnectorConfigField[];
  runtime: {
    type: 'local_stdio' | 'remote_http' | 'remote_sse' | 'custom_http' | 'custom_sse';
    materialize: 'github' | 'supabase' | 'figma' | 'vercel' | 'remote_template';
  };
  tooling?: {
    supportsEnabledTools: boolean;
    discoverTools?: boolean;
  };
};
```

### 9.2 为什么要这样定义

这是对 `suna` 的“toolkit details + auth config + runtime config”三层做 oneceo 化压缩。

oneceo 不需要 Composio 的超大 catalog，但需要它的抽象方式。

## 10. 阶段一连接器范围

### 10.1 阶段一必须集成

阶段一按用户最新确认，只集成下面 6 个连接器定义：

1. `github`
2. `notion`
3. `slack`
4. `supabase`
5. `figma`
6. `vercel`

### 10.1.1 GitHub 配置体验原则

GitHub 在阶段一需要额外遵守一个易用性原则：

1. 默认优先 OAuth，一键创建默认 profile 并进入授权
2. 不要求用户在首次授权前先填写 `profileName`
3. `profileName / displayName` 尽量由平台根据 GitHub 账号自动回填
4. Personal Access Token 作为高级配置入口，不作为默认主路径
5. 当前版本不在 oneceo 内重复做“仓库授权”假流程，仓库访问范围直接以 GitHub OAuth / PAT 的真实权限为准
6. GitHub 详情页的默认交互应收敛到“一个主按钮发起 OAuth”，而不是复用通用连接器的 profile/说明/资料卡布局
7. GitHub 弹窗不复用通用连接器的顶部标题栏，改为独立的单列居中布局，只保留右上角关闭按钮和主体内容
8. GitHub 的“显示详情”区域只保留状态与运行相关信息，不展示 Personal Access Token 入口

原因：

1. 当前 oneceo 的 GitHub runtime 直接依赖 `@modelcontextprotocol/server-github` 和实际 GitHub token
2. 该运行时能力当前没有 oneceo 自己维护的 repo 白名单物化链路
3. 如果前端额外做一层“授权仓库”但运行时不真实执行，会造成错误心智和权限错配

### 10.1.2 GitHub 会话仓库授权原则

在 GitHub 已完成 OAuth/profile 授权之后，会话页还需要补一层“当前会话允许访问哪些仓库”的真实约束。

这里必须明确：

1. 这不是重新做一次 GitHub OAuth
2. 这也不是 profile 级配置
3. 这是 **session 级 repo allowlist**
4. 作用范围只限“当前会话挂载后的 GitHub MCP 使用”

实现原则：

1. 一级弹层显示 GitHub 已连接状态与当前会话是否已挂载
2. GitHub 二级页不再以“选择 profile”为主，而是以“选择授权仓库”为主
3. profile 只作为仓库列表的数据来源与身份来源
4. 仓库选择结果必须真实保存到 session binding
5. runtime 必须真实消费这份仓库 allowlist，而不是只改 UI 文案

最短路径定义：

1. 若某个 GitHub profile 已授权，则二级页默认展示该 profile 下可访问的仓库列表
2. 用户勾选 1 个或多个仓库后点击授权
3. attach 请求把 `profileId + repositories[]` 一起提交
4. 平台把 `repositories[]` 保存进 `session_config_json`
5. sandbox 内 GitHub MCP 只允许访问这批仓库
6. 若 GitHub REST 返回 `401 Bad credentials`，平台必须立即把该 profile 改写为 `needs_auth`、清除失效 token，并在设置页/会话页统一提示“需要重新授权”

反例：

1. 只把二级页标题改成“选择仓库”，但 attach 仍然只传 `profileId`
2. 只在前端记住仓库选择，不落 session binding
3. runtime 继续放行 token 所有仓库

以上都属于假流程，本设计禁止。

### 10.2 `supabase` 的语义

`supabase` 必须按“独立产品连接器”设计，而不是复用 `postgres` 连接器替代。

这意味着：

1. UI 中单独展示 `supabase`
2. profile 中保存的是 Supabase 级配置，不是单纯数据库 DSN
3. runtime materializer 要针对 Supabase 生成独立 MCP 配置
4. 不能在菜单里让用户看到 `postgres` 然后要求他们自己理解那其实是在连 Supabase

同时必须遵守一个实现原则：

1. Supabase 的 project/token/url 等配置全部在 sandbox 外部完成
2. sandbox 内部只拿到已经解析好的 runtime MCP 配置
3. 不允许把 Supabase 的配置流程下沉到 sandbox 内让模型或用户再次配置

### 10.3 `postgres` 的状态

`postgres` 暂时弃用，但不在本轮物理删除。

规则：

1. 保留已有数据迁移与底层 runtime materializer 能力，避免直接破坏历史数据
2. 不出现在连接器选择菜单
3. 不作为阶段一验收对象
4. 如果历史 session 里仍有 `postgres` binding，只做被动读取，不再允许新建

### 10.4 阶段二预留

`custom_http_mcp / custom_sse_mcp` 仍然保留在设计预留中，但不占用阶段一交付范围。

## 11. Session 配置方式完全对齐 Suna 的落点

这里是本次设计最关键的部分。

### 11.1 当前 oneceo 的 attach 语义

现在是：

`attach(sessionId, connectorKey)`

### 11.2 改造后的 attach 语义

要改成：

`attach(sessionId, profileId, enabledTools?, sessionConfig?)`

也就是：

1. session 不再直接挂 connector 定义
2. session 挂的是某个用户 profile
3. 如果该连接器支持工具白名单，可以附带 `enabledTools`
4. 如果该连接器支持 session 级使用范围约束，可以附带 `sessionConfig`
5. attach 时由平台侧把 profile + sessionConfig 解析成 runtime config，再投影到 sandbox 内部

这就是 `suna` 的 agent MCP 配置语义在 oneceo session 维度上的映射。

### 11.3 为什么必须这么改

因为真正复用连接器配置的单位，从来都不是“GitHub 这个名字”，而是：

1. 哪个 token
2. 哪个 workspace / endpoint
3. 哪个 profile
4. 当前会话要不要只开放部分工具
5. 当前会话是否只允许访问其中几个 GitHub 仓库

这也是 `suna` 把运行时配置建立在 profile 之上的原因。

## 12. 前端改造

### 12.1 设置页 Connector Center

当前连接器中心要从“固定连接器配置面板”改为“两层结构”：

1. 左侧：Connector Definitions
2. 右侧：该 definition 下的 Profiles 列表和编辑器

用户操作从：

1. 编辑一个 connector

变为：

1. 选择某个 connector definition
2. 新建 / 编辑 / 删除 profile
3. 设为默认 profile
4. 如果支持 OAuth，则从 profile 维度发起 OAuth

这个页面明确属于 sandbox 外部平台配置页面。

### 12.2 会话内 Plug 弹窗

会话连接器弹窗要从“某个 connector 开/关”改成：

1. 显示可用 definitions
2. 在每个 definition 下展示可挂载的 profiles
3. 当前会话 attach 的是某个 profile
4. 若连接器支持 tools，允许配置 `enabledTools`

### 12.2.1 GitHub 的会话弹窗特殊化

GitHub 不能继续复用现在“二级页 = 选择 profile”的结构。

GitHub 在会话页上的正确结构应改为两层：

1. 一级页：
   - 显示 GitHub 行项目
   - 展示当前授权账号
   - 展示当前会话是否已挂载
   - 展示已授权仓库数量摘要，例如 `2 repos authorized`
2. 二级页：
   - 顶部显示当前使用的 GitHub profile/account
   - 提供仓库搜索框
   - 提供可滚动的仓库列表
   - 当前版本一个会话只授权一个仓库
   - 底部主按钮为“授权/更新”，把单个仓库提交到当前会话

GitHub 二级页不再出现：

1. `Choose profile` 下拉作为主入口
2. “配置位置 / 当前用途 / 可用 profiles”这类说明卡
3. “Docs” 这种和当前会话挂载无关的次要操作

取而代之的是：

1. 当前账号摘要
2. 紧凑搜索框 + 可滚动仓库列表
3. 点击仓库行即把该仓库授权到当前会话，不再额外保留底部提交区
4. 行内单选态 check，而不是 checkbox 表单堆叠
5. 二级页固定贴在一级连接器面板右侧，作为稳定子菜单显示
6. 长仓库名只在必要位置摘要显示，避免主列表和底部动作区遮挡
7. 二级页容器需要有明确高度，内部仓库列表才能形成真实滚动区
8. 底部只保留“配置 GitHub”入口

原因：

1. 用户在会话内的真实任务不是“理解 profile 模型”
2. 用户在会话内真正关心的是“这个 session 现在能访问哪些仓库”
3. GitHub 是唯一一个当前明确需要 session 级 repo scope 的连接器
4. 仓库选择器应该尽量接近命令面板/资源选择器，而不是连接器管理后台

### 12.3 前端类型层改造

`ConnectorKey` 不能再是固定 union。

需要调整为：

1. `connectorKey: string`
2. `profileId: string`
3. `enabledTools: string[]`

前端图标映射也从硬编码 map 改成 definition 提供的 icon name。

## 13. 运行时 materialize 方案

### 13.1 保持 oneceo 现有边界

所有 runtime attach / detach 仍然必须走：

1. `apps/api/src/services/session-connector-service.ts`
2. `apps/api/src/connectors/e2b-connector.ts`
3. OpenCode `/mcp` 链路

并且要新增一条强约束：

4. connector profile 的创建、编辑、OAuth 回调、删除全部在 sandbox 外部完成
5. sandbox 内部只接收 materialize 后的 MCP config、header、token 映射或远端 URL

### 13.2 新的 runtime 组装逻辑

流程改为：

1. session 读取 profile binding 与 `session_config_json`
2. profile service 取 profile
3. definition registry 取 definition
4. runtime materializer 生成 MCP config
5. session connector service 执行 attach / detach / reconcile

换句话说：

1. 平台外部负责“配置”
2. sandbox 内部负责“使用”

### 13.3 `enabledTools` 的使用

本轮规则：

1. 对支持工具筛选的连接器，把 `enabledTools` 注入 runtime config
2. 对不支持的连接器，`enabledTools` 仍然保存，但不下发运行时

这样做的原因：

1. 数据模型先和 `suna` 对齐
2. 不因为少量 runtime provider 暂不支持就破坏整体模型

### 13.4 GitHub repo allowlist 的 runtime 约束

GitHub 要做仓库授权页，runtime 就必须真实执行 repo allowlist。

最短路径实现如下：

1. 保留当前 `@modelcontextprotocol/server-github` 作为底层 provider
2. 在 oneceo 侧新增一个 GitHub MCP wrapper/proxy
3. wrapper 负责：
   - 启动底层 `server-github`
   - 读取 `ONECEO_GITHUB_ALLOWED_REPOSITORIES`
   - 拦截 MCP `tools/call`
   - 对请求参数中的仓库标识做校验
   - 如果目标仓库不在 allowlist 中，直接拒绝

建议识别的仓库参数形态：

1. `owner + repo`
2. `repository = owner/repo`
3. `full_name = owner/repo`

这样做的原因：

1. 当前 `server-github` 的接入方式只是 token 注入，没有 repo 级参数
2. 如果不在 oneceo wrapper 层拦截，session 级 repo allowlist 无法真实生效
3. 这条路径比重写整个 GitHub MCP 更短，也不会引入假流程

这一层完成后，GitHub 的仓库授权二级页才成立。

### 13.5 GitHub repo 列表获取

为了支撑二级页，需要新增 GitHub 仓库列表接口。

最短路径：

1. 新增 GitHub-specific API
2. 输入：`profileId`
3. 输出：当前 profile/token 可访问的仓库列表

建议接口：

`GET /api/connectors/github/profiles/:profileId/repositories`

返回结构至少包含：

1. `id`
2. `fullName`
3. `owner`
4. `name`
5. `private`
6. `permissions`（可选）
7. `defaultBranch`（可选）

前端二级页只消费这个列表，不自己猜仓库。

补充约束：

1. GitHub session 级 attach 一旦选择了仓库列表，该 session 的 GitHub MCP 作用域就收敛为这些仓库，而不是整账号权限。
2. 像 `create_repository` 这类账号级能力，如果目标仓库不在当前 session 的授权仓库范围内，运行时必须明确返回“当前会话仅授权这些仓库，不能创建或写入新的仓库”，不能只返回通用 `MCP_TOOL_CALL_FAILED`。
3. Altus system prompt 也必须把 `authorized_repositories` 明确展示给模型，避免模型把 repo-scoped session 误判成 account-wide GitHub access。
4. 如果 GitHub session attach 未选择任何仓库，则该 session 视为账号级 GitHub 能力开放，允许 `create_repository` 这类账号级操作。
5. Altus 动态 MCP tool name 不能直接用长 `providerId` 截断生成，否则多个工具会发生命名碰撞；必须使用稳定短哈希保证每个 `providerId + toolName` 唯一映射。
6. 当 GitHub MCP 返回 `Resource not accessible by integration` 时，平台必须优先解释为 GitHub App 权限或安装审批问题，明确提示检查：
   `Permissions & events -> Administration: Read and write`
   安装页是否已批准新增权限
   安装范围是否覆盖目标账号/组织
   组织是否允许该 App 创建仓库
7. 用户在设置页执行“清除授权”后，前端必须同步清空本地表单里残留的 secret 字段，后续再次点击连接必须重新走 GitHub OAuth 跳转，不能把旧 token 通过保存 profile 悄悄写回。

### 13.6 GitHub OAuth 成功不等于 installation 就绪

本次线上排查已经确认一个必须收敛的事实：

1. 当前 oneceo 走的是 GitHub App 的 OAuth，拿到的是 `ghu_` 前缀的 user access token
2. 仅有 OAuth 成功，并不代表当前 GitHub App 已安装到用户账号或组织
3. 如果 token 对应 `GET /user/installations` 返回 `total_count = 0`，则该 token 不能视为“GitHub 可用”
4. 在这种状态下，`create_repository` 会直接得到 GitHub 原生 `403 Resource not accessible by integration`

因此当前设计必须补充一个更严格的判定：

1. GitHub OAuth callback 成功后，平台必须立刻校验 `GET /user/installations`
2. 若返回 0 个 installation，则 profile 不能写成 `authorized`
3. 该 profile 必须改写为 `needs_auth`，并给出明确错误：
   `GitHub App 已授权，但当前账号下没有任何可用安装。请先在 GitHub 安装该 App 或批准安装更新后，再重新连接。`
4. 当前 session 的 runtime refresh 也不能继续执行，因为这不是一个真实可用的 GitHub profile
5. 任何 GitHub attach / repo 列表 / repo 操作前，也必须再次验证 installation 是否存在，防止旧的假成功状态残留

这条约束的原因很直接：

1. 当前运行时底层仍然是 `@modelcontextprotocol/server-github`
2. oneceo 只是把用户 token 注入该 provider
3. 如果平台不先保证 installation-ready，模型和用户都会误以为“已经连接完成”
4. 这会形成“UI 已连接，但创建仓库恒定 403”的假成功体验

### 13.7 GitHub 断开连接的正确语义

本次继续排查后，又确认了一条必须收敛的交互语义：

1. 用户点击“取消授权”时，首先需要快速清掉平台本地授权态
2. GitHub 远端 grant revoke 与 session runtime detach 可以继续做，但不能阻塞前端一直转圈
3. 否则用户会看到按钮长期 loading，却在关闭弹窗后发现本地状态其实已经清掉，造成“系统流程不可信”的体验

因此断开连接必须调整为：

1. 本地 profile 清理优先完成并立即返回给前端
2. session runtime detach 改为后台异步执行
3. GitHub 远端 revoke 失败不应阻塞本地断开，但必须把结果显式返回给前端
4. 当前端收到 `remoteGrantRevoked=false` 时，必须明确提示：
   - 本地状态已清除
   - GitHub 远端撤销未确认
   - 若重新连接时 GitHub 直接回跳，应去 GitHub 授权页手动撤销

这样做的原因：

1. “本地已清除”和“GitHub 远端仍记得该 App 已授权”是两个独立状态
2. 用户看到“重新连接直接回跳”，并不必然说明 oneceo 本地没有断开
3. 如果平台不把这两层状态拆开显示，用户会误以为断开流程根本没执行

## 14. 最小实现路径

本任务是长任务，但实现上不能过度设计。

最短路径如下：

### 阶段 1：定义层抽离与阶段一目录切换

1. 把当前连接器从 `connector-registry.ts` 拆到 definition 文件
2. 建立新的 definition registry
3. 让 catalog 只暴露阶段一的 `github / notion / slack / supabase / figma / vercel`
4. 将 `postgres` 标记为 deprecated 且隐藏

### 阶段 2：profile 化

1. 新增 `user_connector_profiles`
2. 迁移现有 `user_connector_accounts` 数据到默认 profile
3. 新建 profile service

### 阶段 3：session 绑定 profile

1. 扩展 `task_session_connector_bindings`
2. attach / detach 改成按 profile
3. attach 请求支持 `sessionConfig`
4. 前端弹窗切到 profile 视图

### 阶段 3.5：GitHub 会话仓库授权

1. 新增 GitHub repo 列表接口
2. 给 session binding 增加 `session_config_json`
3. `ConnectorDialog` 的 GitHub 二级页改成 repo selector
4. attach 时提交 `repositories[]`
5. GitHub runtime wrapper 按 repo allowlist 拦截调用

### 阶段 4：阶段一连接器 runtime 实现

1. 接入 `github`
2. 接入 `notion`
3. 接入 `slack`
4. 接入 `supabase`
5. 接入 `figma`
6. 接入 `vercel`

### 阶段 5：阶段一验收与回归验证

1. GitHub
2. Notion
3. Slack
4. Supabase
5. Figma
6. Vercel

## 15. 受影响文件

后端核心：

1. `apps/api/src/services/connector-registry.ts`
2. `apps/api/src/services/user-connector-service.ts`
3. `apps/api/src/services/session-connector-service.ts`
4. `apps/api/src/routes/connector-routes.ts`
5. `apps/api/src/routes/task-creation-routes.ts`
6. `apps/api/src/db/schema.ts`
7. `apps/api/src/db/migrate.ts`
8. `apps/api/src/db/dao/*connector*`
9. `apps/api/src/services/github-connector-repository-service.ts`
10. `apps/api/src/services/connector-registry.ts`（内联 GitHub MCP allowlist wrapper）

前端核心：

1. `apps/web/client/src/lib/connectors-client.ts`
2. `apps/web/client/src/components/ConnectorCenterPanel.tsx`
3. `apps/web/client/src/components/ConnectorDialog.tsx`
4. `apps/web/client/src/lib/connector-guides.ts`

补充口径（2026-03-30）：

1. 用户态 `设置 -> Connectors` 中，点击连接器卡片后不再在页内右侧展开详情。
2. 详情改为独立 modal 展示。
3. modal 内部统一使用单列布局，依次展示：
   - 基本信息
   - profile 选择与操作
   - 凭证/配置表单
   - 配置指引
   - 使用边界
4. `Altus mode` 的 session 级 connector attach 统一走 `OSAC` provider lifecycle，不再依赖 OpenCode `/mcp` 配置热同步。
5. 复用中的 Altus sandbox 在挂载 session connector 时，不应额外触发 `syncOpencodeRuntimeConfig()` 或 OpenCode server 重启。

新增目录：

1. `apps/api/src/connectors/definitions/`
2. `apps/api/src/services/connector-profile-service.ts`
3. `apps/api/src/services/connector-runtime-materializer.ts`
4. `apps/api/src/connectors/runtime/`

## 16. 风险与处理

### 16.1 风险 1：现有 attach 逻辑回归

处理：

1. 先迁移四个已有连接器
2. attach / detach / reconcile 都走同一条 materialize 逻辑
3. 做 session 级最小回归测试

### 16.5 风险 5：GitHub 仓库授权页做成假流程

处理：

1. 不允许只改前端页面命名
2. attach 必须落 `repositories[]`
3. runtime 必须真实校验 repo allowlist
4. 如果 runtime 校验未完成，GitHub 二级页就不能宣称“授权仓库”

### 16.2 风险 2：数据迁移把已有授权态冲掉

处理：

1. migration 时把 `user_connector_accounts` 全量转为每个 connector 的默认 profile
2. 保留旧表一段时间只读迁移，不先物理删除

### 16.3 风险 3：前端一次性重构过大

处理：

1. 先把 API 改成 profile 模型
2. 再调整两个主要 UI 组件
3. 不新增额外页面，只重构现有入口

### 16.4 风险 4：`supabase` 被错误实现成 `postgres` 替身

处理：

1. definition 层明确将 `supabase` 设为独立 connector key
2. UI 层完全隐藏 `postgres`
3. profile schema 不允许只出现 `dsn` 一个字段就算完成 `supabase` 接入

## 17. 实施后验收标准

### 17.1 配置层

1. 设置页可以在同一连接器下创建多个 profile
2. profile 可以被设为默认
3. OAuth / token / dsn 都能落到 profile

### 17.2 会话层

1. 会话 attach 的对象是 profile
2. 会话能显示当前 profile 名称
3. 会话状态里能看到 `enabledTools`
4. GitHub 会话二级页能展示可选仓库列表
5. GitHub attach 时能提交并回显当前会话的 `repositories[]`

### 17.3 运行时层

1. GitHub / Notion / Slack / Supabase / Figma / Vercel 都能按新模型 attach
2. `postgres` 不出现在选择菜单
3. sandbox 重连后 reconcile 仍然正常
4. sandbox 内不需要再次做连接器配置
5. GitHub runtime 对不在 allowlist 内的仓库请求会拒绝，而不是放过 token 的全部权限

### 17.4 GitHub App 授权页交互

1. 设置页清除 GitHub 授权时，必须同时撤销 GitHub 侧 OAuth grant，并清除 oneceo 本地保存的授权态
2. GitHub 连接器详情弹窗必须明确提供“管理 GitHub 授权”和“管理 GitHub 安装”两个入口
3. GitHub 连接器详情弹窗的主操作按钮必须始终允许重新发起 OAuth，而不是用其他入口替代
4. GitHub OAuth 要保持 GitHub 标准 `login/oauth/authorize` 流程，不额外注入 `prompt=select_account` 之类会触发账户挑战页的参数
5. GitHub App 的安装权限更新不等于 OAuth 重新授权；当 GitHub 返回 `Resource not accessible by integration` 时，前端要明确引导用户检查安装权限审批、安装范围和组织仓库创建策略
6. Altus 在新的 managed run 中，不得直接沿用历史 GitHub tool failure 作为当前结论；如果用户说明已重新授权、重新连接或要求重试，必须在当前 run 重新调用相关工具后才能判断仍然失败
7. Session connectors 摘要要带出 `last_authorized_at`；Altus 必须把所有早于该时间的连接器失败视为过期结论
8. OAuth 回调一旦成功，平台必须自动刷新所有引用该 profile 的 attached session binding，把最新授权同步进当前 session 与 OSAC runtime；这条链路应对用户透明，不能要求用户手动重新挂载或理解 OSAC
9. session MCP recovery 属于后台任务；数据库瞬时断连（如 `ECONNRESET`）只能记录并跳过当前周期，不能把异常抛穿到 API 进程导致服务崩溃
10. GitHub 点击“断开连接”必须同时撤销 GitHub 侧 OAuth grant、清空 oneceo 本地授权态，并自动卸载所有引用该 profile 的 session runtime 绑定；不能只做本地清除
11. GitHub 点击“连接/重新连接”必须固定从标准 `https://github.com/login/oauth/authorize` 入口重新发起 OAuth；不能跳过这一步，也不能允许环境变量把授权入口改成其他路径
12. GitHub 点击“断开连接”虽然必须彻底，但不能无限等待远端；GitHub revoke 要有明确超时，session runtime detach 要尽量并行执行，前端列表刷新不得阻塞用户交互

## 18. 结论

本次 oneceo 连接器模块重构，不应该把焦点放在“抄一份 `suna` 代码”，而应该放在：

1. 吸收 `suna` Integrations 的正确抽象
2. 把 oneceo 从固定 connectorKey 模型升级到 definition + profile + binding 模型
3. 阶段一先接入 `github / notion / slack / supabase / figma / vercel`
4. 让 `supabase` 独立存在，`postgres` 暂时弃用且不出现在前台菜单
5. 预留 `custom_http_mcp / custom_sse_mcp` 到后续阶段
6. 明确遵守“sandbox 外配置，sandbox 内使用”的边界

这是符合 oneceo 当前架构边界、又能真正复用 `suna` 配置思想的最短路径实现。

---

## 待你确认后再进入开发

请先确认下面这件事：

1. **按本文默认前提推进**
   - 不引入 Composio
   - 重构 oneceo 自有连接器模块
   - 阶段一先接入 `github / notion / slack / supabase / figma / vercel`
   - `postgres` 暂时弃用且不出现在选择菜单
   - 连接器在 sandbox 外部配置，在 sandbox 内部使用

如果你确认，我下一步就按这份文档开始拆代码和迁移数据结构。

在正式编码前，我还需要你确认一句话：

**你说的“直接接入整个 Supabase”，阶段一是否要求至少覆盖 `database + auth + storage + edge/functions + project management` 这类 Supabase 产品面，还是只要求按官方 Supabase MCP 能力接入其可直接暴露的工具集合？**
