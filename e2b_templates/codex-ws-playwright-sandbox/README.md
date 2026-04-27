# codex-ws-playwright-sandbox

该模板基于 `codex`，预装 Browser Use CLI、Playwright 与 `@playwright/mcp`，并预创建 `~/.codex/` 目录，供 oneceo 在 `codex -> ws模式` 下启动 sandbox 后直接写入：

- `~/.codex/config.toml`
- `~/.codex/auth.json`

模板本身不内置用户级 API Key 或模型配置。用户级配置由 oneceo 在 sandbox provision 阶段写入。

默认工具边界：

- 调试、测试、回归验证、截图验收和本地应用检查默认使用 Playwright / `playwright-mcp`。
- Playwright 必须连接到 n.eko 正在回传的同一个 Chromium CDP 端口（默认 `http://127.0.0.1:9222`），不要启动独立浏览器。
- `browser-use` 仅作为外部网站探索、导航和表单交互的辅助能力；需要复用调试浏览器时必须显式连接同一个 CDP。

## 构建

需要本机已安装并登录 `e2b` CLI：

```bash
pnpm --filter api exec -- tsx ../../e2b_templates/codex-ws-playwright-sandbox/build.ts
```

构建成功后模板名默认：

```text
codex-ws-browseruse-playwright-sandbox-v1-20260426
```

可选环境变量：

- `E2B_CODEX_WS_TEMPLATE`
- `E2B_TEMPLATE_CODEX_WS`
- `E2B_TEMPLATE_NAME`

## 使用

在 oneceo 中：

1. 选择 `设置 -> 模型设置 -> sandbox直通 -> executor = codex`
2. 切到 `ws模式`
3. 新会话会命中该模板
