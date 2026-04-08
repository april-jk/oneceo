# 2026-04-04 managed run 实时流不刷新测试

## 1. 测试目标

验证 managed 模式下，用户发送消息后无需刷新页面即可实时收到 run stream 事件，页面能及时退出“智能体正在处理...”并直接显示 assistant 回复。

## 2. 测试依据

1. `docs/agent研发文档/Altus接管模式参照Suna重构设计/07_前端对话页与交互状态.md`
2. `docs/agent研发文档/Altus接管模式参照Suna重构设计/09_实施步骤_风险与验收.md`
3. `docs/agent研发文档/20260402_多用户隔离模型与标识边界设计_[20260402-1106已采用].md`

## 3. 测试单元清单

1. `getTaskCreationManagedRunStreamUrl(...)` 是否携带当前用户身份
2. `GET /api/altus-managed/runs/:runId/stream` 是否接受 query userId 并按 session.userId 做校验
3. `openManagedRunStream(...)` 是否能在 run 启动后立即建连
4. `handleManagedRunStreamEvent(...)` 是否能消费 `assistant_delta / assistant_message / run_completed`
5. 页面在收到 assistant 流式消息后是否及时退出“智能体正在处理...”
6. 页面无需刷新是否能直接显示 assistant 回复

## 4. 预期输入与预期输出

### 单元 1

- 输入：
  - 已登录用户 `app_users.id=user-1`
  - `runId=run-1`
- 预期输出：
  - stream URL 带 `userId=user-1`
  - 仍保留 `afterSequence` 等必要参数

### 单元 2

- 输入：
  - stream 请求 query `userId=user-1`
  - run 所属 session.userId 也是 `user-1`
- 预期输出：
  - 允许订阅并返回 `text/event-stream`

- 输入：
  - stream 请求 query `userId=user-2`
  - run 所属 session.userId 为 `user-1`
- 预期输出：
  - 拒绝订阅

### 单元 3

- 输入：
  - managed run 已创建
- 预期输出：
  - 前端立即发起 `EventSource(/api/altus-managed/runs/:runId/stream...)`

### 单元 4

- 输入：
  - stream 连续发出 `assistant_delta`、`assistant_message`、`run_completed`
- 预期输出：
  - assistant 文本实时进入消息流
  - 最终消息收口
  - `isProcessing=false`

### 单元 5

- 输入：
  - 用户发送 `你好`
- 预期输出：
  - 页面在收到 assistant 回复后，不再停留在“智能体正在处理...”

### 单元 6

- 输入：
  - 浏览器真实发送 managed 消息
- 预期输出：
  - 不刷新页面即可看到 assistant 回复
  - 刷新前后的消息结果一致

## 5. 边界条件与失败条件

### 边界条件

1. 浏览器已登录真实用户
2. run 启动后立即建立 stream
3. stream 仅依赖 query userId 与 session.userId 校验，不依赖自定义 header

### 失败条件

1. `POST /inputs` 成功，但 `EventSource` 因身份问题未建连
2. assistant 回复已经落库，但页面仍持续显示“智能体正在处理...”
3. 只有刷新页面后才出现 assistant 回复

## 6. 验证方式

1. 单元级：
   - focused test 校验 stream URL 拼装
2. 路由级：
   - live test 校验 managed stream 的 query userId 授权
3. 浏览器级：
   - Playwright 真实发送 managed 消息并等待 assistant 回复
4. 结果判定：
   - 实时流和页面显示同时成立，才算通过

## 7. 当前测试结果

### 已通过

1. `EventSource` 订阅 URL 已携带当前认证用户 `userId`
2. `GET /api/altus-managed/runs/:runId/stream` 已按 `session.userId === query.userId` 校验并允许订阅
3. `POST /api/altus-managed/inputs` 对无附件文本消息已不再阻塞到 sandbox 完成后才返回，`runId` 能更早返回给前端
4. `AltusRunCoordinator` 已在 sandbox ready 后执行 resolved skill sync

### 真实链路新增发现

1. 真实浏览器链路下，managed stream 已经成功建连，并实际收到：
   - `run_ack`
   - `run_status(starting/running)`
   - `assistant_delta`
   - `clarification_requested`
2. 对应 run 的后端事件表中已存在完整事件序列，说明不是后端未产出。
3. 但 75 秒观察窗口内，前端页面仍保持“智能体正在处理...”，对话区没有把这些已收到的 stream 事件渲染出来。

### 当前结论

- “stream 未建立 / 身份不匹配”这一层已修复并通过验证。
- 前端剩余问题已进一步定位并修复：
  - 新页面实例在 `/new-task -> /session/:id` 切换期间，如果恢复态只有 `processing=true` 但尚未拿到 `runId`，不能提前清空 managed recovery。
  - `useTaskCreationAgent.ts` 的 managed recovery 现在会保留这类 pending recovery，并轮询 `latest run` 直到可接管新 run。
  - 同时修正了 `handleManagedRunStreamEvent` 对 `loadHistory` 的初始化时序，避免 managed 页面首次渲染触发 `ReferenceError: Cannot access 'loadHistory' before initialization`。

### 最终浏览器验收结果

1. 使用 `http://oneceo.ai:3000` 作为前端入口，`oneceo.ai` 已解析到 `127.0.0.1`，避免本地 `localhost`/生产 API base 混用导致的 CORS 干扰。
2. 浏览器真实链路下，发送 `你好` 后无需刷新页面，直接出现了 managed 首轮实时输出：
   - 用户消息 `你好`
   - 状态消息 `managed run 已创建`
   - assistant 实时回复 `你好！我是 Altus...`
3. 在 assistant 文本出现前，页面 URL 已稳定切到 `/session/:id`，说明新页面实例已成功接管 run 恢复，不再依赖刷新补历史。
4. 当前验收结论：
   - “发送后直接看到实时消息流，不需要刷新页面”已通过。
