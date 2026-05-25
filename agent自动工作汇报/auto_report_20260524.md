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

## Altus 调试浏览器/CDP 重试循环固定化

做了什么：

1. 根据 `6d9a2ab3-a483-456c-a959-780ea32e60a2` run events，确认业务预览服务已在健康检查成功后，后续主要失败集中于模型手动探测/启动/清理 Chrome CDP 9222。
2. 将 Chrome/Chromium/n.eko/remote-debugging 生命周期命令从 `shell_execute` 中阻断，要求统一走 `debug_open_page` 与 `browser_interact` 的平台托管链路。
3. 让 `browser_interact` 在执行 Playwright 动作前也先确认 n.eko/CDP ready，避免绕过 `debug_open_page` 后直接连接 9222 失败。

预期效果：

1. Altus 不再通过 shell 反复执行 `curl 9222/json`、手动启动 Chromium、`pkill chrome` 等命令。
2. 调试浏览器不可用时，工具直接返回 `*_debug_not_ready` 结构化错误，停止无意义命令探索。

补充修复：

1. `ensureNekoDebug` 就绪判定从仅检查 n.eko Web 端口扩展为同时检查 Chromium CDP `9222/json/version`。
2. 当 n.eko 已运行但 CDP 未就绪时，记录 `cdp_not_ready`，并采集 `/tmp/chromium.log`、`/tmp/xvfb.log` 与 9222 监听端口诊断。
3. `debug_open_page` 不再允许 `ensureDebug:false` 绕过平台托管检查，避免再次出现直接打开页面时连接 9222 失败。

## Altus 调试浏览器错误可见性首阶段

做了什么：

1. 根据 `6711a041-4659-4c1c-a8f5-cfa31a94bd9c` 的复测现象，确认当前阶段先解决“为什么无法拿到视觉检测图片不可见”的问题。
2. 将 n.eko/CDP 启动脚本改为 `bash -lc` 执行，避免 bash 语法在默认 shell 下失败后只暴露 `exit status 1`。
3. 启动失败时将 stdout、stderr、exitCode、error message、n.eko/Chromium/Xvfb 日志和监听端口统一写入 `metadata.debug.neko.diagnostics`。
4. 对 Xvfb、n.eko 二进制、n.eko 静态资源、Chromium 二进制、n.eko 未就绪、CDP 未就绪分别给出结构化 `reasonCode`。

边界：

1. 本阶段只增强错误可见性。
2. 暂不修改固定链路、重复失败阻断、run retry 或停止无限循环策略。

验证结果：

1. 定向测试通过：`pnpm --filter api exec tsx --test tests/sandbox-debug-service.test.ts tests/altus-managed-tool-runtime.test.ts`，71/71 通过。
2. API 类型检查通过：`pnpm --filter api type-check`。

## Altus 调试浏览器未就绪不再直接停机

做了什么：

1. 根据 `1ce3cdc5-bb60-4c3b-b7b9-e4a923ffd9b4` 的停止记录，确认 `debug_service_not_ready` 被当作平台级硬停止，导致 Altus 无法继续调查调试浏览器链路。
2. 将 `debug_service_not_ready` 改为可恢复工具错误，交还给模型继续检查结构化诊断、刷新或修复调试浏览器状态。
3. 保留同目标同原因重复 `debug_open_page` 的阻断保护，避免变成无脑循环。

验证结果：

1. 定向测试通过：`pnpm --filter api exec tsx --test tests/altus-run-coordinator.test.ts tests/altus-managed-tool-executor.test.ts tests/altus-managed-tool-runtime.test.ts tests/sandbox-debug-service.test.ts`，125/125 通过。
2. API 类型检查通过：`pnpm --filter api type-check`。

## Altus 重复视觉检测失败后继续调查

做了什么：

1. 根据 `a5e4aebc-a02c-4f5e-b5f8-d6a8540e5f6b` 的真实 run events，确认应用构建、安装、后台服务启动和 `curl http://127.0.0.1:8080/` 都已成功，失败集中在 `debug_open_page` 启动 n.eko / Chromium 调试浏览器。
2. 将 `debug_open_page_repeat_blocked` 从用户动作必需错误改为可恢复工具错误：仍阻断同一目标同一原因的重复截图，但不再让 run coordinator 直接抛出用户可见停止。
3. 调整用户可见文案，把语义从“任务停止”改为“平台阻止继续重复截图，Altus 先调查并修复后再打开”。

结论：

