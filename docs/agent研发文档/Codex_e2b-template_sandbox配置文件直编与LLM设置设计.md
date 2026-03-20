# Codex_e2b-template_sandbox配置文件直编与LLM设置设计

## 1. 背景

当前 oneceo 内 `codex` 在 sandbox 中的运行配置分散在两条链路里：

1. `sdk模式`
   - 主要依赖 sandbox 环境变量透传
   - 没有面向用户的显式配置文件编辑入口

2. `ws模式`
   - 会在 sandbox 内写入 `~/.codex/config.toml`
   - 会在 sandbox 内写入 `~/.codex/auth.json`
   - 但配置来源仍然是服务端进程环境变量拼装，不是用户可直接维护的配置

用户当前希望：

1. 将 Playwright 以及 Codex 连接 LLM 的方式固定为 `sandbox`
2. 启动 sandbox 后即可直接使用，不再依赖隐式环境变量拼装
3. `~/.codex/config.toml` 与 `~/.codex/auth.json` 需要有“直接修改接口”
4. 后续要支持不同用户使用不同的 Codex 配置
5. 设置页中需要新增单独的 `LLM设置` 分组，允许用户修改供应商参数：
   - `baseUrl`
   - `model`
   - `apiKey`

本设计只覆盖以上目标，不扩展额外能力。

## 2. 目标

本轮目标：

1. `executor = codex` 时，统一采用“sandbox 内配置文件驱动”的配置方式
2. 将 `Playwright` 使用方式固定为 `sandbox`
3. 将 Codex LLM 连接方式固定为通过 sandbox 内 `~/.codex/config.toml + ~/.codex/auth.json`
4. 提供后端接口与前端设置入口，允许直接编辑：
   - `config.toml`
   - `auth.json`
5. 配置按用户隔离，不允许不同用户共用同一份 Codex 凭据配置
6. 在设置页明确写出当前实现边界：
   - 只实现了 `codex` 的模型切换
   - 其他模型的统一切换与计费，待后续平台侧 `LLM API 计费平台` 建成后补充

非目标：

1. 不修改外部 Codex 安装逻辑
2. 不引入新的 provider 抽象层
3. 不做配置兼容兜底或降级逻辑扩展

## 3. 明确约束

### 3.1 Sandbox 固定化

`codex` 的 Playwright 与 LLM 连接配置都固定在 sandbox 内生效：

1. Playwright 固定使用 sandbox 现有链路
2. Codex 固定读取 sandbox 内：
   - `~/.codex/config.toml`
   - `~/.codex/auth.json`
3. 不再把“环境变量直传”作为用户可感知主配置方式

### 3.2 用户隔离

配置必须按用户隔离：

1. 平台侧存储用户自己的 Codex 配置模板
2. sandbox provision / app-server 启动时，写入当前用户对应配置
3. 不允许把某个用户保存的 `auth.json` 复用于别的用户

### 3.3 直接编辑

“直接更改接口”的含义明确为：

1. 前端设置页可直接查看并编辑 `config.toml`
2. 前端设置页可直接查看并编辑 `auth.json`
3. 后端提供读写接口
4. 保存后，对新启动的 Codex sandbox 生效

本轮不支持：

1. 在正在运行的 Codex 会话里热替换配置并保证无副作用
2. 运行中自动重载

### 3.4 e2b-template 边界

本轮允许新增或修改 `e2b_templates/` 内与 Codex 相关的本地模板代码，但边界如下：

1. 必须新增一套明确命名的 Codex 专用模板
2. 不允许改动外部托管模板仓库
3. 不允许修改非 Codex 相关模板的既有行为
4. 模板构建与使用逻辑必须在 oneceo 本地代码内闭环

## 4. 现状问题

当前代码中的配置入口主要在：

1. `apps/api/src/services/codex-app-server-turn-service.ts`
2. `apps/api/src/services/codex-app-server-service.ts`
3. `apps/api/src/services/sandbox-agent-provision-service.ts`

