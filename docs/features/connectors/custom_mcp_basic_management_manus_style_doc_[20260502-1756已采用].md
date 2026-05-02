# 20260502 自定义 MCP 基础管理与 Manus 风格连接器排版开发文档 [20260502-1756已采用]

状态：`[20260502-1756已采用]`

更新时间：2026-05-02

关联文档：
- `PRODUCT.md`
- `DESIGN.md`
- `docs/features/connectors/custom_api_generated_mcp_tools_execution_doc_[20260502-1642已采用].md`（需后续按“自定义 API 不默认生成 tools”的最新产品口径修订）

## 1. 背景与目标

当前连接器中心已经按 `应用 / 自定义 API / 自定义 MCP` 分组，但自定义 MCP 还缺少完整的配置、编辑、JSON 导入、删除和会话 attach 闭环。用户给出的参考图是 Manus 的连接器弹窗排版：顶部为连接器标题与分组 tab，中间左侧提供“添加自定义 MCP 服务器”的入口，右侧以卡片列出已添加 MCP；配置弹窗支持直接配置、试用、保存、管理菜单、编辑 JSON、删除。

本方案目标是在 oneceo 的“任务塔台”设计北极星下，复刻 Manus 的主流程与紧凑排版，但保持 oneceo 平台管理员和高密度治理场景所需的可复核、可审计、可恢复原则。

核心目标：
1. 在连接器中心新增可用的自定义 MCP 管理能力。
2. 支持添加、删除、编辑基础表单、编辑 JSON、通过 JSON 导入。
3. 保存 JSON 时必须判断 MCP 类型，第一版只允许远程 MCP，不支持 `stdio` / 本地进程类 MCP。
4. 支持会话选择并 attach 自定义 MCP，使 Altus 在任务中可以使用该 MCP 暴露的工具。
5. secret 不进入 sandbox、prompt、tool 参数或前端持久化明文；运行时仍通过 oneceo API 与 OSAC 链路闭环。

## 2. 非目标

第一版不做：
1. 不支持 `stdio`、本地命令、Node/Python 包启动、Docker 本地启动等本地 MCP。
2. 不支持用户上传并在 sandbox 内运行 MCP server。
3. 不支持把用户自定义 MCP URL 直接下发给 sandbox 让 agent 自行连接。
4. 不支持未校验 URL、未校验 headers 的任意 MCP 直连。
5. 不做 MCP marketplace、团队级共享、权限审批流。
6. 不做复杂 OpenAPI 到 MCP 的转换；自定义 API 只按“外部 API 服务调用配置”理解，不在本方案中默认生成 MCP tools。

## 3. 产品定义

### 3.1 自定义 MCP 与自定义 API 的边界

`自定义 API`：
- 用户录入其他平台或服务提供的 HTTP API 配置，类似配置 AI API 服务、业务系统 API 服务或第三方 HTTP 服务。
- 它的核心是“保存 API 服务连接信息并由 oneceo 代理调用”，不是默认把每个 endpoint 审核后生成 MCP tool。
- 校验重点是 URL、鉴权、headers、请求方式、调用权限和 secret 安全；不应套用自定义 MCP 的 transport 规则，也不应默认要求 endpoint 级工具审核。
- 这类 API 服务可以后续被业务流程、agent 编排或平台功能调用，但是否生成 tools 应作为单独能力设计，不能作为自定义 API 的默认定义。

`自定义 MCP`：
- 用户录入已经存在的远程 MCP server。
- oneceo 作为 MCP 代理和凭证边界，向远程 MCP 发起 MCP 协议通信。
- 运行时 Altus 看到的是 oneceo 代理后的 MCP tools，而不是直接看到远程 MCP server URL 或 secret。

因此本方案新增的是 `custom_mcp` 连接器能力，不替代 `custom_api`，也不把 `custom_api` 强行收敛成 MCP tool 生成器。

### 3.2 支持的 MCP 类型

第一版允许：
1. `streamable_http`
2. `http`
3. `sse`

