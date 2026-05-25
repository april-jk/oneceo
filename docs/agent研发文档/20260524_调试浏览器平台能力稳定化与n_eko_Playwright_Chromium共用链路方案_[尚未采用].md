# 20260524 调试浏览器平台能力稳定化与 n.eko / Playwright / Chromium 共用链路方案 [尚未采用]

## 1. 背景与结论

近期多次 Altus 网站生成后的视觉检测失败，已经证明“调试浏览器”不能继续只依赖 prompt 提醒和模型临场 shell 尝试。它应被固定为平台能力：平台负责安装、启动、转发、诊断和生命周期管理；Altus 只通过 `debug_open_page` 与 `browser_interact` 使用这条能力。

本方案的核心结论是：

> n.eko、Playwright、Chromium 必须被设计成同一套共享浏览器链路，而不是三套独立能力。Chromium 是唯一浏览器进程；n.eko 负责把这个 Chromium 所在 X11 显示画面实时回传给用户；Playwright 负责通过 Chromium CDP 控制同一个浏览器。

因此后续所有调试页面、视觉检测、点击、滚动、输入、截图，都必须落到同一个 Chromium：

```text
用户调试页
  -> E2B 端口转发 n.eko Web UI
  -> n.eko WebRTC 回传 Xvfb 显示画面
  -> Xvfb DISPLAY=:0 上运行唯一 Chromium
  -> Playwright / playwright-mcp 通过 127.0.0.1:9222 CDP 控制同一个 Chromium
```

当前失败的根因之一是平台运行时脚本把模板里的 n.eko 静态资源目录 `/opt/neko/client/dist` 当成可写运行目录使用，尝试写入 CSS 和修改 HTML。该目录在模板内为 root 拥有、`755` 权限，sandbox 命令以普通用户执行；在 `set -euo pipefail` 下，写入失败会导致脚本在生成 `/tmp/oneceo/neko.yml`、启动 Xvfb、启动 Chromium、启动 n.eko 之前直接退出，所以没有可用的 `/tmp/neko.log`、`/tmp/chromium.log`、`/tmp/xvfb.log`。

最短正确修复不是让模型继续尝试 `pkill chrome`、`curl 9222/json/version`、`nohup chromium`，也不是只在 prompt 里要求“使用 Playwright”。最短正确修复是把调试浏览器启动链路沉到平台运行时和 sandbox template 的固定契约里，并把运行时可写内容全部放到 `/tmp/oneceo/debug-browser`。

## 2. 设计目标

1. 调试浏览器是平台能力，不是每次任务从 0 探索的 shell 流程。
2. n.eko、Playwright、Chromium 共享同一个浏览器实例。
3. 运行时不修改模板只读/不可写目录，尤其不写 `/opt/neko/client/dist`。
4. `debug_open_page` 负责确保共享浏览器 ready，并在同一 Chromium tab 中打开目标 URL。
5. `browser_interact` 负责用 Playwright 控制同一 Chromium，并把动作截图作为 Action 证据。
6. CDP 9222 只在 sandbox 内部使用，不作为用户可直接访问的公网端口。
7. n.eko Web UI 通过 E2B host 转发给平台和用户，用于实时查看 Altus 操作。
8. 失败必须结构化可见：能区分静态资源、权限、Xvfb、Chromium、CDP、n.eko、TURN/ICE、目标页面等不同失败层。

## 3. 非目标

1. 不新增第二套浏览器，也不允许 Playwright 自动启动独立 Chromium。
2. 不把 Browser Use、Playwright、Chromium 或 n.eko 安装进用户 workspace。
3. 不把 CDP 9222 暴露成公开调试入口。
4. 不用提示词替代平台约束；prompt 只作为行为引导，不能承担生命周期正确性。
5. 不改变用户项目预览服务托管方案；预览服务由 `20260524_Altus预览服务托管与调试启动闭环方案` 负责，本方案只处理调试浏览器平台能力。

## 4. 组件位置与职责

### 4.1 n.eko

模板固定位置：

1. 二进制：`/usr/local/bin/neko`
2. 模板静态资源源目录：`/opt/neko/client/dist`
3. 模板环境变量：`ONECEO_NEKO_BINARY=/usr/local/bin/neko`
4. 模板环境变量：`ONECEO_NEKO_STATIC_ROOT=/opt/neko/client/dist`

运行时固定位置：

1. 可写静态资源副本：`/tmp/oneceo/debug-browser/neko-static`
2. 配置文件：`/tmp/oneceo/debug-browser/neko.yml`
3. 启动脚本：`/tmp/oneceo/debug-browser/neko-start.sh`
4. 启动总日志：`/tmp/oneceo/debug-browser/logs/neko-start.log`
5. n.eko 进程日志：`/tmp/oneceo/debug-browser/logs/neko.log`
6. 运行状态 manifest：`/tmp/oneceo/debug-browser/state/manifest.json`
7. pid 文件目录：`/tmp/oneceo/debug-browser/run`

n.eko 的职责：

1. 读取 `/tmp/oneceo/debug-browser/neko.yml`。
2. 绑定 `0.0.0.0:8081`，提供 Web UI。
3. 捕获 `DISPLAY=:0` 上的桌面画面。
4. 通过 WebRTC/TURN/ICE 将画面实时返回到平台调试页。
5. 不负责启动用户项目服务，也不负责控制浏览器页面跳转。

### 4.2 Chromium

模板固定位置：

