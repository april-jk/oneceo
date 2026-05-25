# 20260524 调试浏览器平台能力稳定化与 n.eko / Playwright / Chromium 共用链路方案 [20260525-1020已采用]

## 1. 这次要解决什么

现在的问题不是“视觉检测 prompt 不够好”，而是调试浏览器链路没有被平台固定住。

最近会话里已经看到几个现象：

1. `debug_open_page` 第一次失败后，后面反复进入 `debug_browser_lock_timeout`。
2. Altus 会尝试用 `shell_execute` 去 `kill chrome`、清理 X11 lock、探测 `9222`，把平台浏览器链路越修越乱。
3. Actions 里看不到截图，不是前端没展示，而是 `debug_open_page` 没成功，后端没有生成 `browserScreenshot`。
4. n.eko、Chromium、Playwright 没有稳定落到“同一个浏览器实例”上。

这份方案只处理一个目标：

> sandbox 里只有一个平台托管 Chromium。n.eko 负责看这个 Chromium，Playwright 负责控制和截图这个 Chromium。

## 2. 最终链路

固定链路如下：

```text
Xvfb DISPLAY=:0
  -> 唯一 Chromium
       --user-data-dir=/tmp/oneceo/debug-browser/chromium-profile
       --remote-debugging-address=127.0.0.1
       --remote-debugging-port=9222
  -> n.eko 捕获 DISPLAY=:0，把画面转发给 oneceo 调试页
  -> Playwright connectOverCDP("http://127.0.0.1:9222") 控制同一个 Chromium
```

职责分清：

1. n.eko：只负责把桌面画面实时转发给平台调试页。
2. Chromium：唯一真实浏览器进程。
3. Playwright：只连接 `127.0.0.1:9222`，负责打开页面、交互、截图。
4. Altus：只启动用户项目服务，然后调用 `debug_open_page` / `browser_interact`。
5. 平台：负责启动、复用、修复和诊断 n.eko / Chromium / Xvfb。

## 3. 固定位置

模板里已有能力：

1. n.eko 二进制：`/usr/local/bin/neko`
2. n.eko 静态资源源目录：`/opt/neko/client/dist`
3. Playwright 浏览器缓存：`/opt/ms-playwright`
4. Playwright MCP wrapper：`/usr/local/bin/playwright-mcp`
5. Xvfb：`/usr/bin/Xvfb`

运行时只写这里：

```text
/tmp/oneceo/debug-browser/
  neko-static/
  chromium-profile/
  logs/
    neko-start.log
    neko.log
    chromium.log
    xvfb.log
  run/
    ensure.lock
    xvfb.pid
    chromium.pid
    neko.pid
  state/
    manifest.json
  neko.yml
  neko-start.sh
```

用户 workspace 仍然只放项目代码：

```text
/opt/.altus/opencode/workspaces/<taskSessionId>
```

不把 n.eko、Chromium profile、Playwright 缓存、启动脚本写进 workspace。

## 4. 要改哪些文件

主要改这几个地方：

1. `apps/api/src/services/sandbox-debug-service.ts`
   - 固定启动和复用唯一调试浏览器。
   - 修复启动锁和 stale lock。
   - 输出可读 diagnostics。

2. `apps/api/src/services/altus-managed-tool-runtime.ts`
   - `debug_open_page` 改成 Playwright CDP 打开页面并截图。
   - `browser_interact` 继续复用同一个 CDP 页面并截图。
   - 禁止 Altus 通过 `shell_execute` 手动管理浏览器链路。

3. `apps/api/src/services/altus-managed-tool-result-envelope.ts`
   - 把 debug 失败原因整理成 Altus 能理解、Actions 能显示的结果。

4. 测试文件：
   - `apps/api/tests/sandbox-debug-service.test.ts`
   - `apps/api/tests/altus-managed-tool-runtime.test.ts`
   - 必要时补充 `apps/api/tests/sandbox-agent-provision-service.test.ts`

## 5. 具体实现

### 5.1 平台启动唯一浏览器

在 `sandbox-debug-service.ts` 里保留一个平台入口，例如继续用 `ensureNekoDebug`，内部按这个顺序做：

1. 先无锁探测：
   - `curl http://127.0.0.1:9222/json/version`
   - `curl http://127.0.0.1:8081/`
   - 检查 `manifest.json` 里的 runtimeVersion、pid、port、display。

