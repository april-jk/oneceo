# API 追踪整合到对话回放设计 [20260508-已采用]

> 创建日期：2026-05-08
> 关联文档：[会话全链路 API 追踪与聚合查询设计](../admin_api_trace_and_aggregation_design_[20260504-已采用].md)
> 关联需求：把 API 追踪按时间线穿插到对话回放中，提升管理员查看体验

---

## 1. 需求概述

### 1.1 现状问题

- API 追踪当前作为对话详情的独立 Tab (`'api-traces'`) 存在
- 对话回放在对话详情弹窗内展示，空间狭小，无法很好查看完整上下文
- API 调用（LLM 请求、工具调用、服务调用）与对话消息在时间上是对应关系，弹窗内分离展示割裂了因果链

### 1.2 目标

把整个「交互回放」（对话消息 + API Trace）迁移到独立页面，在新标签页中提供充足的展示空间，同时保持对话详情弹窗的简洁性。

---

## 2. 方案设计

### 2.1 独立页面方案

把整个「交互回放」迁移到一个独立的 HTML 页面，通过新标签页打开。

**数据加载：**
- 新页面通过 URL query param 接收 `sessionId`
- 通过 `fetch('/api/conversations/sessions/{sessionId}/core')` 获取会话消息
- 通过 `fetch('/api/conversations/sessions/{sessionId}/api-traces?limit=500')` 获取 API Trace
- 浏览器自动携带 cookie，无需额外认证处理

**合并渲染：**
- 将 API Trace 数据流与对话消息数据流按 `createdAt` 时间戳合并为统一时间线
- `ConversationReplayItem` 新增 `kind: 'api_trace'`
- 合并时保持各自的相对顺序，按时间戳升序排列

### 2.2 展示形态

**独立页面 (`conversation-replay.html`)：**
- 暗黑主题，最大宽度 960px 居中
- 顶部：会话标题 + 消息数/Trace 数统计 + 关闭按钮
- 筛选栏：全部/仅对话/LLM/工具/服务/连接器 pill 按钮
- 时间线：
  - 用户消息：右对齐蓝色气泡
  - Agent 消息：左对齐胶囊/文本/工具卡片
  - API Trace：居中紧凑卡片，左侧颜色条区分类型

**API Trace 卡片：**
```
[类型徽章]  [名称]  [状态]  [耗时]  [Tokens]
```
- 类型徽章：`LLM`（蓝）/ `工具`（橙）/ `服务`（灰）/ `连接器`（紫）
- 名称：模型名 / 工具名 / 服务名 / 端点
- 状态：成功（绿色）/ 失败（红色）
- 耗时：`1,234ms`
- Tokens：仅 LLM 类型显示 `Prompt 1,234 + Completion 567`

### 2.3 Trace 详情

点击 API Trace 卡片时：
1. 将 trace JSON 写入 `sessionStorage`（key: `trace-detail-${traceId}`）
2. `window.open('/trace-detail.html?id=${traceId}', '_blank')` 打开新标签页
3. 新页面从 `sessionStorage` 读取完整 trace 数据，展示 Request/Response JSON、原始 HTTP、Token 消耗、错误信息

### 2.4 对话详情弹窗中的「交互回放」Tab

不再在弹窗内嵌入渲染完整回放，改为：
- 简洁的提示面板：「对话回放已移至独立页面」
- 「在新标签页打开回放」主按钮
- 底部显示消息数和 API Trace 数

### 2.5 独立 Tab 处理

删除对话详情弹窗中的 `'api-traces'` 独立 Tab，包括：
- `ConversationDialogTab` 类型中的 `'api-traces'`
- Tab 导航栏中的 API 追踪按钮
- `renderConversationApiTracesPanel` 渲染函数（200+ 行）
- 所有 `conversationApiTraces*` 分页/筛选 state
- 加载 API Trace 的 tab-conditional useEffect

**保留**聚合查询功能（全局 API 追踪仪表盘），仅删除单会话维度的独立 Tab。

---

## 3. 数据结构

### 3.1 扩展 ConversationReplayItem

```typescript
type ConversationReplayItem =
  | { kind: 'user'; id: string; text: string; timestamp: string }
  | { kind: 'agent_plain'; id: string; text: string; author: string; timestamp: string }
  | { kind: 'agent_capsule'; id: string; text: string; label: string; tone: ConversationReplayCapsuleTone; timestamp: string }
  | { kind: 'agent_clarification'; id: string; text: string; timestamp: string }
  | { kind: 'managed_tool'; id: string; ... }
  | { kind: 'opencode_tool'; id: string; ... }
  // 新增：
  | { kind: 'api_trace'; id: string; trace: ApiTraceItem; timestamp: string };
```

### 3.2 合并函数

```typescript
function mergeReplayAndTraces(
  replayItems: ConversationReplayItem[],
  traces: ApiTraceItem[]
): (ConversationReplayItem | { kind: 'api_trace'; ... })[] {
  const traceItems = traces.map((t) => ({
    kind: 'api_trace' as const,
    id: t.id,
    trace: t,
    timestamp: t.createdAt,
  }));
  return [...replayItems, ...traceItems].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}
```

---

## 4. UI 设计

### 4.1 时间线布局

对话回放保持现有的左右交替布局：
- 用户消息：右对齐气泡
- Agent 消息：左对齐气泡
- **API Trace：居中窄卡片**（区别于对话消息，视觉上不抢焦点）

API Trace 卡片样式：
- 背景：`var(--surface-soft)` 或半透明
- 边框：左侧带颜色条（LLM=蓝色, Tool=紫色, Service=灰色, Connector=橙色）
- 内边距紧凑（比消息气泡小）
- 字体：monospace for 技术字段