第一版禁止：
1. `stdio`
2. `local`
3. `command`
4. `npx`
5. `node`
6. `python`
7. `docker`
8. 任意出现 `command`、`args`、`env`、`cwd`、`stdio` 语义的配置

保存时以后端判断为准。前端可以提前提示，但不能作为唯一安全边界。

## 4. 参考排版与 oneceo 风格结合

### 4.1 连接器中心弹窗

沿用当前 oneceo `ConnectorCenterPanel` 的连接器中心入口，但在 `自定义 MCP` tab 下按 Manus 的结构组织：

```text
连接器                                      关闭

应用    自定义 API    自定义 MCP           搜索
------------------------------------------------

左列：
┌ 添加自定义 MCP 服务器 v ┐
└ JSON 导入 / 直接配置     ┘

右列：
┌ MCP 卡片：名称 / 图标 / 状态 / 勾选 ┐
┌ MCP 卡片：名称 / 图标 / 状态 / 勾选 ┐
```

oneceo 风格要求：
1. 不做营销式卡片，不加装饰性渐变和大面积插画。
2. 卡片圆角控制在现有设计系统范围内，默认不超过 8px，除非当前组件库已有更大半径规范。
3. 信息密度高于 Manus：卡片除名称外，需要显示传输类型、状态、最近校验时间或错误摘要。
4. 操作入口清晰：卡片点击进入配置弹窗；右侧状态勾选表示可用或已连接，不承担编辑入口。
5. 搜索支持名称、URL host、备注关键字。

### 4.2 添加入口

`添加自定义 MCP 服务器` 是主按钮，展开后有两个选项：
1. `通过 JSON 导入`
2. `直接配置`

交互规则：
1. 点击主按钮默认打开菜单，不直接创建空记录。
2. `通过 JSON 导入` 打开 JSON 编辑弹窗。
3. `直接配置` 打开 MCP 配置弹窗。
4. 如果当前 tab 没有任何 MCP，右侧空态仍然保持任务塔台风格，给出一个紧凑提示和主操作按钮。

### 4.3 MCP 配置弹窗

参考 Manus 图二，但按 oneceo 调整字段：

```text
MCP 配置                                                   关闭

服务器名称            传输类型
[输入框]              [HTTP / Streamable HTTP / SSE]

图标（可选）
[粘贴 URL] [上传]

备注（可选）
[textarea：告诉 Altus 何时使用此 MCP]

服务器 URL
[https://.../mcp]

自定义 headers（可选）
[+ 添加自定义 header]

底部：
[管理 v]                         [试用一下] [保存]
```

2026-05-02 补充交互约定：

1. 自定义 MCP 卡片的“试用一下”不是单纯连接探测，而是进入真实试用链路：读取当前 profile 的服务器名称，先把该 profile 作为 `custom_mcp` 草稿挂载目标写入当前浏览器草稿，然后关闭设置弹窗并创建新对话，只把 `帮我测试 {{连接器名称}} 连接器，并演示如何使用它的功能` 预填到输入框，不自动发送。用户确认发送后，新对话沿用现有草稿挂载链路自动 attach 到该会话。
2. 输入框连接器 Popover 必须展示用户已保存的自定义 MCP profile。展示方式参考内置 MCP 卡片：每个 profile 以独立行出现，使用 profile 名称作为主标题，开关状态根据当前会话或草稿中 `custom_mcp` 的 `attachedProfileId/profileId` 判断。当前版本仍保持“一次会话只挂载一个 custom_mcp profile”的后端约束，不在本次调整中扩展为多 custom MCP 并挂。

oneceo 增强字段：
1. `启用状态`：默认启用，可手动停用。
2. `工具发现状态`：未测试 / 测试中 / 可用 / 失败。
3. `最后测试时间`。
4. `工具数量`：测试成功后展示远程 MCP 返回的 tool 数量。
5. `风险提示`：如果 headers 中存在敏感字段，提示会加密保存且不可在编辑时回显明文。

### 4.4 管理菜单

