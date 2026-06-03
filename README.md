# OneCEO

OneCEO 是一个面向 AI 项目执行与平台治理的多应用仓库。当前仓库包含用户工作台、API 编排层、管理后台、博客站点，以及围绕 E2B / OSAC / Altus 的运行时与文档资产。

仓库现在采用 MIT 许可证，并准备按开源仓库方式持续整理；如果你是第一次进入项目，先从本文的环境、启动和验证命令开始。

## Workspace Layout

```text
oneceo/
├── apps/
│   ├── api/                # API、任务会话、Altus、OSAC、Sandbox 主编排
│   ├── web/                # 用户工作台（React + Vite）
│   ├── admin_management/   # 管理后台（独立 server + web）
│   └── blog/               # 文档/博客站点（Astro）
├── packages/
│   └── shared/             # 共享类型与工具
├── services/
│   └── kvm-orchestrator/   # 历史/附属服务代码
├── e2b_templates/          # Sandbox 模板与说明
├── docs/                   # 架构、功能、测试与部署文档
└── .github/workflows/      # CI / 安全 / Pages 工作流
```

## Requirements

- Node.js 20+
- pnpm 10.4.1+
- npm 10+

可选但常见的本地依赖：

- PostgreSQL
- Redis

## Install

```bash
git clone https://github.com/april-jk/oneceo.git
cd oneceo
pnpm install --frozen-lockfile
npm --prefix apps/admin_management install
```

`apps/admin_management` 目前使用独立 `npm` 依赖树；其类型检查与开发命令需要先完成本目录安装。

## Environment

主应用环境变量模板在 [apps/.env.example](/Users/watson/codingProj/oneceo/apps/.env.example)。

推荐本地启动方式：

1. 复制主模板并填入你自己的值。
2. 如需本地管理后台，再单独配置 `apps/admin_management/.env`。

```bash
cp apps/.env.example apps/.env
cp apps/.env.example apps/.env.localhost
```

常见变量：

- `FRONTEND_URL`
- `VITE_API_BASE_URL`
- `DATABASE_URL`
- `ONECEO_REDIS_ENABLED`
- `REDIS_URL`
- `OPENAI_API_KEY`
- `E2B_API_KEY`

注意：

- 不要提交真实 `.env` 文件或任何第三方密钥。
- 浏览器侧配置不要写 `railway.internal` 之类的内网地址。
- 管理后台本地代理配置位于 [apps/admin_management/.env](/Users/watson/codingProj/oneceo/apps/admin_management/.env)。

## Development

根工作区常用命令：

```bash
pnpm dev:web
pnpm dev:api
pnpm dev:blog
```

管理后台单独启动：

```bash
npm --prefix apps/admin_management run dev
```

如果你只想跑某个应用，优先在对应目录或通过 `--filter` / `--prefix` 执行，不必一次拉起全部进程。

## Verification

最小静态验证命令：

```bash
pnpm --filter api type-check
pnpm --filter web check
npm --prefix apps/admin_management run type-check
```

全仓库常用命令：

```bash
pnpm build
pnpm type-check
pnpm test
```

说明：

- `pnpm type-check` 会递归执行 workspace 内定义了 `type-check` 的包。
- `apps/admin_management` 目前不在 `pnpm` workspace 内统一安装依赖，因此继续使用 `npm --prefix ...`。

## Architecture Notes

- `apps/api` 是任务会话、Altus managed、OSAC、Sandbox 生命周期与 LLM proxy 的主入口。
- `apps/web` 是用户工作台。
- `apps/admin_management` 是平台管理员控制台。
- `apps/api/src/connectors/e2b-connector.ts` 是主链 E2B 连接入口。
- `apps/api/src/connectors/llm-proxy-connector.ts` 是统一上游模型访问入口。

更细的开发入口见：

- [AGENTS.md](/Users/watson/codingProj/oneceo/AGENTS.md)
- [docs/AGENTS_GUIDE/PROJECT_PROMPT.md](/Users/watson/codingProj/oneceo/docs/AGENTS_GUIDE/PROJECT_PROMPT.md)
- [docs/AGENTS_GUIDE/AGENT_CODE_MODIFICATION_GUIDE.md](/Users/watson/codingProj/oneceo/docs/AGENTS_GUIDE/AGENT_CODE_MODIFICATION_GUIDE.md)

## OSS Collaboration

- 贡献流程见 [CONTRIBUTING.md](/Users/watson/codingProj/oneceo/CONTRIBUTING.md)
- 行为准则见 [CODE_OF_CONDUCT.md](/Users/watson/codingProj/oneceo/CODE_OF_CONDUCT.md)
- 安全问题上报见 [SECURITY.md](/Users/watson/codingProj/oneceo/SECURITY.md)
- 支持与提问入口见 [SUPPORT.md](/Users/watson/codingProj/oneceo/SUPPORT.md)

## License

本项目采用 MIT 许可证，详见 [LICENSE](/Users/watson/codingProj/oneceo/LICENSE)。
