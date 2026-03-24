# LLMAPI 统一供应商与协议兼容层设计

更新时间：2026-03-24  
状态：待审核  
适用范围：`apps/api`、E2B sandbox/OpenCode provision、平台统一 LLM 上游配置

## 1. 背景与问题

当前平台内同时存在多种与 LLM 上游相关的配置口径：

1. `OPENAI_BASE_URL/OPENAI_API_BASE`
2. `AGENT_OPENAI_BASE_URL`
3. `LLM_PROXY_UPSTREAM_BASE_URL`
4. `OPENCODE_PROVIDER_ID`

同时历史上出现过两类不同的上游：

1. `hone.vvvv.ee` / Cloudflare AI Gateway：按 OpenAI-compatible 协议接入
2. `llmapi.oneceo.ai`：已验证同时支持
   - OpenAI-compatible：`/v1/models`、`/v1/chat/completions`
   - Anthropic 原生：`/v1/messages`

现状问题：

1. 平台配置只能隐式假设“上游是 OpenAI-compatible”，没有显式协议类型开关。
2. 当供应商切换为 `llmapi.oneceo.ai` 且希望走 Anthropic 原生接口时，现有 `llm-proxy` 无法完成协议转换。
3. Sandbox/OpenCode、平台代理、Managed agent 配置口径不统一，容易出现某一链路仍然打向旧的 `hone` / `cf gateway`。
4. Cherry Studio 或外部客户端与平台内部链路使用的协议不一致时，排障成本高。

本次目标不是增加更多供应商，而是收口为一个统一供应商：

1. 统一将 `llmapi.oneceo.ai` 作为平台唯一 LLM 上游入口。
2. 在 `.env` 中显式声明上游协议类型：`openai` 或 `anthropic`。
3. 由平台兼容层负责把平台内部请求转换为对应的上游协议。

## 2. 目标

### 2.1 必达目标

1. `.env` 中新增“上游协议类型”配置项。
2. `llm-proxy` 根据该配置决定：
   - 直接透传 OpenAI-compatible
   - 或将 OpenAI-compatible 请求转换为 Anthropic `v1/messages`
3. 平台默认与推荐供应商统一为 `https://llmapi.oneceo.ai`。
4. 移除平台主链路中对 `hone` / `cf gateway` 作为运行上游的依赖。

### 2.2 非目标

1. 不同时支持多个运行中上游并做动态路由。
2. 不实现兼容性兜底或协议自动探测。
3. 不在业务层直接新增 Anthropic 原生路由给前端调用。
4. 不保留旧供应商作为并行正式方案。

## 3. 当前链路盘点

### 3.1 平台代理链路

当前 `apps/api/src/connectors/llm-proxy-connector.ts` 行为：

1. 对 `/v1/*` 原样转发
2. 使用 `LLM_PROXY_UPSTREAM_BASE_URL` 和 `LLM_PROXY_UPSTREAM_API_KEY`
3. 默认假设上游接受 OpenAI-compatible 路径

结论：这里是本次兼容层的主落点。

### 3.2 Sandbox / OpenCode 链路

当前 `apps/api/src/services/sandbox-agent-provision-service.ts` 行为：

1. 通过环境变量生成 `opencode.json`
2. 统一按 `@ai-sdk/openai-compatible` 提供 provider
3. `OPENAI_BASE_URL` / `OPENAI_API_KEY` 会下发到 sandbox

结论：OpenCode 仍然消费 OpenAI-compatible，因此平台若选择 Anthropic 上游，转换应发生在平台代理层，而不是要求 OpenCode 直接改为 Anthropic SDK。

### 3.3 当前 `.env` 现状

当前已存在：

1. `OPENAI_BASE_URL=https://llmapi.oneceo.ai/v1`
2. `AGENT_OPENAI_BASE_URL=https://gateway.ai.cloudflare.com/.../v1`
3. `LLM_PROXY_UPSTREAM_BASE_URL=https://hone.vvvv.ee`

结论：同一项目内部已经出现多个事实上不同的上游入口，必须统一。

## 4. 设计原则

1. 平台内部调用口径保持不变，继续统一走 OpenAI-compatible。
2. 协议差异只允许收敛在 `llm-proxy` 兼容层，不向业务层扩散。
3. `.env` 显式配置协议类型，不做运行时猜测。
4. `llmapi.oneceo.ai` 作为唯一上游域名；协议差异只体现在 `type` 与请求头/路径转换。
5. 最短路径实现，不引入多供应商路由抽象或插件系统。

