# 13 Suna流式执行链路与SSE事件流研究

日期：2026-03-25

## 1. 研究目标

本篇只回答一个具体问题：

- `referance/suna` 是否真的采用了 `SSE / 流式执行`
- 这种实现是否能缓解 oneceo 当前 `Altus managed` 在“工具结果回填后下一轮模型调用”阶段出现的 `upstream_timeout`

结论必须落到源码，而不是停留在概念层。

---

## 2. 核心结论

### 2.1 Suna 确实使用了 SSE

是，而且不是“只有一个 SSE 路由”这么简单。

`Suna` 的实现是：

1. `agent_run` 启动后立即返回
2. 后台执行器把运行中的所有事件持续写入 `agent_run:{id}:stream`
3. `GET /agent-run/{agent_run_id}/stream` 通过 `StreamingResponse(..., media_type="text/event-stream")` 持续把这些事件推给前端

直接代码依据：

- `referance/suna/backend/core/agents/api.py`
  - `start_agent_run(...)`
  - `stream_agent_run(...)`
  - `stream_generator(...)`
- `referance/suna/backend/core/agents/runner/executor.py`
  - `execute_agent_run(...)`

### 2.2 Suna 的关键不只是 SSE 传输，而是“执行内部本身就是流式的”

`Suna` 的 run 并不是等整个模型回合结束后，再一次性写一条“assistant 完成”。

它在模型响应过程中就持续产出：

- `ack`
- `estimate`
- `thinking`
- `context_usage`
- `reasoning_chunk`
- `assistant content chunk`
- `tool_call_chunk`
- `tool_started`
- `tool_result`
- `tool_output_stream`
- `assistant_complete`
- `status completed / failed / stopped`

这意味着：

- 长耗时模型推理期间，前端能持续收到新事件
- 工具参数是增量到达的
- 工具输出也可以边执行边流出
- 连接保活与“整轮必须在 60 秒内完成”是两套机制

### 2.3 oneceo 当前也有 SSE，但层级不对，所以它解决不了这次超时

当前 oneceo 的 managed 模式已经有：

- 后端 SSE 路由
- 前端 `EventSource`
- 15 秒 heartbeat

但这条 SSE 只是把已经落库的粗粒度 run event 转发给浏览器。

当前真正的模型调用仍然是阻塞式：

- `apps/api/src/services/altus-run-coordinator.ts`
  - `callModel(...)` 固定发送 `stream: false`
- `apps/api/src/connectors/llm-proxy-connector.ts`
  - `LLM_PROXY_TIMEOUT_MS` 默认 `60000`

所以现在的实际情况是：

1. 浏览器到 API 的 SSE 连接还活着
2. 但 API 到 `llm-proxy -> 上游模型` 的这一跳在等待完整响应
3. 只要这一跳超过本地 timeout，就会先被本地 abort，最后报 `upstream_timeout`

也就是说：

> 仅仅“前端持续有 SSE”并不能避免当前问题；必须把模型调用内层也改成流式消费，才能在长回合期间持续产生真实事件。

### 2.4 Suna 不是没有超时，而是把超时拆到了正确层级

`Suna` 并不是完全“不设超时”。

它仍然有：

- SSE 建连超时
- Redis 操作超时
- shell/tool 执行超时
- worker 无事件产出时的存活检查

但它没有把“整个 run 的单轮模型回合必须在固定 60 秒内完整返回”当成唯一超时口径。

这正是当前 oneceo 与 Suna 的本质差异。

---

## 3. Suna 后端流式执行链路

## 3.1 run 启动即创建 stream，并先写 UX 事件

`start_agent_run(...)` 在创建 `agent_run_id` 后，立即构造：

- `stream_key = f"agent_run:{agent_run_id}:stream"`

然后先异步写入：

- `stream_ack(...)`
- `stream_estimate(...)`

之后才把真正执行逻辑交给后台 `_background_setup_and_execute(...)`。

代码依据：

- `referance/suna/backend/core/agents/api.py`
  - `start_agent_run(...)`
  - `stream_ack(...)`
  - `stream_estimate(...)`

这一步很关键，因为它让前端在模型首包回来之前，已经能看到 run 已经被接收且开始工作。

## 3.2 执行器持续把事件写进 run stream，而不是只在结束时写一次

`execute_agent_run(...)` 的核心行为：

- 启动时先写 `initializing`
- 设置 `tool output streaming context`
- 构造 `PipelineContext`
- `async for response in coordinator.execute(ctx)` 持续消费协调器输出
- 每拿到一个 response，就 `redis.stream_add(stream_key, {"data": json.dumps(response)})`

