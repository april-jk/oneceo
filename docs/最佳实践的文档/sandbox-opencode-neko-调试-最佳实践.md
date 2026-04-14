# E2B Sandbox 内集成 n.eko + Chromium 远程调试（最佳实践）

## 目标
在单个 E2B sandbox 内启动 Xvfb + Chromium + n.eko，提供浏览器视频流，并在 oneceo 的“内容预览 → 调试”中内嵌访问。

## 适用范围
- E2B `opencode` 模板 sandbox
- 需要在 sandbox 内可视化浏览器调试（视频流）

## 核心思路
1. 在 sandbox 内启动 Xvfb 虚拟屏幕（:0）。
2. 启动 Chromium 指向该 display，并开启 CDP 端口（9222）。
3. 构建 n.eko Web Client（Vue）并配置 `server.static`，保证 UI 可访问。
4. 启动 n.eko 服务器输出 WebRTC 视频流（默认 8081）。
5. 将 n.eko 的公开访问 URL 写入 sandbox 环境元数据。
6. 前端通过 `/api/task-creation/sessions/:sessionId/debug` 拉取调试 URL，并在预览面板内嵌 iframe。

## 2026-04 链路修复结论（连接中）

- 现象：调试页持续显示“连接中”，n.eko HTTP 页面可打开但无画面。
- 根因：WebRTC 处于 `epr` 端口段模式时，ICE 无法形成 candidate pair，日志持续出现 `Failed to ping without candidate pairs`，最终 `ICE failed`。
- 直接修复策略：E2B 场景默认改为 **mux 优先**（`tcpmux`/`udpmux`），默认禁用 `epr`；仅在显式配置时才启用 `epr`。
- 防回归要求：调试启动逻辑必须将 `webrtc mode`、`mux/epr`、`nat` 等关键配置纳入版本/刷新判定，配置改变后强制重启 n.eko，避免旧坏配置持续复用。

## 2026-04 调试页交互优化（声音与锁定提示）

- 调试 iframe URL 改为显式携带 `volume=0` + `mute=1` + `mute_chat=1`，用于默认静音，避免连接后出现提示音/媒体音。
- 不再强制 `embed=1`，避免 embed 模式下 `mute_chat` 初始化逻辑失效导致提示音残留。
- 调试 iframe 保留 `autoplay` 权限，避免浏览器在无交互场景下抛出 `NotAllowedError: play() failed` 并中断画面播放流程。
- 保持默认锁定行为不变（符合远程控制安全预期），仅在“鼠标进入调试画面且当前处于锁定态”时显示中心大号半透明锁提示。
- 锁状态统一以 n.eko 原生 `remote.locked` 为单一真值源：iframe 内右上角按钮与 oneceo 外部“锁定/已解锁”按钮通过 `postMessage` 双向同步（`oneceo-debug-lock:set` / `oneceo-neko-lock`），避免出现本地 `uiLocked` 与 n.eko 状态漂移。
- oneceo 调试页锁按钮仅发送锁定/解锁意图，不在父层本地直接改锁状态；最终状态必须以 n.eko 回传结果为准。
- 锁控链路强制单路径：移除 `/debug/lock-state` 读写控制接口，锁定/解锁仅允许走 iframe `postMessage` 桥接链路。
- 增加桥接握手门禁：iframe 需主动上报锁状态桥接消息（`oneceo-neko-lock`，可扩展 `oneceo-neko-ready`），父层在握手前禁用锁按钮并给出“旧模板 sandbox”提示，避免按钮点击静默失效。

## 2026-04 模板切换与工作区恢复（防空工作区）

- 当老会话因模板不一致触发“新 sandbox”时，必须先对旧 sandbox 执行强制归档（`template_migration`），拿到快照 key，并在新 sandbox 稳定后关闭旧 sandbox。
- 新 sandbox 创建后恢复时优先使用该快照 key 定向恢复，不可仅依赖泛化候选 key。
- 若处于模板迁移链路且恢复失败，必须直接报错中断，禁止继续进入空工作区执行。
- 任务会话去重关闭旧 sandbox 时，应走 `closeEnvironment` 生命周期（包含归档），避免直接 `killSandbox` 跳过归档导致恢复源缺失。

## 实施步骤（单沙箱验证）

### 1) 运行临时脚本（本地）
脚本路径：`oneceo/apps/api/scripts/_tmp_neko_debug_setup.ts`

```bash
cd oneceo/apps/api
pnpm dlx tsx scripts/_tmp_neko_debug_setup.ts
```

脚本会完成：
- 创建一个临时 Task Session
- 创建并绑定 sandbox
- 安装依赖（Xvfb / Chromium / GStreamer / n.eko 编译依赖）
- 拉取 n.eko 源码并构建前端（`/tmp/neko-src/client/dist`）
- 写入 `/opt/neko/neko.yml` 并设置 `server.static`
- 启动 Xvfb + Chromium + n.eko
- 更新环境元数据 `metadata.debug.neko`

控制台输出示例：
```
[debug] taskSessionId= session_xxx
[debug] sandboxId= <sandboxId>
[debug] nekoUrl= https://8081-<sandboxId>.e2b.app
```

### 2) 校验调试接口
确保 API 服务运行后，请求：
```
GET /api/task-creation/sessions/<taskSessionId>/debug
```
成功时返回：
```
{
  "success": true,
  "data": {
    "ready": true,
    "url": "https://8081-<sandboxId>.e2b.app",
    "status": "ready",
    "sandboxId": "<sandboxId>",
    "updatedAt": "..."
  }
}
```

### 3) 前端调试面板
- 位置：内容预览 → 调试
- 逻辑：读取 `/sessions/:id/debug` 的 `url` 并内嵌 iframe。

## 关键配置
- n.eko 端口：`NEKO_PORT`（默认 8081）
- Chromium CDP 端口：`NEKO_CDP_PORT`（默认 9222）
- Xvfb Display：`NEKO_DISPLAY`（默认 `:0`）
- `NEKO_WEBRTC_FORCE_MUX`：默认 `true`（推荐，E2B 场景优先）。
- `NEKO_WEBRTC_TCPMUX`：默认 `8082`。
- `NEKO_WEBRTC_UDPMUX`：默认 `0`（可按需开启）。
- `NEKO_WEBRTC_EPR`：默认 `0`（禁用；仅明确需要时再启用端口段）。
- `NEKO_AUTO_NAT1TO1`：默认 `false`（仅在确认需要时开启）。

## 注意事项
- n.eko 没有可用的 Linux release asset，需 **从源码编译**。
- Go 版本要求较新，脚本默认安装 `go1.24.5`。
- 若在 sandbox 中遇到 `libxcvt/libxcvt.h` 缺失，请安装 `libxcvt-dev`。
- n.eko Web UI 必须通过 `server.static` 指向构建产物（如 `/tmp/neko-src/client/dist`），否则访问 `https://8081-<sandboxId>.e2b.app` 会返回 404。
- 本次验证默认关闭 `desktop.input.enabled`，避免缺少 `xf86-input-neko` 驱动导致服务崩溃；如需可交互控制，需要补齐 Xorg + `xf86-input-neko` 驱动配置。
- 当前脚本为 **单沙箱验证用途**，后续可转为模板化或自动化启动。

## 后续可扩展
- 在 sandbox 启动流程中内置 n.eko start cmd
- 为调试链接增加访问鉴权（如 token gate）
- 接入 Playwright 驱动 Chromium，提供自动化 UI 测试