1. 优先使用系统命令：`chromium-browser` 或 `chromium`
2. 若系统命令不存在，使用 Playwright 缓存：`/opt/ms-playwright/chromium-*/chrome-linux*/chrome`

运行时固定配置：

1. 显示：`DISPLAY=:0`
2. CDP：`http://127.0.0.1:9222`
3. 用户数据目录：`/tmp/oneceo/debug-browser/chromium-profile`
4. 日志：`/tmp/oneceo/debug-browser/logs/chromium.log`
5. 初始页面：`about:blank`
6. 窗口大小：与 n.eko screen 配置一致，例如 `1440x900`

Chromium 的职责：

1. 作为唯一真实浏览器进程。
2. 在 Xvfb 桌面上渲染页面，供 n.eko 捕获。
3. 暴露内部 CDP 9222，供 Playwright / `playwright-mcp` 控制。
4. 承载 `debug_open_page` 打开的目标页面和 `browser_interact` 的后续动作。

### 4.3 Playwright / playwright-mcp

模板固定位置：

1. 浏览器缓存：`/opt/ms-playwright`
2. 全局 Node 包：`/usr/local/lib/node_modules`
3. CLI：`playwright`
4. MCP wrapper：`/usr/local/bin/playwright-mcp`
5. 环境变量：`PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`
6. 环境变量：`NODE_PATH=/usr/local/lib/node_modules`
7. 环境变量：`ONECEO_PLAYWRIGHT_CDP_URL=http://127.0.0.1:9222`

调用方式：

1. 平台 MCP 配置必须直接调用 `/usr/local/bin/playwright-mcp`。
2. `playwright-mcp` 必须带 `--cdp-endpoint http://127.0.0.1:9222`。
3. Playwright 代码必须使用 `chromium.connectOverCDP("http://127.0.0.1:9222")` 或等价 MCP CDP 连接。
4. 禁止使用会启动新浏览器的 `chromium.launch()` 作为调试链路主路径。
5. 禁止在用户 workspace 内运行 `npx playwright install` 或重新下载浏览器。

Playwright 的职责：

1. 打开页面、点击、输入、滚动、等待 DOM、读取标题/URL、截图。
2. 通过 CDP 控制 n.eko 正在显示的同一 Chromium。
3. 为每个 `debug_open_page` / `browser_interact` Action 生成可见证据。

### 4.4 Xvfb

模板固定位置：

1. 二进制：`/usr/bin/Xvfb`

运行时固定配置：

1. 显示：`:0`
2. 日志：`/tmp/oneceo/debug-browser/logs/xvfb.log`
3. screen：与 n.eko 和 Chromium 窗口大小一致。

Xvfb 的职责：

1. 为 Chromium 提供无头 sandbox 内的图形显示。
2. 让 n.eko 捕获到真实浏览器画面。

### 4.5 OSAC

模板/运行时位置：

1. 二进制：`/opt/.altus/opencode/osac`
2. 工作目录：`/opt/.altus/opencode`
3. WebSocket 端口：`18080`

OSAC 的职责：

1. 作为平台与 sandbox 内工具/命令执行的桥。
2. 不直接负责浏览器画面。
3. 为平台执行调试启动脚本、采集日志、调用 MCP 工具提供通道。

### 4.6 用户 workspace

固定位置：

1. `/opt/.altus/opencode/workspaces/<taskSessionId>`

workspace 只存放用户项目代码、测试文档、构建产物和业务应用。不得把 n.eko 静态资源副本、Chromium profile、Playwright 浏览器缓存、调试启动脚本放入 workspace。这样可以避免用户项目清理、构建、watcher 或模型写文件误伤平台调试能力。

## 5. 平台调用链路

### 5.1 sandbox provision 阶段

平台在创建或恢复 sandbox 时完成以下动作：

1. 通过 E2B connector 创建 sandbox，使用预装 n.eko / Playwright / Chromium 的模板。
2. 写入 OpenCode / Codex 运行环境变量：
   - `DISPLAY=:0`
   - `PLAYWRIGHT_HEADLESS=false`
   - `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`
   - `ONECEO_PLAYWRIGHT_CDP_URL=http://127.0.0.1:9222`
   - `ONECEO_PLAYWRIGHT_MCP_COMMAND=playwright-mcp`
   - `ONECEO_NEKO_BINARY=/usr/local/bin/neko`
   - `ONECEO_NEKO_STATIC_ROOT=/opt/neko/client/dist`
3. 写入 MCP 配置，确保 `playwright-mcp` 连接同一个 CDP。
4. 启动 OSAC bridge，暴露 `wss://<18080-host>/ws` 给平台。
5. 调用 `ensureNekoDebug` 做调试浏览器预热；如果失败，写入结构化 diagnostics，但不让 Altus 进入盲目 shell 猜测。

### 5.2 ensureNekoDebug 阶段

`apps/api/src/services/sandbox-debug-service.ts` 是调试浏览器启动的唯一平台入口。后续应固定为以下流程：

1. 读取 sandbox metadata 中已有 n.eko / CDP 状态。
2. 检查 TURN/ICE 配置；需要远程可看页面时，缺 TURN 应返回 `missing_turn`。
3. 检查模板能力：
   - `/usr/local/bin/neko`
   - `/opt/neko/client/dist`
   - `/usr/bin/Xvfb`
   - Chromium 可执行文件
   - `/opt/ms-playwright`
