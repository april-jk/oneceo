# sandbox-opencode-neko-UI最小化-最佳实践

## 目标
在 E2B 模板构建阶段对 n.eko 客户端 UI 做最小化裁剪，仅保留：
- 交互功能（鼠标/键盘操作）
- 锁定功能（防误触）
- 全屏功能

其余元素（logo、加载动画、冗余按钮、菜单栏、侧边栏等）全部移除，以提升用户态的观感与专注度。

## 核心思路
1. **不直接改 n.eko 上游仓库**，而是对其 UI 做补丁并在模板构建时应用。
2. **补丁存储在 R2**，构建时生成预签名 URL 自动拉取并 `git apply`。
3. **模板构建时即完成 UI 最小化**，确保新建 sandbox 开箱即用。

## 目录与文件
最小化方案的关键文件在：
- `oneceo/e2b_templates/opencode-playwright-mcp/patches/neko-client-minimal.patch`
- `oneceo/e2b_templates/opencode-playwright-mcp/template.ts`
- `oneceo/e2b_templates/opencode-playwright-mcp/build.ts`

## 关键修改点（补丁内容概览）
以下调整都在补丁中完成：

### `client/src/app.vue`
- 移除 header / room / side / about / notifications
- 仅保留视频区与连接层

### `client/src/components/connect.vue`
- 移除 logo / loading 动画
- 仅保留最小化连接状态文字与登录表单

### `client/src/components/video.vue`
- 移除顶部/底部菜单、emotes、分辨率/剪贴板组件
- 增加极简控制条：`锁定` / `全屏`
- 交互逻辑在 `uiLocked` 时禁用鼠标和键盘输入

## 构建流程
构建模板时会执行：
1. 克隆 n.eko 源码
2. 从 R2 拉取补丁
3. `git apply` 补丁
4. 编译 n.eko client
5. 生成最终模板镜像

构建命令：
```bash
pnpm --filter api exec -- tsx ../../e2b_templates/opencode-playwright-mcp/build.ts
```

默认模板名：
```
opencode-playwright-mcp-v4-neko-lockapi-20260413
```

## 环境变量（构建时）
- `E2B_TEMPLATE_NAME`：自定义模板名
- `NEKO_UI_PATCH_URL`：直接指定补丁下载地址（跳过自动上传）
- `NEKO_UI_PATCH_PATH`：本地补丁路径（默认 `patches/neko-client-minimal.patch`）
- `NEKO_UI_PATCH_KEY`：上传到 R2 的对象 Key（默认 `neko-ui/neko-client-minimal.patch`）
- `NEKO_UI_PATCH_EXPIRES`：预签名 URL 过期秒数（默认 7 天）

## 使用
后端默认模板配置：
`oneceo/apps/api/src/config/e2b-config.ts`
```ts
template: process.env.E2B_TEMPLATE || 'opencode-playwright-mcp-v4-neko-lockapi-20260413'
```

如需切回旧模板，仅需调整 `E2B_TEMPLATE`。

## 常见问题
### 1) 补丁无法应用
可能原因：n.eko 上游版本变更导致 patch 失效。  
处理方式：
- 重新生成补丁（重新基于最新 n.eko 版本做 UI 变更）
- 更新 `patches/neko-client-minimal.patch`

### 2) 构建时提示 R2 变量未配置
需要在 `.env` 中提供：
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_ENDPOINT`（可选）

### 3) UI 有回退或仍显示旧元素
确认模板是否更新为 `opencode-playwright-mcp-v4-neko-lockapi-20260413`，并确保新 sandbox 使用该模板。
