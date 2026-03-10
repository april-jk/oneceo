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
4. 启动 n.eko 服务器输出 WebRTC 视频流（默认 8080）。
5. 将 n.eko 的公开访问 URL 写入 sandbox 环境元数据。
6. 前端通过 `/api/task-creation/sessions/:sessionId/debug` 拉取调试 URL，并在预览面板内嵌 iframe。

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
[debug] nekoUrl= https://8080-<sandboxId>.e2b.app
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
    "url": "https://8080-<sandboxId>.e2b.app",
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
- n.eko 端口：`NEKO_PORT`（默认 8080）
- Chromium CDP 端口：`NEKO_CDP_PORT`（默认 9222）
- Xvfb Display：`NEKO_DISPLAY`（默认 `:0`）

## 注意事项
- n.eko 没有可用的 Linux release asset，需 **从源码编译**。
- Go 版本要求较新，脚本默认安装 `go1.24.5`。
- 若在 sandbox 中遇到 `libxcvt/libxcvt.h` 缺失，请安装 `libxcvt-dev`。
- n.eko Web UI 必须通过 `server.static` 指向构建产物（如 `/tmp/neko-src/client/dist`），否则访问 `https://8080-<sandboxId>.e2b.app` 会返回 404。
- 本次验证默认关闭 `desktop.input.enabled`，避免缺少 `xf86-input-neko` 驱动导致服务崩溃；如需可交互控制，需要补齐 Xorg + `xf86-input-neko` 驱动配置。
- 当前脚本为 **单沙箱验证用途**，后续可转为模板化或自动化启动。

## 后续可扩展
- 在 sandbox 启动流程中内置 n.eko start cmd
- 为调试链接增加访问鉴权（如 token gate）
- 接入 Playwright 驱动 Chromium，提供自动化 UI 测试