配置弹窗左下角 `管理` 下拉菜单：
1. `编辑 JSON`
2. `删除`

规则：
1. `编辑 JSON` 打开 JSON 编辑弹窗，并带入当前 MCP 的规范化 JSON。
2. `删除` 使用二次确认弹窗，提示会影响已 attach 的会话。
3. 删除后不做软兼容 fallback；相关 session binding 必须进入 detached 或 unavailable 状态。

## 5. JSON 格式规范

### 5.1 首选导入格式

第一版只正式支持 `mcpServers` 格式：

```json
{
  "mcpServers": {
    "howtocook-mcp": {
      "type": "streamable_http",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${TOKEN}"
      },
      "description": "菜谱和烹饪知识 MCP"
    }
  }
}
```

允许的 `type`：
1. `streamable_http`
2. `http`
3. `sse`

兼容字段：
1. `transport` 可以作为 `type` 的别名。
2. `serverUrl` 可以作为 `url` 的别名，但保存时统一归一为 `url`。
3. `note` 可以作为 `description` 的别名，但保存时统一归一为 `description`。

### 5.2 单个服务器编辑格式

编辑单个 MCP 时，JSON 弹窗展示单 server 结构：

```json
{
  "name": "howtocook-mcp",
  "type": "streamable_http",
  "url": "https://mcp.example.com/mcp",
  "headers": {
    "Authorization": "Bearer ${TOKEN}"
  },
  "description": "菜谱和烹饪知识 MCP",
  "iconUrl": ""
}
```

保存后转换为内部 profile 数据，不把 name 作为唯一身份来源。服务端生成 `profileId` / `serverUuid`。

### 5.3 禁止保存的 JSON

出现以下任一字段或类型，必须拒绝保存：

```json
{
  "mcpServers": {
    "local-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-server"],
      "env": {
        "TOKEN": "xxx"
      }
    }
  }
}
```

拒绝条件：
1. `type` 或 `transport` 为 `stdio` / `local`。
2. 存在 `command`。
3. 存在 `args`。
4. 存在 `env`。
5. 存在 `cwd`。
6. `url` 为空。
7. `url` 不是 `https://`。
8. `url` 指向 localhost、127.0.0.1、0.0.0.0、私网 IP、link-local、metadata host。
9. headers 使用非法名称，例如空字符串、包含换行、覆盖 `Host`。

错误提示需要明确：

```text
当前平台暂不支持 stdio / 本地类型 MCP。请填写远程 HTTP、Streamable HTTP 或 SSE MCP 服务 URL。
```

## 6. 数据模型设计

### 6.1 连接器 key

新增：

```ts
type ConnectorKey = 'custom_mcp'
```

分类：

```ts
category: 'custom_mcp'
```

运行时：

```ts
runtime.type = 'hosted'
runtime.backendProvider = 'custom_mcp'
```

### 6.2 复用 profile 表

第一版优先复用已有连接器 profile 体系：

```text
user_connector_profiles
  connector_key = custom_mcp
  profile_name = 用户填写的服务器名称
  display_name = 用户填写的服务器名称
  config_json = 非敏感配置
  metadata_json = 状态、工具数量、最近测试摘要

user_connector_accounts
  connector_key = custom_mcp
  auth_status = connected / failed / not_configured
```

`config_json` 示例：

```json
{
  "serverUuid": "uuid",
  "transportType": "streamable_http",
  "serverUrl": "https://mcp.example.com/mcp",
  "iconUrl": "",
  "description": "菜谱和烹饪知识 MCP",
  "enabled": true,
  "headerNames": ["Authorization"],
  "lastToolDiscoveryAt": "2026-05-02T00:00:00.000Z",
  "lastToolCount": 12
}
```

`credentials` 加密保存：

```json
{
  "headers": {
    "Authorization": "Bearer xxx"
  }
}
```

原因：
1. 与现有 connector profile、默认 profile、session attach、secret 加密链路一致。
2. 不引入第二套用户连接器存储。
3. 后续可以在 profile metadata 中加入远程 MCP tool snapshot。

