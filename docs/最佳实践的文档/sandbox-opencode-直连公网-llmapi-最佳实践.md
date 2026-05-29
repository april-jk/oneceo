# Sandbox 内使用 OpenCode 直连公网 LLM API 最佳实践

更新时间：2026-02-20  
适用范围：当前阶段（暂停 OSAC 方案），在 Sandbox 内直接使用 OpenCode 调用公网 LLM API。

状态补充（2026-05-29）：本文记录的是历史直连方案。生产安全口径已切换为 `Sandbox -> OSAC 本地 LLM proxy -> API 进程内 /api/llm-proxy -> 上游`，不再把平台真实 API Key 或直连 base URL 写入用户可控 sandbox。

## 1. 当前策略（冻结口径）

当前默认策略：

1. 历史口径是不走 OSAC 执行链路（仅保留代码）。
2. 历史口径是 Sandbox 内 `opencode` 直接访问公网 OpenAI-compatible 端点。
3. 当前生产安全口径禁止继续使用直连公网 API Key 方案。

相关默认开关（编排侧）：

- `OSAC_EXECUTION_ENABLED=false`
- 历史直连：`OSAC_LLM_PROXY_ENABLE=false`
- 当前安全默认：`OSAC_LLM_PROXY_ENABLE=true`

### 1.1 配置隔离要求

当平台主链路的 LLM 代理使用了与 Sandbox 直连链路不同的协议口径时，必须为 Sandbox 单独下发配置，不能直接复用平台主链路的协议类型。

历史直连方案曾建议使用以下独立变量：

- `SANDBOX_OPENAI_API_KEY`
- `SANDBOX_OPENAI_BASE_URL`
- `SANDBOX_OPENAI_MODEL`
- `SANDBOX_OPENAI_API_TYPE`

推荐口径：

1. 主平台链路继续按自身协议接入 `llm-proxy`。
2. Sandbox/OpenCode 只消费本地 OpenAI-compatible 代理地址。
3. Sandbox 预检与 `opencode.json` 统一读取本地 OSAC LLM proxy 映射后的环境变量，避免平台主链路密钥进入 sandbox。
4. `SANDBOX_OPENAI_API_KEY`、`SANDBOX_ENGINE_*_API_KEY` 不得写入 sandbox env 或配置文件；模型选择可继续使用 `SANDBOX_OPENAI_MODEL` / `SANDBOX_ENGINE_*_MODEL`。

## 2. 前置条件

1. 已有可用 session（VM 运行中，已绑定）。
2. VM 内已下发 `opencode` 二进制（路径：`/opt/.altus/opencode/opencode`）。
3. 已准备可用的上游参数：
- `OPENAI_BASE_URL`（例如 `https://ai.hvmz.cn/v1`）
- `OPENAI_API_KEY`
- `model`（推荐显式 `provider/model` 格式）

## 3. 标准使用流程

### 步骤 1：确认二进制可用

```bash
pnpm exec tsx scripts/_tmp_exec_once.ts <session_id> "set -e; test -x /opt/.altus/opencode/opencode; /opt/.altus/opencode/opencode --version"
```

### 步骤 2：写入 provider 配置（推荐，避免模型解析失败）

建议写入 `/root/.config/opencode/opencode.json`，至少包含：

1. provider id（如 `hone`）
2. `npm: @ai-sdk/openai-compatible`
3. `baseURL` 与 `apiKey`
4. 模型映射（如 `claude-haiku-4-5-20251001`）

当前已验证可兼容 OpenCode `1.2.6` 工具调用链路的上游组合：

1. `provider=openai`
2. `baseURL=https://ai.hvmz.cn/v1`
3. `model=openai/gpt-5.2`

模型建议统一使用：`provider/model` 格式，例如 `openai/gpt-5.2`。  
避免只写裸模型名导致 `ProviderModelNotFoundError`。

补充：当前 OpenCode `1.2.6` 在部分执行路径下对 `opencode.json` 中的 `{env:OPENAI_BASE_URL}` / `{env:OPENAI_API_KEY}` 解析不稳定。
如果由平台在 Sandbox 内自动生成 `opencode.json`，应优先直接写入字面 `baseURL` / `apiKey`，不要只依赖 `{env:...}` 占位。

### 步骤 3：执行最小烟测

```bash
pnpm exec tsx scripts/_tmp_exec_once.ts <session_id> "set -e; OPENAI_BASE_URL='<OPENAI_BASE_URL>' OPENAI_API_KEY='<OPENAI_API_KEY>' opencode run --format json -m 'openai/gpt-5.2' 'Reply with exactly: OK'"
```

通过标准：输出中出现文本 `OK`。

### 步骤 4：进入业务调用

业务调用继续使用同一命令模板，仅替换 prompt。  
建议每次命令都内联注入 `OPENAI_BASE_URL`、`OPENAI_API_KEY`，避免依赖 VM 全局环境漂移。

## 4. 推荐超时与重试

1. 单次请求总超时：60s。
2. 首 token 延迟按 5~10s 预期设计，不要把超时设得过短。
3. 失败重试最多 2 次，采用短退避（200~500ms），禁止无限重试。
4. 出现配置类错误（401 / model not found）先修配置，不要盲重试。

## 5. 常见错误与处理

### 5.1 `ProviderModelNotFoundError`

原因：模型格式或 provider 映射不正确。  
处理：

1. 改用 `provider/model`（例如 `openai/gpt-5.2`）。
2. 检查 `opencode.json` 是否存在且为合法 JSON。
3. 确认 provider 下已声明该 model。

### 5.2 `401 Unauthorized`

原因：API Key 错误或认证格式不符合上游要求。  
处理：

1. 校验 `OPENAI_API_KEY`。
2. 校验 `OPENAI_BASE_URL` 是否为正确 OpenAI-compatible 路径（通常含 `/v1`）。

### 5.3 网络错误/连接超时

处理：

1. 先用最小 prompt 验证连通性。
2. 检查 base URL 可达性。
3. 保持 60s 超时窗口，避免误判。

## 6. 运行检查清单（每次联调前）

1. `opencode --version` 正常。
2. `opencode.json` 存在且 JSON 合法。
3. 模型格式为 `provider/model`。
4. 烟测 prompt 能返回 `OK`。
5. 超时与重试策略按本文执行。

## 7. 回切 OSAC 时的注意点

当后续恢复 OSAC 方案时：

1. 打开 `OSAC_EXECUTION_ENABLED`。
2. 根据目标链路决定是否打开 `OSAC_LLM_PROXY_ENABLE`。
3. 回归测试要覆盖：连接建立、模型解析、首 token 延迟、重连稳定性。
