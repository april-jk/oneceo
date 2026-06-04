<div align="center">

# oneceo

<p>
  <strong>围绕“任务塔台”模型构建的 AI 任务编排与治理平台。</strong>
</p>

<p>
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a>
</p>

<p>
  <img src="apps/web/client/public/logo-mark.png" alt="oneceo 标志" width="120">
</p>

<p>
  <img alt="License" src="https://img.shields.io/badge/license-MIT-0f172a?style=for-the-badge">
  <img alt="Node.js" src="https://img.shields.io/badge/node-%3E%3D18-2563eb?style=for-the-badge&logo=node.js&logoColor=white">
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-10.4.1+-f59e0b?style=for-the-badge&logo=pnpm&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-first-3178c6?style=for-the-badge&logo=typescript&logoColor=white">
  <img alt="Monorepo" src="https://img.shields.io/badge/workspace-monorepo-111827?style=for-the-badge">
  <img alt="Runtime" src="https://img.shields.io/badge/runtime-E2B%20%2B%20OSAC-059669?style=for-the-badge">
</p>

<p>
  <img alt="AI Agents" src="https://img.shields.io/badge/AI%20Agents-task%20sessions-1d4ed8?style=flat-square">
  <img alt="Admin Console" src="https://img.shields.io/badge/Admin-console-7c3aed?style=flat-square">
  <img alt="Orchestration API" src="https://img.shields.io/badge/API-orchestration-0f766e?style=flat-square">
  <img alt="Sandbox" src="https://img.shields.io/badge/Sandbox-lifecycle-ca8a04?style=flat-square">
  <img alt="Deployments" src="https://img.shields.io/badge/Deployments-managed-9f1239?style=flat-square">
</p>

</div>

oneceo 是一个面向团队协作的 AI Agent 平台，不只是一个聊天界面。它把用户工作台、编排 API、管理后台、文档站，以及基于 E2B 的运行时基础设施组合在一起，让 Agent 工作流可以被创建、追踪、治理、恢复和审计，而不是停留在黑盒状态。

## 目录

