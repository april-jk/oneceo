# auto_report_20260525

## 调试浏览器共用链路继续修复

做了什么：

1. 将 `debug_open_page` 从 CDP `/json/new` 调用改为 Playwright `connectOverCDP` 后 `page.goto()`，确保 n.eko、Chromium、Playwright 控制的是同一个平台托管浏览器。
2. 补齐 Altus `shell_execute` 调试浏览器 guard，拦截 Chrome / Chromium / n.eko / Xvfb / X11 lock / `/tmp/oneceo/debug-browser` / CDP 9222 管理命令，避免模型清理或杀掉平台进程。
3. 加强 n.eko 启动锁：写入 lock owner，超时时输出 owner、`fuser` / `lsof` 诊断，并在确认无 live holder 时清理 stale lock 后重试一次。
4. 给 Playwright 打开失败增加结构化 marker，便于 Actions 看到失败阶段、reasonCode 和 CDP endpoint。
5. 复查设计文档后补齐锁内二次探测、`--remote-debugging-address=127.0.0.1`、无法判断 lock holder 时拒绝 stale cleanup、Playwright 打开失败的 envelope 分类。
6. 继续逻辑复查时修正 `set -e` 下 `lock_has_live_holder` 非零返回会提前退出的问题，并补齐 lockdir fallback 拿锁后二次探测，避免 ready 运行时被误重启。
7. 按“metadata 是缓存、实时 sandbox 状态才是事实”的最小方案修复 `ensureNekoDebug()`：历史 `failed` 不再无条件触发重启；start wrapper false negative 后如果 CDP、n.eko、manifest 都 ready，则修正 metadata 为 `running` 并允许 `debug_open_page` 继续。
8. 复查成功会话 `b028dc2b-6350-45d1-a770-5dc3fecc0275` 后修复 background service false negative：外层 shell PID 退出时不再立刻报 `start_failed`，如果端口/health probe 已 ready，则返回 background service `ready`。

验证结果：

1. `TMPDIR=/private/tmp pnpm --filter api exec tsx --test tests/altus-managed-tool-runtime.test.ts tests/sandbox-debug-service.test.ts`，76/76 通过。
2. `pnpm --filter api type-check` 通过。
3. 本次实时状态修正后重新验证：`pnpm --filter api type-check` 通过；`TMPDIR=/private/tmp pnpm --filter api exec tsx --test tests/altus-managed-tool-runtime.test.ts tests/sandbox-debug-service.test.ts`，78/78 通过。
4. background service false negative 修复后重新验证：`pnpm --filter api type-check` 通过；`TMPDIR=/private/tmp pnpm --filter api exec tsx --test tests/altus-managed-tool-runtime.test.ts tests/sandbox-debug-service.test.ts`，79/79 通过。

剩余风险：

1. 本轮完成了单元/聚焦测试验证，尚未用真实 sandbox 会话 `d4606cd8-b949-41fd-adf4-c6bde9e5ac18` 复跑完整视觉链路。

## Sandbox 内部日志排查 SOP 沉淀

做了什么：

1. 新增 `docs/agent研发文档/20260525_Sandbox内部日志排查SOP_[20260525-1918已采用].md`，固化从 task session 定位 sandbox、脱敏读取 env、优先查询 DB metadata、必要时进入 E2B 查 `/tmp/oneceo/debug-browser` 日志的流程。
2. 新增本地 Codex skill：`/Users/watson/.codex/skills/oneceo-sandbox-logs/SKILL.md`，用于后续用户要求“去 sandbox 内部查日志”时直接复用排查步骤。

验证结果：

1. 已确认文档和 skill 文件写入完成；skill 内容明确禁止输出密钥原文。

## 会话消息首屏与交付卡片错位修复

做了什么：

1. 排查用户端会话页 `/session/:id?view=history` 的 recent/history 加载、managed run 实时流合并和完成交付卡片渲染顺序。
2. 将 managed 新会话的用户输入提前进入本地消息列表，再在草稿会话创建完成后绑定真实 `sessionId` 并写入历史视图缓存。
3. 调整 `run_completed` 携带交付物时的渲染顺序，先显示完成状态文本，再显示交付卡片。
4. 复查 Redis recent / history 时序，并对比 2026-05-19 基线 `92a82093`，补充 Redis recent 新鲜度对账，避免旧 Redis 首屏遮住 DB 中已完成的新尾部。

遇到什么：

