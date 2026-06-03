# OneCEO Web App

`apps/web` is the end-user workspace for OneCEO. It hosts the task cockpit where users create work, chat with agents, inspect deliverables, preview runtime output, and move completed work toward deployment.

For the repository-level quick start, environment variables, screenshots, and governance documents, start with the root [README.md](/Users/watson/codingProj/oneceo/README.md).

## Local development

Requirements:

- Node.js `20+`
- pnpm `10.4.1+`
- Root workspace dependencies already installed with `pnpm install --frozen-lockfile`

Start the web app:

```bash
pnpm --filter web dev
```

By default the app expects the shared environment file at [apps/.env.example](/Users/watson/codingProj/oneceo/apps/.env.example) to be copied to `apps/.env`, with at least these values configured:

- `FRONTEND_URL`
- `VITE_API_BASE_URL`
- `WEB_BFF_API_TARGET`
- `VITE_RUNTIME_ENV`

## Common commands

```bash
pnpm --filter web dev
pnpm --filter web build
pnpm --filter web check
pnpm --filter web preview
```

## Role in the architecture

- Browser-facing user workspace
- Talks to the API app for task sessions, auth, connectors, and runtime state
- Uses the root environment template rather than a separate per-app `.env.example`

## Related docs

- [README.md](/Users/watson/codingProj/oneceo/README.md)
- [AGENTS.md](/Users/watson/codingProj/oneceo/AGENTS.md)
- [PRODUCT.md](/Users/watson/codingProj/oneceo/PRODUCT.md)
- [DESIGN.md](/Users/watson/codingProj/oneceo/DESIGN.md)