## 5. 新增配置设计

## 5.1 新配置项

建议新增以下环境变量：

```env
LLM_PROXY_UPSTREAM_BASE_URL=https://llmapi.oneceo.ai
LLM_PROXY_UPSTREAM_API_KEY=...
LLM_PROXY_UPSTREAM_API_TYPE=openai
```

其中：

1. `LLM_PROXY_UPSTREAM_BASE_URL`
   - 统一固定为 `https://llmapi.oneceo.ai`
   - 不再指向 `hone.vvvv.ee` 或 Cloudflare Gateway
2. `LLM_PROXY_UPSTREAM_API_KEY`
   - 对应 `llmapi.oneceo.ai` 的 key
3. `LLM_PROXY_UPSTREAM_API_TYPE`
   - 可选值：`openai`、`anthropic`
   - 默认值建议：`openai`

### 5.2 不新增的配置项

本次不增加：

1. 自动回退协议
2. 每模型单独协议类型
3. 每执行器单独供应商配置

原因：本轮目标是统一供应商，不是扩充配置矩阵。

## 6. 兼容层设计

### 6.1 总体思路

平台内部仍只暴露 OpenAI-compatible 接口：

1. `GET /api/llm-proxy/v1/models`
2. `POST /api/llm-proxy/v1/chat/completions`

兼容层按 `LLM_PROXY_UPSTREAM_API_TYPE` 分支：

1. `openai`
   - 维持当前逻辑，直接转发至上游
2. `anthropic`
   - `/v1/models`：优先直转上游 `/v1/models`
   - `/v1/chat/completions`：转换为上游 `/v1/messages`
   - 将上游响应再映射回 OpenAI-compatible 格式

### 6.2 `openai` 模式

行为：

1. 与当前 `llm-proxy-connector.ts` 基本一致
2. Header 使用 `Authorization: Bearer <key>`
3. 路径保持 `/v1/models`、`/v1/chat/completions`

### 6.3 `anthropic` 模式

#### 6.3.1 请求映射

输入：

```json
{
  "model": "claude-sonnet-4-6",
  "messages": [
    { "role": "user", "content": "Reply with exactly: ok" }
  ],
  "max_tokens": 64,
  "temperature": 0
}
```

输出：

```json
{
  "model": "claude-sonnet-4-6",
  "messages": [
    { "role": "user", "content": "Reply with exactly: ok" }
  ],
  "max_tokens": 64,
  "temperature": 0
}
```

请求头改为：

```http
x-api-key: <key>
anthropic-version: 2023-06-01
content-type: application/json
```

请求路径改为：

```text
/v1/messages
```

说明：

1. 对纯文本对话，OpenAI `messages` 与 Anthropic `messages` 可直接复用最小公共结构。
2. 本轮先覆盖平台当前主用纯文本路径，不扩展到 tools / reasoning 的跨协议高级字段。

#### 6.3.2 响应映射

Anthropic 响应示例：

```json
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-4-6",
  "content": [{ "type": "text", "text": "ok" }],
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 12,
    "output_tokens": 4
  }
}
```

映射回 OpenAI-compatible：

```json
{
  "id": "msg_xxx",
  "object": "chat.completion",
  "model": "claude-sonnet-4-6",
  "choices": [
    {
      "index": 0,
      "finish_reason": "stop",
      "message": {
        "role": "assistant",
        "content": "ok"
      }
    }
  ],
  "usage": {
    "prompt_tokens": 12,
    "completion_tokens": 4,
    "total_tokens": 16
  }
}
```

#### 6.3.3 支持边界

本轮明确支持：

1. `GET /v1/models`
2. 非流式 `POST /v1/chat/completions`
3. 文本输入输出
4. 单 assistant 文本消息抽取

本轮暂不支持：

1. OpenAI function/tool calling 到 Anthropic tool use 的双向转换
2. 流式 SSE chunk 级映射
3. 图像、多模态 block 的复杂映射
4. `responses` API

原因：当前需求只要求统一供应商与可配置协议，先覆盖现有主链路最小闭环。

## 7. 代码改动范围

### 7.1 必改

1. `apps/api/src/connectors/llm-proxy-connector.ts`
   - 增加 `LLM_PROXY_UPSTREAM_API_TYPE`
   - 增加 Anthropic 请求/响应转换