现状问题：

1. 配置来源主要是服务端进程环境变量
2. 用户无法直接编辑 `config.toml` / `auth.json`
3. 不同用户无法通过平台界面维护各自独立配置
4. `sdk模式` 与 `ws模式` 的配置方式不统一

## 5. 实现方案

### 5.0 e2b-template 现状判断

当前 `e2b_templates/` 目录下只有：

1. `opencode-playwright-mcp/`

也就是：

1. 当前没有专门给 `codex + ws模式` 使用的 sandbox template
2. 现有 `ws模式` 只是运行时在已有 sandbox 中动态写入：
   - `~/.codex/config.toml`
   - `~/.codex/auth.json`
3. 如果要做到“直接启动 sandbox 即具备 Codex ws 模式默认能力”，必须补一套本地模板

### 5.1 新增 Codex 专用 e2b-template

新增一套本地模板目录，命名必须明确表明其用途，例如：

- `e2b_templates/codex-ws-playwright-sandbox/`

建议职责：

1. 以适合 Codex 运行的基础模板为起点
2. 预装或预配置：
   - `codex`
   - Playwright 运行环境
   - `~/.codex/` 目录结构
3. 预留 oneceo 在运行时覆盖写入：
   - `~/.codex/config.toml`
   - `~/.codex/auth.json`
4. 预留 App Server 默认监听入口

说明：

1. 模板内只固化“运行环境和目录约定”
2. 用户级供应商配置仍由 oneceo 运行时写入
3. 不把用户的 `apiKey` 烧进模板

### 5.2 模板构建与命名

新增与现有模板对齐的本地构建脚本，例如：

1. `e2b_templates/codex-ws-playwright-sandbox/template.ts`
2. `e2b_templates/codex-ws-playwright-sandbox/build.ts`
3. `e2b_templates/codex-ws-playwright-sandbox/README.md`

模板名建议独立，例如：

- `codex-ws-playwright-sandbox-v1`

要求：

1. 模板构建成功后，由 oneceo 配置显式指向该模板
2. 不覆盖现有 OpenCode 模板名
3. 模板失败不影响 `sdk模式`

当前实现结果：

1. 已新增：
   - `e2b_templates/codex-ws-playwright-sandbox/template.ts`
   - `e2b_templates/codex-ws-playwright-sandbox/build.ts`
   - `e2b_templates/codex-ws-playwright-sandbox/README.md`
2. 构建脚本已固定优先读取：
   - `apps/.env`
3. 已完成真实模板构建：
   - 模板名：`codex-ws-playwright-sandbox-v1`
   - E2B Template ID：`ss1fwlkiw4vi6l5dwesm`
   - Build ID：`72533b37-77d5-4b4f-9e26-40cfaf786abc`
4. 当前平台代码已支持：
   - `codex + ws模式 -> codex-ws-playwright-sandbox-v1`
   - `codex + sdk模式 -> 旧 codex template`

### 5.2.1 Codex Playwright MCP 固化接入

当前 `codex + ws模式` 还存在一个明确缺口：

1. 新模板已经预装：
   - `playwright`
   - `@playwright/mcp`
2. 但这只代表 sandbox 内“有可执行文件”
3. 还没有把 Playwright MCP 注册进 Codex 的可发现工具链
4. 因此 Codex 在会话内会表现为：
   - 看不到 Playwright MCP
   - 无法直接把它当成可用 MCP server 调用

本轮要求改成：

1. 在 `codex + ws模式` 下，Playwright MCP 必须在 sandbox 启动时直接接给 Codex
2. 不依赖用户在对话里手动告知
3. 不依赖后续额外补配置步骤

实现约束：

1. 不采用“先启动 sandbox，再靠对话内提示让 Codex 自己发现”的方式
2. 不采用运行中额外手工命令配置的方式
3. 必须在以下两处至少一处固化完成：
   - template 内预置默认 MCP 配置
   - oneceo 在 provision / app-server 启动前自动写入 Codex 所需 MCP 配置文件

