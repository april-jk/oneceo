<div align="center">

# oneceo

<p>
  <strong>AI task orchestration and governance platform built around a task command center model.</strong>
</p>

<p>
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a>
</p>

<p>
  <img src="apps/web/client/public/logo-mark.png" alt="oneceo mark" width="120">
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

oneceo is an AI agent platform for teams that need more than a chat box. It combines a user-facing workspace, an orchestration API, an administrator console, a docs/blog site, and E2B-based runtime infrastructure so agent work can be created, inspected, governed, recovered, and audited instead of treated like a black box.

## Table of contents

- [Why oneceo](#why-oneceo)
- [GitHub at a glance](#github-at-a-glance)
- [Repository layout](#repository-layout)
- [Screenshots](#screenshots)
- [Quick start](#quick-start)
- [Minimum environment configuration](#minimum-environment-configuration)
- [Safe example .env](#safe-example-env)
- [Where to get the keys](#where-to-get-the-keys)
- [Running the apps](#running-the-apps)
- [Verification](#verification)
- [Architecture notes](#architecture-notes)
- [Brand assets](#brand-assets)
- [Documentation index](#documentation-index)
- [Contributing and support](#contributing-and-support)
- [License](#license)

## Why oneceo

Teams using AI agents usually need four things at the same time:

- A user workspace where tasks, chat, previews, and outputs stay connected
- A backend that can orchestrate long-running task sessions instead of one-off prompts
- Administrator tooling for governance, traces, deployments, and recoverability
- Runtime infrastructure that makes execution observable and repeatable

oneceo is designed around that stack.

## GitHub at a glance

### Core capabilities

- Persistent task-session orchestration instead of single-turn chat
- E2B-based execution environments routed through the API
- Connector flows, including Composio-hosted integrations
- Audit and trace visibility for requests, tools, and runtime state
- Separate user and administrator surfaces
- Deployment and environment management workflows
- Archive and recovery paths for sandbox-backed execution

### Tech profile

- Frontend surfaces: user workspace, admin console, docs/blog site
- Backend: orchestration API with connectors, session control, archive and recovery services
- Runtime: E2B sandboxes coordinated through OSAC
- Workspace style: pnpm monorepo with a standalone `npm` install for `apps/admin_management`

### Topics

`ai-agents` `task-orchestration` `agent-platform` `admin-console` `sandbox-runtime` `e2b` `typescript` `monorepo`

## Repository layout

- `apps/web`: end-user workspace for task creation, chat, previews, deliverables, and deployment flows
- `apps/api`: orchestration API for task sessions, Altus-managed flows, connectors, OSAC, archives, and sandbox lifecycle
- `apps/admin_management`: administrator console for governance, traces, deployments, connectors, and runtime visibility
- `apps/blog`: docs/blog site
- `packages/shared`: shared types and utilities
- `services/*`: extra service packages in the workspace
- `e2b_templates`: E2B sandbox templates
- `docs`: architecture, testing, workflow, and feature design documents

## Screenshots

### 1. User workspace home

![User workspace home](docs/readme-assets/user-workspace-home.png)

### 2. Dialogue in progress

![Dialogue in progress](docs/readme-assets/dialogue-in-progress.png)

### 3. Sidebar actions

![Sidebar actions](docs/readme-assets/sidebar-actions.png)

### 4. Sidebar remote debug

![Sidebar remote debug](docs/readme-assets/sidebar-remote-debug.png)

### 5. Sidebar deployment

![Sidebar deployment](docs/readme-assets/sidebar-deployment.png)

## Quick start

### Requirements

- Node.js `18+` minimum, `20+` recommended
- pnpm `10.4.1+`
- npm `10+`
- PostgreSQL
- Redis only if you explicitly enable it with `ONECEO_REDIS_ENABLED=true`

### Install

```bash
git clone https://github.com/april-jk/oneceo.git
cd oneceo
pnpm install --frozen-lockfile
npm --prefix apps/admin_management install
cp apps/.env.example apps/.env
```

`apps/admin_management` currently maintains its own `npm` dependency tree, so that install step is required.

## Minimum environment configuration

The canonical template is `apps/.env.example`.

Important:

- The tracked template contains redacted placeholders such as `__REDACTED__` and `__SET_ME__`.
- After copying it to `apps/.env`, replace those placeholders with your own local values.
- Never commit real keys or filled secrets.

### Required for a minimum local boot

These are the values you should set first if your goal is "clone -> install -> run local apps":

| Variable | Why it matters | Example |
| --- | --- | --- |
| `PORT` | API port | `4000` |
| `FRONTEND_URL` | Web origin and callback base fallback | `http://localhost:3000` |
| `ONECEO_API_PUBLIC_URL` | Public API origin used by browser-side checks | `http://localhost:3000` |
| `DATABASE_URL` | API persistence | `postgresql://postgres:postgres@127.0.0.1:5432/oneceo?sslmode=disable` |
| `DATABASE_SSL` | Local DB mode | `disable` |
| `VITE_API_BASE_URL` | Browser requests to API | `http://127.0.0.1:4000` |
| `WEB_BFF_API_TARGET` | Web dev proxy target | `http://localhost:4000` |
| `ONECEO_INTERNAL_TOKEN` | Shared internal auth between services | `replace-with-a-long-random-string` |
| `CONNECTOR_SECRET_KEY` | Encryption for connector-side secrets | `replace-with-a-second-random-string` |
| `OPENAI_API_KEY` | Upstream model access | `sk-your-provider-key` |
| `OPENAI_BASE_URL` | OpenAI-compatible endpoint | `https://api.openai.com/v1` |
| `LLM_PROXY_UPSTREAM_API_KEY` | API-side LLM proxy | `sk-your-provider-key` |
| `LLM_PROXY_UPSTREAM_BASE_URL` | API-side LLM proxy endpoint | `https://api.openai.com/v1` |
| `LLM_PROXY_UPSTREAM_API_TYPE` | Upstream provider protocol | `openai` |

### Required for real sandbox execution

Without these, the UI can boot, but the main execution chain will not work end to end:

| Variable | Why it matters | Example |
| --- | --- | --- |
| `E2B_API_KEY` | Launching real E2B sandboxes | `e2b_your_api_key` |
| `OSAC_EXECUTION_ENABLED` | Main execution chain switch | `true` |
| `OSAC_EXECUTION_MODE` | Sandbox execution mode | `opencode_remote` |

### Required for hosted connectors

| Variable | Why it matters | Example |
| --- | --- | --- |
| `COMPOSIO_API_KEY` | Composio-hosted connectors | `cmp_your_api_key` |
| `COMPOSIO_OAUTH_CALLBACK_BASE_URL` | OAuth callback base origin | `http://localhost:3000` |

### Required for sandbox archive and recovery

| Variable | Why it matters | Example |
| --- | --- | --- |
| `R2_BUCKET_NAME` | Archive bucket | `oneceo-sandbox-storage` |
| `R2_ACCOUNT_ID` | Cloudflare account id | `your-account-id` |
| `R2_ENDPOINT` | Bucket endpoint | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | R2 access key | `your-r2-access-key` |
| `R2_SECRET_ACCESS_KEY` | R2 secret key | `your-r2-secret-key` |

### Required only for managed deployment flows

| Variable | Why it matters |
| --- | --- |
| `RAILWAY_ADMIN_TOKEN` | Railway deployment automation |
| `RAILWAY_WORKSPACE_ID` | Railway workspace selection |
| `GITHUB_DEPLOYMENT_APP_ID` | GitHub App-based deployment repo automation |
| `GITHUB_DEPLOYMENT_INSTALLATION_ID` | GitHub App installation binding |
| `GITHUB_DEPLOYMENT_APP_PRIVATE_KEY` | GitHub App authentication |

## Safe example .env

Use this as a local placeholder-only example. Replace the fake values in your own untracked `apps/.env`.

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

## Where to get the keys

### E2B

- Create an account in the E2B dashboard.
- Generate a workspace API key.
- Put it in `E2B_API_KEY`.
- If you use archive/recovery flows, also configure the R2 variables.

Relevant docs:

- [docs/AGENTS_GUIDE/03_sandbox_e2b.md](docs/AGENTS_GUIDE/03_sandbox_e2b.md)
- [apps/api/src/connectors/e2b-connector.ts](apps/api/src/connectors/e2b-connector.ts)

### Composio

- Create a project and API key in the Composio dashboard.
- Put the key in `COMPOSIO_API_KEY`.
- Set `COMPOSIO_OAUTH_CALLBACK_BASE_URL` to the real frontend origin users open in the browser.
- For local development, that is usually `http://localhost:3000`.

Relevant doc:

- [docs/features/connectors/composio_oauth_callback_env_control_doc_[20260503-1127已采用].md](docs/features/connectors/composio_oauth_callback_env_control_doc_[20260503-1127已采用].md)

### OpenAI-compatible provider

- Bring your own provider key.
- Set both browser-facing and API-side values if you want consistent behavior across the stack.
- If your upstream is not plain OpenAI, set `LLM_PROXY_UPSTREAM_API_TYPE` accordingly.

### Cloudflare R2

- Create an R2 bucket.
- Generate an access key pair scoped to that bucket.
- Fill `R2_BUCKET_NAME`, `R2_ACCOUNT_ID`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`.

## Running the apps

### API

```bash
pnpm dev:api
```

### User workspace

```bash
pnpm dev:web
```

### Blog/docs site

```bash
pnpm dev:blog
```

### Admin console

```bash
npm --prefix apps/admin_management run dev
```

### Convenience command

This starts the web app and API together:

```bash
pnpm dev
```

## Verification

If you are checking OSS readiness or doing a fresh-clone sanity check, start here:

```bash
pnpm --filter api type-check
pnpm --filter web check
npm --prefix apps/admin_management run type-check
```

Additional common commands:

```bash
pnpm build
pnpm type-check
pnpm test
```

## Architecture notes

- `apps/api` is the main entry for task sessions, Altus-managed flows, connectors, OSAC, archive/recovery, and sandbox lifecycle.
- `apps/web` is the main end-user product surface.
- `apps/admin_management` is the platform-operator surface.
- `apps/api/src/connectors/e2b-connector.ts` is the required E2B main-chain entry.
- `apps/api/src/connectors/llm-proxy-connector.ts` is the required upstream model access entry.
- User/admin identity separation is part of the system boundary, not just a UI concern.

## Brand assets

The runtime entry points now use PNG assets:

- `apps/web/client/public/logo.png`
- `apps/web/client/public/logo-dark.png`
- `apps/web/client/public/logo-mark.png`
- `apps/web/client/public/favicon.png`
- `apps/admin_management/web/public/favicon.png`
- `apps/blog/public/og-default.png`

SVG source experiments may still exist in the repo, but the web entry points and metadata now reference PNG assets.

## Documentation index

Start here if you want the repo's operating context, architecture rules, and agent workflow guidance:

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

## Contributing and support

- Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Security reporting: [SECURITY.md](SECURITY.md)
- Support: [SUPPORT.md](SUPPORT.md)

## License

This repository is released under the MIT license. See [LICENSE](LICENSE).