代码依据：

- `referance/suna/backend/core/agents/runner/executor.py`
  - `stream_status_message("initializing", ...)`
  - `set_tool_output_streaming_context(...)`
  - `async for response in coordinator.execute(ctx):`
  - `redis.stream_add(...)`

这说明 Suna 的实时性来自“执行器内部不断产事件”，不是来自 SSE 层自己空转。

## 3.3 模型调用本身就是 `stream=True`

Suna 在协调器的执行引擎里调用模型时明确传：

- `stream=True`

代码依据：

- `referance/suna/backend/core/agents/pipeline/stateless/coordinator/execution.py`
  - `executor.execute(..., stream=True)`

这意味着执行引擎不是等待完整 `assistant message`，而是增量消费模型 chunk。

## 3.4 ResponseProcessor 把 chunk 拆成可消费的运行事件

`ResponseProcessor.process_response(...)` 会边读模型流边产出：

- `build_thread_run_start(...)`
- `build_llm_response_start(...)`
- `build_reasoning_chunk(...)`
- `build_content_chunk(...)`
- `build_tool_call_chunk(...)`
- `build_tool_started(...)`
- 工具执行结果
- `build_assistant_complete(...)`
- `build_llm_response_end(...)`

并且当 `execute_on_stream` 开启时，只要某个 tool call 在流里已经完整，就可以先启动工具执行，而不必等整轮 assistant 完全结束。

代码依据：

- `referance/suna/backend/core/agents/pipeline/stateless/coordinator/response_processor.py`
- `referance/suna/backend/core/agents/pipeline/stateless/coordinator/message_builder.py`

这是 Suna 能在“模型仍在输出中”就展示工具参数和运行状态的核心原因。

## 3.5 工具输出也支持独立流式事件

Suna 不只流 assistant 文本，还单独流工具执行输出。

关键实现：

- `tool_output_streaming.py`
  - 通过上下文保存 `agent_run_id / stream_key / tool_call_id`
  - `stream_tool_output(...)` 直接往同一个 run stream 写 `tool_output_stream`
- `sb_shell_tool.py`
  - shell 工具使用 PTY
  - `on_pty_data(...)` 每收到一段输出就调用 `stream_tool_output(...)`

代码依据：

- `referance/suna/backend/core/utils/tool_output_streaming.py`
- `referance/suna/backend/core/tools/sb_shell_tool.py`

这使得“工具运行很久但还活着”的场景，可以持续产生事件，而不是静默等待。

## 3.6 SSE 端点只是 run stream 的转发层

`stream_agent_run(...)` 本身不负责生成业务事件，它只负责：

1. 鉴权
2. 查找 `stream_key`
3. `subscribe first, then catch-up`，避免 race condition
4. 持续转发 Redis Stream 条目
5. 定期发 `ping`
6. 在长时间无数据时检查 worker 是否还活着

代码依据：

- `referance/suna/backend/core/agents/api.py`
  - `stream_agent_run(...)`
  - `stream_generator(...)`

所以 Suna 的 SSE 是“转发真正的实时运行事件”，不是自己构造一个假的长连接外壳。

## 3.7 Suna 为多订阅者准备了 StreamHub

Suna 没有让每个 SSE 客户端都单独阻塞读 Redis。

它通过 `StreamHub` 做：

- 每个 `stream_key` 只有 1 个 Redis `XREAD`
- 多个 SSE 订阅者共享这个 reader
- fan-out 到各自 queue

代码依据：

- `referance/suna/backend/core/services/redis.py`
  - `class StreamHub`
  - `subscription(...)`
  - `iter_queue(...)`

这说明 Suna 把 run stream 当成权威事件总线，而不是普通接口响应。

---

## 4. Suna 前端如何消费流

## 4.1 前端直接订阅 `/agent-run/{runId}/stream`

前端核心 hook：

- `referance/suna/packages/shared/src/streaming/use-agent-stream-core.ts`

关键行为：

- 建立 `EventSource`
- 订阅 run stream
- 处理 assistant chunk / reasoning chunk / tool call chunk / tool result / tool output stream
- 在完成时做最终收口

## 4.2 前端只对“建连”设短超时，不对整个 run 设死超时

Suna 前端确实有 timeout，但它是：

- `CONNECTION_TIMEOUT_MS = 15000`

这个 timeout 只用于：

- `EventSource` 长时间连不上

它不是：

- “15 秒内整个任务必须完成”

代码依据：

- `referance/suna/packages/shared/src/streaming/use-agent-stream-core.ts`
  - `setupEventSource(...)`

