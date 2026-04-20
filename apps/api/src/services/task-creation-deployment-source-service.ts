import { execFile as execFileCallback } from 'node:child_process';
import { access, cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { e2bConnector } from '../connectors/e2b-connector';
import {
  pushDirectoryToManagedRepository,
  type ManagedDeploymentRepository,
} from './platform-managed-github-repo-service';
import {
  ensureDeploymentTemplateBootstrap,
  type DeploymentTemplateAnalyticsConfig,
  type DeploymentTemplateBootstrapReport,
} from './deployment-template-bootstrap-service';
import {
  ensureTemplateCompliance,
  type OneCeoDeploymentManifest,
  type TemplateComplianceReport,
} from './template-compliance-service';

const execFile = promisify(execFileCallback);

const EXPORT_EXCLUDES = [
  '.git',
  '.opencode',
  'node_modules',
  '.cache',
  '.pnpm-store',
  '.idea',
  '.vscode',
];

const STATIC_TEMPLATE_PACKAGE_JSON = {
  name: 'oneceo-static-web-app',
  private: true,
  version: '1.0.0',
  scripts: {
    build: 'node -e "console.log(\'oneceo static app ready\')"',
    start: 'node server.js',
  },
};

const STATIC_TEMPLATE_SERVER_SOURCE = `const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const port = Number(process.env.PORT || 8080);
const rootDir = __dirname;
const indexPath = path.join(rootDir, 'index.html');
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp'
};
const analyticsPlaceholders = ['VITE_ANALYTICS_ENABLED', 'VITE_ANALYTICS_HOST', 'VITE_ANALYTICS_ENDPOINT', 'VITE_ANALYTICS_WEBSITE_ID', 'VITE_ANALYTICS_TAG', 'VITE_PUBLIC_DOMAIN'];

function getMimeType(filePath) {
  return mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function applyRuntimeEnv(template) {
  return analyticsPlaceholders.reduce((html, key) => {
    const value = String(process.env[key] || '');
    return html.replaceAll('%' + key + '%', value);
  }, template);
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

function resolveStaticPath(requestPath) {
  const normalizedPath = requestPath === '/' ? '/index.html' : requestPath;
  const safePath = path.normalize(normalizedPath).replace(/^(\.\.[/\\\\])+/, '');
  const targetPath = path.join(rootDir, safePath);
  if (!targetPath.startsWith(rootDir)) {
    return null;
  }
  return targetPath;
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
  if (requestUrl.pathname === '/api/system/health' || requestUrl.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'oneceo-static-server' });
  }

  const targetPath = resolveStaticPath(requestUrl.pathname);
  if (!targetPath) {
    return sendJson(res, 400, { ok: false, error: 'invalid_path' });
  }

  try {
    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      const nestedIndex = path.join(targetPath, 'index.html');
      if (!fs.existsSync(nestedIndex)) {
        return sendJson(res, 404, { ok: false, error: 'not_found' });
      }
      const html = applyRuntimeEnv(fs.readFileSync(nestedIndex, 'utf8'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (targetPath === indexPath) {
      const html = applyRuntimeEnv(fs.readFileSync(indexPath, 'utf8'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    res.writeHead(200, { 'Content-Type': getMimeType(targetPath) });
    fs.createReadStream(targetPath).pipe(res);
  } catch {
    sendJson(res, 404, { ok: false, error: 'not_found' });
  }
});

server.listen(port, '0.0.0.0', () => {
console.log('[oneceo-static-server] listening on port ' + port);
});
`;

const FRONTEND_DIST_SERVER_SOURCE = `const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const port = Number(process.env.PORT || 8080);
const rootDir = path.join(__dirname, 'dist');
const indexPath = path.join(rootDir, 'index.html');
const ANALYTICS_MARKER_START = '<!-- ONECEO_ANALYTICS:START -->';
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
  '.webp': 'image/webp'
};
const analyticsEnvKeys = ['VITE_ANALYTICS_ENABLED', 'VITE_ANALYTICS_HOST', 'VITE_ANALYTICS_ENDPOINT', 'VITE_ANALYTICS_WEBSITE_ID', 'VITE_ANALYTICS_TAG', 'VITE_PUBLIC_DOMAIN'];

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
  const publicDomain = readEnv('VITE_PUBLIC_DOMAIN');
  const enabled = !['0', 'false', 'no', 'off'].includes(enabledValue) && Boolean(endpoint && websiteId);
  if (!enabled) {
    return '';
  }
  const normalizedEndpoint = endpoint.replace(/\\/+$/, '');
  return [
    ANALYTICS_MARKER_START,
    '<script>',
    '(function () {',
    "  if (document.querySelector('script[data-oneceo-analytics=\\\"runtime\\\"]')) return;",
    "  var script = document.createElement('script');",
    '  script.defer = true;',
    '  script.src = ' + JSON.stringify(normalizedEndpoint) + " + '/script.js';",
    "  script.setAttribute('data-website-id', " + JSON.stringify(websiteId) + ');',
    "  script.setAttribute('data-host-url', " + JSON.stringify(normalizedEndpoint) + ');',
    "  script.setAttribute('data-oneceo-analytics', 'runtime');",
    tag ? "  script.setAttribute('data-tag', " + JSON.stringify(tag) + ');' : '',
    publicDomain ? "  script.setAttribute('data-domains', " + JSON.stringify(publicDomain) + ');' : '',
    '  document.body.appendChild(script);',
    '})();',
    '</script>',
    '<!-- ONECEO_ANALYTICS:END -->',
  ].filter(Boolean).join('\\n');
}

function injectRuntimeAnalytics(html) {
  if (!html || html.includes(ANALYTICS_MARKER_START)) {
    return html;
  }
  const snippet = buildAnalyticsBootstrapSnippet();
  if (!snippet) {
    return html;
  }
  const bodyCloseIndex = html.lastIndexOf('</body>');
  if (bodyCloseIndex >= 0) {
    return html.slice(0, bodyCloseIndex) + snippet + '\\n' + html.slice(bodyCloseIndex);
  }
  const htmlCloseIndex = html.lastIndexOf('</html>');
  if (htmlCloseIndex >= 0) {
    return html.slice(0, htmlCloseIndex) + snippet + '\\n' + html.slice(htmlCloseIndex);
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

function resolveStaticPath(requestPath) {
  const normalizedPath = requestPath === '/' ? '/index.html' : requestPath;
  const safePath = path.normalize(normalizedPath).replace(/^(\\.\\.[/\\\\])+/, '');
  const targetPath = path.join(rootDir, safePath);
  if (!targetPath.startsWith(rootDir)) {
    return null;
  }
  return targetPath;
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
  if (requestUrl.pathname === '/api/system/health' || requestUrl.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'oneceo-frontend-dist-server' });
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
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(injectRuntimeAnalytics(fs.readFileSync(nestedIndex, 'utf8')));
        return;
      }
    } else {
      if (path.extname(targetPath).toLowerCase() === '.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(injectRuntimeAnalytics(fs.readFileSync(targetPath, 'utf8')));
        return;
      }
      res.writeHead(200, { 'Content-Type': getMimeType(targetPath) });
      fs.createReadStream(targetPath).pipe(res);
      return;
    }
  } catch {}

  try {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(injectRuntimeAnalytics(fs.readFileSync(indexPath, 'utf8')));
  } catch {
    sendJson(res, 404, { ok: false, error: 'not_found' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log('[oneceo-frontend-dist-server] listening on port ' + port);
});
`;

const STATIC_TEMPLATE_MANIFEST: OneCeoDeploymentManifest = {
  templateVersion: '1.0.0',
  appType: 'web_app',
  stack: 'static_node_http_api_dbless',
  build: {
    command: 'npm run build',
    outputDir: '.',
  },
  start: {
    command: 'node server.js',
    portEnv: 'PORT',
  },
  healthcheck: {
    path: '/api/system/health',
  },
  features: {
    analytics: true,
    userTracking: true,
    database: false,
    auth: false,
    objectStorage: false,
  },
  runtime: {
    framework: 'static',
    transport: 'http',
  },
};

const FRONTEND_DIST_TEMPLATE_MANIFEST: OneCeoDeploymentManifest = {
  templateVersion: '1.0.0',
  appType: 'web_app',
  stack: 'frontend_dist_http_api_dbless',
  build: {
    command: 'npm run build',
    outputDir: 'dist',
  },
  start: {
    command: 'node server.js',
    portEnv: 'PORT',
  },
  healthcheck: {
    path: '/api/system/health',
  },
  features: {
    analytics: true,
    userTracking: true,
    database: false,
    auth: false,
    objectStorage: false,
  },
  runtime: {
    framework: 'frontend_dist',
    transport: 'http',
  },
};

const BUILT_FRONTEND_ENTRY_RELATIVE_PATHS = [
  'index.html',
  'public/index.html',
  'client/index.html',
] as const;

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function normalizeCommandForMatch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isFrontendPreviewOrDevStartCommand(value: string): boolean {
  const normalized = normalizeCommandForMatch(value);
  if (!normalized) {
    return false;
  }

  const exactMatches = new Set([
    'vite',
    'vite preview',
    'vite dev',
    'react-scripts start',
    'npm run preview',
    'npm run dev',
    'pnpm preview',
    'pnpm dev',
    'yarn preview',
    'yarn dev',
    'bun preview',
    'bun dev',
  ]);
  if (exactMatches.has(normalized)) {
    return true;
  }

  return (
    normalized.startsWith('vite preview ') ||
    normalized.startsWith('vite dev ') ||
    normalized.startsWith('react-scripts start ') ||
    normalized.startsWith('npm run preview ') ||
    normalized.startsWith('npm run dev ') ||
    normalized.startsWith('pnpm preview ') ||
    normalized.startsWith('pnpm dev ') ||
    normalized.startsWith('yarn preview ') ||
    normalized.startsWith('yarn dev ') ||
    normalized.startsWith('bun preview ') ||
    normalized.startsWith('bun dev ')
  );
}

export type DeploymentTemplateBaselineData = {
  status: 'ready' | 'needs_attention' | 'unavailable';
  checkedAt: string;
  workspaceDetected: boolean;
  analyticsMode: 'workspace' | 'platform_injected' | 'missing' | 'unknown';
  manifestGenerated: boolean;
  manifestPath?: string;
  templateVersion?: string;
  buildCommand?: string;
  startCommand?: string;
  healthcheckPath?: string;
  features?: OneCeoDeploymentManifest['features'];
  checks: {
    build: boolean | null;
    start: boolean | null;
    analytics: boolean | null;
    healthcheck: boolean | null;
    database: boolean | null;
  };
  warnings: string[];
  errors: string[];
};

export type DeploymentWorkspacePublishReport = {
  bootstrap: DeploymentTemplateBootstrapReport;
  compliance: TemplateComplianceReport;
  baseline: DeploymentTemplateBaselineData;
};

export type RailwayWorkspaceUploadResult = DeploymentWorkspacePublishReport & {
  deploymentId?: string;
};

export function buildDeploymentTemplateBaseline(input: {
  workspaceDetected: boolean;
  bootstrap?: DeploymentTemplateBootstrapReport | null;
  compliance?: TemplateComplianceReport | null;
  extraErrors?: string[];
}): DeploymentTemplateBaselineData {
  const bootstrap = input.bootstrap || null;
  const compliance = input.compliance || null;
  const errors = [
    ...(bootstrap?.errors || []),
    ...(compliance?.errors || []),
    ...(input.extraErrors || []).map((item) => asText(item)).filter(Boolean),
  ];
  const warnings = [
    ...(bootstrap?.warnings || []),
    ...(compliance?.warnings || []),
  ];
  const analyticsMode: DeploymentTemplateBaselineData['analyticsMode'] =
    bootstrap?.analyticsInjected
      ? 'platform_injected'
      : compliance?.checks.analyticsEntryDetected
        ? 'workspace'
        : compliance
          ? 'missing'
          : 'unknown';

  return {
    status: !input.workspaceDetected
      ? 'unavailable'
      : errors.length > 0
        ? 'needs_attention'
        : compliance
          ? 'ready'
          : 'unavailable',
    checkedAt: new Date().toISOString(),
    workspaceDetected: input.workspaceDetected,
    analyticsMode,
    manifestGenerated: Boolean(compliance?.generatedManifest),
    manifestPath: compliance?.manifestPath,
    templateVersion: compliance?.manifest.templateVersion,
    buildCommand: compliance?.manifest.build.command,
    startCommand: compliance?.manifest.start.command,
    healthcheckPath: compliance?.manifest.healthcheck.path,
    features: compliance?.manifest.features,
    checks: {
      build: compliance?.checks.buildCommandDetected ?? null,
      start: compliance?.checks.startCommandDetected ?? null,
      analytics: compliance?.checks.analyticsEntryDetected ?? null,
      healthcheck: compliance?.checks.healthcheckRouteDetected ?? null,
      database: compliance?.checks.databaseDependencyDetected ?? null,
    },
    warnings,
    errors,
  };
}

async function extractArchive(archivePath: string, outputDir: string) {
  try {
    await execFile('tar', ['-xzf', archivePath, '-C', outputDir], {
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error: any) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    throw new Error(stderr || '解压部署归档失败');
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(path: string): Promise<string> {
  if (!(await exists(path))) {
    return '';
  }
  return readFile(path, 'utf-8');
}

async function ensureRailwayConfigFile(
  sourceDir: string,
  manifest: OneCeoDeploymentManifest,
  options?: {
    force?: boolean;
  }
) {
  const railwayJsonPath = join(sourceDir, 'railway.json');
  const railwayTomlPath = join(sourceDir, 'railway.toml');
  if (!options?.force && ((await exists(railwayJsonPath)) || (await exists(railwayTomlPath)))) {
    return false;
  }
  const payload = {
    '$schema': 'https://railway.com/railway.schema.json',
    deploy: {
      startCommand: manifest.start.command,
      healthcheckPath: manifest.healthcheck.path,
    },
    build: {
      buildCommand: manifest.build.command || null,
    },
  };
  await writeFile(railwayJsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  return true;
}

async function copyDirectoryEntriesToRoot(sourceDir: string, nestedDir: string) {
  const entries = await readdir(nestedDir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXPORT_EXCLUDES.includes(entry.name) || entry.name.startsWith('.')) {
      continue;
    }
    const sourcePath = join(nestedDir, entry.name);
    const targetPath = join(sourceDir, entry.name);
    if (await exists(targetPath)) {
      continue;
    }
    await cp(sourcePath, targetPath, { recursive: true, force: false });
  }
}

async function findSingleNestedAppDirectory(sourceDir: string): Promise<string | null> {
  const rootHasDeploymentEntry =
    (await exists(join(sourceDir, 'package.json'))) ||
    (await exists(join(sourceDir, 'index.html'))) ||
    (await exists(join(sourceDir, 'client/index.html'))) ||
    (await exists(join(sourceDir, 'public/index.html'))) ||
    (await exists(join(sourceDir, 'server.js'))) ||
    (await exists(join(sourceDir, 'index.js'))) ||
    (await exists(join(sourceDir, 'app.js'))) ||
    (await exists(join(sourceDir, 'requirements.txt'))) ||
    (await exists(join(sourceDir, 'pyproject.toml'))) ||
    (await exists(join(sourceDir, 'main.py'))) ||
    (await exists(join(sourceDir, 'app.py'))) ||
    (await exists(join(sourceDir, 'server.py')));
  if (rootHasDeploymentEntry) {
    return null;
  }

  const entries = await readdir(sourceDir, { withFileTypes: true });
  const candidateDirs = entries.filter(
    (entry) =>
      entry.isDirectory() &&
      !EXPORT_EXCLUDES.includes(entry.name) &&
      !entry.name.startsWith('.')
  );
  if (candidateDirs.length !== 1) {
    return null;
  }

  const nestedDir = join(sourceDir, candidateDirs[0].name);
  const hasNestedAppEntry =
    (await exists(join(nestedDir, 'index.html'))) ||
    (await exists(join(nestedDir, 'package.json'))) ||
    (await exists(join(nestedDir, 'client/index.html'))) ||
    (await exists(join(nestedDir, 'public/index.html'))) ||
    (await exists(join(nestedDir, 'server.js'))) ||
    (await exists(join(nestedDir, 'index.js'))) ||
    (await exists(join(nestedDir, 'app.js'))) ||
    (await exists(join(nestedDir, 'requirements.txt'))) ||
    (await exists(join(nestedDir, 'pyproject.toml'))) ||
    (await exists(join(nestedDir, 'main.py'))) ||
    (await exists(join(nestedDir, 'app.py'))) ||
    (await exists(join(nestedDir, 'server.py')));
  return hasNestedAppEntry ? nestedDir : null;
}

async function ensureStaticRootDeploymentFiles(sourceDir: string) {
  const rootIndexPath = join(sourceDir, 'index.html');
  if (!(await exists(rootIndexPath))) {
    return false;
  }

  if (await exists(join(sourceDir, 'package.json'))) {
    return false;
  }

  const packageJsonPath = join(sourceDir, 'package.json');
  if (!(await exists(packageJsonPath))) {
    await writeFile(
      packageJsonPath,
      `${JSON.stringify(STATIC_TEMPLATE_PACKAGE_JSON, null, 2)}\n`,
      'utf-8'
    );
  }

  const serverPath = join(sourceDir, 'server.js');
  if (!(await exists(serverPath))) {
    await writeFile(serverPath, STATIC_TEMPLATE_SERVER_SOURCE, 'utf-8');
  }

  const manifestPath = join(sourceDir, 'oneceo.manifest.json');
  if (!(await exists(manifestPath))) {
    await writeFile(
      manifestPath,
      `${JSON.stringify(STATIC_TEMPLATE_MANIFEST, null, 2)}\n`,
      'utf-8'
    );
  }

  await ensureRailwayConfigFile(sourceDir, STATIC_TEMPLATE_MANIFEST);

  return true;
}

async function ensureBuiltFrontendDeploymentFiles(sourceDir: string) {
  const packageJsonPath = join(sourceDir, 'package.json');
  const rootIndexPath = join(sourceDir, 'index.html');
  const hasFrontendHtmlEntry = (
    await Promise.all(
      BUILT_FRONTEND_ENTRY_RELATIVE_PATHS.map(async (relativePath) =>
        exists(join(sourceDir, relativePath))
      )
    )
  ).some(Boolean);
  if (!(await exists(packageJsonPath)) || !hasFrontendHtmlEntry) {
    return false;
  }

  if (!(await exists(rootIndexPath))) {
    for (const candidate of ['public/index.html', 'client/index.html'] as const) {
      const candidatePath = join(sourceDir, candidate);
      if (!(await exists(candidatePath))) continue;
      await writeFile(rootIndexPath, await readTextIfExists(candidatePath), 'utf-8');
      break;
    }
  }

  let packageJson: Record<string, unknown>;
  try {
    packageJson = JSON.parse(await readTextIfExists(packageJsonPath)) as Record<string, unknown>;
  } catch {
    return false;
  }

  const scripts = (packageJson.scripts || {}) as Record<string, unknown>;
  const buildCommand = asText(scripts.build);
  const startCommand = asText(scripts.start);
  const shouldRewriteStartCommand =
    !startCommand || isFrontendPreviewOrDevStartCommand(startCommand);
  if (!buildCommand || !shouldRewriteStartCommand) {
    return false;
  }

  const dependencies = {
    ...((packageJson.dependencies || {}) as Record<string, unknown>),
    ...((packageJson.devDependencies || {}) as Record<string, unknown>),
  };
  const frontendSignals = [
    'vite',
    'react',
    'react-dom',
    'vue',
    'svelte',
    '@vitejs/plugin-react',
    '@vitejs/plugin-vue',
  ];
  const hasFrontendSignal =
    frontendSignals.some((name) => Boolean(asText(dependencies[name]))) ||
    (await exists(join(sourceDir, 'src'))) ||
    (await exists(join(sourceDir, 'public')));
  if (!hasFrontendSignal) {
    return false;
  }

  const nextPackageJson = {
    ...packageJson,
    scripts: {
      ...scripts,
      start: 'node server.js',
    },
  };
  await writeFile(packageJsonPath, `${JSON.stringify(nextPackageJson, null, 2)}\n`, 'utf-8');

  const serverPath = join(sourceDir, 'server.js');
  if (!(await exists(serverPath))) {
    await writeFile(serverPath, FRONTEND_DIST_SERVER_SOURCE, 'utf-8');
  }

  const manifestPath = join(sourceDir, 'oneceo.manifest.json');
  const existingManifestRaw = await readTextIfExists(manifestPath);
  let existingManifest: Record<string, unknown> = {};
  if (existingManifestRaw) {
    try {
      existingManifest = JSON.parse(existingManifestRaw) as Record<string, unknown>;
    } catch {
      existingManifest = {};
    }
  }
  const existingBuild = asObject(existingManifest.build);
  const existingFeatures = asObject(existingManifest.features);
  const existingRuntime = asObject(existingManifest.runtime);
  const nextManifest: OneCeoDeploymentManifest = {
    ...FRONTEND_DIST_TEMPLATE_MANIFEST,
    ...existingManifest,
    templateVersion: FRONTEND_DIST_TEMPLATE_MANIFEST.templateVersion,
    appType: FRONTEND_DIST_TEMPLATE_MANIFEST.appType,
    build: {
      command: asText(existingBuild.command) || FRONTEND_DIST_TEMPLATE_MANIFEST.build.command,
      outputDir: FRONTEND_DIST_TEMPLATE_MANIFEST.build.outputDir,
    },
    start: {
      command: FRONTEND_DIST_TEMPLATE_MANIFEST.start.command,
      portEnv: FRONTEND_DIST_TEMPLATE_MANIFEST.start.portEnv,
    },
    healthcheck: {
      path: FRONTEND_DIST_TEMPLATE_MANIFEST.healthcheck.path,
    },
    features: {
      ...FRONTEND_DIST_TEMPLATE_MANIFEST.features,
      ...existingFeatures,
      analytics: true,
      userTracking: true,
    },
    runtime: {
      ...FRONTEND_DIST_TEMPLATE_MANIFEST.runtime,
      ...existingRuntime,
      transport: 'http',
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf-8');

  await ensureRailwayConfigFile(sourceDir, nextManifest, { force: true });

  return true;
}

async function ensureNodeScriptDeploymentFiles(sourceDir: string) {
  if (await exists(join(sourceDir, 'package.json'))) {
    return false;
  }
  const entryCandidates = ['server.js', 'index.js', 'app.js'];
  const entryName = (
    await Promise.all(entryCandidates.map(async (item) => ((await exists(join(sourceDir, item))) ? item : '')))
  ).find(Boolean);
  if (!entryName) {
    return false;
  }

  const packageJson = {
    name: 'oneceo-node-script-app',
    private: true,
    version: '1.0.0',
    scripts: {
      build: 'node -e "console.log(\'oneceo node app ready\')"',
      start: `node ${entryName}`,
    },
  };
  const manifest: OneCeoDeploymentManifest = {
    templateVersion: '1.0.0',
    appType: 'web_app',
    stack: 'node_script_http_api_dbless',
    build: {
      command: 'npm run build',
      outputDir: '.',
    },
    start: {
      command: `node ${entryName}`,
      portEnv: 'PORT',
    },
    healthcheck: {
      path: '/health',
    },
    features: {
      analytics: true,
      userTracking: true,
      database: false,
      auth: false,
      objectStorage: false,
    },
    runtime: {
      framework: 'node_script',
      transport: 'http',
    },
  };

  await writeFile(join(sourceDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf-8');
  if (!(await exists(join(sourceDir, 'oneceo.manifest.json')))) {
    await writeFile(
      join(sourceDir, 'oneceo.manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf-8'
    );
  }
  await ensureRailwayConfigFile(sourceDir, manifest);
  return true;
}

function detectPythonStartCommand(input: {
  fileName: string;
  source: string;
}): { command: string; framework: string } {
  const moduleName = input.fileName.replace(/\.py$/i, '');
  const source = input.source;
  if (source.includes('FastAPI(') && /\bapp\s*=/.test(source)) {
    return {
      command: `uvicorn ${moduleName}:app --host 0.0.0.0 --port $PORT`,
      framework: 'fastapi',
    };
  }
  if (source.includes('Flask(') && /\bapp\s*=/.test(source)) {
    return {
      command: `gunicorn ${moduleName}:app --bind 0.0.0.0:$PORT`,
      framework: 'flask',
    };
  }
  return {
    command: `python ${input.fileName}`,
    framework: 'python',
  };
}

async function ensurePythonRootDeploymentFiles(sourceDir: string) {
  if (await exists(join(sourceDir, 'package.json'))) {
    return false;
  }
  const pythonSignal =
    (await exists(join(sourceDir, 'requirements.txt'))) ||
    (await exists(join(sourceDir, 'pyproject.toml'))) ||
    (await exists(join(sourceDir, 'main.py'))) ||
    (await exists(join(sourceDir, 'app.py'))) ||
    (await exists(join(sourceDir, 'server.py')));
  if (!pythonSignal) {
    return false;
  }

  const entryCandidates = ['main.py', 'app.py', 'server.py'];
  let selectedEntry = '';
  let selectedSource = '';
  for (const candidate of entryCandidates) {
    const candidatePath = join(sourceDir, candidate);
    if (!(await exists(candidatePath))) continue;
    selectedEntry = candidate;
    selectedSource = await readTextIfExists(candidatePath);
    break;
  }
  if (!selectedEntry) {
    return false;
  }

  const detected = detectPythonStartCommand({
    fileName: selectedEntry,
    source: selectedSource,
  });
  const manifest: OneCeoDeploymentManifest = {
    templateVersion: '1.0.0',
    appType: 'web_app',
    stack: `python_${detected.framework}_http_api_dbless`,
    build: {
      command: 'echo "oneceo python app ready"',
      outputDir: '.',
    },
    start: {
      command: detected.command,
      portEnv: 'PORT',
    },
    healthcheck: {
      path: '/health',
    },
    features: {
      analytics: true,
      userTracking: true,
      database: false,
      auth: false,
      objectStorage: false,
    },
    runtime: {
      framework: detected.framework,
      transport: 'http',
    },
  };

  if (!(await exists(join(sourceDir, 'oneceo.manifest.json')))) {
    await writeFile(
      join(sourceDir, 'oneceo.manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf-8'
    );
  }
  await ensureRailwayConfigFile(sourceDir, manifest);

  return true;
}

export async function normalizeDeploymentSourceDirectoryForPublish(sourceDir: string): Promise<{
  promotedNestedApp: boolean;
  injectedBuiltFrontendBaseline: boolean;
  injectedStaticBaseline: boolean;
  injectedNodeScriptBaseline: boolean;
  injectedPythonBaseline: boolean;
}> {
  const nestedDir = await findSingleNestedAppDirectory(sourceDir);
  let promotedNestedApp = false;
  if (nestedDir) {
    await copyDirectoryEntriesToRoot(sourceDir, nestedDir);
    promotedNestedApp = true;
  }

  const injectedBuiltFrontendBaseline = await ensureBuiltFrontendDeploymentFiles(sourceDir);
  const injectedStaticBaseline = injectedBuiltFrontendBaseline
    ? false
    : await ensureStaticRootDeploymentFiles(sourceDir);
  const injectedNodeScriptBaseline = injectedBuiltFrontendBaseline || injectedStaticBaseline
    ? false
    : await ensureNodeScriptDeploymentFiles(sourceDir);
  const injectedPythonBaseline =
    injectedBuiltFrontendBaseline || injectedStaticBaseline || injectedNodeScriptBaseline
      ? false
      : await ensurePythonRootDeploymentFiles(sourceDir);
  const manifestPath = join(sourceDir, 'oneceo.manifest.json');
  if (await exists(manifestPath)) {
    try {
      const manifest = JSON.parse(await readTextIfExists(manifestPath)) as OneCeoDeploymentManifest;
      await ensureRailwayConfigFile(sourceDir, manifest);
    } catch {
      // manifest 校验交给模板合规阶段处理，这里只做最佳努力生成 Railway config
    }
  }
  return {
    promotedNestedApp,
    injectedBuiltFrontendBaseline,
    injectedStaticBaseline,
    injectedNodeScriptBaseline,
    injectedPythonBaseline,
  };
}

async function exportWorkspaceToLocalDirectory(
  orchestratorSessionId: string,
  workspaceRoot: string
): Promise<string> {
  const normalizedSessionId = asText(orchestratorSessionId);
  const normalizedWorkspaceRoot = asText(workspaceRoot);
  if (!normalizedSessionId || !normalizedWorkspaceRoot) {
    throw new Error('缺少工作区信息，无法导出部署源码');
  }

  const sandboxArchivePath = `/tmp/oneceo-deployment-source-${Date.now()}.tar.gz`;
  const excludeArgs = EXPORT_EXCLUDES.map((item) => `--exclude=${item}`).join(' ');
  const command = [
    `test -d ${shellEscape(normalizedWorkspaceRoot)}`,
    `tar -czf ${shellEscape(sandboxArchivePath)} ${excludeArgs} -C ${shellEscape(normalizedWorkspaceRoot)} .`,
  ].join(' && ');

  await e2bConnector.runCommand(normalizedSessionId, command, {
    timeoutMs: 3 * 60 * 1000,
  });

  const archiveBytes = await e2bConnector.readFile(normalizedSessionId, sandboxArchivePath);
  await e2bConnector.runCommand(normalizedSessionId, `rm -f ${shellEscape(sandboxArchivePath)}`, {
    timeoutMs: 30 * 1000,
  }).catch(() => undefined);

  const localTempDir = await mkdtemp(join(tmpdir(), 'oneceo-deployment-src-'));
  const archivePath = join(localTempDir, 'workspace.tar.gz');
  await writeFile(archivePath, Buffer.from(archiveBytes));
  await extractArchive(archivePath, localTempDir);
  await rm(archivePath, { force: true });
  return localTempDir;
}

export async function publishTaskSessionWorkspaceToRepository(input: {
  orchestratorSessionId: string;
  workspaceRoot: string;
  repository: ManagedDeploymentRepository;
  sessionId: string;
  analyticsConfig?: DeploymentTemplateAnalyticsConfig;
}): Promise<DeploymentWorkspacePublishReport> {
  const sourceDir = await exportWorkspaceToLocalDirectory(input.orchestratorSessionId, input.workspaceRoot);
  try {
    await normalizeDeploymentSourceDirectoryForPublish(sourceDir);
    const bootstrap = await ensureDeploymentTemplateBootstrap(sourceDir, {
      analyticsConfig: input.analyticsConfig,
    });
    if (bootstrap.warnings.length > 0) {
      console.warn('[DEPLOYMENT_TEMPLATE_BOOTSTRAP_WARNINGS]', {
        sessionId: input.sessionId,
        warnings: bootstrap.warnings,
        analyticsTargetPath: bootstrap.analyticsTargetPath,
      });
    }
    if (bootstrap.errors.length > 0) {
      throw new Error(`部署模板注入失败：${bootstrap.errors.join('；')}`);
    }
    const compliance = await ensureTemplateCompliance(sourceDir);
    await ensureRailwayConfigFile(sourceDir, compliance.manifest);
    if (compliance.warnings.length > 0) {
      console.warn('[DEPLOYMENT_TEMPLATE_COMPLIANCE_WARNINGS]', {
        sessionId: input.sessionId,
        warnings: compliance.warnings,
        manifestPath: compliance.manifestPath,
        generatedManifest: compliance.generatedManifest,
      });
    }
    if (!compliance.ok) {
      throw new Error(`部署前检查失败：${compliance.errors.join('；')}`);
    }
    await pushDirectoryToManagedRepository(input.repository, sourceDir, {
      commitMessage: `chore: deploy session ${input.sessionId} ${new Date().toISOString()}`,
    });
    return {
      bootstrap,
      compliance,
      baseline: buildDeploymentTemplateBaseline({
        workspaceDetected: true,
        bootstrap,
        compliance,
      }),
    };
  } finally {
    await rm(sourceDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runRailwayUpFromDirectory(input: {
  sourceDir: string;
  token: string;
  projectId: string;
  environmentId: string;
  serviceId: string;
  message?: string;
}) {
  const railwayBinary = process.env.RAILWAY_CLI_PATH || 'railway';
  const args = [
    'up',
    '-d',
    '--json',
    '-p',
    input.projectId,
    '-e',
    input.environmentId,
    '-s',
    input.serviceId,
    '--path-as-root',
    '.',
  ];
  const message = asText(input.message);
  if (message) {
    args.push('-m', message);
  }

  const maxAttempts = 5;
  const baseDelayMs = 2000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { stdout } = await execFile(railwayBinary, args, {
        cwd: input.sourceDir,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          CI: 'true',
          RAILWAY_TOKEN: input.token,
        },
      });
      const payload = JSON.parse(stdout || '{}') as {
        deploymentId?: unknown;
      };
      return asText(payload.deploymentId) || undefined;
    } catch (error: any) {
      const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
      const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
      const raw = stderr || stdout || error?.message || 'Railway 直传部署失败';
      const normalized = raw.toLowerCase();
      const shouldRetry =
        attempt < maxAttempts &&
        (normalized.includes('failed to upload code with status code 404') ||
          normalized.includes('status code 404 not found') ||
          normalized.includes('service not found'));
      if (!shouldRetry) {
        throw new Error(raw);
      }
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }

  throw new Error('Railway 直传部署失败');
}

export async function uploadTaskSessionWorkspaceToRailway(input: {
  orchestratorSessionId: string;
  workspaceRoot: string;
  sessionId: string;
  railway: {
    token: string;
    projectId: string;
    environmentId: string;
    serviceId: string;
    message?: string;
  };
  analyticsConfig?: DeploymentTemplateAnalyticsConfig;
}): Promise<RailwayWorkspaceUploadResult> {
  const sourceDir = await exportWorkspaceToLocalDirectory(input.orchestratorSessionId, input.workspaceRoot);
  try {
    await normalizeDeploymentSourceDirectoryForPublish(sourceDir);
    const bootstrap = await ensureDeploymentTemplateBootstrap(sourceDir, {
      analyticsConfig: input.analyticsConfig,
    });
    if (bootstrap.warnings.length > 0) {
      console.warn('[DEPLOYMENT_TEMPLATE_BOOTSTRAP_WARNINGS]', {
        sessionId: input.sessionId,
        warnings: bootstrap.warnings,
        analyticsTargetPath: bootstrap.analyticsTargetPath,
      });
    }
    if (bootstrap.errors.length > 0) {
      throw new Error(`部署模板注入失败：${bootstrap.errors.join('；')}`);
    }
    const compliance = await ensureTemplateCompliance(sourceDir);
    await ensureRailwayConfigFile(sourceDir, compliance.manifest, { force: true });
    if (compliance.warnings.length > 0) {
      console.warn('[DEPLOYMENT_TEMPLATE_COMPLIANCE_WARNINGS]', {
        sessionId: input.sessionId,
        warnings: compliance.warnings,
        manifestPath: compliance.manifestPath,
        generatedManifest: compliance.generatedManifest,
      });
    }
    if (!compliance.ok) {
      throw new Error(`部署前检查失败：${compliance.errors.join('；')}`);
    }
    const baseline = buildDeploymentTemplateBaseline({
      workspaceDetected: true,
      bootstrap,
      compliance,
    });
    const deploymentId = await runRailwayUpFromDirectory({
      sourceDir,
      token: input.railway.token,
      projectId: input.railway.projectId,
      environmentId: input.railway.environmentId,
      serviceId: input.railway.serviceId,
      message: input.railway.message,
    });
    return {
      bootstrap,
      compliance,
      baseline,
      deploymentId,
    };
  } finally {
    await rm(sourceDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function inspectTaskSessionDeploymentTemplate(input: {
  orchestratorSessionId: string;
  workspaceRoot: string;
}): Promise<DeploymentTemplateBaselineData> {
  const normalizedSessionId = asText(input.orchestratorSessionId);
  const normalizedWorkspaceRoot = asText(input.workspaceRoot);
  if (!normalizedSessionId || !normalizedWorkspaceRoot) {
    return buildDeploymentTemplateBaseline({
      workspaceDetected: false,
      extraErrors: ['未找到可检查的工作区'],
    });
  }

  const sourceDir = await exportWorkspaceToLocalDirectory(
    normalizedSessionId,
    normalizedWorkspaceRoot
  );
  try {
    await normalizeDeploymentSourceDirectoryForPublish(sourceDir);
    const bootstrap = await ensureDeploymentTemplateBootstrap(sourceDir);
    try {
      const compliance = await ensureTemplateCompliance(sourceDir);
      await ensureRailwayConfigFile(sourceDir, compliance.manifest);
      return buildDeploymentTemplateBaseline({
        workspaceDetected: true,
        bootstrap,
        compliance,
      });
    } catch (error: any) {
      return buildDeploymentTemplateBaseline({
        workspaceDetected: true,
        bootstrap,
        extraErrors: [error?.message || '模板检查失败'],
      });
    }
  } finally {
    await rm(sourceDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
