# OSAC LLM 转发回归测试与排障手册（Fix3）

## 1. 适用范围
- OSAC 版本：`v1.1.2.fix3`
- 编排 API：`apps/api`
- 测试目标：验证 Sandbox 内 `127.0.0.1:18111` 经 OSAC 转发到上游 LLM（OpenAI 兼容）稳定可用

## 2. 固化流程（标准执行顺序）
1. 启动/重启 API 后先检查健康状态：
```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4000/health
```
2. 确认启动日志包含持久连接恢复（避免重启后桥接丢失）：
   - 关键日志：`[OSAC_PERSISTENT_RECOVER_RESULT] {"sessionId":"<sid>","ok":true}`
3. 确认 session 状态为 `ready`：
```powershell
Invoke-RestMethod http://127.0.0.1:4000/api/sandbox/environment/<sid>
```
4. 在 VM 内验证 `models` 与 `chat/completions`，单请求超时固定 `60s`。
5. 回归测试按“`5 轮 x 4 批`”执行（总计 20 轮），避免单条 KVM 命令体过长导致失败。

## 3. 回归脚本
- 脚本：`apps/api/scripts/osac_llm_regression.ts`
- 说明：每轮做两件事
  - `GET /v1/models`
  - `POST /v1/chat/completions`（期望返回 `OK`）

示例（5 轮）：
```powershell
$env:SID='sess_xxx'
$env:ROUNDS='5'
$env:CURL_TIMEOUT_SECONDS='60'
$env:EXEC_TIMEOUT_SECONDS='600'
$env:ROUND_INTERVAL_SECONDS='1'
$env:EXEC_RETRY_ATTEMPTS='4'
$env:EXEC_RETRY_DELAY_MS='3000'
npx tsx scripts/osac_llm_regression.ts
```

20 轮建议执行方式（4 批，每批 5 轮）：
```powershell
for($b=1;$b -le 4;$b++){
  npx tsx scripts/osac_llm_regression.ts
  Start-Sleep -Seconds 2
}
```

## 4. 本次实际回归结果（2026-02-18）
- session：`sess_4fb5239668d94b6f`
- API 重启后恢复：`ok=true`
- 回归方式：`5轮 x 4批 = 20轮`
- 聚合结果：
  - `passed: 20`
  - `failed: 0`
  - `passRate: 100.0%`

## 5. 错误清单与解决方式（防止从零排查）

### 错误 A：`bridge_disconnected` / `bridge_no_ack`
- 现象：
  - VM 内 `18111` 请求返回 `503`
  - OSAC 日志出现 `bridge_disconnected` 或 `bridge_no_ack`
- 根因：
  - API 重启后，编排侧持久 WS 桥接未自动恢复
- 解决：
  1. 在 API 启动时自动恢复 ready session 持久连接
  2. 保留 Fix3 的 `LLM_PROXY_ACK` 机制
- 核验：
  - API 日志出现 `[OSAC_PERSISTENT_RECOVER_RESULT] ... ok=true`
  - OSAC 日志出现 `stage=bridge_ack`

### 错误 B：`upstream_unavailable` + `fetch failed`（连接超时）
- 现象：
  - `/api/llm-proxy/*` 返回 `503 upstream_unavailable`
  - 错误栈含 `UND_ERR_CONNECT_TIMEOUT`
- 根因：
  - Node `fetch` 在当前网络路径下连接超时不稳定
- 解决：
  - LLM 上游转发改为原生 `http/https` 请求，并保留统一超时/错误映射

### 错误 C：返回体乱码（gzip 压缩体）
- 现象：
  - `200` 但 body 是二进制乱码
- 根因：
  - 上游压缩响应被透传，调用端未解压
- 解决：
  - 转发请求强制 `accept-encoding: identity`

### 错误 D：`401 auth_missing` / `token_mismatch`
- 现象：
  - WS 握手失败
- 根因：
  - OSAC token 未传/传错
- 解决：
  - 使用标准 `Authorization: Bearer <token>`
  - 对照 Fix3 返回头 `X-OSAC-Auth-Code` 与 JSON `error.code` 定位

### 错误 E：`KVM 服务暂时不可用` / `Rate limit exceeded`
- 现象：
  - 高频执行回归时，KVM `execSession` 调用失败
- 根因：
  - 执行频率或单条命令过长引发 KVM 侧限制
- 解决：
  1. 使用批量执行（推荐 `5轮/批`）
  2. 增加重试与退避（脚本已内置）

## 6. 快速验收命令（最小闭环）
```powershell
# 1) 重启 API
# 2) 确认恢复日志含 ok=true
# 3) 运行 5轮脚本，重复4次
```

验收通过标准：
- 20/20 轮均满足：
  - `modelsCode=200` 且 `modelsOk=true`
  - `chatCode=200` 且 `chatOk=true`
