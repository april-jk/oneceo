# OneCEO

OneCEO is an AI task execution and platform-governance workspace for teams that need more than a chat box. It combines a user-facing task cockpit, an orchestration API, an administrator console, and sandbox/runtime infrastructure around E2B, OSAC, and hosted connectors.

The product is designed as a "task command center": operators can create and review agent work, administrators can inspect sessions, sandboxes, deployments, connectors, and audit traces, and the platform keeps the execution chain observable instead of hiding it behind a single prompt box.

![OneCEO logo](apps/web/client/public/logo.png)

## What is in this repository

- `apps/web`: end-user workspace for task creation, chat, deliverables, previews, and deployment flows
- `apps/api`: orchestration API for task sessions, Altus-managed flows, OSAC, connectors, archives, and sandbox lifecycle
- `apps/admin_management`: administrator console for governance, operations, audit, deployments, connectors, OSAC, and sandbox visibility
- `apps/blog`: documentation/blog site
- `packages/shared`: shared types and utilities
- `e2b_templates`: E2B sandbox templates and related assets
- `docs`: architecture, feature, testing, and deployment documents

## Feature overview

- Agent task execution with persistent task-session orchestration
- E2B-based execution environments routed through the OneCEO API
- Hosted connector flows, including Composio OAuth-based integrations
- Admin-side audit and trace views for requests, tools, and runtime state
- Deployment and environment management surfaces for operators
- Multi-app workspace with separate end-user and administrator experiences

## Product surfaces

### User workspace

The main web app is where users create tasks, collaborate with agents, inspect deliverables, and move work toward deployment.

![User workspace](oneceo-home-send.png)

### API trace and runtime visibility

The API app includes tracing and audit-oriented surfaces so operators can review requests and execution details instead of treating agent behavior as opaque.

![API traces](screenshot_api_traces.png)

### Administrator command center

The admin console is built for platform operators who need dense oversight of sandboxes, OSAC, connectors, deployments, and other operational entities.

![Admin command center](agent自动工作汇报/admin_detail_command_center_20260426/osac-command-center.png)

## Quick start

### Requirements

- Node.js `20+`
- pnpm `10.4.1+`
- npm `10+`
- PostgreSQL for the API
- Redis only if you explicitly enable it with `ONECEO_REDIS_ENABLED=true`

### Install

```bash
git clone https://github.com/april-jk/oneceo.git
cd oneceo
pnpm install --frozen-lockfile
npm --prefix apps/admin_management install
cp apps/.env.example apps/.env
```

`apps/admin_management` currently keeps its own `npm` dependency tree, so the extra install step is required.

### Minimum local configuration

The canonical environment template is [apps/.env.example](/Users/watson/codingProj/oneceo/apps/.env.example). For a first local boot, fill at least these values in `apps/.env`:

| Variable | Required for | Example |
| --- | --- | --- |
| `PORT` | API local port | `4000` |
| `FRONTEND_URL` | Browser origin and OAuth callback base fallback | `http://localhost:3000` |
| `ONECEO_API_PUBLIC_URL` | Public API origin for browser-side checks | `http://localhost:3000` |
| `DATABASE_URL` | API boot and persistence | `postgresql://postgres:postgres@127.0.0.1:5432/oneceo?sslmode=disable` |
| `VITE_API_BASE_URL` | Web app requests to API | `http://127.0.0.1:4000` |
| `WEB_BFF_API_TARGET` | Web dev proxy target | `http://localhost:4000` |
| `ONECEO_INTERNAL_TOKEN` | Shared internal auth between apps | `replace-with-a-long-random-string` |
| `OPENAI_API_KEY` | Upstream model access | `sk-your-provider-key` |
| `OPENAI_BASE_URL` | OpenAI-compatible endpoint | `https://api.openai.com/v1` |
| `LLM_PROXY_UPSTREAM_API_KEY` | API-side LLM proxy | `sk-your-provider-key` |
| `LLM_PROXY_UPSTREAM_BASE_URL` | API-side LLM proxy endpoint | `https://api.openai.com/v1` |

### Sandbox, connector, and archive configuration

These are not required for a bare UI/API boot, but they are required if you want the platform's core execution flows to work end to end:

| Variable | Needed when | Example |
| --- | --- | --- |
| `E2B_API_KEY` | Running real E2B sandboxes | `e2b_your_api_key` |
| `COMPOSIO_API_KEY` | Enabling Composio-hosted connectors | `cmp_your_api_key` |
| `COMPOSIO_OAUTH_CALLBACK_BASE_URL` | Completing connector OAuth flows | `http://localhost:3000` |
| `CONNECTOR_SECRET_KEY` | Encrypting connector-side secrets | `replace-with-a-long-random-string` |
| `R2_BUCKET_NAME` | Sandbox archive storage | `oneceo-sandbox-storage` |
| `R2_ACCOUNT_ID` | Sandbox archive storage | `your-cloudflare-account-id` |
| `R2_ENDPOINT` | Sandbox archive storage | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | Sandbox archive storage | `your-r2-access-key` |
| `R2_SECRET_ACCESS_KEY` | Sandbox archive storage | `your-r2-secret-key` |

### Safe example `.env`

Use placeholders only. Never commit real secrets.

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
COMPOSIO_API_KEY=cmp_your_api_key
COMPOSIO_OAUTH_CALLBACK_BASE_URL=http://localhost:3000

