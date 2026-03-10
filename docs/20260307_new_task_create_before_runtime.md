# 新建任务先创建会话再启动 Runtime（2026-03-07）

## 背景
- 现象：在“新建任务”窗口发送首条消息时，若 WS/智能体连接尚未稳定，会出现：
  - 任务列表未及时新增；
  - 稍后出现任务但进入后内容为空。

## 根因
- 旧流程对首条消息依赖 WS 已连接；未连接时仅前端等待，后端没有会话落盘。
- 侧边栏任务列表主要依赖轮询（30s），缺少“会话刚创建”即时刷新信号。
- 首条消息若在前端预落盘与 WS 直通都写入，可能出现重复 user_input。

## 修复
1. 后端新增 `POST /api/task-creation/sessions`
- 能力：先创建/复用会话；可选预落盘首条用户消息；同步文件存储与 DB。
- 位置：`apps/api/src/routes/task-creation-routes.ts`。

2. 前端发送链路增加“断线排队 + 先建会话”
- 在 sandbox 直通模式发送前先调用创建会话接口（含首条消息预落盘）。
- WS 未连接时将消息入队，连接成功后自动 flush。
- 位置：`apps/web/client/src/hooks/useTaskCreationAgent.ts`。

3. 后端直通链路增加去重标记
- 前端发送 `prePersistedUserInput=true` 时，后端跳过重复 `user_input` 追加。
- 位置：`apps/api/src/agents/task-creation/websocket-service.ts`。

4. 任务列表即时刷新
- Hook 在会话创建/绑定时派发 `task-creation-session-updated`。
- Sidebar 监听该事件并立即刷新会话列表。
- 位置：`apps/web/client/src/hooks/useTaskCreationAgent.ts`、`apps/web/client/src/components/Sidebar.tsx`。

## 结果
- 新建任务发送首条消息时，会先有可见会话记录，再进入 runtime/e2b 流程。
- WS 不稳定场景下，首条消息不会因为连接时序丢失。
- 进入任务页不再出现“仅有空会话”的高概率问题。

## 验证
- `pnpm --dir apps/web check` 通过。
- `pnpm --dir apps/api type-check` 仍有仓库历史错误（与本次改动无直接新增阻断关系）。