2. 如果 CDP 和 n.eko 都 ready，直接返回 ready，不重启。

3. 如果不 ready，再拿 `/tmp/oneceo/debug-browser/run/ensure.lock`。

4. 拿到锁后重新探测一次，避免重复启动。

5. 需要重启时，只处理 manifest/pid 文件里记录的平台进程：
   - Xvfb
   - Chromium
   - n.eko

6. 重新生成运行时文件：
   - 复制 `/opt/neko/client/dist` 到 `/tmp/oneceo/debug-browser/neko-static`
   - 写 `/tmp/oneceo/debug-browser/neko.yml`
   - 写 `/tmp/oneceo/debug-browser/neko-start.sh`
   - 写或更新 `state/manifest.json`

7. 启动：
   - `Xvfb :0`
   - `Chromium --remote-debugging-port=9222`
   - `n.eko` 监听 `8081`

8. 再探测：
   - CDP ready
   - n.eko HTTP ready

9. 成功或失败都释放 lock。

重点：不再让 Altus 参与这件事。

### 5.2 修启动锁

当前反复失败的一个核心是 lock 卡住。

lock 文件内容要写清楚：

```json
{
  "ownerPid": 123,
  "startedAt": "2026-05-25T10:00:00.000Z",
  "runtimeVersion": "debug-browser-runtime-v2"
}
```

规则：

1. lock 没超时：等待一小段时间，然后重新探测。
2. lock 超过 90 秒：检查 `ownerPid` 是否还活着。
3. owner 不活：清理 stale lock。
4. owner 还活：返回 `debug_browser_lock_timeout`，并带上 manifest 和日志 tail。
5. 启动脚本失败：必须释放 lock，不能让下一次继续卡住。

### 5.3 `debug_open_page` 直接用 Playwright

现在 `debug_open_page` 应该证明 Playwright 能控制 n.eko 正在展示的那个浏览器。

在 `altus-managed-tool-runtime.ts` 中改成：

1. 校验目标 URL。
2. 调 `ensureManagedDebugBrowserReady("debug_open_page")`。
3. 在 sandbox 里执行 Playwright 脚本：
   - `chromium.connectOverCDP("http://127.0.0.1:9222")`
   - 找到当前 page，没有就新建 page
   - `page.goto(targetUrl)`
   - `page.waitForLoadState("domcontentloaded")`
   - `page.screenshot(...)`
4. 平台读取截图文件，上传到 R2。
5. `tool_call_completed` 上挂：
   - `browserScreenshot.status`
   - `browserScreenshot.storageKey`
   - `browserScreenshot.source.url`
   - `browserScreenshot.visualCheck`

不要再把打开页面的主路径放在 `curl 9222/json/new` 上。`curl` 可以做健康探测，但真正打开页面和截图由 Playwright 完成。

### 5.4 `browser_interact` 继续用同一个 CDP

`browser_interact` 也只走：

1. `ensureManagedDebugBrowserReady("browser_interact")`
2. `chromium.connectOverCDP("http://127.0.0.1:9222")`
3. 选当前 page
4. 执行动作：
   - click
   - fill
   - keyboard
   - scroll
   - wait
5. 动作后截图
6. 截图挂到对应 Action

这样用户在 n.eko 里看到动作，Actions 里看到同一步截图。

### 5.5 禁止 Altus 手动碰浏览器

`shell_execute` 需要继续扩大拦截范围。

命令里出现下面内容时，直接拒绝：

```text
chromium
chromium-browser
chrome
remote-debugging-port
127.0.0.1:9222
neko
Xvfb
/tmp/.X0-lock
/tmp/.X11-unix
/tmp/oneceo/debug-browser
```

允许 Altus 做这些：

```text
npm run dev
pnpm dev
PORT=7070 node dist/index.js
python -m http.server
curl http://127.0.0.1:<用户服务端口>
```

边界是：Altus 可以管理用户项目服务，不能管理平台浏览器。

### 5.6 失败也要有 Action 证据

如果浏览器没起来，确实没有页面截图，但 Action 不能只显示“视觉检测页面打开失败”。

失败时 `debug_open_page` 要返回结构化诊断：