### 6.3 多自定义 MCP 的 session 限制

当前 `task_session_connector_bindings` 按 `task_session_id + connector_key` 唯一。如果不改表结构，同一会话只能 attach 一个 `custom_mcp` profile。

第一版选择：
1. 连接器中心允许用户创建多个 custom MCP profile。
2. 单个任务会话第一版只 attach 一个 custom MCP profile。
3. UI 在会话选择时明确展示“当前会话只能选择一个自定义 MCP”。

不在第一版改动 binding 唯一键，避免影响 Slack、Notion、GitHub 等现有连接器恢复链路。

## 7. 后端接口设计

### 7.1 用户接口

新增或扩展连接器接口：

```text
GET    /api/connectors/custom-mcp/profiles
POST   /api/connectors/custom-mcp/profiles
PATCH  /api/connectors/custom-mcp/profiles/:profileId
DELETE /api/connectors/custom-mcp/profiles/:profileId
POST   /api/connectors/custom-mcp/import-json
POST   /api/connectors/custom-mcp/profiles/:profileId/test
GET    /api/connectors/custom-mcp/profiles/:profileId/json
PUT    /api/connectors/custom-mcp/profiles/:profileId/json
POST   /api/connectors/custom-mcp/sessions/:taskSessionId/attach
```

接口要求：
1. 全部使用真实 `app_users.id`，不得长期依赖匿名 `X-User-Id`。
2. 所有 secret 进入 `connector-secret-service.ts` 加密。
3. URL 与 JSON 类型校验必须在后端执行。
4. 删除 profile 前检查 owner，禁止跨用户删除。
5. attach 前检查 profile 属于当前用户且 `enabled=true`。

### 7.2 保存 profile 请求

```json
{
  "profileName": "howtocook-mcp",
  "transportType": "streamable_http",
  "serverUrl": "https://mcp.example.com/mcp",
  "iconUrl": "",
  "description": "菜谱和烹饪知识 MCP",
  "headers": [
    { "name": "Authorization", "value": "Bearer xxx", "secret": true }
  ],
  "enabled": true
}
```

后端保存：
1. `profileName` / `displayName` 保存明文。
2. `serverUrl`、`transportType`、`iconUrl`、`description` 保存到 config。
3. header name 保存到 config 的 `headerNames`。
4. header value 保存到 encrypted secret。

### 7.3 JSON 导入返回

JSON 导入允许一次导入多个远程 MCP：

```json
{
  "created": [
    { "profileId": "uuid", "name": "howtocook-mcp" }
  ],
  "rejected": [
    {
      "name": "local-server",
      "reason": "stdio_not_supported"
    }
  ]
}
```

如果同一个 JSON 中既有合法远程 MCP 又有非法 stdio：
1. 合法项可以创建。
2. 非法项必须拒绝并返回原因。
3. 前端展示导入结果，不把非法项静默丢弃。

## 8. 后端服务设计

### 8.1 custom-mcp-config-service

职责：
1. `normalizeFormInput`
2. `normalizeJsonInput`
3. `validateTransportType`
4. `validateRemoteUrl`
5. `splitSecretHeaders`
6. `createProfile`
7. `updateProfile`
8. `deleteProfile`
9. `exportEditableJson`

### 8.2 custom-mcp-security-service

职责：
1. 阻止 `stdio` / local / command 类配置。
2. 阻止 localhost / private IP / metadata host。
3. 阻止非 HTTPS URL。
4. 校验 headers 名称和值不包含换行。
5. 对敏感 header 做脱敏摘要。

与 custom_api 可复用的逻辑：
1. URL 静态校验。
2. DNS 解析后私网 IP 拦截。
3. sensitive header 名称识别。

不能直接复用 custom_api endpoint 审核，因为 custom_mcp 校验对象是 MCP server config，不是 HTTP endpoint schema。

### 8.3 custom-mcp-remote-client-service

