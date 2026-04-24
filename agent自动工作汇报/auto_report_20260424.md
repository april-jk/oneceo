# 2026-04-24 自动工作汇报

## Altus managed tool arguments JSON 格式错误排查

- 排查了 `InternalError.Algo.InvalidParameter: function.arguments must be in JSON format`，定位为上一轮 assistant `tool_calls[].function.arguments` 中可能存在半截或非法 JSON，下一轮请求被上游 code model 校验拦截。
- 在 `altus-managed-context-budget-service` 的模型输入投影视图中增加工具参数合法化：合法 object JSON 保持不变，对象值转 JSON 字符串，非法参数仅在投影中替换为 `{}`，不改原始事件和历史持久化。
- 继续在 `AltusRunCoordinator.sanitizeMessagesForModel` 和 `llm-proxy` OpenAI-compatible 出站边界增加最后防线，避免未来有路径绕过 context budget service 后重新把非法 arguments 发给上游。
- 对当前轮模型刚生成的 malformed tool arguments 不再执行工具，而是回填 `invalid_tool_arguments_json` 工具结果，要求模型用合法 JSON object 参数重试。
- 补充 targeted 回归测试，验证 malformed assistant tool arguments 不会继续污染下一轮模型请求，并验证最终请求 body 已被 sanitize。

## Altus Todo 活动组默认折叠优化

- 调整前端 `groupManagedActivityItems`，为 Todo 驱动的活动组计算 `defaultExpanded`。
- 只默认展开最后一次 `todowrite` 快照仍包含 `in_progress` 的 Todo 活动组；出现新 Todo 阶段时自动折叠旧阶段；最后阶段完成后所有 Todo 活动组默认折叠。
- 补充 managed run status dialogue 回归测试，覆盖最新 running Todo 默认展开和 all-completed 后默认折叠。

## Altus 网页交付卡片与拖动柄视觉优化

- 收敛共享 `ResizableHandle` 和预览文件分栏拖动柄：handle 使用透明热区与负外边距抵消布局占位，不绘制可见分隔带，独立 grip 无容器、无底纹、无边框，只在 hover / drag / focus 时显示，鼠标移出立即隐藏。
- 隐藏首页对话区贴近分栏边缘的原生滚动条，避免滚动条轨道继续像拖动柄边缘线一样切割画面。
- 将 grip 显示改为直接响应 `react-resizable-panels` 的 `data-resize-handle-state=hover/drag` 与 `data-resize-handle-active`，避免普通 DOM hover 在扩展 hit area 下不触发导致看不到拖动柄。
- 将 `AltusArtifactPreviewCard` 的网页预览改为按容器缩放的只读 iframe，卡片内不再上下滚动，完整交互继续走 `Open`。
- 补充缩放计算单元测试，覆盖小卡片缩放和大容器原始比例两类场景。

## Altus 完成消息 Markdown 列表格式修复

- 排查完成消息格式丢失问题，定位为 `resolveFinalAssistantContent` 会优先保留更长 assistant 原文，但这条路径未规范化模型输出中的 `• item • item` 非标准列表。
- 在 `altus-run-coordinator` 增加完成消息 Markdown 规范化，把行首或同段内的 bullet glyph 转为标准 `- item` 列表，并让 summary 构建和 assistant 原文优先路径共用该边界。
- 将完成消息的验证区块调整为标题后留空行再接 Markdown 列表，避免列表和标题黏连。
- 在 Altus managed prompt 中补充约束，要求 `complete_task.summary` 使用分行 Markdown bullet，不要把多个 `• item` 拼成一段。