4. 创建运行目录 `/tmp/oneceo/debug-browser`。
5. 将 `/opt/neko/client/dist` 复制到 `/tmp/oneceo/debug-browser/neko-static`。
6. 只在 `/tmp/oneceo/debug-browser/neko-static` 内注入平台 edgefill CSS 或 HTML patch。
7. 写入 `/tmp/oneceo/debug-browser/neko.yml`，其中 `server.static` 指向 `/tmp/oneceo/debug-browser/neko-static`。
8. 启动 Xvfb。
9. 启动或复用唯一 Chromium，确保 `127.0.0.1:9222/json/version` ready。
10. 启动 n.eko，确保 n.eko Web 端口 ready。
11. 同时探测 n.eko Web 与 Chromium CDP，二者都 ready 才返回 `ready=true`。
12. 将 `debug.url` 写入 metadata，供前端调试页打开。

### 5.3 debug_open_page 阶段

Altus 调用 `debug_open_page` 时，平台执行：

1. 校验目标 URL：
   - `http://` / `https://`
   - 或 workspace 内 `file://`
2. 调用 `ensureManagedDebugBrowserReady("debug_open_page")`。
3. `ensureManagedDebugBrowserReady` 调用 `ensureNekoDebug`，要求同一 n.eko/CDP ready。
4. 平台在 sandbox 内用 `curl http://127.0.0.1:9222/json/new?<target>` 或 CDP 等价方法打开目标。
5. 探测 `/json/list`，确认目标 tab 出现在同一 Chromium。
6. 通过 Playwright/CDP 截图，作为 `debug_open_page` Action evidence。
7. 返回：
   - `targetUrl`
   - `debugSessionReady=true`
   - `debugViewAvailable=true`
   - `sandboxId`
   - `cdpPort=9222`
   - `browserScreenshot`

完整 `debugUrl` 只写入后端 metadata 或发送给前端调试页，不进入模型可见 tool result。模型只需要知道调试页已可用，不需要拿到可转发的 n.eko 地址。

### 5.4 browser_interact 阶段

Altus 调用 `browser_interact` 时，平台执行：

1. 再次确认 `ensureManagedDebugBrowserReady("browser_interact")`。
2. 使用 Playwright connectOverCDP 接入 `127.0.0.1:9222`。
3. 在当前 Chromium 页面上执行受控动作：
   - locator click
   - text click
   - coordinate click
   - fill
   - keyboard type / press
   - mouse wheel
   - wait for locator / text / load state / timeout
4. 动作完成后截图。
5. 将截图挂到对应 Action，作为用户实时可见和后续复盘证据。

## 6. 平台转发方式

### 6.1 n.eko 页面转发

n.eko 服务监听 sandbox 内 `0.0.0.0:8081`。平台通过 E2B host 映射拿到公网 URL，例如：

```text
https://8081-<orchestratorSessionId>.e2b.app
```

前端调试页面打开的是这个 n.eko URL。用户看到的不是 Playwright 新开浏览器，而是 n.eko 捕获的 Xvfb 桌面画面；该桌面画面中运行的是同一 Chromium。

n.eko URL 不应被当成可公开分享的长期地址。平台前端可以在已登录会话里嵌入或打开该 URL，但管理后台、Action 结果和模型可见输出都不应泄露完整调试 URL、ICE credential 或会话 token。若后续需要外部分享调试页，应单独设计带过期时间和权限校验的分享能力，不混入本方案。

### 6.2 OSAC 转发

OSAC 监听 sandbox 内 `18080`，平台通过 E2B host 映射拿到：

```text
wss://18080-<orchestratorSessionId>.e2b.app/ws
```

OSAC 用于平台命令执行、MCP 调用、日志采集和会话恢复，不用于直接显示浏览器。

### 6.3 CDP 不公开转发

Chromium CDP 固定监听：

```text
http://127.0.0.1:9222
```

它只允许 sandbox 内部平台脚本、Playwright、`playwright-mcp` 访问。不要把 9222 暴露给用户浏览器，也不要通过 E2B host 映射公开 CDP。

### 6.4 访问控制与敏感信息边界

1. 前端调试入口必须依赖 oneceo 已登录会话和任务会话权限。
2. `debugUrl` 可以存在于后端 metadata，但返回给模型的内容应只包含必要摘要；完整 URL 只给前端调试页使用。
3. TURN username / credential、OSAC auth token、E2B host token、cookies、OpenAI key、连接器 token 不进入 Action 文本。
4. n.eko 配置中的 member/password 如存在，只允许写入 sandbox runtime 文件，不进入模型上下文。
5. 日志采集默认 tail，避免把页面内容、cookie 或用户输入大量带出 sandbox。

## 7. Template / Runtime / Workspace 边界

### 7.1 Sandbox template 负责

1. 安装 `Xvfb`。
2. 安装 `/usr/local/bin/neko`。
3. 构建并放置 `/opt/neko/client/dist` 作为静态资源源目录。
4. 安装 Playwright 和 `@playwright/mcp`。
5. 下载 Chromium 到 `/opt/ms-playwright`。
6. 写 `/usr/local/bin/playwright-mcp` wrapper。
7. 安装 Browser Use CLI 到 `/opt/browser-use`。
8. 可选预置 OSAC 二进制到 `/opt/.altus/opencode/osac`。
9. 设置固定环境变量。

模板目录可以保持 root 拥有和只读语义；运行时不应要求它可写。