```json
{
  "reasonCode": "chromium_start_failed",
  "failureLayer": "browser",
  "message": "Chromium 没有成功开放 CDP 9222",
  "diagnostics": {
    "manifest": "...摘要...",
    "cdpProbe": "...",
    "nekoProbe": "...",
    "nekoStartLogTail": "...",
    "chromiumLogTail": "...",
    "xvfbLogTail": "..."
  }
}
```

Actions 里至少要能看到：

1. 失败层：`xvfb` / `chromium` / `cdp` / `neko` / `target`
2. 失败原因：`reasonCode`
3. 最近日志 tail
4. 下一步建议

这样 Altus 不会继续乱猜 shell 命令，用户也能看到到底卡在哪里。

## 6. `reasonCode` 先收敛成这些

不用一开始设计很多，先保留这些够用的：

1. `debug_browser_lock_timeout`
2. `neko_binary_missing`
3. `neko_static_missing`
4. `xvfb_missing`
5. `chromium_binary_missing`
6. `xvfb_start_failed`
7. `chromium_start_failed`
8. `cdp_not_ready`
9. `neko_start_failed`
10. `neko_not_ready`
11. `target_unreachable`
12. `target_bad_status`
13. `playwright_connect_failed`
14. `browser_screenshot_capture_failed`
15. `start_script_failed`

`start_script_failed` 只做兜底。能判断出具体原因时，不用兜底。

## 7. Altus 的标准流程

以后 Altus 做网站视觉检测，只走这个流程：

```text
1. 写代码
2. build 或启动用户项目服务
3. 确认用户服务 URL 可访问
4. 调 debug_open_page(url)
5. 如果成功，Actions 出现 browserScreenshot
6. 如需交互，调 browser_interact
7. 交互后 Actions 再出现 browserScreenshot
8. 截图通过后 complete_task
```

禁止流程：

```text
Altus 启动 Chromium
Altus 启动 n.eko
Altus kill Chrome
Altus 清 /tmp/.X0-lock
Altus 自己写 Playwright 截图脚本代替 Action 截图
Altus 安装 Playwright
```

## 8. 验收标准

这次改完后，用真实会话测试时，看这些结果：

1. 第一次 `debug_open_page` 不应该因为 stale lock 反复失败。
2. `debug_open_page` 成功后，Actions 里必须有 `browserScreenshot`。
3. n.eko 调试页看到的页面，和 Actions 里的 Playwright 截图是同一个页面。
4. `browser_interact` 后，n.eko 画面同步变化，Actions 新增动作截图。
5. Altus 不再尝试启动、杀掉、清理 Chromium / n.eko / Xvfb / X11。
6. 如果浏览器平台能力失败，Actions 里显示具体 `reasonCode` 和日志 tail。
7. 用户项目服务失败时，Altus 修用户项目；浏览器平台失败时，Altus 不再乱修平台进程。

## 9. 最小测试

代码修改后至少补这些测试：

1. `debug_open_page` 使用 Playwright `connectOverCDP` 打开页面并返回 `browserScreenshot`。
2. `browser_interact` 使用同一个 CDP 执行动作并返回 `browserScreenshot`。
3. stale lock 会被清理，不能永久 `debug_browser_lock_timeout`。
4. `shell_execute` 拦截 `Xvfb`、`/tmp/.X0-lock`、`/tmp/oneceo/debug-browser`、`127.0.0.1:9222`。
5. 启动失败时返回 diagnostics，而不是只有 `exit status 1`。

## 10. 一句话结论

不要再让 Altus 从 0 探索浏览器链路。

## 11. 20260525-1847 实现补记

本次在现有采用方案上继续收敛实现，不新增方案：

1. `debug_open_page` 的打开页面主路径已从 `curl 127.0.0.1:9222/json/new` 改为 sandbox 内 Playwright `chromium.connectOverCDP("http://127.0.0.1:9222")` + `page.goto()`。
2. `shell_execute` guard 补齐 Chromium / n.eko / Xvfb / X11 lock / `/tmp/oneceo/debug-browser` / CDP 9222 管理命令拦截，同时保留普通预览服务命令不被误伤。
3. n.eko start wrapper 在 `/tmp/oneceo/debug-browser/run/ensure.lock.owner` 写入锁持有信息；锁超时时输出 owner、`fuser` / `lsof` 诊断，并在确认没有 live holder 时清理 stale lock 后重试一次。
4. `debug_open_page` 的 Playwright CDP 打开失败会输出 `__ONECEO_DEBUG_OPEN_PAGE_RESULT__` 结构化 marker，失败原因会进入工具错误，便于 Actions 看到 `reasonCode`、阶段和 CDP 端点。

