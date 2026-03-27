# 04 API、Sandbox 与 Agent 使用设计

## 1. 总体目标

后端需要把当前“附件上传接口”和“消息发送接口”整合成一条完整输入链路。

参照 `suna` 的核心方式：

- `/agent/start` 直接接收 `prompt + files[]`
- 服务端快速解析文件
- 生成标准附件引用
- 上传到 `/workspace/uploads`
- 在 PromptManager 中注入文件上下文

## 2. oneceo 目标结构

### 2.1 新的输入入口

建议新增统一接口：

- `POST /api/altus-managed/inputs`

`multipart/form-data` 字段：

- `sessionId`（可选）
- `content`
- `messageKey`
- `messageType`
- `files[]`

### 2.2 接口职责

该接口统一负责：

1. 如果 `sessionId` 为空，则先创建 managed session。
2. 如果 `sessionId` 非空，则校验 session ownership。
3. 校验附件数量、大小、类型。
4. 规范化文件名。
5. 快速解析文本类文件内容。
6. 确保 runtime / sandbox。
7. 上传到 `${workspaceRoot}/uploads`。
8. 生成 canonical 附件引用。
9. 将 `attachments + attachmentContext` 一并持久化到 `user_input.metadata`。
10. 持久化 `user_input` 消息。
11. 启动 managed run。
12. 返回 `sessionId + message 摘要 + attachments + run 信息`。

### 2.3 明确废弃

以下接口不再作为 managed 用户输入主链路：

- `POST /api/task-creation/sessions/:sessionId/attachments`
- `POST /api/altus-managed/sessions/:sessionId/runs` 的前端直接调用

前端对 managed mode 的用户提交，只能走统一输入接口，不能保留第二套 run 启动入口。

## 3. 推荐服务拆分

### 3.1 `task-attachment-ingest-service.ts`

职责：

- 接收上传文件
- 文件名规范化
- 白名单校验
- 重名处理
- 生成结构化附件记录

### 3.2 `task-attachment-parse-service.ts`

职责：

- 解析文本类附件内容
- 返回截断后的 `parsedText`
- 对不可解析类型返回空内容

### 3.3 `task-input-dispatch-service.ts`

职责：

- 组装用户消息内容
- 组装消息元数据
- 持久化用户输入
- 启动 managed run

## 4. Sandbox 处理规则

### 4.1 强制规则

所有 Sandbox 文件写入必须继续通过：

- `apps/api/src/connectors/e2b-connector.ts`

不允许：

- 在业务路由里绕过 connector 直连 Sandbox
- 走 KVM 老链路

### 4.2 上传目录

统一目录：

- `${workspaceRoot}/uploads`
- 消息和前端只暴露相对路径 `uploads/...`

### 4.3 文件写入顺序

对每次用户输入：

1. 确保 runtime 已存在
2. `mkdir -p ${workspaceRoot}/uploads`
3. 对每个文件生成最终文件名
4. 逐个写入
5. 记录最终相对路径 `uploads/...`
6. `touchSandbox(...)`

### 4.4 重名处理

参照 `suna` 的 `generate_unique_filename(...)`：

- 不覆盖已有文件
- 自动改名
- 最终路径以服务端实际写入结果为准

## 5. Agent 使用方式

## 5.1 用户消息层

用户消息正文中必须包含标准附件引用块。

这样 Agent 在读取对话历史时，天然能看到：

- 有哪些附件
- Sandbox 实际路径是什么

## 5.2 Prompt Assembly 层

建议在：

- `apps/api/src/services/altus-managed-prompt-service.ts`

新增 file context 装配逻辑，参照：

- `referance/suna/backend/core/agents/runner/prompt_manager.py`

注入内容包含：

- 当前输入轮次的文本类附件内容摘录
- 文件名
- 文件大小

### 5.3 注入数据来源

Prompt assembly 不直接依赖请求期内存对象。

统一数据来源：

- 最新相关 `user_input` 消息的 `metadata.attachmentContext`

这样在以下场景下仍可稳定获取附件上下文：

- run 重试
- SSE 断开后恢复
- 会话刷新后重新启动新一轮 managed run

### 5.4 注入规则

仅注入：

- 文本
- Markdown
- JSON
- CSV / TSV
- 代码文件
- 常见可提取文本的文档类内容

不注入：

- 图片二进制
- 大型二进制文件

### 5.5 Agent 使用规范

在 managed mode 中，附件应视为工作区输入资产：

1. Agent 可以直接读取 `uploads/...`
2. Agent 可以根据 PromptManager 的 file context 先理解文本概要
3. 若需精确内容，再主动读具体文件

## 6. 结构化数据设计

### 6.1 附件记录

建议统一服务端输出结构：

```ts
type TaskSessionAttachmentRecord = {
  sourceName: string;
  storedName: string;
  path: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  parsedTextIncluded: boolean;
};
```

### 6.2 文件上下文记录

建议 run 内部装配结构：

```ts
type TaskAttachmentContextItem = {
  path: string;
  sourceName: string;
  size: number;
  mimeType: string;
  parsedText: string;
};
```

## 7. 远程附件处理

当前 `oneceo` 已有：

- `apps/api/src/services/remote-attachment-service.ts`
- `POST /api/task-creation/attachments/fetch`

本次设计不废弃该能力，但调整其定位：

1. 远程链接导入仍在前端先转为 `File`
2. 之后进入与本地文件完全一致的统一输入链路
3. 不再走单独的“远程附件专用消息处理”

## 8. 安全与限制

### 8.1 服务端必须二次校验

无论前端是否校验，服务端都必须再次验证：

- 文件类型
- 文件大小
- 附件数量
- 私有网络远程链接限制

### 8.2 路径安全

文件名规范化时必须：

- 移除路径穿越片段
- 移除目录分隔符
- 保证最终路径只能落在 `uploads/`

### 8.3 Prompt 注入安全

解析文本注入 prompt 时必须：

- 截断长度
- 去除二进制异常内容
- 标记来源文件名

## 9. 与当前路由/Hook 的映射

当前 oneceo 入口：

- `apps/web/client/src/components/TaskCreationChat.tsx`
- `apps/web/client/src/hooks/useTaskCreationAgent.ts`
- `apps/web/client/src/lib/task-creation-client.ts`

当前 managed run 入口：

- `apps/web/client/src/lib/task-creation-client.ts`
- `POST /api/altus-managed/sessions/:sessionId/runs`

目标改造关系：

1. 新输入接口负责 `create/ensure session + user_input + attachments + run start`
2. `startTaskCreationManagedRun(...)` 不再作为前端用户输入入口
3. `useTaskCreationAgent.ts` 改为以“统一输入提交结果”驱动 run 订阅