1. 用户提供的示例会话在当前登录态下 recent/history 接口返回 403，页面表现为空白，无法直接读取该会话历史。
2. 代码侧发现 managed 新会话原本会先等待草稿会话创建再显示本地输入，完成事件携带交付物时卡片会先于完成状态进入时间线。
3. Redis recent page 只在 GET 首屏时写入，消息写入路径重建 DB recent 但不会同步失效 Redis recent，存在 600 秒 TTL 内读到旧首屏的时序风险。

计划如何解决：

1. 已补充前端回归测试和 recent/history 设计文档记录。
2. 继续通过 `web` 聚焦测试和类型检查验证。

## 视觉检查自动打开远端调试优化

做了什么：

1. 梳理 Altus 视觉工具事件、回放抽屉和 Debug iframe 的衔接，确认 `debug_open_page` / `browser_interact` 已经是视觉检查对应的 Debug 视图入口。
2. 增加 managed 运行中视觉调试工具的自动打开逻辑：出现最新非失败视觉调试动作时，自动打开右侧回放抽屉并切到 Debug 视图。
3. 修正 Debug 启用按钮的时序判断：已有 `debugInfo.ready && debugInfo.url` 时只刷新调试信息，不再往会话里发送“帮我调试页面”。
4. 更新调试浏览器方案文档，记录自动打开、去重和已调试状态不重复发消息的规则。
5. 根据 review 继续修正旧视觉调试动作误触发问题：非处理状态和新一轮处理刚开始时先登记历史 action，只有后续新增 action 才自动打开 Debug。
6. 继续优化自动打开时序：视觉调试 action 出现后先后台轮询 `getTaskCreationDebugInfo`，确认 `ready + url` 后才展示 Debug，避免自动路径提前显示“执行环境未启动 / 启动调试”。
7. 将自动轮询拿到的 ready debug info 传给 Altus 回放抽屉作为展示 override，避免 runtime 状态尚未同步时 DebugPreview 仍误判为执行环境未启动。
8. 排查会话 `d7b157d7-60fd-40bb-9b72-21fa0451f254` 的 sandbox `ifejcjlfezwwlt41lrxyh`，确认失败根因是 Chromium CDP 晚到 ready 后 n.eko 未启动，而不是前端自动 Debug 展示改动。
9. 最小化修复 `ensureNekoDebug()`：当 `chromium_start_failed` / `debug_browser_lock_timeout` 后实时探测发现 CDP ready、n.eko not ready 时，执行只启动 n.eko 的 late-CDP 恢复命令并写 manifest，不重跑完整 wrapper。

验证结果：

1. `pnpm --filter web exec vitest run src/tests/managed-run-status-dialogue.test.ts`：15/15 通过。
2. `pnpm --filter web check`：通过。
3. `TMPDIR=/private/tmp pnpm --filter api exec tsx --test tests/sandbox-debug-service.test.ts`：17/17 通过。
4. `pnpm --filter api type-check`：通过。
5. 真实 sandbox `ifejcjlfezwwlt41lrxyh` 验证：修复后的 `ensureNekoDebug()` 返回 `ready=true`、`status=running`、`url=https://8081-ifejcjlfezwwlt41lrxyh.e2b.app`。

## 会话消息乱序稳定化

做了什么：

1. 排查 recent/history、Redis 页面缓存、DB timeline 与前端合并逻辑，确认乱序风险来自展示层没有始终把 `timeline_cursor` 当作第一排序事实源。
2. 后端 `messages/recent` / `messages/history` 的游标计算改为优先使用 top-level `timelineCursor` / `metadata.timelineCursor`，旧数据缺失时再退回 `sessionEventSeq`、时间戳和 `createdAt`。
3. 后端 timeline 响应补齐 `timelineCursor` 透传，避免前端只能依赖时间戳推断顺序。
4. 前端历史合并和实时追加增加稳定排序：双方都有可比较 timeline cursor 时按 cursor 排序；缺失 cursor 的旧消息保持原相对顺序，避免强行误排。
5. 更新 recent/history 设计文档，明确前后端展示排序也必须以 `timeline_cursor` 为第一依据。

验证结果：

1. `pnpm --filter web exec vitest run src/tests/managed-mixed-timeline-render.test.ts`：4/4 通过。
2. `pnpm --filter api type-check`：通过。
3. `pnpm --filter web exec tsc --noEmit`：首次发现 metadata 类型收窄问题，修复后复跑通过。
4. `pnpm --filter web check`：通过。
5. `git diff --check`：通过。