职责：
1. 根据 profile 和 secret 构造远程 MCP 初始化请求。
2. 支持 `streamable_http`、`http`、`sse` 的最小 handshake。
3. 实现 `tools/list` 试用。
4. 不把 secret 返回给前端。
5. 失败时返回可展示错误，不泄露 header value。

### 8.4 hosted-provider-host-service 接入

新增 backend provider：

```ts
case 'custom_mcp':
  return this.executeCustomMcp(input)
```

执行路径：

```text
Altus
  -> OSAC
  -> hosted-provider-host-service
  -> custom-mcp-remote-client-service
  -> 远程 MCP server
```

禁止路径：

```text
Altus -> sandbox shell -> 远程 MCP server
```

## 9. 前端实现设计

### 9.1 文件范围

预计修改：
1. `apps/web/client/src/components/ConnectorCenterPanel.tsx`
2. `apps/web/client/src/components/ConnectorDialog.tsx`
3. `apps/web/client/src/lib/connectors-client.ts`
4. `apps/web/client/src/lib/connector-ui.tsx`
5. `apps/web/client/src/lib/connector-guides.ts`
6. i18n 文案文件
7. 对应测试文件

补充实现约束：
1. `connector-guides` 只承载已有说明文案的连接器，类型应允许 `custom_api`、`custom_mcp` 等新 key 暂时缺省。
2. 连接器详情侧栏在没有 guide 时直接隐藏说明区块，不要求为每个新 connector 先补占位文案再发布。

预计新增：
1. `apps/web/client/src/components/connectors/CustomMcpConfigDialog.tsx`
2. `apps/web/client/src/components/connectors/CustomMcpJsonEditorDialog.tsx`
3. `apps/web/client/src/components/connectors/CustomMcpCard.tsx`
4. `apps/web/client/src/lib/custom-mcp-client.ts`
5. `apps/web/client/src/lib/custom-mcp-validation.ts`

### 9.2 状态模型

前端状态：

```ts
type CustomMcpProfile = {
  profileId: string;
  profileName: string;
  displayName?: string | null;
  transportType: 'streamable_http' | 'http' | 'sse';
  serverUrl: string;
  iconUrl?: string;
  description?: string;
  enabled: boolean;
  authStatus: 'connected' | 'failed' | 'not_configured' | 'unavailable';
  lastToolCount?: number;
  lastToolDiscoveryAt?: string | null;
  lastError?: string | null;
  headerNames: string[];
};
```

编辑表单状态：

```ts
type CustomMcpFormState = {
  name: string;
  transportType: 'streamable_http' | 'http' | 'sse';
  iconUrl: string;
  description: string;
  serverUrl: string;
  headers: Array<{ id: string; name: string; value: string; secret: boolean }>;
  enabled: boolean;
};
```

实现约束补充：
1. `CustomMcpManagementPanel` 的列表刷新回调统一复用 `ConnectorCenterPanel` 内部的 profile reload 方法。
2. 子面板只接收显式声明的 `onProfilesChanged` 回调，不再额外引入未定义的别名函数，避免页面 reload 后因 `ReferenceError` 直接中断渲染。

### 9.3 表单校验

前端即时校验：
1. 名称必填。
2. 传输类型只能从允许列表选择，不展示 stdio。
3. URL 必填，必须是 `https://`。
4. header name 不能重复。
5. header name 不能包含空格、冒号、换行。
6. 编辑 JSON 时若发现 stdio，保存按钮禁用并展示错误。

后端最终校验：
1. 重新解析 JSON。
2. 重新判断 MCP 类型。
3. 重新校验 URL 和 headers。
4. 重新分离 secret。

### 9.4 JSON 编辑器交互

编辑 JSON 弹窗：
1. 左侧为 JSON textarea 或代码编辑器。
2. 右侧为解析结果摘要：服务器名、类型、URL host、headers 数量。
3. 错误在底部固定区域展示。
4. 保存前自动格式化 JSON。
5. 保存失败时保持用户输入，不覆盖。

不要求第一版引入大型代码编辑器库。若当前项目没有 Monaco/CodeMirror，使用 textarea + 格式化按钮即可。

