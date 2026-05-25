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