模板构建还必须固定依赖版本。当前 `template.ts` 中存在 `github.com/m1k1o/neko/server/cmd/neko@latest`、`npm install -g playwright @playwright/mcp@latest`、`pip install browser-use` 这类漂移来源；正式实现时应改成显式版本或锁文件驱动，并把版本写入 template release note。否则同一个 template 脚本在不同日期构建出的 n.eko、Playwright MCP、browser-use 行为可能不同，调试问题会变成不可复现。

### 7.2 平台 runtime 负责

1. 创建 `/tmp/oneceo/debug-browser`，并在其下维护 `logs`、`run`、`state`、`tmp` 子目录。
2. 复制 `/opt/neko/client/dist` 到 `/tmp/oneceo/debug-browser/neko-static`。
3. 对 `/tmp/oneceo/debug-browser/neko-static` 做运行时 patch。
4. 写 `/tmp/oneceo/debug-browser/neko.yml`。
5. 写 `/tmp/oneceo/debug-browser/neko-start.sh`。
6. 写 `/tmp/oneceo/debug-browser/state/manifest.json`，记录 template 版本、runtime 版本、端口、display、pid、日志路径和最后一次健康检查。
7. 通过 pid 文件和 manifest 管理 Xvfb / Chromium / n.eko 进程。
8. 采集 `/tmp/oneceo/debug-browser/logs/*.log`。
9. 写入 sandbox metadata 中的 `debug.neko` 状态和 diagnostics。

平台 runtime 不应把所有临时文件平铺在 `/tmp/oneceo` 根目录。根目录只作为 oneceo 运行时命名空间；调试浏览器能力必须有独立子树，避免后续 OSAC、preview service、连接器缓存或其他平台能力混写。

### 7.3 平台 runtime 不负责

1. 不在 sandbox 内做全局依赖安装。
2. 不修改 `/opt/neko/client/dist`、`/opt/ms-playwright`、`/usr/local/lib/node_modules`。
3. 不把 CDP 9222 转发给用户浏览器。
4. 不接管用户应用预览服务端口。
5. 不清理 workspace 或用户项目进程。

### 7.4 用户 workspace 负责

1. 用户应用代码。
2. 用户应用测试计划，例如 `docs/test-plan.md`。
3. 用户应用构建产物。
4. 用户应用预览服务日志，如果该日志属于用户项目服务。

workspace 不承载平台浏览器运行时文件。

## 8. 具体修复方案

### 8.1 运行时静态资源改为可写副本

当前错误点：

```text
NEKO_STATIC="/opt/neko/client/dist"
cat > "$NEKO_STATIC/oneceo-edgefill-v3.css"
sed -i ... "$NEKO_STATIC/index.html"
```

修复后：

```text
NEKO_STATIC_SOURCE="${ONECEO_NEKO_STATIC_ROOT:-/opt/neko/client/dist}"
NEKO_RUNTIME_ROOT="/tmp/oneceo/debug-browser"
NEKO_STATIC="$NEKO_RUNTIME_ROOT/neko-static"
NEKO_LOG_DIR="$NEKO_RUNTIME_ROOT/logs"
NEKO_RUN_DIR="$NEKO_RUNTIME_ROOT/run"
NEKO_STATE_DIR="$NEKO_RUNTIME_ROOT/state"

rm -rf "$NEKO_STATIC"
mkdir -p "$NEKO_STATIC" "$NEKO_LOG_DIR" "$NEKO_RUN_DIR" "$NEKO_STATE_DIR"
cp -R "$NEKO_STATIC_SOURCE"/. "$NEKO_STATIC"/

cat > "$NEKO_STATIC/oneceo-edgefill-v3.css"
sed -i ... "$NEKO_STATIC/index.html"
```

`neko.yml` 中：

```yaml
server:
  bind: "0.0.0.0:8081"
  static: "/tmp/oneceo/debug-browser/neko-static"
```

这样 template 静态资源源目录保持不可变，运行时 patch 在可写副本内完成。

### 8.2 启动脚本文件化

不要继续把超长 shell 字符串直接塞进 `bash -lc '<script>'`，而应在 sandbox 内生成：

```text
/tmp/oneceo/debug-browser/neko-start.sh
/tmp/oneceo/debug-browser/logs/neko-start.log
```