## 10. 运行时与会话 attach

### 10.1 attach 规则

在任务会话里选择自定义 MCP：
1. 只能选择当前用户拥有的 profile。
2. profile 必须 `enabled=true`。
3. profile 最近测试失败不阻止 attach，但 UI 需要提示风险。
4. attach 后写入 `task_session_connector_bindings`：

```json
{
  "connectorKey": "custom_mcp",
  "profileId": "profile-id",
  "sessionConfig": {
    "transportType": "streamable_http",
    "serverUuid": "uuid"
  }
}
```

### 10.2 tools/list

Altus 请求 `tools/list` 时：
1. hosted provider 根据 session binding 找到 profile。
2. 后端解密 headers。
3. 代理请求远程 MCP server。
4. 返回 tools 给 Altus。
5. 审计记录工具发现结果。

### 10.3 tools/call

Altus 请求 `tools/call` 时：
1. hosted provider 验证 profile 与 session 绑定关系。
2. 后端解密 headers。
3. 代理调用远程 MCP server。
4. 响应返回给 Altus。
5. 记录调用审计：tool name、duration、status、错误摘要。

第一版不做逐工具审核，但必须记录审计。

## 11. 删除与编辑规则

### 11.1 编辑基础信息

可编辑：
1. 名称
2. 图标 URL
3. 备注
4. URL
5. 传输类型
6. headers
7. 启用状态

编辑 URL 或传输类型后：
1. `lastToolDiscoveryAt` 清空或标记 stale。
2. `authStatus` 变为 `not_configured` 或 `needs_test`。
3. UI 提示需要重新试用。

### 11.2 编辑 JSON

JSON 保存相当于一次完整覆盖：
1. 覆盖名称、类型、URL、备注、图标、headers。
2. 未提供的可选字段置空。
3. 不保留旧 headers secret，除非 JSON 中使用占位符且后端明确支持。

第一版不做 secret 占位符保留。编辑 JSON 时，如果 headers value 为空，则保存为空并提示用户补充。

### 11.3 删除

删除规则：
1. 删除 profile。
2. 清理或标记相关 session binding 为 detached。
3. 不删除审计日志。
4. 前端列表立即移除卡片。
5. 如果当前打开的是被删除 profile，关闭配置弹窗。

## 12. 审计与调试

新增审计类型：
1. `custom_mcp_profile_created`
2. `custom_mcp_profile_updated`
3. `custom_mcp_profile_deleted`
4. `custom_mcp_json_imported`
5. `custom_mcp_test_connection`
6. `custom_mcp_tools_list`
7. `custom_mcp_tools_call`

审计内容：
1. userId
2. profileId
3. taskSessionId
4. serverUrl redacted
5. transportType
6. toolName
7. status
8. durationMs
9. errorCode

不得记录：
1. header value
2. Authorization
3. Cookie
4. API key 明文
5. MCP tool call 中可能包含的敏感参数全文

## 13. 测试计划

### 13.1 后端单元测试

必须覆盖：
1. 保存 `streamable_http` 成功。
2. 保存 `sse` 成功。
3. 保存 `stdio` 失败。
4. JSON 中存在 `command` 失败。
5. JSON 中存在 `args` 失败。
6. URL 为 localhost 失败。
7. URL 为 private IP 失败。
8. headers 含换行失败。
9. secret headers 不进入 config 明文。
10. 删除 profile 后 session binding 不再可用。

### 13.2 前端组件测试

必须覆盖：
1. `自定义 MCP` tab 展示添加入口和已配置卡片。
2. 直接配置保存远程 MCP。
3. JSON 导入合法远程 MCP。
4. JSON 导入 stdio 时展示“不支持 stdio / 本地类型 MCP”。
5. 管理菜单可以打开编辑 JSON。
6. 删除需要二次确认。
7. 搜索可以命中名称与 URL host。

### 13.3 集成测试

