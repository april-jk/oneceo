# 02 第二阶段：Ask_user 与 Tool Pairing 接管 [尚未采用]

## 1. 阶段目标

第二阶段解决用户体感最明显的问题：用户回答补充信息后，Altus 不应重复追问，而应自然继续。

目标是把 `ask_user` 从“UI 文案 + pending 状态”升级成协议闭合的工具调用：

```text
assistant_tool_use ask_user
  -> clarification_request
  -> user_message
  -> clarification_answer
  -> tool_result
  -> next model call
```

## 2. 实现范围

允许修改：

1. pending clarification 的接收路径；
2. clarification answer 的持久化；
3. `ask_user` 对应 tool_result 的生成；
4. Protocol Validator 对 pending ask_user 的拦截；
5. 相关 UI projection 去重逻辑；
6. 相关测试。

不允许修改：

1. 非 clarification 工具结果主链；
2. deployment gate；
3. connector guide gating；
4. direct mode；
5. SSE 事件名；
6. `AltusRunEventWriter` 写入顺序。

## 3. 状态关系

### 3.1 允许的 pending 状态

`ask_user` 可以暂时没有最终 tool_result，但必须满足：

1. run status 是 `waiting_user`；
2. 不会发起下一次 LLM API 请求；
3. ledger / adapter 能找到对应 clarification_request；
4. 用户回答、取消、委托或转向后必须闭合。

### 3.2 不允许的状态

不允许：

1. pending ask_user 时继续 call model；
2. 用户已回答但旧 ask_user 仍悬空；
3. UI 显示一个 clarification，API messages 认为另一个 clarification 还没回答；
4. 同一问题重复投影成两个可见气泡；
5. sibling tool_call 悬空进入下一轮模型调用。

## 4. Answer 分类

用户回答 pending clarification 后，reconciler 必须分类：

| answer kind | 示例 | 结果 |
| --- | --- | --- |
| `direct_answer` | `网页应用` | 闭合 ask_user，继续原任务 |
| `delegated_to_agent` | `你决定`、`按你的想法` | 闭合 ask_user，把决策权交给 Altus |
| `scope_softening` | `先做方案`、`先想想` | 闭合 ask_user，进入方案/讨论模式 |
| `redirect` | `不用了，帮我做另一个...` | 闭合旧 ask_user，开启新 user intent |
| `cancelled` | `取消`、`先不做了` | 闭合 ask_user，停止或等待新输入 |

分类可以由 LLM transition agent 辅助，但最终写入必须通过后端 reconciler 和 validator。

## 5. 多工具批次规则

如果同一 assistant message 同时返回：

1. `ask_user`
2. 其他 tool_call

则进入 waiting_user 前，未执行 sibling tool_call 必须写入结构化 result：

1. `cancelled_due_to_user_clarification`
2. 或 `deferred_until_user_answer`

不能把 sibling tool_use 留给下一轮模型。

## 6. UI 适配

用户可见层必须保持自然：

1. 仍然可以显示“需要补充信息”；
2. 不能重复显示同一个问题；
3. 用户回答后不显示内部 `tool_result`；
4. 如果用户委托 Altus 决定，下一条 Altus 回复应体现“我按当前上下文继续”，不是再次确认；
5. 如果用户转向新任务，旧问题不再出现在新任务上下文中。

## 7. 验收条件

### 7.1 功能验收

1. 用户回答“网页应用”后，不再重复问交付类型。
2. 用户回答“方案”后，进入方案输出，不继续强迫选择技术边界。
3. 用户回答“你决定”后，Altus 继续推进，并把该回答记录为 delegated result。
4. 用户开启新任务时，旧 ask_user 以 redirect result 闭合。
5. pending ask_user 期间不会发生下一次 LLM API 请求。
6. 同批次 sibling tool_call 不会悬空。

### 7.2 数据验收

每个通过 ask_user 的 clarification 必须能查到：

1. `assistant_tool_use ask_user`
2. `clarification_request`
3. `clarification_answer`
4. `tool_result`
5. 对应 `runId`
6. 对应 `toolUseId`
7. 对应 `messageKey`

### 7.3 历史回放验收

1. history reload 后不会再次显示重复追问。
2. sidebar pending 状态能正常清除。
3. conversation timeline 中只显示一个用户可见追问单元。
4. manifest 中 `missingToolResultCount` 为 0。

### 7.4 测试验收

至少新增：

1. `direct_answer` 测试；
2. `delegated_to_agent` 测试；
3. `scope_softening` 测试；
4. `redirect` 测试；
5. pending ask_user 禁止 call model 测试；
6. sibling tool_call cancelled/deferred 测试；
7. history reload 去重测试。

## 8. 退出条件

第二阶段完成后，必须证明：

1. 补充信息问题不再重复；
2. ask_user 协议闭合；
3. UI 仍自然；
4. manifest 能稳定证明 pairing；
5. 未影响非 clarification 工具链路。
