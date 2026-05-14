# Composio Router MCP 先加载 Connector Guide 再按需 Search 修改方案 [20260511-2200已采用]

## 1. 背景

当前 Notion、Slack、Supabase、Figma、Google Workspace 等 Composio Router 型 MCP 连接器都依赖 `load_connector_guide` 提供运行规则、参数格式、禁止行为和工具选择约束。

实际运行中出现了一个不符合预期的调用顺序：

```text
notion__COMPOSIO_SEARCH_TOOLS
load_connector_guide
notion__COMPOSIO_SEARCH_TOOLS
```

这说明模型在第一次使用连接器 MCP 前，先调用了 `COMPOSIO_SEARCH_TOOLS`，随后被运行时的 connector guide 拦截机制阻断，再补调 `load_connector_guide`。这个链路虽然最终可能恢复，但会产生一次无效失败，也会让用户看到“刚才那一步没成功，我调整后继续”的错误过程。

## 2. 现状代码事实

### 2.1 运行时已经有硬拦截

文件：`apps/api/src/services/altus-managed-tool-runtime.ts`

当前逻辑会在 MCP 工具执行前检查 connector guide：

1. 根据 managed MCP tool 找到 `connectorKey`。
2. 如果该 connector 有 active guide，且本 run 还没有加载过该 guide，则抛出：

```text
connector_guide_blocked:<connectorKey>
Call load_connector_guide with connectorKey=<connectorKey> before using <tool>.
```

因此“先 load guide 再用 MCP”在运行时是被强制要求的。

### 2.2 提示词中也写了 load guide 优先，但后续规则仍然容易误导

文件：`apps/api/src/services/altus-managed-prompt-service.ts`

现有规则包含：

```text
If # Connector MCP Instructions or # Relevant Connector Guides shows an active connector guide,
call load_connector_guide for that connector before the first MCP tool call for that connector in the current run.
```

但同一区域还有：

```text
Prefer read/search tools before editing or making assumptions.
```

这条全局规则对普通文件/代码读取是合理的，但对 connector MCP 会让模型把 `COMPOSIO_SEARCH_TOOLS` 当作固定第一步。

### 2.3 内置 connector guide 在未 load 前就把 Search 写进上下文

文件：`apps/api/src/services/connector-guide-service.ts`

`buildPromptSections()` 当前会把 active guide 的 `serverInstructionsMarkdown` 和 `guideReminderMarkdown` 直接注入 prompt。多个内置 guide 中存在类似文案：

```text
Start with `notion__COMPOSIO_SEARCH_TOOLS`
Identify the target workspace/page/database first, then call `notion__COMPOSIO_SEARCH_TOOLS`
```

这导致模型还没调用 `load_connector_guide`，就已经在系统上下文中看到了“Start with Search”。运行时又要求先 load guide，于是形成“提示词诱导 search，运行时拦截 search”的冲突。

## 3. 问题判断

根因不是缺少拦截，而是提示词顺序和 guide 注入粒度不一致：

1. `load_connector_guide` 是强制前置步骤。
2. `COMPOSIO_SEARCH_TOOLS` 是 guide 加载后的可选发现步骤，不应该是所有 MCP 的固定第一步。
3. 部分连接器或任务不需要 search：
   - 自定义 MCP 已经暴露明确 provider tool 时，可以直接按 guide 使用对应工具。
   - 用户目标非常明确且 guide 或上下文已给出明确 tool slug/schema 时，可以直接 schema lookup 或 execute。
   - 某些 connector 的常用动作可由 guide 给出固定工具路径，search 只作为未知动作发现手段。
4. Search 的参数格式本身需要 guide 告知，例如 Composio Router 应使用 `queries` 数组，而不是把自然语言、OAuth/MCP 配置或错误字段直接塞给 search。

## 4. 修改目标

本次修改目标是调整 MCP 工具选择策略：

1. 任意 connector MCP 工具调用前，必须先调用 `load_connector_guide(connectorKey=...)`。
2. `COMPOSIO_SEARCH_TOOLS` 不能作为默认第一步；它只能在 guide 加载后，且确实需要发现动作时调用。
3. 模型要先从 guide 中读取 search 所需参数格式，再决定是否 search。
4. 如果 guide、上下文或已知工具足以确定下一步，可以跳过 search。
5. 保留运行时硬拦截，避免提示词失效时绕过 guide。

## 5. 具体修改方案

### 5.1 调整主提示词的工具使用规则

文件：`apps/api/src/services/altus-managed-prompt-service.ts`

将 connector 相关规则改成更强的顺序约束：

