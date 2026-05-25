# opencode-playwright-mcp-deploy-stable

该模板基于 `opencode-playwright-mcp`，用于部署稳定性场景：

- 固定 Node 版本（`20.19.5`）和 `pnpm`（`9.12.3`），避免运行时出现 `vite/node` 兼容漂移。
- 保留 Browser Use、Playwright、`@playwright/mcp` 与 Chromium 预装能力。
- 保留 OSAC 与 n.eko UI 最小化补丁构建流程。
- 浏览器工具链默认固定为 `n.eko=v3.1.4`、`playwright=1.60.0`、`@playwright/mcp=0.0.75`、`browser-use=0.12.8`。

`/opt/neko/client/dist` 是模板构建产物和运行时只读源目录；平台调试浏览器运行时只允许复制到 `/tmp/oneceo/debug-browser/neko-static` 后修改副本。

## 构建

需要本机已安装并登录 `e2b` CLI：

```bash
pnpm --filter api exec -- tsx ../../e2b_templates/opencode-playwright-mcp-deploy-stable/build.ts
```

构建成功后模板名默认：`opencode-browseruse-playwright-mcp-stable`。

可选环境变量：

- `E2B_TEMPLATE_NAME`：自定义模板名。
- `NEKO_UI_PATCH_URL`：直接指定补丁下载地址（跳过自动上传）。
- `NEKO_UI_PATCH_PATH`：本地补丁路径（默认复用旧模板 patch）。
- `NEKO_UI_PATCH_KEY`：上传到 R2 的对象 Key（默认 `neko-ui/neko-client-minimal.patch`）。
- `NEKO_UI_PATCH_EXPIRES`：补丁签名 URL 过期秒数（默认 7 天）。
- `ONECEO_TEMPLATE_NEKO_VERSION`：覆盖默认 n.eko tag。
- `ONECEO_TEMPLATE_PLAYWRIGHT_VERSION`：覆盖默认 Playwright npm 版本。
- `ONECEO_TEMPLATE_PLAYWRIGHT_MCP_VERSION`：覆盖默认 `@playwright/mcp` npm 版本。
- `ONECEO_TEMPLATE_BROWSER_USE_VERSION`：覆盖默认 Browser Use PyPI 版本。

## 使用

在运行时设置环境变量：

```
E2B_TEMPLATE=opencode-browseruse-playwright-mcp-stable
```