## 4.3 heartbeat 的意义是检查连接/worker 存活，而不是终止长任务

Suna 前端维护：

- `lastMessageTimeRef`
- `HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000`

当很久没有消息时，它会：

1. 调状态接口确认 run 是否仍在运行
2. 如果 run 仍在运行，就继续等待
3. 只有网络/连接异常时才走 reconnect

代码依据：

- `referance/suna/packages/shared/src/streaming/use-agent-stream-core.ts`
  - `openHandler`
  - heartbeat status check
  - reconnect 逻辑

这和 oneceo 当前“模型内层 60 秒超时”是两套完全不同的超时语义。

## 4.4 tool_call 和 assistant 文本都在前端增量重组

Suna 前端不是每次都等一条完整 assistant message。

它会对：

- assistant chunk
- reasoning chunk
- tool_call_chunk
- tool_result

进行累积和重组，直到最后收到 `stream_status: complete`。

代码依据：

- `referance/suna/packages/shared/src/streaming/use-agent-stream-core.ts`
- `referance/suna/packages/shared/src/streaming/message-handler.ts`

---

## 5. 对照 oneceo 当前 Altus managed

## 5.1 oneceo 当前“有 SSE，但只是粗粒度 run event replay”

当前 oneceo 已有：

- 后端 SSE 服务：`apps/api/src/services/altus-managed-stream-service.ts`
- SSE 路由：`apps/api/src/routes/altus-managed-routes.ts`
- 前端 managed `EventSource`：`apps/web/client/src/hooks/useTaskCreationAgent.ts`

当前行为是：

1. 先从数据库补历史 run event
2. 再订阅内存中的 subscriber
3. 每 15 秒写一个 `heartbeat`

这说明 oneceo 现阶段的 SSE 主要职责是“把 run event 推给浏览器”，而不是 run 内部真实执行流。

## 5.2 oneceo 当前模型调用仍然是阻塞式整轮等待

当前 `AltusRunCoordinator.callModel(...)` 请求 llm-proxy 时写死：

- `stream: false`

代码依据：

- `apps/api/src/services/altus-run-coordinator.ts`

这意味着：

- 工具结果回填后
- coordinator 会阻塞等待完整 `choices[0].message`
- 在此期间不会产生 assistant chunk、tool_call chunk、reasoning chunk

## 5.3 oneceo 的 llm-proxy 其实已经具备流式代理能力，但 managed 没有用上

`llm-proxy-connector.ts` 已经支持：

- 上游 `text/event-stream`
- Anthropic SSE 转 OpenAI chunk
- 非 Anthropic SSE 直接 pipe downstream

代码依据：

- `apps/api/src/connectors/llm-proxy-connector.ts`
  - `forwardAnthropicChat(...)`
  - `isStreamContentType(...)`
  - `finalResponse.pipe(res)`

也就是说，当前瓶颈不是 oneceo 完全不会代理流，而是 `Altus managed coordinator` 没有把这条能力接入自己的执行内层。

## 5.4 当前 heartbeat 只能保住浏览器连接，保不住上游模型调用

`altus-managed-stream-service.ts` 的 heartbeat 是：

- API -> Browser 的 SSE 心跳

但当前报错的 timeout 发生在：

- `AltusRunCoordinator.callModel(...)`
- `llm-proxy-connector.ts`
- 上游模型

因此：

- 即使浏览器一直收到 `heartbeat`
- 也不会延长 API 内部那次 `fetch(..., stream: false)` 的等待时间

这是本次问题里最容易被误判的一点。

## 5.5 当前 oneceo 事件模型也明显比 Suna 更粗

当前后端实际发出的主要事件是：

- `run_ack`
- `run_status`
- `tool_call_started`
- `tool_call_completed`
- `tool_call_failed`
- `clarification_requested`
- `assistant_message`
- `run_completed / run_failed / run_stopped`

代码依据：

- `apps/api/src/services/altus-managed-run-entry-service.ts`
- `apps/api/src/services/altus-run-coordinator.ts`
- `apps/api/src/services/altus-run-lifecycle-service.ts`

前端虽然已经预留了：

- `assistant_delta`
- `tool_call_progress`

等事件分支，但后端当前并没有真正连续地产这些事件。

代码依据：

- `apps/web/client/src/hooks/useTaskCreationAgent.ts`

---

## 6. 对当前 timeout 问题的直接判断

## 6.1 只补前端 SSE 不能解决这次问题

如果只做：

- 更稳定的 `EventSource`
- 更多 heartbeat
- 更好的 reconnect

但仍保持：

