# Cloudflare AI Gateway 配置完成报告

## 配置概览

| 项目 | 详情 |
|------|------|
| **Gateway 名称** | `opencode-proxy` |
| **Gateway ID** | `opencode-proxy` |
| **Cloudflare Account ID** | `1db165e7760cc66ac92c02bf6a92102b` |
| **日志记录** | 已启用（`collect_logs: true`） |
| **创建时间** | 2026-02-22 07:25:04 UTC |
| **Custom Provider Slug** | `opencode` |
| **上游站点** | `https://hone.vvvv.ee` |

---

## CherryStudio 配置（直接可用）

在 CherryStudio 中添加自定义 OpenAI 格式提供商，填入以下信息：

### API Base URL

```
https://gateway.ai.cloudflare.com/v1/1db165e7760cc66ac92c02bf6a92102b/opencode-proxy/custom-opencode/v1
```

### API Key

```
sk-aipfteelVJ3hD3n7KOVy69VW4sTIfw1BqWEopqhoO8iyV1au
```

### 模型名称

```
claude-haiku-4-5-20251001
```

---

## 请求流转路径

```
CherryStudio
    ↓  发送请求到 Cloudflare AI Gateway
https://gateway.ai.cloudflare.com/v1/{account_id}/opencode-proxy/custom-opencode/v1/chat/completions
    ↓  Cloudflare 记录日志 + 转发到上游
https://hone.vvvv.ee/v1/chat/completions
    ↓  返回响应
CherryStudio
```

---

## 日志查看

登录 [Cloudflare Dashboard](https://dash.cloudflare.com/1db165e7760cc66ac92c02bf6a92102b/ai/ai-gateway/opencode-proxy) 即可查看所有请求日志。

日志包含以下信息：
- 请求时间、耗时
- 使用的模型名称
- 请求路径
- HTTP 状态码
- 是否成功
- Token 用量（如上游返回）

---

## 验证测试

已通过以下测试请求验证配置正常工作：

```bash
curl -X POST \
  "https://gateway.ai.cloudflare.com/v1/1db165e7760cc66ac92c02bf6a92102b/opencode-proxy/custom-opencode/v1/chat/completions" \
  -H "Authorization: Bearer sk-aipfteelVJ3hD3n7KOVy69VW4sTIfw1BqWEopqhoO8iyV1au" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-haiku-4-5-20251001",
    "messages": [{"role": "user", "content": "Say hello"}],
    "max_tokens": 10
  }'
```

**测试结果**：返回 HTTP 200，响应内容 `{"choices":[{"message":{"content":"Hello"}}]...}`，日志已记录。

---

## 注意事项

1. **无需额外认证头**：当前 Gateway 未启用 `authentication`，直接使用上游 API Key 即可。
2. **URL 路径说明**：`/custom-opencode/v1` 中的 `v1` 是上游 API 的路径前缀，Cloudflare 会将其拼接到 `base_url (https://hone.vvvv.ee)` 后面，形成完整的上游 URL `https://hone.vvvv.ee/v1/chat/completions`。
3. **日志保留**：Cloudflare AI Gateway 日志默认保留，可在 Dashboard 中查看和导出。
