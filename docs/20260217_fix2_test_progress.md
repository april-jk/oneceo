# 2026-02-17 Fix2 联调进度记录

## 本轮目标
- 将 OSAC 二进制切换为 `osac-linux-amd64_v1.1.2.fix2`
- 复跑一次编排侧 E2E（provision + OSAC 连接）
- 核对 opencode 的模型/API 指定方式，排除纯配置错误

## 本轮执行
1. 本地运行配置切换：
   - `apps/api/.env` 中 `OSAC_BINARY_PATH` 已切到 `../../others/osac-linux/osac-linux-amd64_v1.1.2.fix2`
2. E2E 脚本：
   - 命令：`apps/api/scripts/_osac_e2e_test.ts`
   - 结果：`OSAC end-to-end test: done`
   - 关键输出：
     - `status: ready`
     - `osacEndpoint: ws://192.168.10.172:20063/ws`
     - `SESSION_LIST_RESPONSE` 正常返回
3. 网关连通性补测：
   - `GET /api/llm-proxy/v1/models` 到达 API 网关
   - 当前上游返回 `503 upstream_unavailable`，日志为 `fetch failed`
4. opencode 侧规则确认（官方文档）：
   - 模型需采用 `provider/model` 形式
   - OpenAI 兼容上游建议通过自定义 provider（`@ai-sdk/openai-compatible`）配置 `baseURL/apiKey/models`
   - `ProviderModelNotFoundError` 首先检查模型字符串与 provider 配置是否匹配

## 当前结论
- Fix2 下编排 + OSAC 控制链路可用。
- 目前阻塞点不在 “OSAC 正向通道建立”，而在：
  1) 上游模型网关可达性/可用性（当前 503）；
  2) opencode 的模型名与 provider 映射配置。