脚本开头固定：

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
trap 'status=$?; echo "[oneceo-debug-browser] failed line=$LINENO status=$status command=$BASH_COMMAND" >&2' ERR
```

平台执行：

```bash
bash /tmp/oneceo/debug-browser/neko-start.sh > /tmp/oneceo/debug-browser/logs/neko-start.log 2>&1
```

这样失败时可以看到具体行号、命令和 exit code。

启动脚本文件化后，平台仍然是控制面。脚本不能自行决定是否降级、换端口、安装依赖或改 workspace；它只执行平台传入的固定参数，并把结果写回 manifest/logs。这样 sandbox 内部可排查，但不会让业务逻辑分裂到 shell 脚本里。

### 8.3 结构化失败分类

`ensureNekoDebug` 应返回稳定 `reasonCode`：

1. `missing_turn`
2. `xvfb_missing`
3. `neko_binary_missing`
4. `neko_static_missing`
5. `neko_static_copy_failed`
6. `neko_static_patch_failed`
7. `chromium_binary_missing`
8. `xvfb_start_failed`
9. `chromium_start_failed`
10. `cdp_not_ready`
11. `neko_config_write_failed`
12. `neko_start_failed`
13. `neko_not_ready`
14. `permission_denied`
15. `start_script_failed`

其中 `start_script_failed` 只作为未知兜底；能分类时必须使用更具体原因。

### 8.4 进程复用与重启规则

1. 健康探测可以无锁执行；任何会写文件、复制静态资源、启动进程或停止进程的操作必须先获得 `/tmp/oneceo/debug-browser/run/ensure.lock`。
2. 如果已有 ensure 正在运行，后续调用最多等待固定时间，例如 20 秒；超时返回 `debug_browser_lock_timeout`，并附带当前 manifest/log tail。
3. 如果 n.eko Web ready 且 CDP ready，直接复用。
4. 如果 CDP ready 但 n.eko 不 ready，只重启 n.eko。
5. 如果 n.eko ready 但 CDP 不 ready，重启 Chromium，然后必要时重启 n.eko。
6. 如果 display 不存在，重启 Xvfb、Chromium、n.eko。
7. 如果配置版本、TURN/ICE、端口、screen 变化，按顺序重启 n.eko；只有 display 或 Chromium 参数变化才重启 Chromium。
8. 平台重启进程时只能终止 manifest/pid 文件记录的受控进程，或终止命令行明确带有 oneceo debug-browser 标记的进程。
9. 禁止使用全局 `pkill -x chrome`、`pkill -x chromium`、`pkill -x neko` 作为常规重启策略，避免误伤 sandbox 内用户或其他平台能力启动的浏览器进程。
10. 禁止 Altus 通过 `shell_execute` 手动 `pkill chrome` / `pkill neko` / `curl 9222` 修复；此类操作应由平台调试服务内部完成。

### 8.5 端口与 display 所有权

调试浏览器固定占用的资源必须有所有权判断：

1. n.eko Web 默认端口：`8081`。
2. Chromium CDP 默认端口：`9222`。
3. Xvfb 默认 display：`:0`。
4. 端口或 display 已被占用时，先检查是否是 manifest 中记录的受控进程。
5. 如果是受控进程，按健康状态复用或重启。
6. 如果不是受控进程，返回 `debug_browser_resource_conflict`，并输出占用进程摘要；不要静默换端口。
7. 不静默换端口的原因是前端转发、Playwright MCP、prompt、metadata 都依赖固定链路；自动换端口会制造“n.eko 显示 A、Playwright 控制 B”的分裂风险。

### 8.6 sandbox 内部可维护性约束

调试浏览器能力需要能被人和平台长期维护，不能演变成不可读的大脚本。实现时必须满足：

1. 单一入口：`ensureNekoDebug` 仍是平台唯一入口；sandbox 内 helper 也只能被该入口调用。
2. 目录清晰：所有运行时文件放在 `/tmp/oneceo/debug-browser` 子树，禁止散落到 `/tmp` 或 workspace。
3. 运行 manifest：每次启动写 `state/manifest.json`，至少包含 `schemaVersion`、`runtimeVersion`、`templateVersion`、`ports`、`display`、`pidFiles`、`logFiles`、`startedAt`、`lastHealthCheckAt`。
4. 进程可追踪：Xvfb、Chromium、n.eko 均写 pid 文件；重启只处理 pid 文件指向且仍匹配预期命令行的进程。
5. 日志可保留：每次启动前将旧日志轮转为 `.1` 或按时间戳归档，至少保留最近 3 次启动记录。
6. 配置可读：`neko.yml`、启动脚本和 manifest 都要保留在 runtime 目录，便于管理后台或 OSAC 采集。
7. 健康检查可复现：提供固定诊断命令或 helper，例如 `/tmp/oneceo/debug-browser/diagnose.sh`，输出 n.eko/CDP/display/process/static/permissions 的摘要。
8. 版本可升级：helper 或脚本必须带 `runtimeVersion`，当平台代码版本变化时允许重建 runtime 文件，不能盲目复用旧脚本。
9. 清理有边界：只允许清理 `/tmp/oneceo/debug-browser` 内的平台文件；不得清理用户 workspace、`/opt/ms-playwright`、`/opt/neko/client/dist` 或全局 node_modules。
10. 权限最小化：template 目录保持只读源目录，runtime 副本由 sandbox 普通用户可写；不通过 `sudo` 修复权限。
11. 磁盘有上限：`logs`、旧静态副本、旧 profile 归档必须有数量或大小上限，避免长会话把 sandbox 磁盘写满。
12. 输出可脱敏：diagnostics 不输出 ICE credential、auth token、完整环境变量或 cookies；需要展示时只显示是否存在和末尾少量可识别字符。
13. profile 可重建：Chromium profile 损坏时可以删除并重建 `/tmp/oneceo/debug-browser/chromium-profile`，但该动作必须记录到 manifest 和 diagnostics。

### 8.7 旧 sandbox 与升级边界

本方案不做“双路径兼容”。采用后，平台应按 runtimeVersion 判断 sandbox 内调试浏览器能力是否过旧：

1. 如果 sandbox 还没有 `/tmp/oneceo/debug-browser/state/manifest.json`，首次 `ensureNekoDebug` 直接按新 runtime 重建该目录。
2. 如果 manifest 的 `runtimeVersion` 低于平台要求，先停止受控进程，再重建 runtime 文件。
3. 如果 template 缺少必要能力，例如 `/usr/local/bin/neko` 或 `/opt/ms-playwright`，返回 template 能力缺失错误，不在用户任务中安装依赖。
4. 如果旧 sandbox 因 template 缺失无法满足能力，应由平台重新 provision 新 sandbox 或标记该 session 需要恢复到新环境，而不是让 Altus 在 workspace 中修补。

### 8.8 prompt 与工具边界

prompt 应明确：

1. 调试浏览器由平台托管。
2. 不要安装 Playwright。
3. 不要启动独立 Chromium。
4. 不要用 `npx @playwright/mcp@latest`。
5. 不要手写截图脚本替代 Action evidence。
6. `debug_service_not_ready` 时，读取平台结构化 diagnostics，先做具体修复动作，再重试。

但 prompt 不是第一层修复。真正的稳定性必须来自：

1. template 固定依赖位置。
2. runtime 固定启动脚本。
3. tool runtime 固定 CDP 调用。
4. coordinator 固定失败语义。
5. diagnostics 固定日志采集。

## 9. 后续调用规范

### 9.1 Altus 应遵循的标准流程

```text
1. 生成或修改网站代码
2. 构建或启动用户项目预览服务
3. shell_execute 返回 background_service ready
4. debug_open_page 打开 service.url 或 workspace file://
5. browser_interact 执行可见交互和截图
6. 发现问题则修改代码并重新验证
7. 截图证据通过后 complete_task
```

### 9.2 平台应屏蔽的错误调用

`shell_execute` 应继续阻断以下调试浏览器生命周期命令：

1. 手动启动 `chromium` / `chromium-browser` / `chrome` 并带 `--remote-debugging-port`
2. 手动启动 `neko serve`
3. 手动 `pkill` / `killall` n.eko 或 Chromium
4. 手动探测 `127.0.0.1:9222/json/version` 后陷入重复循环
5. 手动安装 Playwright 或运行 `npx playwright install`
6. 手动运行 `npx @playwright/mcp@latest`

这些不是用户项目调试动作，而是平台浏览器能力的内部生命周期。

### 9.3 失败恢复状态机

调试浏览器失败后不能只返回“失败”，也不能让 Altus 从 0 猜命令。平台需要把失败映射到下一步动作：

| reasonCode | 归属层 | 平台动作 | Altus 动作 |
| --- | --- | --- | --- |
| `missing_turn` | 平台配置 | 生成或刷新 TURN/ICE；仍失败则标记平台配置缺失 | 不改用户代码，等待平台配置恢复或报告平台配置问题 |
| `neko_binary_missing` | template | 标记 template 能力缺失 | 不安装 n.eko，报告 sandbox template 异常 |
| `neko_static_missing` | template | 标记 template 能力缺失 | 不创建假静态目录，报告 sandbox template 异常 |
| `neko_static_copy_failed` | runtime 权限/磁盘 | 采集权限、磁盘、源目录信息 | 不重试打开页面，等待平台 runtime 修复 |
| `neko_static_patch_failed` | runtime patch | 保留 patch 前后文件和错误行 | 不修改 workspace，报告平台静态 patch 失败 |
| `xvfb_missing` | template | 标记 template 能力缺失 | 不安装 Xvfb |
| `xvfb_start_failed` | runtime/display | 采集 display、X socket、日志 | 不自行换 display |
| `chromium_binary_missing` | template | 标记 template 能力缺失 | 不运行 `npx playwright install` |
| `chromium_start_failed` | runtime/browser | 采集 profile、依赖库、stderr | 不启动独立 Chrome |
| `cdp_not_ready` | runtime/browser | 重启受控 Chromium；必要时重建 profile | 可在平台返回 ready 后重试 `debug_open_page` |
| `neko_start_failed` | runtime/n.eko | 采集 n.eko config/log | 不手动 `neko serve` |
| `neko_not_ready` | runtime/n.eko | 重启受控 n.eko | 可在平台返回 ready 后重试 |
| `debug_browser_lock_timeout` | 并发控制 | 返回当前 ensure 持有者、manifest、日志 tail | 稍后重试，不发起并发 shell 修复 |
| `debug_browser_resource_conflict` | 资源占用 | 返回占用进程摘要 | 不杀进程；等待平台或用户处理冲突 |
| `permission_denied` | 权限 | 返回具体路径、owner、mode | 不用 sudo；报告平台权限边界问题 |
| `start_script_failed` | 未分类 runtime | 返回启动脚本行号、命令、日志 | 先看 diagnostics，不重复打开同一 URL |

这张表的目的不是让 Altus 自动修平台，而是让它知道“哪些能继续用户项目修复，哪些必须停在平台能力异常”。用户项目页面错误仍然由 Altus 修；n.eko / Chromium / Xvfb / template 缺失则属于平台能力。

### 9.4 能力分层与责任边界

为了避免后续又把浏览器问题和用户项目问题混在一起，平台应按以下边界分类：

1. 用户项目层：构建失败、预览服务 4xx/5xx、页面 JS 报错、DOM 不符合预期。这些由 Altus 修改 workspace 解决。
2. 预览服务层：端口、healthcheck、background service、service log。该层由 `shell_execute` 的托管预览能力负责。
3. 调试浏览器层：Xvfb、Chromium、CDP、n.eko、TURN/ICE。该层由 `ensureNekoDebug` 负责。
4. 转发权限层：E2B host、OSAC WS、用户登录态、调试页访问控制。该层由平台 runtime 和前端负责。

`debug_open_page` 失败时必须指出失败属于哪一层；否则 Altus 很容易把平台调试浏览器失败误修成用户项目代码问题。

## 10. 诊断与日志设计

`metadata.debug.neko` 应至少包含：

1. `status`
2. `reasonCode`
3. `message`
4. `configVersion`
5. `debugUrl`，仅后端和前端调试页使用，不进入模型可见输出
6. `nekoPort`
7. `cdpPort`
8. `display`
9. `screen`
10. `turnConfigured`
11. `iceServers`
12. `diagnostics`

`diagnostics` 应包含：

1. `/tmp/oneceo/debug-browser/logs/neko-start.log` tail
2. `/tmp/oneceo/debug-browser/logs/neko.log` tail
3. `/tmp/oneceo/debug-browser/logs/chromium.log` tail
4. `/tmp/oneceo/debug-browser/logs/xvfb.log` tail
5. `/tmp/oneceo/debug-browser/neko.yml` 是否存在
6. `/tmp/oneceo/debug-browser/neko-static` 是否存在、权限、文件数量
7. `/tmp/oneceo/debug-browser/state/manifest.json` 内容摘要
8. `/opt/neko/client/dist` 是否存在、权限、owner
9. `ps` 中 Xvfb / Chromium / n.eko
10. `ss -ltnp` 或等价端口监听信息
11. `curl 127.0.0.1:8081` 结果
12. `curl 127.0.0.1:9222/json/version` 结果

用户界面和 Action 错误中应显示压缩后的关键 diagnostics，而不是只显示 `exit status 1`。

诊断输出必须遵循三条可维护性规则：

1. `summary` 面向 Altus：只包含 reasonCode、下一步建议、关键日志 tail。
2. `details` 面向管理后台：包含路径、权限、pid、端口、manifest、脚本行号。
3. `raw` 仅用于内部排障：默认不回传给模型，避免 token 过大和泄漏敏感配置。

metadata 中建议额外增加 `failureLayer` 字段，取值为：

1. `template`
2. `runtime`
3. `browser`
4. `media_forwarding`
5. `target_preview`
6. `authz`
7. `unknown`

`failureLayer` 用于 UI 聚合和 Altus 下一步判断；`reasonCode` 用于工程排障。两者不要混用。

## 11. 验证方案

### 11.1 单元测试

1. `sandbox-debug-service.test.ts`
   - 生成的启动脚本不写 `/opt/neko/client/dist`。
   - 生成的 `neko.yml` 使用 `/tmp/oneceo/debug-browser/neko-static`。
   - `permission denied` 能归类为 `permission_denied` 或 `neko_static_copy_failed`。
   - n.eko ready 但 CDP 不 ready 时返回 `cdp_not_ready`。
   - n.eko 和 CDP 都 ready 才返回 `ready=true`。
   - 重启逻辑只终止 pid/manifest 指向的受控进程，不生成全局 `pkill chrome`。
   - 启动前轮转旧日志，并至少保留最近 3 次启动记录。
   - 并发 ensure 时只有一个调用进入写操作，其他调用等待锁或返回 `debug_browser_lock_timeout`。
   - 非受控进程占用 8081 / 9222 / `:0` 时返回 `debug_browser_resource_conflict`，不静默换端口。
   - diagnostics 不包含 ICE credential、auth token、cookies 或完整环境变量。
   - 旧 runtimeVersion manifest 会触发受控重建；缺 template 依赖时返回能力缺失，不尝试安装。
2. `altus-managed-tool-runtime.test.ts`
   - `debug_open_page` 必须先调用 `ensureNekoDebug`。
   - `browser_interact` 必须复用同一个 CDP。
   - `ensureDebug:false` 不能绕过平台调试浏览器 ready 检查。
   - `debug_browser_resource_conflict`、`debug_browser_lock_timeout` 会进入可恢复工具错误，不被误判为用户项目失败。
3. `sandbox-agent-provision-service.test.ts`
   - OpenCode MCP 配置中 `playwright-mcp` 带 `--cdp-endpoint http://127.0.0.1:9222`。
   - 环境变量固定为 `/opt/ms-playwright`、`/usr/local/bin/neko`、`/opt/neko/client/dist`。
   - provision verify 能检查 template 依赖版本并输出版本摘要。