使用 mock 远程 MCP server：
1. 创建 custom MCP profile。
2. test connection 获取 tools/list。
3. attach 到 task session。
4. hosted provider tools/list 返回 mock tools。
5. hosted provider tools/call 返回 mock result。
6. audit log 不包含 Authorization 明文。

## 14. 开发顺序

### 阶段一：文档确认

1. 用户审核本文档。
2. 若认可，状态从 `[尚未采用]` 更新为 `[yyyymmdd-hhmm已采用]`。
3. 再开始代码实现。

### 阶段二：后端基础能力

1. 增加 `custom_mcp` connector definition。
2. 扩展 `ConnectorKey`。
3. 增加 custom MCP config/security service。
4. 增加 custom MCP routes。
5. 增加 user connector secret payload 支持。
6. 增加 hosted provider custom_mcp 代理入口。
7. 增加后端测试。

### 阶段三：前端管理 UI

1. 连接器中心 `自定义 MCP` tab 改为 Manus 风格两列布局。
2. 实现添加菜单。
3. 实现配置弹窗。
4. 实现 JSON 编辑弹窗。
5. 实现卡片列表、搜索、删除。
6. 增加前端测试。

### 阶段四：会话 attach 与运行时验证

1. 在会话连接器选择中展示 custom MCP profile。
2. attach 后 hosted provider 能获取远程 tools。
3. 验证 Altus 可以调用远程 MCP tool。
4. 验证 stdio 被保存层和运行时双重拦截。

## 15. 验收标准

功能验收：
1. 用户可以在 `自定义 MCP` tab 添加远程 MCP。
2. 用户可以通过 JSON 导入远程 MCP。
3. 用户可以编辑基础表单。
4. 用户可以编辑 JSON。
5. 用户可以删除 MCP。
6. 用户保存 stdio MCP 时被明确拒绝。
7. 用户保存包含 `command/args/env/cwd` 的 JSON 时被明确拒绝。
8. 用户可以对远程 MCP 执行“试用一下”。
9. 任务会话可以 attach 一个 custom MCP。
10. Altus 可以通过 oneceo hosted provider 使用该 custom MCP 的 tools。

安全验收：
1. secret 不出现在前端 profile config。
2. secret 不出现在 sandbox。
3. secret 不出现在审计日志。
4. 私网 URL 与 localhost 被拒绝。
5. 非 HTTPS URL 被拒绝。
6. stdio / local MCP 被拒绝。

UI 验收：
1. 排版参考 Manus，但符合 oneceo 当前连接器中心视觉语言。
2. 移动端或窄屏不出现文字重叠。
3. 搜索、卡片、弹窗、菜单操作状态完整。
4. 按钮文案不溢出。

测试验收：
1. 后端新增单元测试通过。
2. 前端新增组件测试通过。
3. API type-check 通过，或明确记录非本功能引入的既有阻塞。
4. 不启动 E2B sandbox；如后续测试需要启动，必须成对关闭。

## 16. 风险与处理

### 16.1 远程 MCP 协议差异

风险：不同远程 MCP 服务对 Streamable HTTP、SSE、legacy HTTP 支持不完全一致。

处理：第一版只实现最小 handshake、tools/list、tools/call。失败时给出明确错误，不做自动 fallback。

### 16.2 多 custom MCP 会话绑定

风险：现有 binding 唯一键限制同一会话只能绑定一个 `custom_mcp`。

处理：第一版接受该限制并在 UI 明示。后续如要支持多个 custom MCP，需要先设计 binding key 或虚拟 connector key，不在本次范围内隐式修改。

### 16.3 JSON secret 编辑

风险：编辑 JSON 时用户可能误以为旧 secret 会保留。

处理：第一版不保留未提供的 header value。UI 明确提示“保存 JSON 会覆盖 headers，需要重新填写敏感值”。

### 16.4 stdio 绕过

风险：用户通过 JSON 的变体字段绕过 stdio 判断。

处理：后端递归扫描配置对象，任何层级出现 `command/args/env/cwd` 或 `stdio/local` 类型都拒绝。