推荐实现：

1. template 内保证 Playwright MCP 二进制和浏览器环境已可用
2. oneceo 在写入 `~/.codex/config.toml` 时，同时写入 Codex 可识别的 Playwright MCP 配置段
3. `codex app-server` 启动前，确保：
   - `~/.codex/config.toml`
   - `~/.codex/auth.json`
   - Playwright MCP 配置
   三者都已经就位
4. 启动后的第一轮对话里，Codex 应该能直接回答自己可见的 Playwright MCP，而不是只看到通用文本工具

验收标准：

1. `codex + ws模式` 新 sandbox 启动后，无需额外人工配置
2. 在同一会话里询问“当前可用 MCP / 工具”时，Codex 能明确看到 Playwright MCP
3. Playwright MCP 可被实际调用
4. 该接入只影响 `codex + ws模式`
5. 不修改 OpenCode 现有 Playwright MCP 已验证逻辑

当前实现结果：

1. 已新增 `apps/api/src/utils/codex-runtime-config.ts`
2. `ws模式` 写入 `~/.codex/config.toml` 前会自动补充：
   - `[mcp_servers.playwright]`
   - `[mcp_servers.playwright.env]`
3. 若用户自定义 `config.toml` 已自行声明 `[mcp_servers.playwright]`，平台不覆盖
4. 已做真实 sandbox 验证：
   - `codex mcp list` 可以直接看到 `playwright`
   - 说明 Playwright MCP 已在启动阶段接给 Codex，而不是只安装在 sandbox 里

## 5.3 平台侧新增“Codex 配置文件”存储

新增一套用户级配置存储，内容包含：

1. `configToml`
2. `authJson`
3. `updatedAt`
4. `updatedBy`

建议新增表：

- `user_codex_runtime_config`

字段：

1. `user_id`
2. `config_toml`
3. `auth_json`
4. `created_at`
5. `updated_at`

说明：

1. 一用户一份当前生效配置
2. 不在本轮做历史版本管理

## 5.4 设置页新增 Codex 配置编辑区

路径：

- `设置 -> 模型设置 -> sandbox直通 -> executor = codex -> LLM设置`

新增一个独立分组：`LLM设置`

分组内包含三层内容：

1. 供应商基础配置
   - `baseUrl`
   - `model`
   - `apiKey`
2. 高级文件配置
   - `config.toml`
   - `auth.json`
3. 实现边界提示
   - `TODO：当前只实现 Codex 的模型切换`
   - `其他模型的统一供应商切换、平台统一计费与模型路由，待后续 LLM API 计费平台开发时补充`

直接编辑器：

1. `config.toml`
2. `auth.json`

交互：

1. 页面进入时读取当前用户已保存配置
2. 用户可直接修改：
   - `baseUrl`
   - `model`
   - `apiKey`
   - 或直接修改 `config.toml/auth.json`
3. 点击保存后写入后端
4. 明确提示：
   - 仅对后续新启动 sandbox 生效
   - 当前运行中会话不自动热更新
5. 明确显示 TODO：
   - 目前只落 `codex`
   - 其他模型后续接入平台统一计费与统一切换体系

## 5.5 后端新增读写接口

建议新增：

1. `GET /api/task-creation/codex/runtime-config`
2. `PUT /api/task-creation/codex/runtime-config`

返回结构：

```json
{
  "success": true,
  "data": {
    "configToml": "...",
    "authJson": "...",
    "updatedAt": "..."
  }
}
```

约束：

1. 必须按当前用户读取
2. 必须校验 `auth.json` 为合法 JSON
3. `config.toml` 本轮只做非空文本校验，不做复杂语义校验
4. `PUT` 时允许用户只提交结构化字段：
   - `baseUrl`
   - `model`
   - `apiKey`
   后端负责同步重建默认 `config.toml/auth.json`
