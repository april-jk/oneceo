# 2026-05-24 自动工作汇报

## Altus 预览服务启动失败定位

做了什么：

1. 根据用户提供的 `104b9bd6-7d7e-4ec3-8afb-abefd2b008b2` Actions 记录，定位预览阶段反复 timeout 与 `debug_open_page_repeat_blocked` 的因果链。
2. 核对 `AltusManagedToolRuntime`、固定 Web Shell 物料化服务、完成态网站截图服务、run coordinator 的相关实现。
3. 新增审核稿文档：`docs/agent研发文档/20260524_Altus预览服务托管与调试启动闭环方案_[尚未采用].md`。

结论：

1. 根因是固定 Web Shell 的 `node dist/index.js` 长驻启动命令未被 `shell_execute` 识别为需要托管的本地预览服务。
2. 命令超时是长驻服务被当前台一次性命令等待的症状，不应通过单纯调大 timeout 或提示模型加 `nohup/&` 解决。
3. 最短正确路径是把预览服务启动、健康检查、ready URL 与 `debug_open_page` 调试入口收敛到平台托管闭环。

进展更新：

1. 用户已确认采用方案，方案文档已更新为 `[20260524-1743已采用]`。
2. 开始实现平台托管预览服务闭环：新增固定 Web Shell 预览服务契约解析，覆盖 `node dist/index.js`、`PORT=... node dist/index.js` 与固定壳 `npm start`。
3. 后续继续补测试并运行端到端验证。

验证结果：

1. 定向测试通过：`TMPDIR=/private/tmp ./node_modules/.bin/tsx --test tests/altus-managed-tool-runtime.test.ts tests/task-session-website-preview-snapshot-service.test.ts`，70/70 通过。
2. API 类型检查通过：`pnpm --filter api type-check`。
3. 本地轻量启动闭环通过：模拟固定 Web Shell 长驻服务，`/api/system/health` 返回 `{"ok":true,"service":"oneceo-official-web-shell"}`，首页返回预期 HTML。