### 11.2 新 sandbox 集成测试

每次 template 或 runtime 修改后，用新 sandbox 验证：

1. `command -v Xvfb`
2. `command -v neko`
3. `test -d /opt/neko/client/dist`
4. `test -d /opt/ms-playwright`
5. 调用 `ensureNekoDebug`
6. 检查 `/tmp/oneceo/debug-browser/logs/neko-start.log`
7. `curl http://127.0.0.1:8081`
8. `curl http://127.0.0.1:9222/json/version`
9. 调用 `debug_open_page http://127.0.0.1:<previewPort>/`
10. 调用 `browser_interact wait_for_load_state`
11. 确认 Action screenshot 出现，且截图不是 `about:blank`、Chrome error page 或空白画面。
12. 检查 `/tmp/oneceo/debug-browser/state/manifest.json` 中 pid、端口、display 与实际进程一致。
13. 连续调用两次 `ensureNekoDebug`，第二次必须复用已 ready 的同一 Chromium，不重建 profile、不重启 n.eko。
14. 模拟 Chromium profile 损坏，平台应记录 profile rebuild 并恢复 CDP。
15. 模拟旧日志存在，启动后只保留最近 3 次或设定上限内的日志。

### 11.3 同一浏览器断言

必须加一个端到端断言证明三者共用同一浏览器：