```text
- For connector MCP usage, `load_connector_guide` is the first connector tool call. Do not call any connector MCP tool, including `*_COMPOSIO_SEARCH_TOOLS`, before loading that connector guide in the current run.
- After `load_connector_guide` returns, read the guide result and choose the narrowest next step.
- `COMPOSIO_SEARCH_TOOLS` is optional discovery, not a fixed first step. Use it only when the guide indicates search is needed to discover the action/tool slug or when the requested action is not already clear from the guide/context.
- If search is needed, build its arguments from the loaded guide. Do not guess the search schema before loading the guide.
- Prefer read/search tools before editing only after connector guide requirements are satisfied.
```

同时将现有这条全局规则：

```text
- Prefer read/search tools before editing or making assumptions.
```

改为：

```text
- Prefer read/search tools before editing or making assumptions, except connector MCP tools must first satisfy `load_connector_guide` ordering.
```

### 5.2 调整 pre-load guide 注入内容

文件：`apps/api/src/services/connector-guide-service.ts`

当前 `buildPromptSections()` 会在 prompt 中提前注入完整 `serverInstructionsMarkdown`，其中包含大量 search 指令。建议改为：

1. prompt 初始阶段只注入“某 connector 有 active guide，需要先 load”的轻量提示。
2. 完整 `serverInstructionsMarkdown`、`guideReminderMarkdown`、`blockingRulesMarkdown` 只通过 `load_connector_guide` 的工具结果返回给模型。

建议新增一个 pre-load section 格式：

```text
# Connector MCP Instructions
- notion: Active connector guide exists. Before using any notion MCP tool, call load_connector_guide with connectorKey=notion.
- google_super: Active connector guide exists. Before using any google_super MCP tool, call load_connector_guide with connectorKey=google_super.
```

不要在这个 pre-load section 里出现：

```text
Start with *_COMPOSIO_SEARCH_TOOLS
Search tools first
then call *_COMPOSIO_SEARCH_TOOLS
```

这样模型在第一次决策时只会看到“先 load guide”，不会提前被 search 诱导。

### 5.3 调整内置 connector guide 文案

文件：`apps/api/src/services/connector-guide-service.ts`

对 Notion、Slack、Supabase、Figma、Google Workspace 等 guide 文案做统一表述，避免 “Start with Search” 被理解成硬规则。

将类似：

```text
Start with `notion__COMPOSIO_SEARCH_TOOLS` to find Notion actions
```

改为：

```text
After this guide is loaded, use `notion__COMPOSIO_SEARCH_TOOLS` only when you need to discover the matching Notion action/tool slug. If the action and schema path are already clear from this guide or prior tool results, skip search and continue with schema lookup or execution.
```

将 reminder 中类似：

```text
Identify the target workspace/page/database first, then call `notion__COMPOSIO_SEARCH_TOOLS`
```

改为：

```text
Identify the target workspace/page/database first. If the exact action is unclear, call `notion__COMPOSIO_SEARCH_TOOLS` with the guide-specified `queries` shape; otherwise use the known schema or execution path directly.
```

### 5.4 明确 Search 参数格式只能来自已加载 guide

文件：`apps/api/src/services/connector-guide-service.ts`

每个 Composio Router guide 中保留 search 参数示例，但必须放在 `load_connector_guide` 返回内容内，而不是 pre-load prompt。

标准格式：

```json
{
  "queries": [
    {
      "use_case": "search Notion pages by title"
    }
  ],
  "session": {
    "generate_id": true
  }
}
```

约束：

1. `queries` 必须是数组。
2. `use_case` 应该是短任务描述，不要传整段用户需求。
3. 不允许向 search 传 OAuth token、MCP URL、headers、providerId、toolName 等运行时配置字段。
4. 如果 guide 没说明 search 参数格式，模型应先停下，不能猜 schema。

### 5.5 保留运行时拦截，但优化错误恢复策略

文件：`apps/api/src/services/altus-managed-tool-runtime.ts`

保留现有 `connector_guide_blocked` 逻辑。该逻辑仍然是最后防线。

不建议移除拦截或让 search 例外，因为 search 本身也是 connector MCP tool，也可能需要连接器安全规则和参数格式约束。

可选优化：

1. 如果阻断的是 `*_COMPOSIO_SEARCH_TOOLS`，错误文案中明确说明：

```text
Search is also a connector MCP tool. Load the connector guide first, then decide whether search is needed.
```

2. UI 层继续显示为可恢复步骤，不把这类阻断解释为连接器不可用。

## 6. 涉及文件

预计需要修改：

1. `apps/api/src/services/altus-managed-prompt-service.ts`
   - 调整 Tool usage rules。
   - 明确 `load_connector_guide` 对 search 也前置。