5. 也允许直接提交原始：
   - `configToml`
   - `authJson`

## 5.6 Sandbox provision 与 App Server 统一改为读取用户配置

所有 `codex` 启动链路统一改为：

1. 先读当前用户保存的 `configToml/authJson`
2. 再写入 sandbox：
   - `~/.codex/config.toml`
   - `~/.codex/auth.json`
3. `ws模式` 优先使用新的 Codex 专用 template
4. 然后再启动：
   - `codex app-server`
   - 或 sdk 模式下的 Codex 运行进程

说明：

1. `ws模式` 继续使用配置文件写入方式，并指向 Codex 专用 template
2. `sdk模式` 也改成先写 `~/.codex/*`，确保两条模式统一
3. 环境变量只保留为内部最小辅助，不再作为用户主配置面

补充：

1. `baseUrl/model/apiKey` 属于平台设置层面的结构化输入
2. `config.toml/auth.json` 属于最终落地文件
3. 若用户修改结构化字段，后端必须同步重建默认文件内容
4. 若用户直接修改原始文件内容，则以后者为准

## 5.7 Playwright 固定为 sandbox

本轮定义为：

1. `executor = codex` 时，Playwright 统一使用 sandbox 内现有浏览器/Playwright 链路
2. 不提供“本地/远程”切换项
3. 相关设置不再开放给用户修改

也就是：

1. 平台层固定策略
2. 用户只改 Codex 的 `config.toml/auth.json`
3. 不再对 Playwright 配置做额外动态分支

### 5.8 模板切换规则

模板选择规则明确如下：

1. `executor != codex`
   - 完全不变
2. `executor = codex` 且 `codexMode = sdk`
   - 继续走现有 Codex sandbox provision 逻辑
3. `executor = codex` 且 `codexMode = ws`
   - 使用新的 `codex-ws-playwright-sandbox` template

要求：

1. `ws模式` 模板切换必须只影响新 sandbox
2. 历史会话仍按 session 内记录的执行模式与 template 恢复
3. 不允许在运行中会话热切换 template

## 6. 默认配置内容

如果用户尚未配置，系统初始化默认内容为：

`config.toml`

```toml
model_provider = "OpenAI"
model = "gpt-5.2"
review_model = "gpt-5.2"
model_reasoning_effort = "high"
disable_response_storage = true
network_access = "enabled"
windows_wsl_setup_acknowledged = true
model_context_window = 1000000
model_auto_compact_token_limit = 900000

[model_providers.OpenAI]
name = "OpenAI"
base_url = "https://ai.hvmz.cn"
wire_api = "responses"
supports_websockets = true
requires_openai_auth = true

[features]
responses_websockets_v2 = true
```

`auth.json`

```json
{
  "OPENAI_API_KEY": ""
}
```

## 7. 编译与验收

### 7.1 模板编译验收

必须完成：

1. `codex-ws-playwright-sandbox` 本地构建成功
2. 构建产物模板名可被 oneceo 配置引用
3. 构建后启动 sandbox 时，默认具备：
   - Codex 可执行环境
   - Playwright 运行环境
   - `~/.codex/` 目录

### 7.2 oneceo 联调验收

必须完成：

1. 设置页保存用户级 `LLM设置`
2. 新建 `codex -> ws模式` 会话
3. 命中新的 Codex 专用 template
4. sandbox 内成功写入：
   - `~/.codex/config.toml`
   - `~/.codex/auth.json`
5. `codex app-server` 正常启动
6. 用户可直接开始对话，无需额外人工写配置

## 8. TODO

1. 当前只实现 `codex` 的模型切换
2. 其他模型的统一供应商切换、统一计费、统一路由能力，待后续 `LLM API 计费平台` 开发时补充
3. 运行中 sandbox 的配置热更新不在本轮实现范围

说明：