1. `debug_open_page` 打开 `http://127.0.0.1:<port>/unique-path?token=<uuid>`。
2. Playwright 通过 CDP 按 `debug_open_page` 返回的 target/tab id 定位页面，读取 URL 必须等于该 URL。
3. n.eko 截图中必须显示该页面可见标识。
4. `browser_interact` 点击页面按钮后，Playwright DOM 状态变化和 n.eko 截图状态变化一致。

只有这四点同时成立，才能认为 n.eko、Playwright、Chromium 共用链路成立。

### 11.4 维护性回归测试

1. 并发测试：provision 预热、`debug_open_page`、`browser_interact` 同时触发 ensure 时，不会出现静态目录被半复制、pid 覆盖或日志互相截断。
2. 资源冲突测试：用户进程占用 9222 时，平台返回资源冲突，不杀用户进程，不换 CDP 端口。
3. 旧 sandbox 测试：缺少 runtime manifest 的 sandbox 首次调用后能生成新目录结构；缺少 template 依赖的 sandbox 返回明确 template 错误。
4. 磁盘压力测试：长会话多次重启后，日志和 profile 归档不会无限增长。
5. 安全测试：diagnostics 中不出现 TURN credential、OSAC token、cookie、OpenAI key 或完整环境变量。
6. 操作可读性测试：只拿到 `/tmp/oneceo/debug-browser` 目录和 metadata，也能判断当前失败层级。
7. 访问控制测试：未登录或无任务权限的用户不能通过 oneceo 前端调试入口访问该 session 的 n.eko 页面。
8. 输出边界测试：模型可见 tool result 不包含完整 n.eko URL、TURN credential 或 member password。

