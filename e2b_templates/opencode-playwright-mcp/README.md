# opencode-playwright-mcp

该模板基于 `opencode`，预装 Playwright 及 `@playwright/mcp`，并提前下载 Chromium 浏览器，避免运行期安装耗时。构建时会自动从 R2 拉取 n.eko UI 最小化补丁并应用。

## 构建

需要本机已安装并登录 `e2b` CLI：

```bash
pnpm --filter api exec -- tsx ../../e2b_templates/opencode-playwright-mcp/build.ts
```

构建成功后模板名默认：`opencode-playwright-mcp-v7-osac-prebuilt-20260421`。

可选环境变量：

- `E2B_TEMPLATE_NAME`：自定义模板名。
- `NEKO_UI_PATCH_URL`：直接指定补丁下载地址（跳过自动上传）。
- `NEKO_UI_PATCH_PATH`：本地补丁路径（默认 `patches/neko-client-minimal.patch`）。
- `NEKO_UI_PATCH_KEY`：上传到 R2 的对象 Key（默认 `neko-ui/neko-client-minimal.patch`）。
- `NEKO_UI_PATCH_EXPIRES`：补丁签名 URL 过期秒数（默认 7 天）。

## 使用

在运行时设置环境变量：

```
E2B_TEMPLATE=opencode-playwright-mcp-v7-osac-prebuilt-20260421
```
