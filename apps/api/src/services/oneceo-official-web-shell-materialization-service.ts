import path from 'node:path';
import { e2bConnector } from '../connectors/e2b-connector';
import type { AltusManagedTaskIntentProfile } from './altus-managed-prompt-service';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function shellEscape(value: string) {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

const OFFICIAL_WEB_SHELL_PACKAGE_JSON = {
  name: 'oneceo-official-web-shell',
  private: true,
  version: '1.0.0',
  type: 'module',
  scripts: {
    build: 'vite build && esbuild server/index.ts --platform=node --bundle --format=esm --outfile=dist/index.js',
    start: 'node dist/index.js',
  },
  dependencies: {
    express: '^5.0.0',
    react: '^19.0.0',
    'react-dom': '^19.0.0',
  },
  devDependencies: {
    esbuild: '^0.25.0',
    vite: '^7.0.0',
  },
};

const OFFICIAL_WEB_SHELL_INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OneCEO Web App</title>
  </head>
  <body>
    <div id="root"></div>
    <!-- ONECEO_ANALYTICS:START --><!-- ONECEO_ANALYTICS:END -->
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`;

const OFFICIAL_WEB_SHELL_MAIN_JSX = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;

const OFFICIAL_WEB_SHELL_APP_JSX = `export default function App() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">OneCEO Official Web Shell</p>
        <h1>在这个固定模板里完成用户网站需求</h1>
        <p className="summary">
          保留当前 build、start、healthcheck、analytics 契约，只替换页面内容、样式、交互和少量服务逻辑。
        </p>
      </section>

      <section className="panel">
        <h2>建议修改区域</h2>
        <ul>
          <li>client/src/App.jsx：页面结构与文案</li>
          <li>client/src/styles.css：视觉风格与响应式布局</li>
          <li>server/index.ts：少量路由或接口</li>
          <li>shared/：跨端共享的简单常量或类型</li>
        </ul>
      </section>
    </main>
  );
}
`;

const OFFICIAL_WEB_SHELL_STYLES = `:root {
  color-scheme: light;
  font-family: "Helvetica Neue", "PingFang SC", sans-serif;
  background: #f4efe6;
  color: #111111;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(circle at top, rgba(255, 255, 255, 0.9), transparent 35%),
    linear-gradient(160deg, #f4efe6 0%, #efe4d2 100%);
}

.shell {
  width: min(960px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 72px 0 96px;
}

.hero,
.panel {
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(17, 17, 17, 0.08);
  border-radius: 24px;
  padding: 28px;
  box-shadow: 0 18px 45px rgba(17, 17, 17, 0.08);
}

.panel {
  margin-top: 18px;
}

.eyebrow {
  margin: 0 0 12px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 12px;
  color: #9b4d1f;
}

h1,
h2,
p,
ul {
  margin: 0;
}

h1 {
  font-size: clamp(36px, 6vw, 64px);
  line-height: 0.95;
}

.summary {
  margin-top: 16px;
  max-width: 56ch;
  line-height: 1.6;
  color: rgba(17, 17, 17, 0.75);
}

ul {
  margin-top: 14px;
  padding-left: 20px;
  line-height: 1.8;
}
`;

const OFFICIAL_WEB_SHELL_SERVER_SOURCE = `import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 8080);
const publicDir = path.join(__dirname, 'public');

app.get('/api/system/health', (_req, res) => {
  res.json({ ok: true, service: 'oneceo-official-web-shell' });
});

app.use(express.static(publicDir));

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log('[oneceo-official-web-shell] listening on port ' + port);
});
`;

const OFFICIAL_WEB_SHELL_VITE_CONFIG = `import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'client'),
  publicDir: path.resolve(__dirname, 'client/public'),
  build: {
    outDir: path.resolve(__dirname, 'dist/public'),
    emptyOutDir: true,
  },
});
`;

const OFFICIAL_WEB_SHELL_MANIFEST = {
  templateVersion: '1.0.0',
  appType: 'web_app',
  stack: 'oneceo_fixed_vite_node_shell',
  build: {
    command: 'pnpm build',
    outputDir: 'dist/public',
  },
  start: {
    command: 'node dist/index.js',
    portEnv: 'PORT',
  },
  healthcheck: {
    path: '/api/system/health',
  },
  features: {
    analytics: true,
    userTracking: true,
    database: false,
    auth: 'optional',
    objectStorage: false,
  },
  runtime: {
    framework: 'frontend_dist',
    transport: 'http',
  },
};

type WorkspaceProbe = {
  officialPresent: boolean;
  stackDetected: boolean;
  nonIgnoredCount: number;
};

export type OfficialWebShellMaterializationResult = {
  applied: boolean;
  reason:
    | 'task_not_deployable'
    | 'deployment_not_allowed'
    | 'already_present'
    | 'stack_detected'
    | 'workspace_not_empty'
    | 'materialized';
  writtenPaths: string[];
};

function shouldMaterializeForTask(profile?: AltusManagedTaskIntentProfile | null) {
  if (!profile || profile.mode !== 'deployable_web_app') {
    return {
      allowed: false,
      reason: 'task_not_deployable' as const,
    };
  }
  if (!profile.deploymentAllowed) {
    return {
      allowed: false,
      reason: 'deployment_not_allowed' as const,
    };
  }
  return {
    allowed: true as const,
  };
}

async function probeWorkspace(input: { sandboxId: string; workspaceRoot: string }): Promise<WorkspaceProbe> {
  const command = [
    'stack_detected=0',
    'official_present=0',
    "for candidate in package.json pnpm-workspace.yaml tsconfig.json requirements.txt pyproject.toml go.mod Cargo.toml pom.xml composer.json build.gradle build.gradle.kts index.html; do",
    '  if [ -e "$candidate" ]; then stack_detected=1; fi',
    'done',
    "for candidate in client server shared src public app pages; do",
    '  if [ -e "$candidate" ]; then stack_detected=1; fi',
    'done',
    'if [ -f client/index.html ] && { [ -f server/index.ts ] || [ -f server/index.js ]; }; then official_present=1; fi',
    "non_ignored_count=$(find . -maxdepth 1 -mindepth 1 ! -name '.git' ! -name '.opencode' ! -name '.oneceo' ! -name '.DS_Store' ! -name 'uploads' | wc -l | tr -d ' ')",
    'echo "stack_detected=$stack_detected"',
    'echo "official_present=$official_present"',
    'echo "non_ignored_count=$non_ignored_count"',
  ].join('\n');
  const result: any = await e2bConnector.runCommand(input.sandboxId, command, {
    cwd: input.workspaceRoot,
    timeoutMs: 15_000,
  });
  const stdout = asText(result?.stdout);
  const values = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const [key, ...rest] = line.split('=');
    if (!key) continue;
    values.set(key.trim(), rest.join('=').trim());
  }
  return {
    officialPresent: values.get('official_present') === '1',
    stackDetected: values.get('stack_detected') === '1',
    nonIgnoredCount: Number(values.get('non_ignored_count') || '0') || 0,
  };
}

function buildScaffoldFiles(workspaceRoot: string) {
  const joinPath = (...parts: string[]) => path.posix.join(workspaceRoot, ...parts);
  return [
    { path: joinPath('client', 'index.html'), content: OFFICIAL_WEB_SHELL_INDEX_HTML },
    { path: joinPath('client', 'src', 'main.jsx'), content: OFFICIAL_WEB_SHELL_MAIN_JSX },
    { path: joinPath('client', 'src', 'App.jsx'), content: OFFICIAL_WEB_SHELL_APP_JSX },
    { path: joinPath('client', 'src', 'styles.css'), content: OFFICIAL_WEB_SHELL_STYLES },
    { path: joinPath('server', 'index.ts'), content: OFFICIAL_WEB_SHELL_SERVER_SOURCE },
    { path: joinPath('vite.config.ts'), content: OFFICIAL_WEB_SHELL_VITE_CONFIG },
    { path: joinPath('package.json'), content: `${JSON.stringify(OFFICIAL_WEB_SHELL_PACKAGE_JSON, null, 2)}\n` },
    { path: joinPath('oneceo.manifest.json'), content: `${JSON.stringify(OFFICIAL_WEB_SHELL_MANIFEST, null, 2)}\n` },
  ];
}

export function buildOfficialWebShellMaterializationGuidance() {
  return [
    'OneCEO 官方固定网站模板已经预置到当前工作区。',
    '请直接在现有模板内完成用户需求，不要重新发明技术栈，也不要重写 build/start/healthcheck/analytics 契约。',
    '优先修改这些文件：`client/src/App.jsx`、`client/src/styles.css`、`server/index.ts`、`shared/`。',
    '保持这些契约不变：`package.json` 的 build/start、`oneceo.manifest.json`、`client/index.html` 的 analytics hook、`/api/system/health`。',
  ].join('\n');
}

export async function materializeOfficialWebShellInSandbox(input: {
  sandboxId: string;
  workspaceRoot: string;
  taskIntentProfile?: AltusManagedTaskIntentProfile | null;
}): Promise<OfficialWebShellMaterializationResult> {
  const eligibility = shouldMaterializeForTask(input.taskIntentProfile);
  if (!eligibility.allowed) {
    return {
      applied: false,
      reason: eligibility.reason,
      writtenPaths: [],
    };
  }

  const probe = await probeWorkspace({
    sandboxId: input.sandboxId,
    workspaceRoot: input.workspaceRoot,
  });
  if (probe.officialPresent) {
    return {
      applied: false,
      reason: 'already_present',
      writtenPaths: [],
    };
  }
  if (probe.stackDetected) {
    return {
      applied: false,
      reason: 'stack_detected',
      writtenPaths: [],
    };
  }
  if (probe.nonIgnoredCount > 0) {
    return {
      applied: false,
      reason: 'workspace_not_empty',
      writtenPaths: [],
    };
  }

  await e2bConnector.runCommand(
    input.sandboxId,
    [
      `mkdir -p ${shellEscape(path.posix.join(input.workspaceRoot, 'client', 'src'))}`,
      `mkdir -p ${shellEscape(path.posix.join(input.workspaceRoot, 'client', 'public'))}`,
      `mkdir -p ${shellEscape(path.posix.join(input.workspaceRoot, 'server'))}`,
      `mkdir -p ${shellEscape(path.posix.join(input.workspaceRoot, 'shared'))}`,
    ].join('\n'),
    {
      timeoutMs: 15_000,
    }
  );

  const files = buildScaffoldFiles(input.workspaceRoot);
  for (const file of files) {
    await e2bConnector.writeFile(input.sandboxId, file.path, Buffer.from(file.content, 'utf-8'));
  }

  return {
    applied: true,
    reason: 'materialized',
    writtenPaths: files.map((item) => item.path),
  };
}