- [项目定位](#项目定位)
- [GitHub 项目速览](#github-项目速览)
- [仓库结构](#仓库结构)
- [界面截图](#界面截图)
- [快速开始](#快速开始)
- [最小环境配置](#最小环境配置)
- [安全示例 env](#安全示例-env)
- [这些密钥从哪里来](#这些密钥从哪里来)
- [运行方式](#运行方式)
- [验证命令](#验证命令)
- [架构说明](#架构说明)
- [品牌资源](#品牌资源)
- [文档索引](#文档索引)
- [贡献与支持](#贡献与支持)
- [许可证](#许可证)

## 项目定位

很多团队在使用 AI Agent 时，实际需要同时具备下面几层能力：

- 一个能把任务、对话、预览和交付物串起来的用户工作台
- 一个能处理长生命周期任务会话的后端编排层，而不是只收单轮 prompt
- 一个给平台管理员使用的治理、追踪、部署和恢复后台
- 一套可观测、可恢复、可复用的运行时基础设施

oneceo 就是按这个完整栈来设计的。

## GitHub 项目速览

### 核心能力

- 持久化任务会话编排，而不是单轮聊天
- 通过 API 路由的 E2B 执行环境
- 包含 Composio 托管连接器在内的连接器能力
- 请求、工具调用和运行时状态的审计与追踪可视化
- 用户端与管理端分离
- 部署与环境管理工作流
- 面向 Sandbox 执行链路的归档与恢复能力

### 技术画像

- 前端界面：用户工作台、管理后台、文档或博客站点
- 后端能力：任务编排 API、连接器、会话控制、归档与恢复服务
- 运行时：通过 OSAC 协调 E2B Sandbox
- 工作区形态：pnpm monorepo，`apps/admin_management` 额外维护独立 `npm` 依赖树

### 推荐 GitHub Topics

`ai-agents` `task-orchestration` `agent-platform` `admin-console` `sandbox-runtime` `e2b` `typescript` `monorepo`

## 仓库结构

- `apps/web`：面向终端用户的工作台，负责任务创建、对话、预览、交付和部署流程
- `apps/api`：编排 API，负责任务会话、Altus 托管流程、连接器、OSAC、归档和 Sandbox 生命周期
- `apps/admin_management`：面向平台管理员的后台，用于治理、追踪、部署、连接器和运行时可见性
- `apps/blog`：文档或博客站点
- `packages/shared`：共享类型与工具
- `services/*`：工作区内的其他服务包
- `e2b_templates`：E2B Sandbox 模板
- `docs`：架构、测试、协作流程和功能设计文档

## 界面截图

### 1. 用户工作台首页

![用户工作台首页](docs/readme-assets/user-workspace-home.png)

### 2. 对话进行中

![对话进行中](docs/readme-assets/dialogue-in-progress.png)

### 3. 侧边栏操作

![侧边栏操作](docs/readme-assets/sidebar-actions.png)

### 4. 侧边栏远程调试

![侧边栏远程调试](docs/readme-assets/sidebar-remote-debug.png)

### 5. 侧边栏部署视图

![侧边栏部署视图](docs/readme-assets/sidebar-deployment.png)

## 快速开始

### 环境要求

- Node.js `18+`，推荐 `20+`
- pnpm `10.4.1+`
- npm `10+`
- PostgreSQL
- Redis 只有在显式设置 `ONECEO_REDIS_ENABLED=true` 时才启用

### 安装

```bash
git clone https://github.com/april-jk/oneceo.git
cd oneceo
pnpm install --frozen-lockfile
npm --prefix apps/admin_management install
cp apps/.env.example apps/.env
```

`apps/admin_management` 当前仍维护独立的 `npm` 依赖树，所以这一步安装是必需的。

## 最小环境配置

规范模板是 `apps/.env.example`。

注意事项：

- 仓库跟踪的模板中使用了 `__REDACTED__`、`__SET_ME__` 这类脱敏占位符。
- 复制为本地 `apps/.env` 后，需要替换成你自己的值。
- 不要提交真实密钥或已填充的敏感配置。

### 本地最小启动必填项

如果你的目标是“克隆 -> 安装 -> 本地启动”，优先填写下面这些值：

| 变量 | 作用 | 示例 |
| --- | --- | --- |
| `PORT` | API 端口 | `4000` |
| `FRONTEND_URL` | Web 源地址与回调基准 | `http://localhost:3000` |
| `ONECEO_API_PUBLIC_URL` | 浏览器侧公共 API 地址 | `http://localhost:3000` |
| `DATABASE_URL` | API 持久化数据库 | `postgresql://postgres:postgres@127.0.0.1:5432/oneceo?sslmode=disable` |
| `DATABASE_SSL` | 本地数据库模式 | `disable` |
| `VITE_API_BASE_URL` | 浏览器访问 API 地址 | `http://127.0.0.1:4000` |
| `WEB_BFF_API_TARGET` | Web 开发代理目标 | `http://localhost:4000` |
| `ONECEO_INTERNAL_TOKEN` | 服务之间共享内部鉴权 | `replace-with-a-long-random-string` |
| `CONNECTOR_SECRET_KEY` | 连接器密钥加密 | `replace-with-a-second-random-string` |
| `OPENAI_API_KEY` | 上游模型访问密钥 | `sk-your-provider-key` |
| `OPENAI_BASE_URL` | OpenAI 兼容端点 | `https://api.openai.com/v1` |
| `LLM_PROXY_UPSTREAM_API_KEY` | API 侧 LLM 代理密钥 | `sk-your-provider-key` |
| `LLM_PROXY_UPSTREAM_BASE_URL` | API 侧 LLM 代理端点 | `https://api.openai.com/v1` |
| `LLM_PROXY_UPSTREAM_API_TYPE` | 上游协议类型 | `openai` |

### 真正跑通 Sandbox 执行链路必填项

没有这些值，界面可以启动，但主执行链路不能完整跑通：

| 变量 | 作用 | 示例 |
| --- | --- | --- |
| `E2B_API_KEY` | 启动真实 E2B Sandbox | `e2b_your_api_key` |
| `OSAC_EXECUTION_ENABLED` | 主执行链路开关 | `true` |
| `OSAC_EXECUTION_MODE` | Sandbox 执行模式 | `opencode_remote` |

### 托管连接器必填项

| 变量 | 作用 | 示例 |
| --- | --- | --- |
| `COMPOSIO_API_KEY` | Composio 托管连接器 | `cmp_your_api_key` |
| `COMPOSIO_OAUTH_CALLBACK_BASE_URL` | OAuth 回调基础地址 | `http://localhost:3000` |

### Sandbox 归档与恢复必填项

| 变量 | 作用 | 示例 |
| --- | --- | --- |
| `R2_BUCKET_NAME` | 归档桶名称 | `oneceo-sandbox-storage` |
| `R2_ACCOUNT_ID` | Cloudflare 账号 ID | `your-account-id` |
| `R2_ENDPOINT` | 桶端点 | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | R2 Access Key | `your-r2-access-key` |
| `R2_SECRET_ACCESS_KEY` | R2 Secret Key | `your-r2-secret-key` |

### 仅托管部署流程需要的配置

| 变量 | 作用 |
| --- | --- |
| `RAILWAY_ADMIN_TOKEN` | Railway 部署自动化 |
| `RAILWAY_WORKSPACE_ID` | Railway 工作区选择 |
| `GITHUB_DEPLOYMENT_APP_ID` | 基于 GitHub App 的部署仓库自动化 |
| `GITHUB_DEPLOYMENT_INSTALLATION_ID` | GitHub App 安装绑定 |
| `GITHUB_DEPLOYMENT_APP_PRIVATE_KEY` | GitHub App 鉴权 |

## 安全示例 env

下面只是本地占位示例。请在你自己的未跟踪 `apps/.env` 中替换为真实值。

```env
PORT=4000
FRONTEND_URL=http://localhost:3000
ONECEO_API_PUBLIC_URL=http://localhost:3000

DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/oneceo?sslmode=disable
DATABASE_SSL=disable

ONECEO_REDIS_ENABLED=false
REDIS_URL=

VITE_API_BASE_URL=http://127.0.0.1:4000
VITE_RUNTIME_ENV=dev
WEB_BFF_API_TARGET=http://localhost:4000

ONECEO_INTERNAL_TOKEN=replace-with-a-long-random-string
CONNECTOR_SECRET_KEY=replace-with-a-second-long-random-string

OPENAI_API_KEY=sk-your-provider-key
OPENAI_BASE_URL=https://api.openai.com/v1
LLM_PROXY_UPSTREAM_API_KEY=sk-your-provider-key
LLM_PROXY_UPSTREAM_BASE_URL=https://api.openai.com/v1
LLM_PROXY_UPSTREAM_API_TYPE=openai

E2B_API_KEY=e2b_your_api_key
OSAC_EXECUTION_ENABLED=true
OSAC_EXECUTION_MODE=opencode_remote

COMPOSIO_API_KEY=cmp_your_api_key
COMPOSIO_OAUTH_CALLBACK_BASE_URL=http://localhost:3000

R2_BUCKET_NAME=your-r2-bucket
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
```

## 这些密钥从哪里来

### E2B

- 在 E2B 控制台创建账号。
- 生成 workspace API key。
- 填入 `E2B_API_KEY`。
- 如果你要用归档或恢复能力，还需要配置 R2 相关变量。

相关文档：

- [docs/AGENTS_GUIDE/03_sandbox_e2b.md](docs/AGENTS_GUIDE/03_sandbox_e2b.md)
- [apps/api/src/connectors/e2b-connector.ts](apps/api/src/connectors/e2b-connector.ts)

### Composio

- 在 Composio 控制台创建项目和 API key。
- 把 key 填到 `COMPOSIO_API_KEY`。
- `COMPOSIO_OAUTH_CALLBACK_BASE_URL` 需要设置成用户实际打开的前端地址。
- 本地开发通常是 `http://localhost:3000`。

相关文档：

- [docs/features/connectors/composio_oauth_callback_env_control_doc_[20260503-1127已采用].md](docs/features/connectors/composio_oauth_callback_env_control_doc_[20260503-1127已采用].md)

### OpenAI 兼容提供方

- 使用你自己的上游提供方密钥。
- 如果希望浏览器侧和 API 侧行为一致，两侧都要配。
- 如果不是原生 OpenAI 协议，记得调整 `LLM_PROXY_UPSTREAM_API_TYPE`。

### Cloudflare R2

- 创建一个 R2 bucket。
- 生成作用域受限的 access key。
- 填写 `R2_BUCKET_NAME`、`R2_ACCOUNT_ID`、`R2_ENDPOINT`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`。

## 运行方式

### API

```bash
pnpm dev:api
```

### 用户工作台

```bash
pnpm dev:web
```

### 文档或博客站点

```bash
pnpm dev:blog
```

### 管理后台

```bash
npm --prefix apps/admin_management run dev
```

### 便捷命令

下面这条命令会同时启动 Web 和 API：

```bash
pnpm dev
```

## 验证命令

如果你在做开源可用性检查，或者验证 fresh clone 的基本可运行性，可以先跑这些：

```bash
pnpm --filter api type-check
pnpm --filter web check
npm --prefix apps/admin_management run type-check
```

其他常用命令：

```bash
pnpm build
pnpm type-check
pnpm test
```

## 架构说明

- `apps/api` 是任务会话、Altus 托管流程、连接器、OSAC、归档恢复和 Sandbox 生命周期的主入口。
- `apps/web` 是终端用户主产品界面。
- `apps/admin_management` 是平台运营和治理界面。
- `apps/api/src/connectors/e2b-connector.ts` 是强制要求的 E2B 主链入口。
- `apps/api/src/connectors/llm-proxy-connector.ts` 是强制要求的上游模型访问入口。
- 用户身份与管理员身份的隔离是系统边界的一部分，不只是界面层约定。

## 品牌资源

当前运行时入口使用的是 PNG 资源：

- `apps/web/client/public/logo.png`
- `apps/web/client/public/logo-dark.png`
- `apps/web/client/public/logo-mark.png`
- `apps/web/client/public/favicon.png`
- `apps/admin_management/web/public/favicon.png`
- `apps/blog/public/og-default.png`

仓库中可能还保留 SVG 试验文件，但 Web 入口和元数据当前引用的是 PNG 资源。

## 文档索引

如果你想快速建立对仓库协作上下文、架构约束和 Agent 工作流的理解，可以从这里开始：

- [AGENTS.md](AGENTS.md)
- [PRODUCT.md](PRODUCT.md)
- [DESIGN.md](DESIGN.md)
- [docs/AGENTS_GUIDE/PROJECT_PROMPT.md](docs/AGENTS_GUIDE/PROJECT_PROMPT.md)
- [docs/AGENTS_GUIDE/01_overview.md](docs/AGENTS_GUIDE/01_overview.md)
- [docs/AGENTS_GUIDE/02_services.md](docs/AGENTS_GUIDE/02_services.md)
- [docs/AGENTS_GUIDE/03_sandbox_e2b.md](docs/AGENTS_GUIDE/03_sandbox_e2b.md)
- [docs/AGENTS_GUIDE/04_agent_flow.md](docs/AGENTS_GUIDE/04_agent_flow.md)
- [docs/AGENTS_GUIDE/05_系统调试与测试指南.md](docs/AGENTS_GUIDE/05_系统调试与测试指南.md)
- [docs/AGENTS_GUIDE/06_分支与部署环境简要规范.md](docs/AGENTS_GUIDE/06_分支与部署环境简要规范.md)
- [docs/AGENTS_GUIDE/AGENT_CODE_MODIFICATION_GUIDE.md](docs/AGENTS_GUIDE/AGENT_CODE_MODIFICATION_GUIDE.md)
- [docs/AGENTS_GUIDE/AGENTS_git操作与提交指南.md](docs/AGENTS_GUIDE/AGENTS_git操作与提交指南.md)
- [docs/AGENTS_GUIDE/AGENTS_git协作开发指南.md](docs/AGENTS_GUIDE/AGENTS_git协作开发指南.md)

## 贡献与支持

- 贡献指南：[CONTRIBUTING.md](CONTRIBUTING.md)
- 行为准则：[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- 安全问题反馈：[SECURITY.md](SECURITY.md)
- 支持说明：[SUPPORT.md](SUPPORT.md)

## 许可证

本仓库基于 MIT 协议发布，详见 [LICENSE](LICENSE)。