- `AltusRunCoordinator.callModel(... stream: false)`
- `LLM_PROXY_TIMEOUT_MS = 60000`

那么“工具结果后下一轮模型调用超时”仍然会继续发生。

原因很简单：

- 真正卡住的是内层模型请求
- 不是浏览器与 API 之间的 SSE 连接

## 6.2 Suna 的可借鉴点是“让模型回合在内层就开始产流”

对这次问题真正有帮助的是 Suna 的这些结构：

1. 模型调用 `stream=True`
2. `ResponseProcessor` 把 chunk 立刻转换成 run event
3. run stream 持续接收 chunk、tool chunk、tool output
4. 前端按 chunk 重组 UI
5. 连接保活与 run 时长分离

只有做到这一步，才谈得上“长任务继续有流，因此不需要把整轮结果卡死在一个很短的固定 timeout 上”。

## 6.3 仍然需要 timeout，但必须改成分层 timeout

参照 Suna，可以明确区分：

- 建连超时
- 首个业务事件等待超时
- tool 执行超时
- worker 无事件存活检测
- 整体 run 生命周期管理

而不应继续使用：

- 单个 blocking completion 请求的整轮硬超时，作为 managed run 的主要约束

---

## 7. 后续改造时必须重点参照的 Suna 代码

| 主题 | Suna 参照代码 | 说明 |
|---|---|---|
| run 启动与 stream 建立 | `referance/suna/backend/core/agents/api.py` | `start_agent_run(...)`、`stream_agent_run(...)`、`stream_generator(...)` |
| run 执行器 | `referance/suna/backend/core/agents/runner/executor.py` | `execute_agent_run(...)` 持续写 stream |
| 流式模型执行 | `referance/suna/backend/core/agents/pipeline/stateless/coordinator/execution.py` | `executor.execute(..., stream=True)` |
| chunk -> run event 转换 | `referance/suna/backend/core/agents/pipeline/stateless/coordinator/response_processor.py` | reasoning/content/tool_call 增量处理 |
| 事件结构定义 | `referance/suna/backend/core/agents/pipeline/stateless/coordinator/message_builder.py` | `stream_status=chunk/tool_call_chunk/complete` |
| UX 过程事件 | `referance/suna/backend/core/agents/pipeline/ux_streaming.py` | `ack / estimate / thinking / context_usage` |
| 工具输出流 | `referance/suna/backend/core/utils/tool_output_streaming.py` | `tool_output_stream` |
| Shell 工具实时输出 | `referance/suna/backend/core/tools/sb_shell_tool.py` | PTY 输出实时写 stream |
| SSE 共享总线 | `referance/suna/backend/core/services/redis.py` | `StreamHub` |
| 前端 EventSource 与重连 | `referance/suna/packages/shared/src/streaming/use-agent-stream-core.ts` | run stream 消费、heartbeat、reconnect |

---

## 8. 与 oneceo 当前代码的直接对照入口

| 主题 | oneceo 当前代码 | 当前状态 |
|---|---|---|
| managed run 入口 | `apps/api/src/services/altus-managed-run-entry-service.ts` | 已有 run entry |
| run SSE 服务 | `apps/api/src/services/altus-managed-stream-service.ts` | 已有，但只转发粗粒度事件 |
| run SSE 路由 | `apps/api/src/routes/altus-managed-routes.ts` | 已有 |
| 模型调用 | `apps/api/src/services/altus-run-coordinator.ts` | 仍是 `stream: false` 的阻塞式回合 |
| llm-proxy 流能力 | `apps/api/src/connectors/llm-proxy-connector.ts` | 已支持流式代理，但 managed 未接入 |
| 前端 managed EventSource | `apps/web/client/src/hooks/useTaskCreationAgent.ts` | 已有，但主要消费粗粒度 run 事件 |

---

## 9. 本文结论

最终判断如下：

1. `Suna` 确实使用了 `SSE`，而且是 run 内部真正流式执行驱动的 SSE。
2. `Suna` 能缓解长任务超时，不是因为“单纯有 SSE”，而是因为模型 chunk、tool chunk、tool output 在内层持续产流。
3. oneceo 当前也有 SSE，但它只在 `API -> Browser` 这一层成立；`API -> llm-proxy -> upstream` 仍是 blocking completion，所以依然会命中 `upstream_timeout`。
4. 后续 oneceo 若要参照 Suna 改造，必须重点对齐：
   - 流式模型调用
   - chunk 级事件生成
   - tool output stream
   - 前端 chunk 重组
   - 分层 timeout 策略

这才是后续改造的直接实现依据。