### 4.2 交互

- **单击卡片**：将 trace 数据写入 `sessionStorage`，在新标签页打开独立详情页 (`/trace-detail.html?id=${traceId}`)
- **Hover**：显示完整时间戳和 trace ID

### 4.3 独立详情页 (`trace-detail.html`)

位于 `apps/admin_management/web/public/trace-detail.html`，是一个自包含的静态页面：
- 从 URL 参数读取 trace ID
- 从 `sessionStorage` 读取完整 trace JSON
- 渲染：类型徽章 + 名称 + 状态 + 耗时 + 时间
- Token 消耗指标卡片（仅 LLM）
- 可折叠面板：请求 JSON、响应 JSON、原始 HTTP、元数据
- JSON 语法高亮（Vanilla JS 实现）
- 暗黑主题，与现有管理后台风格一致

### 4.4 空状态

当筛选条件过滤掉所有 API Trace 时，时间线中不显示任何 trace 卡片，只显示对话消息。

---

## 5. 技术实现

### 5.1 文件变更清单

| 文件 | 变更 |
|------|------|
| `App.tsx` | 删除 `api-traces` tab；删除内嵌对话回放渲染逻辑（300+ 行）；「交互回放」Tab 改为提示面板 + 「在新标签页打开回放」按钮；点击按钮传递 sessionId 到新页面；保留 API Trace 加载逻辑 |
| `types.ts` | 扩展 `ConversationReplayItem` union type（新增 `api_trace` kind） |
| `api.ts` | 保留 `getSessionApiTraces`（聚合查询仍需） |
| `public/conversation-replay.html` | 新增独立回放页面：自包含 HTML，通过 fetch 加载会话消息和 API Trace，渲染完整时间线（消息气泡 + 工具卡片 + trace 卡片），含类型筛选器，点击 trace 卡片打开 trace-detail.html |
| `public/trace-detail.html` | 新增独立 trace 详情页：自包含 HTML，从 sessionStorage 读取 trace 数据，展示完整详情（JSON 高亮、可折叠面板、暗黑主题） |

### 5.2 关键逻辑

1. **数据加载**：新页面 `conversation-replay.html` 通过 `fetch` 调用管理后台 API 获取会话消息和 API Trace。浏览器自动携带 cookie，无需额外认证。

2. **消息解析**：新页面实现简化版消息解析逻辑，将原始消息转换为 replay items：
   - 用户输入 → user bubble
   - 助手消息 → agent block / capsule / clarification
   - 工具调用 → tool card
   - 错误 → error block

3. **时间线合并**：将消息 items 和 trace items 按 `createdAt` 排序合并。

4. **筛选**：客户端筛选，支持全部/仅对话/LLM/工具/服务/连接器。

5. **Trace 详情**：点击 trace 卡片 → `sessionStorage.setItem` → `window.open('/trace-detail.html?id=...', '_blank')`。

6. **对话详情弹窗**：「交互回放」Tab 内不再嵌入渲染回放，只显示提示面板和「在新标签页打开回放」按钮。

### 5.3 性能考虑

- API Trace 一次加载 500 条（上限），满足绝大多数场景
- 消息和 trace 渲染使用原生 DOM，无 React 虚拟 DOM 开销
- 筛选在客户端进行，不重新请求
- 数据加载有 loading 状态，失败时显示错误提示

---

## 6. 实施步骤

1. **扩展类型**：在 `App.tsx` 中给 `ConversationReplayItem` 新增 `api_trace` kind
2. **删除独立 Tab**：删除 `App.tsx` 中所有 `'api-traces'` tab 相关代码（state、useEffect、渲染函数、Tab 定义）
3. **简化回放面板**：将 `renderConversationReplayPanel` 改为提示面板，提供「在新标签页打开回放」按钮
4. **创建独立回放页**：`public/conversation-replay.html`，实现消息解析、时间线合并、筛选器、trace 卡片渲染
5. **创建独立详情页**：`public/trace-detail.html`，实现完整 trace 详情展示（JSON 高亮、可折叠面板、暗黑主题）
6. **清理旧代码**：删除 `buildConversationReplayItems` 等不再使用的函数（约 300 行）
7. **测试验证**：验证新页面加载、消息渲染、trace 卡片、筛选、trace 详情跳转

---

## 7. 风险与回退

1. **新页面 fetch 失败**：
   - 如果用户未登录或会话过期，fetch 会返回 401/403
   - 缓解：新页面显示错误提示，引导用户返回管理后台重新登录

2. **trace 数量过多**：
   - 一次加载 500 条 trace，极端情况下可能超时
   - 缓解：显示 loading 状态，fetch 失败时显示重试按钮

3. **浏览器弹窗拦截**：
   - `window.open` 可能被浏览器拦截
   - 缓解：按钮明确标注「在新标签页打开」，用户主动点击不会被拦截

4. **回退方案**：
   - 如果独立页面方案不可接受，可恢复内嵌渲染（代码保留在 git 历史中）

---

## 8. 与现有文档的关系

本文档是对 [会话全链路 API 追踪与聚合查询设计](../admin_api_trace_and_aggregation_design_[20260504-已采用].md) 的**前端展示层变更**：
- 数据表结构不变
- 采集逻辑不变
- API 路由不变（管理后台 `/api/audit/*` 路由已在前次清理中删除）
- 变更单会话维度展示方式：从「弹窗内多 Tab」→「弹窗内提示 + 独立新标签页」