1. 初始默认值只作为模板
2. 实际由用户自行维护和保存
3. 前端结构化字段默认映射为：
   - `baseUrl = https://ai.hvmz.cn`
   - `model = gpt-5.2`
   - `apiKey = ''`

## 7. 数据与权限

### 7.1 权限

读写接口都必须绑定当前登录用户：

1. 只能读自己的 Codex 配置
2. 只能改自己的 Codex 配置

### 7.2 安全

`auth.json` 含敏感信息：

1. 数据库存储必须走现有安全策略
2. 前端展示时允许明文编辑，但不做额外共享
3. 不在日志中打印完整 `auth.json`

## 8. 影响范围

需要修改的主要文件：

1. `apps/web/client/src/components/SettingsDialog.tsx`
2. `apps/web/client/src/lib/task-creation-client.ts`
3. `apps/api/src/routes/task-creation-routes.ts`
4. `apps/api/src/services/codex-app-server-turn-service.ts`
5. `apps/api/src/services/codex-app-server-service.ts`
6. `apps/api/src/services/sandbox-agent-provision-service.ts`
7. 新增 DAO / schema / migration
8. 可能新增设置页内的独立 `LLM设置` 子组件

## 9. 实施顺序

1. 新增用户级 Codex 配置表与 DAO
2. 新增后端读取/保存接口
3. 设置页新增 `config.toml` / `auth.json` 编辑器
4. `ws模式` 改为只读用户配置写入 sandbox
5. `sdk模式` 也统一改为先写 `~/.codex/*`
6. 做一轮真实 sandbox 验证：
   - 用户 A 配置 A
   - 用户 B 配置 B
   - 各自启动后读取 sandbox 内配置文件确认隔离正确

## 10. 验收标准

满足以下条件才算完成：

1. 设置页可以直接查看并编辑 `config.toml`
2. 设置页可以直接查看并编辑 `auth.json`
3. 设置页可以直接修改 `baseUrl/model/apiKey`
4. 保存后，新启动 sandbox 内能看到对应文件内容
5. `sdk模式` 与 `ws模式` 都统一从这两个文件取配置
6. 不同用户保存的配置互不影响
7. Playwright 固定为 sandbox，不再出现额外切换分支
8. 设置页明确展示 TODO：
   - 当前只实现 `codex`
   - 其他模型的统一切换与统一计费待后续平台能力补齐

## 11. 当前建议

建议按本方案实施。

原因：

1. 它与当前 `ws模式` 已验证成功的 `.codex/config.toml + auth.json` 方向一致
2. 它能把 `sdk模式` 和 `ws模式` 收敛到同一套配置源
3. 它满足“不同用户使用不同配置信息”的明确要求
4. 它不需要修改 e2b template，符合当前约束

## 12. TODO

本节只记录本轮明确确认、但不在当前范围内实现的事项。

### 12.1 平台统一 LLM 计费与模型切换

状态：

- 待后续开发

范围：

1. 不同模型统一走平台侧 `LLM API 计费平台`
2. 不同模型的统一供应商切换
3. 不同模型的统一计费、审计、额度控制
4. 非 Codex 执行器的统一 `baseUrl / model / apiKey` 设置入口

当前结论：

1. 本轮只实现 `codex` 的模型切换与配置文件写入
2. 设置页必须明确提示：
   - 当前只有 `codex` 已实现
   - 其他模型暂未实现

### 12.2 运行中配置热更新

状态：

- 待后续开发

范围：

1. 已运行 sandbox 的配置热重载
2. 正在运行会话不中断切换 `config.toml/auth.json`

当前结论：

1. 本轮只保证“保存后对新启动 sandbox 生效”
2. 当前运行中的会话不做热切换

### 12.3 配置版本管理

状态：

- 待后续开发

范围：

1. `config.toml/auth.json` 历史版本
2. 回滚到指定版本
3. 配置变更审计

当前结论：

1. 本轮只保存每个用户的当前生效版本
