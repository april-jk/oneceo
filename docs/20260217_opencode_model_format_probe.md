# 2026-02-17 Opencode 模型格式探针记录

## 目标
- 核实编排侧当前 `OPENCODE_MODEL` 传递格式
- 在 fix2 + 已开启上游代理条件下，验证 opencode 可用的模型格式

## 编排侧现状
- `apps/api/src/agents/task-creation/task-creation-service.ts`
  - 直接透传：`--model ${process.env.OPENCODE_MODEL}`
  - 未自动添加 provider 前缀
- `apps/api/.env`
  - 当前配置：`OPENCODE_MODEL=gemini-3-pro-image`

## 实测结果
1. 上层网关（`/api/llm-proxy/v1/models`）可用，返回 61 个模型。
2. 进入 VM 执行 `opencode run --help`：
   - 明确要求：`--model` 格式为 `provider/model`。
3. 在 VM 执行：
   - `--model gemini-3-pro-image`
   - `--model openai/gemini-3-pro-image`
   - `--model openai/claude-sonnet-4-5-20250929`
   均返回 `ProviderModelNotFoundError`（请求前失败）。
4. 在 VM 执行 `opencode models`：
   - 当前可见模型仅为：
     - `opencode/big-pickle`
     - `opencode/glm-5-free`
     - `opencode/gpt-5-nano`
     - `opencode/kimi-k2.5-free`
     - `opencode/minimax-m2.5-free`
5. 在 VM 执行：
   - `--model opencode/gpt-5-nano`
   - `--model opencode/glm-5-free`
   均成功返回 JSON 事件流。

## 结论
- 当前环境下，opencode 可用模型格式是 `provider/model`，并且 provider 必须是 opencode 已注册 provider。
- 现有 `OPENCODE_MODEL=gemini-3-pro-image` 会触发 `ProviderModelNotFoundError`。
- 若要使用你们网关中的模型名（如 `claude-sonnet-4-5-20250929` / `gemini-3-pro-image`），需要在 opencode 侧补充对应 provider 配置与模型映射（OpenAI-compatible provider），否则仅改模型字符串无效。