## 12. 实施顺序

第一阶段：运行时修复

1. 修改 `sandbox-debug-service.ts`，运行时复制 n.eko static 到 `/tmp/oneceo/debug-browser/neko-static`。
2. 启动脚本文件化到 `/tmp/oneceo/debug-browser/neko-start.sh`。
3. 日志统一迁移到 `/tmp/oneceo/debug-browser/logs/*.log`。
4. 增强 diagnostics。
5. 增加 manifest/pid/log rotation 机制。
6. 补单测。

第二阶段：template 固化

1. 在 `e2b_templates/opencode-playwright-mcp/README.md` 明确 `/opt/neko/client/dist` 是只读源目录。
2. 可选：在 template 中预置 `/opt/oneceo/debug-browser` helper，但 helper 仍只能写 `/tmp/oneceo/debug-browser`。
3. 固定 template 构建依赖版本，避免 `@playwright/mcp@latest`、`neko@latest`、`browser-use` 最新版在不同构建日期产生不一致行为；版本升级必须伴随模板版本号和回归记录。
4. 重新构建并发布新 template。
5. 更新运行环境使用新 template 名。

第三阶段：平台观测与 UI

1. 管理后台会话详情显示 `debug.neko.reasonCode`。
2. Action 失败详情显示关键日志 tail。
3. 调试页显示当前 n.eko URL、CDP ready 状态和最后一次启动时间。

第四阶段：Altus 行为收敛

1. prompt 保持“不要手动管理浏览器生命周期”的规则。
2. `shell_execute` 阻断调试浏览器生命周期命令。
3. `debug_service_not_ready` 引导 Altus 查看 diagnostics，而不是停止任务或重复打开同一 URL。

## 13. 验收标准

1. 新 sandbox 中 `ensureNekoDebug` 首次调用可成功拉起 n.eko、Xvfb、Chromium。
2. `/tmp/oneceo/debug-browser/neko-static` 存在并被 n.eko 使用。
3. `/opt/neko/client/dist` 在运行时保持不变，不需要普通用户写权限。
4. `debug_open_page` 打开的页面能在用户调试页实时看到。
5. `browser_interact` 控制的页面和用户调试页看到的是同一页面。
6. 失败时能在 metadata 和 Action 中看到具体 reasonCode 与日志摘要。
7. Altus 不再通过 shell 反复尝试启动/杀掉 Chromium 或 n.eko。
8. 视觉检测失败不会因为同一调试浏览器启动错误而直接丢失根因。
9. sandbox 内存在可读 manifest、pid、日志和诊断脚本，能在不看平台源码的情况下判断 n.eko/CDP/display/process 哪一层失败。
10. 重启调试浏览器不会误杀非 oneceo debug-browser 管理的浏览器进程。
11. 模型可见输出不会泄露完整调试 URL、TURN credential、OSAC token、cookie 或连接器密钥。
12. `debug_open_page` 失败时返回 `failureLayer + reasonCode + nextAction`，足以判断是修用户项目、修预览服务、刷新调试浏览器，还是标记平台/template 异常。

## 14. 与既有文档的关系

1. `20260411_调试工具化与n_eko页面控制链路方案_[20260411-2310已采用].md` 定义了 `debug_open_page` / `browser_interact` 的工具化方向，本方案继承该方向，并补齐浏览器平台能力启动与存储边界。
2. `20260412_Issue41_n_eko连接中_ICE失败修复方案_[20260412-1910已采用].md` 处理 TURN/ICE，本方案继续要求远程调试页必须通过 TURN/ICE 诊断。
3. `20260524_Altus预览服务托管与调试启动闭环方案_[20260524-1743已采用].md` 处理用户项目预览服务生命周期，本方案只处理调试浏览器生命周期。
4. 若本方案被采用，应把上述文档中“调试浏览器启动”的运行时细节统一指向本文，避免后续继续把 `/opt/neko/client/dist` 当运行时可写目录。

## 15. 当前状态

本文档为待评审方案，状态为 `[尚未采用]`。用户确认采用后，才能进入代码实现，并将标题与文件名状态更新为 `[yyyymmdd-hhmm已采用]`。
