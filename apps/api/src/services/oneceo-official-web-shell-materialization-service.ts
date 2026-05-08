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

const OFFICIAL_WEB_SHELL_APP_JSX = `import React from 'react';

export default function App() {
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

const OFFICIAL_WEB_SHELL_SERVER_SOURCE = `import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT || 8080);
const publicDir = path.join(__dirname, 'public');
const indexPath = path.join(publicDir, 'index.html');
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};
const ANALYTICS_MARKER_START = '<!-- ONECEO_ANALYTICS:START -->';
const ANALYTICS_MARKER_END = '<!-- ONECEO_ANALYTICS:END -->';

function getMimeType(filePath) {
  return mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function readEnv(key) {
  return typeof process.env[key] === 'string' ? process.env[key].trim() : '';
}

function buildAnalyticsBootstrapSnippet() {
  const enabledValue = readEnv('VITE_ANALYTICS_ENABLED').toLowerCase();
  const host = readEnv('VITE_ANALYTICS_HOST');
  const endpoint = readEnv('VITE_ANALYTICS_ENDPOINT') || host;
  const websiteId = readEnv('VITE_ANALYTICS_WEBSITE_ID');
  const tag = readEnv('VITE_ANALYTICS_TAG');
  const enabled = !['0', 'false', 'no', 'off'].includes(enabledValue) && Boolean(endpoint && websiteId);
  if (!enabled) return '';
  const normalizedEndpoint = endpoint.replace(/\\/+$/, '');
  return [
    ANALYTICS_MARKER_START,
    '<script>',
    'window.__ONECEO_ANALYTICS__ = Object.freeze(' + JSON.stringify({ enabled, host: normalizedEndpoint, endpoint: normalizedEndpoint, websiteId, tag }) + ');',
    '(function () {',
    "  if (document.querySelector('script[data-oneceo-analytics=\\\"runtime\\\"]')) return;",
    "  var script = document.createElement('script');",
    '  script.defer = true;',
    '  script.src = ' + JSON.stringify(normalizedEndpoint) + " + '/script.js';",
    "  script.setAttribute('data-website-id', " + JSON.stringify(websiteId) + ');',
    "  script.setAttribute('data-host-url', " + JSON.stringify(normalizedEndpoint) + ');',
    "  script.setAttribute('data-oneceo-analytics', 'runtime');",
    tag ? "  script.setAttribute('data-tag', " + JSON.stringify(tag) + ');' : '',
    '  document.body.appendChild(script);',
    '})();',
    '</script>',
    ANALYTICS_MARKER_END,
  ].filter(Boolean).join('\\n');
}

function injectRuntimeAnalytics(html) {
  const snippet = buildAnalyticsBootstrapSnippet();
  if (!snippet) return html;
  const markerStartIndex = html.indexOf(ANALYTICS_MARKER_START);
  if (markerStartIndex >= 0) {
    const markerEndIndex = html.indexOf(ANALYTICS_MARKER_END, markerStartIndex);
    if (markerEndIndex < 0) return html;
    return html.slice(0, markerStartIndex) + snippet + html.slice(markerEndIndex + ANALYTICS_MARKER_END.length);
  }
  const bodyCloseIndex = html.lastIndexOf('</body>');
  if (bodyCloseIndex >= 0) {
    return html.slice(0, bodyCloseIndex) + snippet + '\\n' + html.slice(bodyCloseIndex);
  }
  return html + '\\n' + snippet + '\\n';
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendFile(res, filePath) {
  if (path.extname(filePath).toLowerCase() === '.html') {
    const html = injectRuntimeAnalytics(fs.readFileSync(filePath, 'utf8'));
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(html),
    });
    res.end(html);
    return;
  }
  res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
  fs.createReadStream(filePath).pipe(res);
}

function resolveStaticPath(requestPath) {
  const normalizedPath = requestPath === '/' ? '/index.html' : requestPath;
  const safePath = path.normalize(normalizedPath).replace(/^(\\.\\.[/\\\\])+/, '');
  const targetPath = path.join(publicDir, safePath);
  if (!targetPath.startsWith(publicDir)) {
    return null;
  }
  return targetPath;
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
  if (requestUrl.pathname === '/api/system/health' || requestUrl.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'oneceo-official-web-shell' });
  }

  const targetPath = resolveStaticPath(requestUrl.pathname);
  if (!targetPath) {
    return sendJson(res, 400, { ok: false, error: 'invalid_path' });
  }

  try {
    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      const nestedIndex = path.join(targetPath, 'index.html');
      if (fs.existsSync(nestedIndex)) {
        sendFile(res, nestedIndex);
        return;
      }
    } else {
      sendFile(res, targetPath);
      return;
    }
  } catch {}

  try {
    sendFile(res, indexPath);
  } catch {
    sendJson(res, 404, { ok: false, error: 'not_found' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log('[oneceo-official-web-shell] listening on port ' + port);
});
`;

const OFFICIAL_WEB_SHELL_VITE_CONFIG = `import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'client'),
  publicDir: path.resolve(__dirname, 'client/public'),
  esbuild: {
    jsxInject: "import React from 'react'",
  },
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
    command: 'npm run build',
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
    '首页主内容、用户要求的验收标识、hero、核心区块和浏览器交互必须写入 `client/src/App.jsx`；`client/src/main.jsx` 只负责挂载。',
    '保持这些契约不变：`package.json` 的 build/start、固定 Node Web Shell、`oneceo.manifest.json`、`client/index.html` 的 analytics hook、`/api/system/health`。',
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