1. 这次两次视觉检测失败的直接原因是 `debug_open_page_debug_not_ready:start_script_failed`，即调试浏览器启动脚本失败，而不是页面服务不可达。
2. 原先任务直接失败的控制流原因是第二次失败被归类为 `tool_failed_user_action_required`，随后 `AltusRunCoordinator` 调用失败生命周期。

验证结果：

1. 定向测试通过：`pnpm --filter api exec tsx --test --test-name-pattern "debug_open_page failure tracking|execute keeps repeated debug_open_page failures recoverable" tests/altus-run-coordinator.test.ts`，5/5 通过。
2. 相关完整测试通过：`pnpm --filter api exec tsx --test tests/altus-run-coordinator.test.ts tests/altus-managed-tool-executor.test.ts tests/altus-managed-tool-runtime.test.ts tests/sandbox-debug-service.test.ts`，125/125 通过。

## 调试浏览器平台能力稳定化方案文档

做了什么：

1. 按用户要求新增待采用设计文档，完整规整 n.eko、Playwright、Chromium 的存放位置、调用方式、平台结合方式、E2B/OSAC 转发方式和后续固定调用流程。
2. 明确三者必须共用同一个 Chromium：n.eko 负责显示同一个 Xvfb 桌面，Playwright 通过 CDP 控制同一个 Chromium，Chromium 是唯一浏览器进程。
3. 将当前根因写入方案：运行时不应写 `/opt/neko/client/dist`，应复制到 `/tmp/oneceo/debug-browser/neko-static` 后再 patch，并将日志、配置和启动脚本固定到 `/tmp/oneceo/debug-browser`。

产物：

1. `docs/agent研发文档/20260524_调试浏览器平台能力稳定化与n_eko_Playwright_Chromium共用链路方案_[尚未采用].md`

补充审查：

1. 发现原方案把 `/tmp/oneceo` 写成笼统运行时目录，后续可维护性不足；已调整为 `/tmp/oneceo/debug-browser` 专属子树，并要求维护 `logs`、`run`、`state`、`tmp`。
2. 增加 sandbox 内部可维护性约束：manifest、pid 文件、日志轮转、诊断脚本、runtimeVersion、受控清理边界。
3. 明确禁止常规使用全局 `pkill -x chrome/chromium/neko`，重启只能处理 manifest/pid 指向且命令行匹配 oneceo debug-browser 的受控进程。
4. 增加 template 依赖版本固定要求，避免 `@playwright/mcp@latest`、`neko@latest`、`browser-use` 最新版导致不同构建日期行为漂移。

继续补充：

1. 增加 ensure 并发锁、端口/display 所有权判断、旧 sandbox runtimeVersion 升级边界。
2. 增加失败恢复状态机，将 template、runtime、browser、media forwarding、target preview、authz 分层，避免 Altus 把平台调试失败误修成用户项目问题。
3. 增加访问控制和敏感信息边界：模型可见输出不应泄露完整 n.eko URL、TURN credential、OSAC token、cookie 或连接器密钥。
4. 补强测试矩阵：锁竞争、资源冲突、旧 sandbox、磁盘压力、诊断脱敏、访问控制、同一浏览器断言都需要进入验证。

## 调试浏览器平台能力稳定化 runtime 首阶段实现

做了什么：

1. 用户确认按方案进入实现，方案文档状态更新为 `[20260525-1020已采用]`。
2. `ensureNekoDebug` 启动链路改为 `/tmp/oneceo/debug-browser` runtime 子树：
   - `neko-static`
   - `neko.yml`
   - `neko-start.sh`
   - `logs/`
   - `run/`
   - `state/manifest.json`
3. n.eko 静态资源不再运行时写 `/opt/neko/client/dist`，改为复制到 runtime 副本后 patch。
4. 启动脚本改为先写入 sandbox 文件，再通过带锁 wrapper 执行，避免并发 ensure 覆盖日志、pid 和静态目录。
5. 增加 manifest、pid 文件、日志轮转、runtimeVersion、failureLayer、nextAction。
6. 进程重启改为处理 pid 文件指向的受控进程；旧 runtime 的 `/tmp/oneceo/neko.yml` 和 `/tmp/chromium-profile` 进程只作为升级清理对象处理。

验证结果：

1. API 类型检查通过：`pnpm --filter api type-check`。
2. 定向测试通过：`TMPDIR=/private/tmp pnpm --filter api exec tsx --test tests/sandbox-debug-service.test.ts`，12/12 通过。
3. 相关测试通过：`TMPDIR=/private/tmp pnpm --filter api exec tsx --test tests/sandbox-debug-service.test.ts tests/altus-managed-tool-runtime.test.ts tests/altus-run-coordinator.test.ts`，121/121 通过。