R2_BUCKET_NAME=your-r2-bucket
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
```

## How to get the required keys

### E2B

- Create an account in the E2B dashboard.
- Generate an API key for your workspace.
- Put that value in `E2B_API_KEY`.
- If you enable long-lived archive/recovery flows, also configure the R2 variables shown above.

Relevant architecture notes:
- [docs/AGENTS_GUIDE/03_sandbox_e2b.md](/Users/watson/codingProj/oneceo/docs/AGENTS_GUIDE/03_sandbox_e2b.md)
- [apps/api/src/connectors/e2b-connector.ts](/Users/watson/codingProj/oneceo/apps/api/src/connectors/e2b-connector.ts)

### Composio

- Create a project and API key in the Composio dashboard.
- Put that value in `COMPOSIO_API_KEY`.
- Set `COMPOSIO_OAUTH_CALLBACK_BASE_URL` to the real frontend origin that users open in the browser.
- For local development, that usually means `http://localhost:3000`.
- Do not point the callback base URL at an internal API hostname or a private Railway hostname.

Relevant design notes:
- [docs/features/connectors/composio_oauth_callback_env_control_doc_[20260503-1127已采用].md](/Users/watson/codingProj/oneceo/docs/features/connectors/composio_oauth_callback_env_control_doc_[20260503-1127已采用].md)

### OpenAI-compatible model provider

- Bring your own provider key for the model backend you want to use.
- Set both browser-facing and API-side values if you want the entire stack to behave consistently:
  - `OPENAI_API_KEY`
  - `OPENAI_BASE_URL`
  - `LLM_PROXY_UPSTREAM_API_KEY`
  - `LLM_PROXY_UPSTREAM_BASE_URL`
- If your upstream is not plain OpenAI, set `LLM_PROXY_UPSTREAM_API_TYPE` accordingly.

### Cloudflare R2

- Create an R2 bucket in Cloudflare if you want sandbox archive storage.
- Generate an access key pair scoped to that bucket.
- Fill `R2_BUCKET_NAME`, `R2_ACCOUNT_ID`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`.

### Deployment credentials

Deployment-related variables in `apps/.env.example` are only needed if you use the managed deployment flows:

- `RAILWAY_ADMIN_TOKEN`
- `RAILWAY_WORKSPACE_ID`
- `GITHUB_DEPLOYMENT_APP_ID`
- `GITHUB_DEPLOYMENT_INSTALLATION_ID`
- `GITHUB_DEPLOYMENT_APP_PRIVATE_KEY`

These should come from your Railway workspace and your GitHub App configuration, not from sample values in this repository.

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

## Verification

If you are checking whether the repository is usable after cloning, start with the same minimum static checks used for OSS readiness:

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

- `apps/api` is the main entry for task sessions, Altus-managed flows, OSAC, connector orchestration, archive/recovery, and sandbox lifecycle.
- `apps/web` is the main end-user surface.
- `apps/admin_management` is the platform operator surface.
- `apps/api/src/connectors/e2b-connector.ts` is the required E2B main-chain entry.
- `apps/api/src/connectors/llm-proxy-connector.ts` is the required upstream model access entry.
- User/admin identity separation is part of the system boundary, not a UI detail.

## Documentation index

Start here if you want the operating and architecture context behind the repo:

- [AGENTS.md](/Users/watson/codingProj/oneceo/AGENTS.md)
- [PRODUCT.md](/Users/watson/codingProj/oneceo/PRODUCT.md)
- [DESIGN.md](/Users/watson/codingProj/oneceo/DESIGN.md)
- [docs/AGENTS_GUIDE/PROJECT_PROMPT.md](/Users/watson/codingProj/oneceo/docs/AGENTS_GUIDE/PROJECT_PROMPT.md)
- [docs/AGENTS_GUIDE/02_services.md](/Users/watson/codingProj/oneceo/docs/AGENTS_GUIDE/02_services.md)
- [docs/AGENTS_GUIDE/03_sandbox_e2b.md](/Users/watson/codingProj/oneceo/docs/AGENTS_GUIDE/03_sandbox_e2b.md)
- [docs/AGENTS_GUIDE/04_agent_flow.md](/Users/watson/codingProj/oneceo/docs/AGENTS_GUIDE/04_agent_flow.md)
- [docs/AGENTS_GUIDE/05_系统调试与测试指南.md](/Users/watson/codingProj/oneceo/docs/AGENTS_GUIDE/05_系统调试与测试指南.md)
- [docs/AGENTS_GUIDE/AGENT_CODE_MODIFICATION_GUIDE.md](/Users/watson/codingProj/oneceo/docs/AGENTS_GUIDE/AGENT_CODE_MODIFICATION_GUIDE.md)
- [docs/features/20260603_开源发布仓库整理_[20260603-2358已采用].md](/Users/watson/codingProj/oneceo/docs/features/20260603_开源发布仓库整理_[20260603-2358已采用].md)

## Open-source collaboration

- Contribution guide: [CONTRIBUTING.md](/Users/watson/codingProj/oneceo/CONTRIBUTING.md)
- Code of conduct: [CODE_OF_CONDUCT.md](/Users/watson/codingProj/oneceo/CODE_OF_CONDUCT.md)
- Security reporting: [SECURITY.md](/Users/watson/codingProj/oneceo/SECURITY.md)
- Support: [SUPPORT.md](/Users/watson/codingProj/oneceo/SUPPORT.md)

## License

This repository is released under the MIT license. See [LICENSE](/Users/watson/codingProj/oneceo/LICENSE).
