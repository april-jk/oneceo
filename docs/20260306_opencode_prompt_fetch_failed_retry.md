# 2026-03-06 OpenCode 二次输入不稳定（fetch failed）修复

## 现象

- 用户第二条输入后未继续收到 OpenCode 事件流。
- 管理后台会话日志显示：第二条输入后仅落盘 `user_input`，随后出现 `error: fetch failed`，未出现 `opencode_user_input / OPENCODE_PROMPT_ACCEPTED`。

## 根因

- `sendOpencodePrompt` 仅在超时/abort时才走 sandbox 内部派发兜底。
- 对 `TypeError: fetch failed`、5xx 等瞬时网络/上游异常直接抛错，导致该轮输入中断。
- 同时前端与 WS 层对 `error` 消息存在吞掉路径，用户感知为“静默无响应”。

## 修复

1. 后端发送 prompt 容错增强（API）
- 在 `osac-agent-service` 新增可重试错误判定（`fetch failed`、网络类错误、429/5xx）。
- 命中后自动走 sandbox 内部 `dispatchPromptInSandbox` 兜底，不直接失败。

2. 错误可见性修复（WS + Web）
- WebSocket 服务不再提前吞掉 `error` 类型消息。
- 前端 `useTaskCreationAgent` 在 SSE/WS 两条链路都显式处理 `error`：
  - 结束 processing 状态
  - 将错误写入消息列表，避免“无反馈卡住”

## 影响

- 第二条及后续输入在短暂网络抖动下可继续执行（兜底派发）。
- 即使仍失败，前端也会明确显示错误，而不是无响应。

## 追加加固（2026-03-06 晚）

1. fallback 改为同步确认（API）
- dispatchPromptInSandbox 从后台 nohup 改为前台同步 python3 调用。
- 若 sandbox 内转发仍失败会立即 sys.exit(1) 抛回，避免“已接受但实际未送达”的假成功。

2. 合并器不再丢弃 error（Web）
- mergeRealtimeMessage 不再直接忽略 error，改为去重后保留。
- 覆盖历史回放/混合链路场景下的错误可见性，避免残余静默。

## 新增问题修复（2026-03-06 晚，conversation-0ddc42...）

### 现象
- 第二轮用户补充后返回 error: exit status 1，会话中断。

### 根因
- sandbox fallback 使用 urllib 请求并等待响应，流式/冲突场景容易被误判为命令失败，最终上抛为泛化错误。

### 修复
1. fallback 仅以 HTTP 状态判定“已接收”
- 不再读取完整响应体，只要请求建立并返回非 4xx/5xx 即视为成功。

2. 兼容 409 冲突场景
- 对 HTTP 409（会话忙/可能已接收）按成功处理，避免误判失败。

3. fallback 失败时增加最终兜底重试与聚合报错
- 在 fallback 报错后，重新 ensure server 并再尝试一次主通道发送。
- 若仍失败，返回 primary/fallback/retry 三段错误信息，便于定位。

## 新增修复（2026-03-06 夜，前台报错 primary/fallback/retry）

### 问题表现
- 第二条输入仍在同一任务会话中，但 prompt 投递链路报错：
  opencode prompt failed after fallback: primary=This operation was aborted; fallback=exit status 1; retry=This operation was aborted

### 根因补充
- 外网 HTTP 投递容易出现 aborted（超时中断）。
- fallback 之前依赖等待响应语义，失败时只返回 exit status 1，不利于稳定与定位。

### 本次修复
1. Prompt 投递改为优先 sandbox 内本地分发
- 默认启用 `OPENCODE_PROMPT_PREFER_SANDBOX=true`（可通过环境变量关闭）。
- 使用 sandbox 本地 socket 直写 HTTP 请求，尽量避免外网链路 abort。

2. fallback 结果结构化解析
- sandbox 侧输出 `OCPROMPT_RESULT` 与返回码标记，由后端解析并生成明确错误。
- 不再只显示模糊的 exit status 1。

3. 保留 HTTP 通道作为次级兜底
- sandbox 分发失败后再走 HTTP；若仍失败再 ensure+retry，并输出聚合错误。
