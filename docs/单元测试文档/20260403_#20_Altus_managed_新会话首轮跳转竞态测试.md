# 2026-04-03 #20 Altus managed 新会话首轮跳转竞态测试

## 1. 测试目标

验证 `#20` 修复后，`managed` 模式在“新建任务 -> 发送首条消息 -> 跳转新会话页”链路上不再因为 `session` 绑定、URL 变化和页面初始化竞态而清空首轮消息或错误重置会话状态。

## 2. 测试依据

1. `docs/agent研发文档/Altus接管模式参照Suna重构设计/07_前端对话页与交互状态.md`
2. `docs/agent研发文档/managed消息发送后立即消失根因分析与修复方案.md`
3. `docs/agent研发文档/20260328_发送后用户消息偶发不可见_问题与修复方案.md`
4. Issue `#20`

## 3. 测试单元清单

1. `useTaskCreationAgent.ts` 中的 route sync 解析与 defer 规则
2. `bindSessionId(...)` 后 location/search effect 不误触发 `resetConversationState(...)`
3. 新会话首轮发送后，页面 URL 正确落到 `/session/:sessionId`
4. 新会话首轮发送后，首条 `user_input` 在跳转过程中保持可见
5. 新会话首轮发送后，`managed run` 状态能继续推进，不因页面初始化被清空
6. 刷新当前会话页后，消息列表与刷新前保持一致
7. 会话详情接口返回的 `taskSessionId/status/stage` 与前台页面一致
8. recent/history 接口包含首轮用户消息，不依赖刷新补回

## 4. 预期输入与预期输出

### 单元 1

- 输入：
  - `pendingSessionId=session-1`
  - URL 仍为 `/new-task?new=1` 或 `/session/session-1?sessionId=session-1`
- 预期输出：
  - route sync 仍处于 defer 状态
  - 不允许释放 pending sync

### 单元 2

- 输入：
  - `bindSessionId(session-1)` 已执行
  - 浏览器路由尚未完全稳定
- 预期输出：
  - 不调用 `resetConversationState(...)`
  - 现有 optimistic messages 不被清空

### 单元 3

- 输入：
  - 已登录用户在 `managed` 模式发送首条消息
- 预期输出：
  - 页面最终落到 `/session/:sessionId`
  - URL 中不再保留 `?new` / `?sessionId`

### 单元 4

- 输入：
  - 新会话首条消息，例如：`帮我创建一个简单的欢迎页`
- 预期输出：
  - 跳转前后都能看到这条用户消息
  - 不出现“先显示再消失”

### 单元 5

- 输入：
  - 新会话 managed run 已启动
- 预期输出：
  - 页面可继续看到 `run_ack / run_status / assistant` 反馈
  - 不出现因为页面初始化导致的空白重置

### 单元 6

- 输入：
  - 在已有首轮消息和回复的同一会话页执行浏览器刷新
- 预期输出：
  - 消息列表与刷新前一致
  - 当前会话仍为同一个 `sessionId`

### 单元 7

- 输入：
  - 对当前会话调用详情接口
- 预期输出：
  - `sessionId` 与前台 URL 一致
  - `status/stage` 与页面所示运行状态不冲突

### 单元 8

- 输入：
  - 对当前会话调用 recent/history 接口
- 预期输出：
  - recent/history 能看到首轮 `user_input`
  - 不需要依赖刷新后才出现

## 5. 边界条件与失败条件

### 边界条件

1. 从 `/new-task` 进入新会话
2. 首轮发送时 URL 同时经历：
   - `?new`
   - `?sessionId`
   - `/session/:id`
3. 首轮消息发送后立即进入 history 初始化
4. 刷新当前会话页后重新恢复

### 失败条件

1. 首条用户消息在跳转过程中消失
2. 页面回到空对话或错误触发 `resetConversationState(...)`
3. URL 已切到新会话，但消息仍被旧状态覆盖
4. recent/history 中没有首轮用户消息
5. 刷新前后消息列表不一致

## 6. 验证方式

1. 单元级：
   - `vitest` 运行 `managed-session-resolution.test.ts`
2. 浏览器级：
   - Playwright 真实打开 oneceo 页面
   - 注册或登录用户
   - 切到 `managed` 模式
   - 新建任务并发送首条消息
   - 观察 URL、消息列表、运行状态
3. 接口级：
   - 调 `session detail / messages recent / history`
4. 结果判定：
   - 页面可见行为和接口结果同时满足，才算通过

## 7. 执行结果

### 7.1 单元级结果

1. 已执行：
   - `pnpm --filter web exec vitest run client/src/tests/managed-session-resolution.test.ts client/src/tests/managed-history-pending-message.test.ts client/src/tests/managed-message-stream-identity.test.ts`
2. 结果：
   - 通过
3. 结论：
   - route sync 解析、pending defer、managed 首轮消息 identity 与刷新恢复相关回归断言满足预期

### 7.2 浏览器级结果

1. 真实环境：
   - API：`http://localhost:4000`
   - Web：`http://localhost:3001`
   - Web 启动时显式覆盖：
     - `VITE_API_BASE_URL=http://localhost:4000`
     - `VITE_TASK_CREATION_WS_URL=ws://localhost:4000/ws/task-creation`
2. Playwright 实测步骤：
   - 注册真实用户
   - 在当前 `new-task` 页面切到 `managed` 模式
   - 发送首条消息：`Codex managed route race test 1775224014276`
   - 等待跳转到 `/session/:id`
   - 刷新当前会话页
3. 结果：
   - 会话 URL 落到 `/session/fa819928-848c-4bbd-bfdb-f912cae8652a`
   - `afterSend.revertedToNewTask=false`
   - `afterSend.queryDirty=false`
   - `afterSend.promptVisible=true`
   - `afterReload.revertedToNewTask=false`
   - `afterReload.promptVisible=true`
4. 结论：
   - `#20` 修复目标已满足：首轮发送后不会因页面初始化竞态退回空白 `new-task` 状态，刷新后同一 `sessionId` 仍可恢复首条消息

### 7.3 接口级结果

1. 针对上述真实会话调用：
   - `GET /api/task-creation/sessions/fa819928-848c-4bbd-bfdb-f912cae8652a`
   - `GET /api/task-creation/sessions/fa819928-848c-4bbd-bfdb-f912cae8652a/messages/history?limit=20`
2. 结果：
   - session detail 返回 `status=completed`、`stage=completed`
   - history 返回 `3` 条消息
   - history 中包含首轮 `user_input`
   - history 中存在同一 managed run 的 `assistant_message` 与 `run_completed`
3. 结论：
   - 页面可见状态与后端 session/history 权威数据一致，不存在“只是前端本地保住了消息，但后端没有落库”的偏差

## 8. 测试备注

1. 当前浏览器日志仍有两类与 `#20` 无关的噪声：
   - `http://oneceo.ai:3000/umami` 请求被拦截
   - Vite HMR 仍尝试连 `ws://localhost:3000`
2. 当前认证链路存在一个独立现象：
   - 注册成功后若立即再次导航到新的 `/new-task?new=...`，有概率回到登录页
3. 上述现象不影响本次 `#20` 结论：
   - 因为本次验证主链路是“已进入 `new-task` 的真实用户首轮发送 -> `/session/:id` -> 刷新恢复”，该链路已通过真实浏览器和接口双重验证
