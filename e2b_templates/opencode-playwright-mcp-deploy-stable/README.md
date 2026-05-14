# opencode-playwright-mcp-deploy-stable

该模板基于 `opencode-playwright-mcp`，用于部署稳定性场景：

- 固定 Node 版本（`20.19.5`）和 `pnpm`（`9.12.3`），避免运行时出现 `vite/node` 兼容漂移。
- 保留 Browser Use、Playwright、`@playwright/mcp` 与 Chromium 预装能力。
- 保留 OSAC 与 n.eko UI 最小化补丁构建流程。

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

## 使用

在运行时设置环境变量：

```
E2B_TEMPLATE=opencode-browseruse-playwright-mcp-stable
```