2. `apps/api/src/services/connector-guide-service.ts`
   - 调整 `buildPromptSections()` 的 pre-load 注入策略。
   - 调整 Notion、Slack、Supabase、Figma、Google Workspace 的内置 guide 文案。

3. `apps/api/src/services/altus-managed-tool-runtime.ts`
   - 保留硬拦截。
   - 可补充 search 被拦截时的错误说明。

4. `apps/api/tests/altus-run-coordinator.test.ts`
   - 增加“模型第一次错误 search 被拦截后恢复”的既有保护测试可保留。
   - 新增“prompt 引导下第一次应 load guide，不应 search”的测试。

5. `apps/api/tests/altus-managed-tool-runtime.test.ts`
   - 确认 `COMPOSIO_SEARCH_TOOLS` 也必须先 load guide。

6. `apps/api/tests/connector-guide-on-demand-trigger.test.ts` 或新增 connector guide prompt 测试
   - 验证 pre-load prompt 不包含 `COMPOSIO_SEARCH_TOOLS` 的启动指令。

## 7. 测试设计

### 7.1 Prompt 单元测试

构造 session active guide 为 Notion，调用 prompt 构建逻辑，断言：

1. prompt 包含：

```text
load_connector_guide
connectorKey=notion
```

2. prompt 不包含：

```text
Start with `notion__COMPOSIO_SEARCH_TOOLS`
Search tools first
```

3. prompt 包含：

```text
Do not call any connector MCP tool, including *_COMPOSIO_SEARCH_TOOLS, before loading that connector guide
```

### 7.2 Runtime 单元测试

在 active guide 存在且未 loaded 的情况下调用：

```text
notion__COMPOSIO_SEARCH_TOOLS
```

期望：

1. 抛出 `connector_guide_blocked:notion`。
2. 错误文案明确 search 也需要先 load guide。
3. 调用 `load_connector_guide(connectorKey=notion)` 后，再调用 search 成功进入 OSAC MCP 调用。

### 7.3 Coordinator 行为测试

模拟模型响应顺序：

```text
load_connector_guide
notion__COMPOSIO_SEARCH_TOOLS
notion__COMPOSIO_GET_TOOL_SCHEMAS
notion__COMPOSIO_MULTI_EXECUTE_TOOL
complete_task
```

期望：

1. 第一个 connector 工具是 `load_connector_guide`。
2. 不出现先 search 失败的 tool entry。
3. 如果 guide 返回内容已足够明确，也允许：

```text
load_connector_guide
notion__COMPOSIO_GET_TOOL_SCHEMAS
notion__COMPOSIO_MULTI_EXECUTE_TOOL
complete_task
```

### 7.4 回归验证命令

建议最小验证：

```powershell
pnpm --filter api exec tsx --test tests/altus-managed-tool-runtime.test.ts tests/altus-run-coordinator.test.ts
pnpm --filter api type-check
```

如果修改影响前端展示，再补：

```powershell
pnpm --filter web check
```

## 8. 验收标准

1. 新 run 中，第一次使用 Notion/Slack/Supabase/Figma/Google Workspace MCP 时，模型先调用 `load_connector_guide`。
2. `COMPOSIO_SEARCH_TOOLS` 不再被提示词固定为所有 MCP 的第一步。
3. Search 只在 guide 加载后按需调用，并使用 guide 给出的 `queries` 参数格式。
4. 如果不需要 search，模型可以直接进入 schema lookup 或具体 provider tool。
5. 未 load guide 直接调用任何 connector MCP tool，仍然会被运行时拦截。
6. 用户界面不再因为可避免的“先 search 被拦截”展示一条失败步骤。

## 9. 不做事项

1. 不移除 connector guide runtime blocking。
2. 不把 `COMPOSIO_SEARCH_TOOLS` 加入免拦截白名单。
3. 不让模型在未加载 guide 前猜 search 参数。
4. 不为每个 connector 写独立补丁逻辑；统一修正 prompt 和 guide 注入顺序。
5. 不改变 OAuth、MCP 挂载、OSAC 调用和用户授权隔离链路。

## 10. 开发顺序

1. 先改 `altus-managed-prompt-service.ts` 的通用工具规则。
2. 再改 `connector-guide-service.ts` 的 pre-load prompt section，避免完整 guide 在 load 前泄漏 search 指令。
3. 更新内置 guide 文案，把 “Start with Search” 改成 “load 后按需 search”。
4. 补 runtime/search 拦截错误说明。
5. 增加或更新测试。
6. 跑最小验证命令。