2. `apps/.env.example`
   - 新增并说明 `LLM_PROXY_UPSTREAM_API_TYPE`
   - 将上游统一示例改为 `https://llmapi.oneceo.ai`
3. `apps/.env`
   - 实际运行配置切到 `llmapi.oneceo.ai`
4. `apps/api/src/services/sandbox-agent-provision-service.ts`
   - 确保 sandbox/OpenCode 最终使用的平台统一代理入口或统一的 `llmapi.oneceo.ai` 配置口径
5. 相关验证脚本
   - `apps/api/src/scripts/e2b-sandbox-verify.sh`
   - 若依赖 OpenAI-compatible，可继续打平台代理，不直接打 Anthropic 原生

### 7.2 应清理

1. `AGENT_OPENAI_BASE_URL` 中指向 Cloudflare Gateway 的默认示例
2. `LLM_PROXY_UPSTREAM_BASE_URL` 指向 `hone.vvvv.ee` 的旧值
3. 文档中将 `hone` / `cf gateway` 视为主运行供应商的口径

## 8. 统一接入方案

### 8.1 推荐最终口径

平台内统一分两层：

1. 平台内部消费者
   - 继续永远只调用 OpenAI-compatible 口径
   - 即 `/v1/models`、`/v1/chat/completions`
2. 平台上游兼容层
   - 根据 `.env` 选择转 OpenAI 或 Anthropic

这样可以保证：

1. OpenCode 不需要改 provider 体系
2. Codex / managed / sandbox verify 等现有逻辑改动最小
3. 未来切回 `openai` 或继续走 `anthropic` 只需改环境变量

### 8.2 为什么不让 OpenCode 直接走 Anthropic

原因：

1. 当前 OpenCode 配置体系已稳定建立在 `@ai-sdk/openai-compatible`
2. 直接切 Anthropic 会波及 provider 配置、模型格式、验证脚本和运行时行为
3. 当前最短路径是“平台内部统一 OpenAI-compatible，外层兼容 Anthropic”

## 9. 验证方案

实现后必须验证以下场景：

### 9.1 `openai` 模式

1. `GET /api/llm-proxy/v1/models` 返回 200
2. `POST /api/llm-proxy/v1/chat/completions` 返回 200
3. E2B sandbox verify 通过
4. OpenCode 最小 smoke 返回 `OK`

### 9.2 `anthropic` 模式

1. `GET /api/llm-proxy/v1/models` 返回 200
2. `POST /api/llm-proxy/v1/chat/completions` 经转换后返回 200
3. 响应体为标准 OpenAI-compatible 格式
4. 平台内最小 agent 调用可完成一次文本对话
5. Sandbox verify 仍通过

## 10. 风险与约束

1. 如果某些链路依赖 OpenAI 流式 chunk 格式，则本轮 `anthropic` 模式不能直接覆盖，必须限制在非流式路径。
2. 如果某些 managed/tool 场景已经依赖 OpenAI tools schema，则本轮不能宣称 Anthropic 全量兼容，只能宣称“文本 chat 完整兼容”。
3. `llmapi.oneceo.ai` 若未来模型列表和消息接口权限分离，`/v1/models` 与 `/v1/messages` 需分别验证。

## 11. 实施步骤

1. 修改 `docs` 设计文档并确认方案。
2. 在 `llm-proxy-connector.ts` 中增加上游协议类型配置与转换逻辑。
3. 统一 `.env` / `.env.example` 到 `llmapi.oneceo.ai`。
4. 调整 sandbox verify 和相关 smoke 脚本。
5. 完成 `openai` 与 `anthropic` 两种模式的本地验证。

## 12. 验收标准

满足以下条件才算完成：

1. `.env` 中可以直接选择 `openai` 或 `anthropic`
2. 平台运行上游统一为 `llmapi.oneceo.ai`
3. 平台内部消费者无需区分上游协议
4. 至少文本聊天主链路在两种模式下都能成功
5. 代码与文档中不再把 `hone` / `cf gateway` 作为默认正式供应商

## 13. 待你确认的实现边界

本设计默认以下边界，请确认：

1. 第一阶段只要求兼容文本 `chat.completions`
2. Anthropic 模式暂不覆盖 tool calling / 流式 chunk 映射
3. 平台内部接口口径继续保持 OpenAI-compatible，不把业务调用改写为直接调用 `/v1/messages`

如果以上边界确认无误，下一步即可开始实现。
