# 2026-04-24 自动工作汇报

## Altus managed tool arguments JSON 格式错误排查

- 排查了 `InternalError.Algo.InvalidParameter: function.arguments must be in JSON format`，定位为上一轮 assistant `tool_calls[].function.arguments` 中可能存在半截或非法 JSON，下一轮请求被上游 code model 校验拦截。
- 在 `altus-managed-context-budget-service` 的模型输入投影视图中增加工具参数合法化：合法 object JSON 保持不变，对象值转 JSON 字符串，非法参数仅在投影中替换为 `{}`，不改原始事件和历史持久化。
- 继续在 `AltusRunCoordinator.sanitizeMessagesForModel` 和 `llm-proxy` OpenAI-compatible 出站边界增加最后防线，避免未来有路径绕过 context budget service 后重新把非法 arguments 发给上游。
- 对当前轮模型刚生成的 malformed tool arguments 不再执行工具，而是回填 `invalid_tool_arguments_json` 工具结果，要求模型用合法 JSON object 参数重试。
- 补充 targeted 回归测试，验证 malformed assistant tool arguments 不会继续污染下一轮模型请求，并验证最终请求 body 已被 sanitize。