验证：

1. `TMPDIR=/private/tmp pnpm --filter api exec tsx --test tests/altus-managed-tool-runtime.test.ts tests/sandbox-debug-service.test.ts`：76/76 通过。
2. `pnpm --filter api type-check`：通过。

平台固定并拥有唯一 Chromium；n.eko 看它，Playwright 控它和截它；Altus 只能通过 `debug_open_page` / `browser_interact` 使用它。

## 12. 20260525-逻辑复查修正

按本文档重新做逻辑对照后，补了三处实现细节，避免“测试能过但链路仍不严谨”：

1. 启动锁拿到后会再次检查 manifest 的 `runtimeVersion` / `configVersion`、CDP 9222、n.eko 8081；如果第一个 ensure 已经启动成功，第二个 ensure 不再重复重启浏览器链路。
2. stale lock 恢复不再在缺少 `fuser` / `lsof` 时盲目清理 lock；无法判断持有者时只输出诊断并返回 lock timeout，避免两个启动脚本并发改同一套 Xvfb / Chromium / n.eko。
3. Chromium 启动显式绑定 `--remote-debugging-address=127.0.0.1`，并把 Playwright `page.goto()` 失败归类为 debug browser/CDP open failure，避免 Actions 退化成泛化工具错误。
4. 锁超时分支在 `set -e` 下读取 `lock_has_live_holder` 的返回值时必须使用 `lock_has_live_holder || holder_status=$?`，否则“无 live holder / 无法判断 holder”会提前退出脚本，绕过 stale lock 诊断与恢复重试。
5. 无 `flock` 时的 lockdir fallback 也必须在拿锁后做同样的 ready 二次探测，避免运行时已经 ready 但 fallback 分支继续重启平台浏览器。

## 13. 20260525-实时状态修正 failed metadata

针对会话 `3e82c733-7a48-4328-9e44-32f8b29485f1` 的排查结论，补充一条第一性原则：

> metadata 是缓存，不是事实；事实以当前 sandbox 内 CDP、n.eko 和 manifest 的实时状态为准。

实现要求：

1. `ensureNekoDebug()` 不再因为历史 `debug.neko.status=failed` 就无条件重启平台浏览器；如果配置版本匹配且实时 `127.0.0.1:9222/json/version`、`127.0.0.1:8081/` 都 ready，则直接把 metadata 修正为 `running`。
2. 如果 start wrapper 返回非零，但随后实时 CDP、n.eko、manifest 都证明当前调试浏览器已 ready，则认为 wrapper 是 false negative，修正 metadata 并返回 ready。
3. 只有实时探测仍失败，才继续返回 `start_script_failed`、`debug_browser_lock_timeout`、`cdp_not_ready`、`neko_not_ready` 等失败状态。

这样可以避免“浏览器实际已经起来，但历史 failed metadata 把 `debug_open_page` 拦在入口，最终没有 `browserScreenshot`”的问题。

## 14. 20260525-background_service false negative 修正

会话 `b028dc2b-6350-45d1-a770-5dc3fecc0275` 证明了一类独立于调试浏览器的 false negative：

1. 模型启动 `node dist/index.js & echo "Server started..."`。
2. 平台 background service wrapper 监控的是外层 shell PID；外层 shell 很快退出，于是标记 `start_failed`。
3. 但日志已经出现 `listening on port 8080`，后续 `curl /` 和 `/api/system/health` 都证明服务真实可用。

修正原则：

1. background service 的父 PID 退出不等于服务失败。
2. 只要存在明确端口，就必须继续 probe `service_url` 或 `health_url`。
3. 如果 health probe 成功，返回 `ready`；只有 PID 退出且 health probe 也失败时，才输出 `__ONECEO_SERVICE_START_FAILED__`。

这样可以减少“用户预览服务已可用但 shell_execute 先报失败”的无效恢复步骤，让 Altus 更快进入 `debug_open_page`。
