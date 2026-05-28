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

同时在：

- `apps/api/src/services/altus-managed-setup-service.ts`

新增消息级多模态装配逻辑，参照：

- `referance/suna/backend/core/agents/runner/setup_manager.py`

规则是：

1. 文本附件继续走 `attachmentContext -> system prompt`。
2. 图片附件不进入 `attachmentContext` 文本注入。
3. 图片附件在组装 `ChatMessage[]` 时，按对应 `user_input/user_response` 消息追加 `image_url` block。
4. 服务端先把图片上传到“图片外链专用 R2 桶”，并在消息 metadata 中持久化 object key。
5. `image_url.url` 由服务端在调用前基于 object key 生成短时签名 `GET` URL。
6. 如果一个 managed run 内会多次调用模型，则每次调用前都刷新图片签名 URL。
7. 图片签名与 R2 访问只允许在 API 进程内完成，`R2_MANAGED_IMAGE_*`、`R2_*`、`CF_*`、`CLOUDFLARE_*` 这类密钥不得注入 sandbox 环境。
8. 运行时发现消息中包含图片块时，managed run 必须切换到视觉模型；不能继续沿用纯文本模型并依赖 `file`、OCR、Pillow 等工具做首选解析。

### 5.3 注入数据来源

Prompt assembly 不直接依赖请求期内存对象。

统一数据来源：

- 最新相关 `user_input` 消息的 `metadata.attachmentContext`
- 对应消息的 `metadata.attachments`
- 对应图片附件的 `metadata.attachments[].externalObjectKey`

这样在以下场景下仍可稳定获取附件上下文：

- run 重试
- SSE 断开后恢复
- 会话刷新后重新启动新一轮 managed run

存储约束：

- `taskCreationSessionDAO` 在写入 `conversation_messages` 和重建 `task_session_recent_messages` 时，不能裁掉 `attachments / attachmentContext / attachmentContextIncluded / originalInput / question / options / runId`
- 否则首轮消息刷新后虽然正文仍保留 `[Attached: ...]`，但图片附件对应的 `externalObjectKey` 会丢失，后续 run 只能退回到 shell/OCR 路径

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

图片类不走 system prompt 注入，而是走消息级多模态输入。

### 5.5 图片类消息装配规则

对历史中的每条 `user_input/user_response`：

1. 读取消息文本内容。
2. 读取 `metadata.attachments` 中的图片附件记录。
3. 过滤为模型兼容图片格式：`png/jpeg/gif/webp`。
4. 使用 `metadata.attachments[].externalObjectKey` 生成短时签名 URL。
5. 组装为：

```ts
{
  role: 'user',
  content: [
    { type: 'text', text: '...' },
    { type: 'image_url', image_url: { url: 'https://...signed...' } }
  ]
}
```

7. 同一轮中图片块跟随原始用户消息，不额外拆成新的 timeline message。
8. 如果 R2 对象不存在、签名失败或格式不兼容，则跳过该图片块，但不影响文本消息本身进入模型。

### 5.6 R2 图片外链服务设计

建议新增独立服务：

- `apps/api/src/services/managed-image-object-service.ts`

职责：

1. 使用专用图片桶 client 上传图片对象。
2. 生成 session/message 级 object key。
3. 为 object key 生成短时签名下载 URL。
4. 校验 object key 只能落在图片桶的允许前缀。
5. 不允许访问归档桶中的任何对象。

### 5.7 存储桶与凭证隔离

必须采用双桶双凭证，而不是“同桶不同前缀”：

1. 归档桶：
   - 继续用于 workspace/state archive
   - 环境变量沿用 `R2_*`
2. 图片外链桶：
   - 专用于 LLM 可访问图片对象
   - 新增环境变量：
     - `R2_MANAGED_IMAGE_BUCKET_NAME`
     - `R2_MANAGED_IMAGE_ACCOUNT_ID`
     - `R2_MANAGED_IMAGE_ACCESS_KEY_ID`
     - `R2_MANAGED_IMAGE_SECRET_ACCESS_KEY`
     - `R2_MANAGED_IMAGE_ENDPOINT`（可选）
     - `R2_MANAGED_IMAGE_SIGNED_URL_TTL_SECONDS`

安全要求：

1. 图片桶 AK/SK 仅有该桶权限。
2. 归档桶 AK/SK 不具备图片桶权限。
3. sandbox 创建入口必须过滤 Cloudflare / R2 / AWS 存储凭证，防止未来其他链路误把存储密钥透传到 E2B。
3. 图片桶默认私有，外部访问仅通过签名 URL。
4. 任何“根据 key 生成签名 URL”的接口都必须只接受图片桶 key，不接受归档 key。

### 5.8 Agent 使用规范

在 managed mode 中，附件应视为工作区输入资产：

1. Agent 可以直接读取 `uploads/...`
2. Agent 可以根据 PromptManager 的 file context 先理解文本概要
3. 对图片附件，模型在首轮已经直接看到视觉输入，不应再默认向用户索要“请描述一下图片”
4. 若需精确内容，再主动读具体文件

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

## 7. 安全与限制

### 7.1 服务端必须二次校验

无论前端是否校验，服务端都必须再次验证：

- 文件类型
- 文件大小
- 附件数量

### 7.2 路径安全

文件名规范化时必须：

- 移除路径穿越片段
- 移除目录分隔符
- 保证最终路径只能落在 `uploads/`

### 7.3 Prompt 注入安全

解析文本注入 prompt 时必须：

- 截断长度
- 去除二进制异常内容
- 标记来源文件名

## 8. 与当前路由/Hook 的映射

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
