# 2026-04-04 #25 Altus 交付稳定性 Playwright 测试

## 1. 测试目标

验证 Altus managed 模式下，最终交付文件在真实浏览器链路里可以稳定触发，并满足以下要求：

1. 固定 prompt 可稳定生成唯一 markdown 交付物
2. 实时流中必须捕获 `deliverables_ready`
3. 页面无需刷新即可出现最终交付卡片
4. 下载得到的文件内容与 prompt 中约束一致
5. 刷新页面、同一浏览器重新进入会话、新浏览器 context 重新进入会话后，交付卡片仍可恢复

## 2. 测试依据

1. [07_前端对话页与交互状态.md](/Users/watson/.codex/worktrees/3f02/oneceo/docs/agent研发文档/Altus接管模式参照Suna重构设计/07_前端对话页与交互状态.md)
2. [20260327_交付物出Sandbox闭环_实现与验证.md](/Users/watson/.codex/worktrees/3f02/oneceo/docs/agent研发文档/20260327_交付物出Sandbox闭环_实现与验证.md)
3. Issue `#25`

## 3. 测试单元清单

1. 用户注册并进入工作区
2. managed 模式固定 prompt 触发唯一 markdown deliverable
3. 浏览器实时流捕获 `deliverables_ready`
4. 对话区出现 `Task complete` 交付卡片和唯一文件名
5. 下载按钮返回的文件内容包含约定 token
6. `GET /api/altus-managed/sessions/:sessionId/runs/latest` 返回同一 run 且状态为 `completed`
7. `GET /api/task-creation/sessions/:sessionId/messages` 中存在 `deliverables_ready`，并位于 `run_completed` 之前
8. `GET /api/task-creation/sessions/:sessionId/deliverables` 返回唯一 artifact，名称与下载路径正确
9. 页面刷新后交付卡片仍可见
10. 同一浏览器新页面重新进入同一会话后交付卡片仍可见
11. 新浏览器 context 在显式恢复 managed 模式后重新进入同一会话，交付卡片仍可见

## 4. 预期输入与预期输出

### 4.1 固定触发 prompt

输入 prompt 采用单一最小交付物场景：

```text
请严格执行以下任务，不要提问：
1. 在工作区根目录创建一个 Markdown 文件 `deliverable-stability-<token>.md`
2. 文件内容必须精确包含：
   # Deliverable Stability Smoke

   token: <token>
3. 不要创建任何其他最终交付文件
4. 完成后把这个 markdown 作为唯一最终交付文件返回
```

预期输出：

1. 最终 deliverable 只有一个 markdown 文件
2. 文件名严格为 `deliverable-stability-<token>.md`
3. 文件正文包含 `token: <token>`

### 4.2 实时流顺序

输入：

1. 浏览器在页面加载前注入 EventSource recorder
2. 记录 managed run stream 事件

预期输出：

1. 对同一 run 至少记录到 `deliverables_ready`
2. `deliverables_ready` 出现时页面已可进入交付卡片展示阶段

### 4.3 页面可见交付卡片

输入：

1. 发送固定 prompt
2. 等待对话区稳定

预期输出：

1. 页面出现 `Task complete`
2. 页面出现 `已生成 1 个最终交付物`
3. 页面出现目标文件名
4. 页面出现 `下载` 按钮

### 4.4 下载校验

输入：

1. 点击交付卡片中的 `下载`

预期输出：

1. 浏览器触发下载
2. 下载文件名匹配目标文件名
3. 下载文件正文包含约定 token

### 4.5 接口与持久化校验

输入：

1. 使用与页面同一登录态访问 API

预期输出：

1. latest run 为同一会话 run，状态 `completed`
2. messages 中存在 `deliverables_ready` 与 `run_completed`
3. `deliverables_ready` 排在 `run_completed` 之前
4. deliverables 列表中只有一个 artifact，且 `downloadPath` 非空

### 4.6 刷新与重进恢复

输入：

1. 页面刷新
2. 同一浏览器新页面重新进入 `/session/:sessionId?view=history`
3. 新建浏览器 context，显式恢复 `localStorage.altus_mode=managed` 后重新进入 `/session/:sessionId?view=history`

预期输出：

1. 交付卡片仍可见
2. 文件名仍可见
3. 不依赖再次发送消息或手工刷新历史

## 5. 边界条件与失败条件

边界条件：

1. 使用唯一 token，避免命中旧会话或旧交付物
2. 只允许唯一 deliverable，避免多文件结果污染断言
3. 固定使用 markdown 文本文件，降低工具链波动

失败条件：

1. 页面长时间无交付卡片，只在刷新后才出现
2. 实时流没有 `deliverables_ready`
3. 持久化消息中 `run_completed` 早于 `deliverables_ready`
4. deliverables 列表为空或文件名不匹配
5. 下载文件内容不包含 token
6. 刷新或重新进入会话后交付卡片消失

## 6. 验证方式

1. Playwright 浏览器自动化验证页面可见行为
2. Playwright APIRequestContext 补查 latest run、messages、deliverables
3. 读取下载文件内容，验证 token
4. 使用浏览器注入的 EventSource recorder 验证实时流事件顺序

## 7. 执行脚本

测试脚本：

- [managed-deliverable-stability.playwright.spec.ts](/Users/watson/.codex/worktrees/3f02/oneceo/apps/web/client/src/tests/managed-deliverable-stability.playwright.spec.ts)

执行命令：

```bash
pnpm --filter web exec playwright test client/src/tests/managed-deliverable-stability.playwright.spec.ts
```

## 8. 实际执行结果

执行时间：

- 2026-04-04

执行命令：

```bash
pnpm --filter web check
DATABASE_URL=... pnpm --filter api exec tsx --test tests/task-creation-deep-routes.test.ts
pnpm --filter web exec playwright test client/src/tests/managed-deliverable-stability.playwright.spec.ts --reporter=list
```

结果：

1. `pnpm --filter web check` 通过
2. `apps/api/tests/task-creation-deep-routes.test.ts` 中本次新增的两条回归通过：
   - `/messages/recent` 保留 managed deliverable metadata
   - `/messages/history` 保留 managed deliverable metadata
3. Playwright 真实链路通过，关键日志如下：

```text
[managed-deliverable-test] session created fb940391-4bb0-4ffc-a24e-9e1f53229e76
[managed-deliverable-test] run completed f2e0a55b-1f4a-473f-8642-af0e2e6b39dc
[managed-deliverable-test] deliverable card visible
[managed-deliverable-test] deliverables listed
[managed-deliverable-test] download verified
[managed-deliverable-test] reload verified
[managed-deliverable-test] reentry verified (same context)
[managed-deliverable-test] reentry verified (fresh context)
```

结论：

1. managed 交付文件可以在真实浏览器链路中稳定触发
2. 交付卡片无需刷新即可出现
3. 下载文件内容与 prompt 约束一致
4. 页面刷新、同浏览器重进、fresh context 重进后都能恢复交付卡片
