import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { e2bConnector } from '../connectors/e2b-connector';
import { taskCreationSessionDAO, taskSessionRunDAO } from '../db/dao';
import { downloadFromR2, uploadToR2 } from './r2-client';
import type { AltusManagedTaskIntentProfile } from './altus-managed-prompt-service';
import type { TaskSessionDeliverableArtifactRecord } from './task-session-deliverable-service';

export type WebsitePreviewSnapshotStatus =
  | 'captured'
  | 'capture_unavailable'
  | 'capture_failed'
  | 'storage_failed';

export type WebsitePreviewSnapshot = {
  kind: 'website_screenshot';
  status: WebsitePreviewSnapshotStatus;
  storageKey?: string;
  mimeType?: 'image/png';
  width?: number;
  height?: number;
  capturedAt?: string;
  reasonCode?: string;
  message?: string;
  source?: {
    sandboxId?: string;
    port?: number;
    url?: string;
    command?: string;
    logPath?: string;
  };
  visualCheck?: BrowserVisualCheck;
};

export type WebsitePreviewSnapshotImage = {
  body: Buffer;
  mimeType: 'image/png';
};

export type BrowserActionScreenshotStatus = 'captured' | 'capture_failed' | 'storage_failed';

export type BrowserActionScreenshot = {
  type: 'browser_screenshot';
  kind: 'browser_action_screenshot';
  status: BrowserActionScreenshotStatus;
  storageKey?: string;
  mimeType?: 'image/png';
  width?: number;
  height?: number;
  capturedAt?: string;
  reasonCode?: string;
  message?: string;
  source?: {
    sandboxId?: string;
    cdpPort?: number;
    url?: string;
    title?: string;
    toolName?: string;
    action?: string;
    description?: string;
  };
  visualCheck?: BrowserVisualCheck;
};

export type BrowserVisualCheckStatus = 'passed' | 'failed';

export type BrowserVisualCheck = {
  status: BrowserVisualCheckStatus;
  reasonCode?: string;
  message?: string;
  diagnostics?: Record<string, unknown>;
};

type E2BLikeConnector = Pick<typeof e2bConnector, 'readFile' | 'runCommand'>;

type WebsitePreviewSnapshotDeps = {
  e2b: E2BLikeConnector;
  uploadToR2: typeof uploadToR2;
  downloadFromR2: typeof downloadFromR2;
};

type CommandCandidate = {
  command: string;
  port: number;
  reason: string;
  appendVitePortArgs?: boolean;
};

const HTML_PREVIEW_FALLBACK_PATHS = ['index.html', 'public/index.html', 'dist/index.html'];

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  if (!value.trim()) return null;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function readBrowserVisualCheck(value: unknown): BrowserVisualCheck | undefined {
  const record = asRecord(value);
  const status = asText(record.status) as BrowserVisualCheckStatus;
  if (status !== 'passed' && status !== 'failed') {
    return undefined;
  }
  const diagnostics = asRecord(record.diagnostics);
  return {
    status,
    reasonCode: asText(record.reasonCode) || undefined,
    message: asText(record.message) || undefined,
    diagnostics: Object.keys(diagnostics).length > 0 ? diagnostics : undefined,
  };
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '').trim();
  if (!normalized || normalized.split('/').some((part) => part === '..')) return '';
  return normalized;
}

function isHtmlPath(value: string): boolean {
  return /\.html?$/i.test(value);
}

function buildWorkspaceFileUrl(workspaceRoot: string, relativePath: string): string {
  const absolutePath = path.posix.join(workspaceRoot, normalizeRelativePath(relativePath));
  const encodedPath = absolutePath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `file://${encodedPath.startsWith('/') ? '' : '/'}${encodedPath}`;
}

function extractNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function extractPortFromCommand(command: string): number | null {
  const match =
    command.match(/(?:--port|-p)\s+(\d{2,5})/) ||
    command.match(/:(\d{2,5})(?:\b|["'])/) ||
    command.match(/PORT=(\d{2,5})/);
  if (!match) return null;
  return extractNumber(match[1]);
}

function getDefaultPortForScript(scriptName: string, scriptCommand: string): number {
  const normalized = `${scriptName} ${scriptCommand}`.toLowerCase();
  if (scriptName === 'preview') return 4173;
  if (scriptName === 'dev' && normalized.includes('vite')) return 5173;
  return 3000;
}

function inferPackageManager(packageJson: Record<string, unknown>): 'pnpm' | 'yarn' | 'bun' | 'npm' {
  const packageManager = asText(packageJson.packageManager).toLowerCase();
  if (packageManager.startsWith('pnpm@')) return 'pnpm';
  if (packageManager.startsWith('yarn@')) return 'yarn';
  if (packageManager.startsWith('bun@')) return 'bun';
  return 'npm';
}

function buildScriptCommand(manager: 'pnpm' | 'yarn' | 'bun' | 'npm', scriptName: string): string {
  if (manager === 'pnpm') return `pnpm ${scriptName}`;
  if (manager === 'yarn') return `yarn ${scriptName}`;
  if (manager === 'bun') return `bun run ${scriptName}`;
  return `npm run ${scriptName}`;
}

function isViteLikeScript(scriptName: string, scriptCommand: string): boolean {
  const normalized = `${scriptName} ${scriptCommand}`.toLowerCase();
  return (
    normalized.includes('vite') ||
    normalized.includes('react-scripts start') ||
    scriptName === 'dev' ||
    scriptName === 'preview'
  );
}

export function shouldCaptureWebsitePreview(input: {
  taskIntentProfile?: AltusManagedTaskIntentProfile | null;
  attachments?: Array<{ path?: string | null }>;
  deliverables?: Array<{ path?: string | null }>;
  manifestExists?: boolean;
  packageExists?: boolean;
  debugOpenPageSucceeded?: boolean;
}): boolean {
  const profile = input.taskIntentProfile;
  if (profile?.mode === 'deployable_web_app' || profile?.webArtifactRequested) {
    return true;
  }
  if (input.manifestExists) {
    return true;
  }
  const paths = [
    ...(input.attachments || []).map((item) => asText(item.path)),
    ...(input.deliverables || []).map((item) => asText(item.path)),
  ];
  if (paths.some(isHtmlPath) && input.packageExists) {
    return true;
  }
  return Boolean(input.debugOpenPageSucceeded);
}

export function readPreviewSnapshot(value: unknown): WebsitePreviewSnapshot | null {
  const record = asRecord(value);
  const status = asText(record.status) as WebsitePreviewSnapshotStatus;
  if (
    record.kind !== 'website_screenshot' ||
    !['captured', 'capture_unavailable', 'capture_failed', 'storage_failed'].includes(status)
  ) {
    return null;
  }
  const sourceRecord = asRecord(record.source);
  const port = extractNumber(sourceRecord.port);
  return {
    kind: 'website_screenshot',
    status,
    storageKey: asText(record.storageKey) || undefined,
    mimeType: record.mimeType === 'image/png' ? 'image/png' : undefined,
    width: extractNumber(record.width) || undefined,
    height: extractNumber(record.height) || undefined,
    capturedAt: asText(record.capturedAt) || undefined,
    reasonCode: asText(record.reasonCode) || undefined,
    message: asText(record.message) || undefined,
    visualCheck: readBrowserVisualCheck(record.visualCheck),
    source: {
      sandboxId: asText(sourceRecord.sandboxId) || undefined,
      port: port || undefined,
      url: asText(sourceRecord.url) || undefined,
      command: asText(sourceRecord.command) || undefined,
      logPath: asText(sourceRecord.logPath) || undefined,
    },
  };
}

export function readBrowserActionScreenshot(value: unknown): BrowserActionScreenshot | null {
  const record = asRecord(value);
  const status = asText(record.status) as BrowserActionScreenshotStatus;
  if (
    record.type !== 'browser_screenshot' ||
    record.kind !== 'browser_action_screenshot' ||
    !['captured', 'capture_failed', 'storage_failed'].includes(status)
  ) {
    return null;
  }
  const sourceRecord = asRecord(record.source);
  const cdpPort = extractNumber(sourceRecord.cdpPort);
  return {
    type: 'browser_screenshot',
    kind: 'browser_action_screenshot',
    status,
    storageKey: asText(record.storageKey) || undefined,
    mimeType: record.mimeType === 'image/png' ? 'image/png' : undefined,
    width: extractNumber(record.width) || undefined,
    height: extractNumber(record.height) || undefined,
    capturedAt: asText(record.capturedAt) || undefined,
    reasonCode: asText(record.reasonCode) || undefined,
    message: asText(record.message) || undefined,
    visualCheck: readBrowserVisualCheck(record.visualCheck),
    source: {
      sandboxId: asText(sourceRecord.sandboxId) || undefined,
      cdpPort: cdpPort || undefined,
      url: asText(sourceRecord.url) || undefined,
      title: asText(sourceRecord.title) || undefined,
      toolName: asText(sourceRecord.toolName) || undefined,
      action: asText(sourceRecord.action) || undefined,
      description: asText(sourceRecord.description) || undefined,
    },
  };
}

function buildFailureSnapshot(input: {
  status: Exclude<WebsitePreviewSnapshotStatus, 'captured'>;
  reasonCode: string;
  message: string;
  sandboxId?: string | null;
  port?: number | null;
  url?: string | null;
  command?: string | null;
  logPath?: string | null;
}): WebsitePreviewSnapshot {
  return {
    kind: 'website_screenshot',
    status: input.status,
    reasonCode: input.reasonCode,
    message: input.message,
    source: {
      sandboxId: asText(input.sandboxId) || undefined,
      port: input.port || undefined,
      url: asText(input.url) || undefined,
      command: asText(input.command) || undefined,
      logPath: asText(input.logPath) || undefined,
    },
  };
}

function buildVisualCheckFailureSnapshot(input: {
  visualCheck: BrowserVisualCheck;
  sandboxId?: string | null;
  port?: number | null;
  url?: string | null;
  command?: string | null;
  logPath?: string | null;
}): WebsitePreviewSnapshot {
  const reason = asText(input.visualCheck.reasonCode) || 'visual_check_failed';
  const message = asText(input.visualCheck.message) || '页面截图未通过视觉健康诊断';
  return {
    kind: 'website_screenshot',
    status: 'capture_failed',
    reasonCode: 'preview_visual_check_failed',
    message: `${reason}: ${message}`,
    visualCheck: input.visualCheck,
    source: {
      sandboxId: asText(input.sandboxId) || undefined,
      port: input.port || undefined,
      url: asText(input.url) || undefined,
      command: asText(input.command) || undefined,
      logPath: asText(input.logPath) || undefined,
    },
  };
}

function truncateMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  return raw.replace(/\s+/g, ' ').trim().slice(0, 500) || 'unknown error';
}

export class TaskSessionWebsitePreviewSnapshotService {
  constructor(
    private readonly deps: WebsitePreviewSnapshotDeps = {
      e2b: e2bConnector,
      uploadToR2,
      downloadFromR2,
    }
  ) {}

  private buildStorageKey(input: { sessionId: string; runId: string }) {
    const stable = createHash('sha256')
      .update(`${input.sessionId}:${input.runId}`)
      .digest('hex')
      .slice(0, 12);
    return ['sessions', input.sessionId, 'previews', input.runId, `${Date.now()}-${stable}.png`].join('/');
  }

  private async readWorkspaceText(sandboxId: string, workspaceRoot: string, relativePath: string) {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized) return '';
    try {
      const bytes = await this.deps.e2b.readFile(sandboxId, path.posix.join(workspaceRoot, normalized));
      return Buffer.from(bytes).toString('utf8');
    } catch {
      return '';
    }
  }

  private resolveArtifactHtmlPreviewPath(input: {
    attachments?: Array<{ path?: string | null }>;
    deliverables?: Array<{ path?: string | null }>;
  }) {
    const paths = [
      ...(input.deliverables || []).map((item) => asText(item.path)),
      ...(input.attachments || []).map((item) => asText(item.path)),
    ];
    for (const itemPath of paths) {
      const normalized = normalizeRelativePath(itemPath);
      if (normalized && isHtmlPath(normalized)) return normalized;
    }
    return null;
  }

  private async resolveDebugOpenedHtmlPreviewPath(input: {
    sandboxId: string;
    workspaceRoot: string;
    attachments?: Array<{ path?: string | null }>;
    deliverables?: Array<{ path?: string | null }>;
    debugOpenPageSucceeded?: boolean;
  }) {
    const artifactPath = this.resolveArtifactHtmlPreviewPath(input);
    if (artifactPath) return artifactPath;
    if (!input.debugOpenPageSucceeded) return null;

    for (const fallbackPath of HTML_PREVIEW_FALLBACK_PATHS) {
      const html = await this.readWorkspaceText(input.sandboxId, input.workspaceRoot, fallbackPath);
      if (html.trim()) return fallbackPath;
    }
    return null;
  }

  private resolveCommandCandidate(input: {
    manifest: Record<string, unknown> | null;
    packageJson: Record<string, unknown> | null;
  }): CommandCandidate | null {
    const manifestStart = asRecord(input.manifest?.start);
    const manifestCommand = asText(manifestStart.command);
    if (manifestCommand) {
      const manifestPort = extractNumber(manifestStart.port) || extractNumber(manifestStart.defaultPort);
      return {
        command: manifestCommand,
        port: extractPortFromCommand(manifestCommand) || manifestPort || 3000,
        reason: 'manifest_start',
        appendVitePortArgs: isViteLikeScript('start', manifestCommand),
      };
    }

    const scripts = asRecord(input.packageJson?.scripts);
    const manager = input.packageJson ? inferPackageManager(input.packageJson) : 'npm';
    for (const scriptName of ['start', 'dev', 'preview']) {
      const scriptCommand = asText(scripts[scriptName]);
      if (!scriptCommand) continue;
      return {
        command: buildScriptCommand(manager, scriptName),
        port: extractPortFromCommand(scriptCommand) || getDefaultPortForScript(scriptName, scriptCommand),
        reason: `package_script_${scriptName}`,
        appendVitePortArgs: isViteLikeScript(scriptName, scriptCommand),
      };
    }

    return null;
  }

  private buildStartCommand(input: {
    command: string;
    port: number;
    runId: string;
    logPath: string;
    appendVitePortArgs?: boolean;
  }) {
    const command =
      input.appendVitePortArgs && !/(?:--port|-p)\s+\d{2,5}/.test(input.command)
        ? `${input.command} -- --host 0.0.0.0 --port ${input.port}`
        : input.command;
    return [
      'set -e',
      `if curl -fsS --max-time 2 ${shellEscape(`http://127.0.0.1:${input.port}/`)} >/dev/null 2>&1; then`,
      '  echo "already_ready"',
      '  exit 0',
      'fi',
      `export PORT=${input.port}`,
      'export HOST=0.0.0.0',
      `nohup sh -lc ${shellEscape(command)} > ${shellEscape(input.logPath)} 2>&1 &`,
      `echo $! > ${shellEscape(`/tmp/oneceo-preview-${input.runId}.pid`)}`,
      'echo "started"',
    ].join('\n');
  }

  private async waitForPort(sandboxId: string, port: number) {
    const result = await this.deps.e2b.runCommand(
      sandboxId,
      [
        'set +e',
        'for i in $(seq 1 45); do',
        `  curl -fsS --max-time 2 ${shellEscape(`http://127.0.0.1:${port}/`)} >/dev/null 2>&1 && exit 0`,
        '  sleep 1',
        'done',
        'exit 1',
      ].join('\n'),
      { timeoutMs: 50_000 }
    );
    return Number((result as any)?.exitCode ?? 1) === 0;
  }

  private async captureScreenshot(input: {
    sandboxId: string;
    url: string;
    outputPath: string;
    width: number;
    height: number;
  }): Promise<{ captured: boolean; visualCheck?: BrowserVisualCheck; stdout?: string; stderr?: string }> {
    const payload = {
      url: input.url,
      outputPath: input.outputPath,
      domPath: `${input.outputPath}.dom.html`,
      width: input.width,
      height: input.height,
    };
    const command = `
set -euo pipefail
PLAYWRIGHT_BROWSERS_PATH="\${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright}"
CHROME_BIN=""
if command -v chromium-browser >/dev/null 2>&1; then
  CHROME_BIN=$(command -v chromium-browser)
elif command -v chromium >/dev/null 2>&1; then
  CHROME_BIN=$(command -v chromium)
else
  for candidate in "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-linux*/chrome; do
    if [ -x "$candidate" ]; then
      CHROME_BIN="$candidate"
      break
    fi
  done
fi
if [ -z "$CHROME_BIN" ]; then
  echo "chromium_not_found"
  exit 44
fi
rm -f ${shellEscape(input.outputPath)}
"$CHROME_BIN" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --hide-scrollbars \
  --window-size=${input.width},${input.height} \
  --virtual-time-budget=5000 \
  --screenshot=${shellEscape(input.outputPath)} \
  ${shellEscape(input.url)}
test -s ${shellEscape(input.outputPath)}
set +e
"$CHROME_BIN" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --window-size=${input.width},${input.height} \
  --virtual-time-budget=5000 \
  --dump-dom \
  ${shellEscape(input.url)} > ${shellEscape(`${input.outputPath}.dom.html`)} 2>/tmp/oneceo-preview-dump-dom.err
set -e
ONECEO_PREVIEW_SCREENSHOT=${shellEscape(JSON.stringify(payload))} node <<'NODE'
const fs = require('fs');
const zlib = require('zlib');

const payload = JSON.parse(process.env.ONECEO_PREVIEW_SCREENSHOT || '{}');

function assessVisualHealth(diagnostics) {
  const url = String(diagnostics.url || '');
  const title = String(diagnostics.title || '');
  const bodyTextLength = Number(diagnostics.bodyTextLength || 0);
  const visibleTextLength = Number(diagnostics.visibleTextLength || 0);
  const visibleElementCount = Number(diagnostics.visibleElementCount || 0);
  const documentHeight = Number(diagnostics.documentHeight || 0);
  const uniqueColorCount = Number(diagnostics.uniqueColorCount || 0);
  const dominantColorRatio = Number(diagnostics.dominantColorRatio || 0);
  const nearWhiteRatio = Number(diagnostics.nearWhiteRatio || 0);
  const nearBlackRatio = Number(diagnostics.nearBlackRatio || 0);
  const rootTextLength = Number(diagnostics.rootTextLength || 0);
  const appStatus = String(diagnostics.oneCeoAppStatus || '');
  const appRootStatus = String(diagnostics.oneCeoRootStatus || '');
  const appErrors = Array.isArray(diagnostics.oneCeoAppErrors) ? diagnostics.oneCeoAppErrors : [];

  if (!url || url === 'about:blank') {
    return { status: 'failed', reasonCode: 'blank_page_url', message: '浏览器页面仍停留在空白地址。' };
  }
  if (/chrome-error:\\/\\//i.test(url) || /^(404|500|502|503|504)\\b/.test(title) || /ERR_[A-Z_]+/.test(title)) {
    return { status: 'failed', reasonCode: 'chrome_error_page', message: '浏览器打开的是错误页，不是生成的网站页面。' };
  }
  if (appStatus === 'error' || appRootStatus === 'error') {
    return {
      status: 'failed',
      reasonCode: 'app_runtime_error',
      message: appErrors.length > 0 ? '页面浏览器运行时报错：' + String(appErrors[0]).slice(0, 240) : '页面浏览器运行时报错，疑似入口模块或 React 渲染失败。',
    };
  }
  if (bodyTextLength < 8 && visibleTextLength < 8 && visibleElementCount < 3) {
    return { status: 'failed', reasonCode: 'visible_text_too_short', message: '页面可见文本和元素过少，疑似白屏或空页面。' };
  }
  if (rootTextLength < 4 && visibleTextLength < 8) {
    return { status: 'failed', reasonCode: 'app_root_empty', message: '应用根节点没有渲染出有效内容。' };
  }
  if (documentHeight > 0 && documentHeight < 40 && visibleTextLength < 8) {
    return { status: 'failed', reasonCode: 'document_too_small', message: '页面文档高度过小，疑似没有完成渲染。' };
  }
  if (uniqueColorCount <= 4 && dominantColorRatio >= 0.97) {
    return { status: 'failed', reasonCode: 'screenshot_low_entropy', message: '截图几乎是单一颜色，疑似白屏或纯色空页面。' };
  }
  if ((nearWhiteRatio >= 0.985 || nearBlackRatio >= 0.985) && visibleTextLength < 20 && uniqueColorCount <= 12) {
    return { status: 'failed', reasonCode: 'screenshot_near_blank', message: '截图接近纯白或纯黑，且缺少可见文本。' };
  }
  return { status: 'passed' };
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function readPngPixelDiagnostics(outputPath) {
  try {
    const buffer = fs.readFileSync(outputPath);
    if (buffer.length < 33 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
      return { pixelDiagnosticError: 'not_png' };
    }
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idat = [];
    while (offset + 12 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > buffer.length) break;
      if (type === 'IHDR') {
        width = buffer.readUInt32BE(dataStart);
        height = buffer.readUInt32BE(dataStart + 4);
        bitDepth = buffer[dataStart + 8];
        colorType = buffer[dataStart + 9];
      } else if (type === 'IDAT') {
        idat.push(buffer.subarray(dataStart, dataEnd));
      } else if (type === 'IEND') {
        break;
      }
      offset = dataEnd + 4;
    }
    if (!width || !height || bitDepth !== 8 || ![0, 2, 6].includes(colorType) || idat.length === 0) {
      return { pixelDiagnosticError: 'unsupported_png' };
    }
    const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
    const bytesPerPixel = channels;
    const stride = width * bytesPerPixel;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const sampleXStep = Math.max(1, Math.floor(width / 160));
    const sampleYStep = Math.max(1, Math.floor(height / 90));
    let previous = Buffer.alloc(stride);
    let inputOffset = 0;
    const buckets = new Map();
    let nearWhite = 0;
    let nearBlack = 0;
    let opaque = 0;
    for (let y = 0; y < height; y += 1) {
      const filter = raw[inputOffset];
      inputOffset += 1;
      const scanline = Buffer.from(raw.subarray(inputOffset, inputOffset + stride));
      inputOffset += stride;
      for (let x = 0; x < stride; x += 1) {
        const left = x >= bytesPerPixel ? scanline[x - bytesPerPixel] : 0;
        const up = previous[x] || 0;
        const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] || 0 : 0;
        if (filter === 1) {
          scanline[x] = (scanline[x] + left) & 255;
        } else if (filter === 2) {
          scanline[x] = (scanline[x] + up) & 255;
        } else if (filter === 3) {
          scanline[x] = (scanline[x] + Math.floor((left + up) / 2)) & 255;
        } else if (filter === 4) {
          scanline[x] = (scanline[x] + paethPredictor(left, up, upLeft)) & 255;
        }
      }
      if (y % sampleYStep === 0) {
        for (let x = 0; x < width; x += sampleXStep) {
          const index = x * bytesPerPixel;
          let r;
          let g;
          let b;
          let a = 255;
          if (colorType === 0) {
            r = g = b = scanline[index];
          } else {
            r = scanline[index];
            g = scanline[index + 1];
            b = scanline[index + 2];
            if (colorType === 6) a = scanline[index + 3];
          }
          if (a < 8) continue;
          opaque += 1;
          if (r > 245 && g > 245 && b > 245) nearWhite += 1;
          if (r < 10 && g < 10 && b < 10) nearBlack += 1;
          const bucket = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
        }
      }
      previous = scanline;
    }
    const total = Math.max(1, opaque);
    let dominant = 0;
    for (const count of buckets.values()) dominant = Math.max(dominant, count);
    return {
      screenshotPixelWidth: width,
      screenshotPixelHeight: height,
      sampledPixelCount: total,
      uniqueColorCount: buckets.size,
      dominantColorRatio: dominant / total,
      nearWhiteRatio: nearWhite / total,
      nearBlackRatio: nearBlack / total,
    };
  } catch (error) {
    return { pixelDiagnosticError: error && error.message ? error.message : String(error || '') };
  }
}

function textFromHtml(html) {
  return String(html || '')
    .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ')
    .replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

function readDomDiagnostics(domPath) {
  let html = '';
  try {
    html = fs.readFileSync(domPath, 'utf8');
  } catch {}
  const title = (html.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i) || [])[1] || '';
  const rootMatch = html.match(/<(?:div|main|section)[^>]+(?:id=["'](?:root|app)["']|data-reactroot)[^>]*>([\\s\\S]*?)<\\/(?:div|main|section)>/i);
  const rootText = textFromHtml(rootMatch ? rootMatch[1] : '');
  const text = textFromHtml(html);
  const elementMatches = html.match(/<(?:div|main|section|article|header|footer|nav|h1|h2|h3|p|a|button|img|form|input|ul|ol|li)\\b/gi) || [];
  const heightMatch = html.match(/height:\\s*(\\d{2,5})px/i);
  const appStatusMatch = html.match(/__ONECEO_APP_STATUS__[^\\n]+status["']?\\s*[:=]\\s*["']([^"']+)["']/i);
  const rootStatusMatch = html.match(/data-oneceo-app-status=["']([^"']+)["']/i);
  const runtimeErrorMatch = html.match(/OneCEO browser runtime error/i);
  return {
    url: payload.url,
    title: title.replace(/\\s+/g, ' ').trim(),
    bodyTextLength: text.length,
    visibleTextLength: text.length,
    visibleElementCount: elementMatches.length,
    rootTextLength: rootText.length || text.length,
    oneCeoAppStatus: runtimeErrorMatch ? 'error' : (appStatusMatch ? appStatusMatch[1] : ''),
    oneCeoRootStatus: runtimeErrorMatch ? 'error' : (rootStatusMatch ? rootStatusMatch[1] : ''),
    oneCeoAppErrors: runtimeErrorMatch ? ['OneCEO browser runtime error'] : [],
    documentHeight: heightMatch ? Number(heightMatch[1]) : 0,
  };
}

const diagnostics = {
  ...readDomDiagnostics(payload.domPath),
  ...readPngPixelDiagnostics(payload.outputPath),
};
const visualCheck = {
  ...assessVisualHealth(diagnostics),
  diagnostics,
};
console.log(JSON.stringify({
  ok: true,
  url: payload.url,
  title: diagnostics.title || '',
  outputPath: payload.outputPath,
  visualCheck,
}));
NODE
`;
    const result = await this.deps.e2b.runCommand(input.sandboxId, command, {
      timeoutMs: 30_000,
    });
    const stdout = String((result as any)?.stdout || '');
    const stderr = String((result as any)?.stderr || '');
    const visualCheck = stdout
      .split('\n')
      .map((line) => parseJsonRecord(line)?.visualCheck)
      .map((item) => readBrowserVisualCheck(item))
      .find(Boolean);
    return {
      captured: Number((result as any)?.exitCode ?? 1) === 0 && !stdout.includes('chromium_not_found'),
      visualCheck,
      stdout,
      stderr,
    };
  }

  async captureManagedRunPreview(input: {
    sessionId: string;
    runId: string;
    sandboxId: string;
    workspaceRoot: string;
    taskIntentProfile?: AltusManagedTaskIntentProfile | null;
    attachments?: Array<{ path?: string | null }>;
    deliverables?: TaskSessionDeliverableArtifactRecord[];
    debugOpenPageSucceeded?: boolean;
  }): Promise<WebsitePreviewSnapshot | null> {
    const [manifestText, packageText] = await Promise.all([
      this.readWorkspaceText(input.sandboxId, input.workspaceRoot, 'oneceo.manifest.json'),
      this.readWorkspaceText(input.sandboxId, input.workspaceRoot, 'package.json'),
    ]);
    const manifest = parseJsonRecord(manifestText);
    const packageJson = parseJsonRecord(packageText);
    const manifestExists = Boolean(manifest);
    const packageExists = Boolean(packageJson);

    if (!shouldCaptureWebsitePreview({
      taskIntentProfile: input.taskIntentProfile,
      attachments: input.attachments,
      deliverables: input.deliverables,
      manifestExists,
      packageExists,
      debugOpenPageSucceeded: input.debugOpenPageSucceeded,
    })) {
      return null;
    }

    const candidate = this.resolveCommandCandidate({ manifest, packageJson });
    if (!candidate) {
      const htmlPreviewPath = await this.resolveDebugOpenedHtmlPreviewPath({
        sandboxId: input.sandboxId,
        workspaceRoot: input.workspaceRoot,
        attachments: input.attachments,
        deliverables: input.deliverables,
        debugOpenPageSucceeded: input.debugOpenPageSucceeded,
      });
      if (htmlPreviewPath) {
        const fileUrl = buildWorkspaceFileUrl(input.workspaceRoot, htmlPreviewPath);
        const screenshotPath = `/tmp/oneceo-preview-${input.runId}-${randomUUID()}.png`;
        try {
          const captured = await this.captureScreenshot({
            sandboxId: input.sandboxId,
            url: fileUrl,
            outputPath: screenshotPath,
            width: 1280,
            height: 720,
          });
          if (!captured.captured) {
            return buildFailureSnapshot({
              status: 'capture_failed',
              reasonCode: 'html_file_capture_failed',
              message: truncateMessage(captured.stderr || captured.stdout || 'HTML 调试页面截图失败'),
              sandboxId: input.sandboxId,
              url: fileUrl,
            });
          }
          if (captured.visualCheck?.status === 'failed') {
            return buildVisualCheckFailureSnapshot({
              visualCheck: captured.visualCheck,
              sandboxId: input.sandboxId,
              url: fileUrl,
            });
          }

          const bytes = Buffer.from(await this.deps.e2b.readFile(input.sandboxId, screenshotPath));
          const storageKey = this.buildStorageKey({
            sessionId: input.sessionId,
            runId: input.runId,
          });
          try {
            await this.deps.uploadToR2(storageKey, bytes);
          } catch (error) {
            return buildFailureSnapshot({
              status: 'storage_failed',
              reasonCode: 'preview_snapshot_storage_failed',
              message: truncateMessage(error),
              sandboxId: input.sandboxId,
              url: fileUrl,
            });
          }

          return {
            kind: 'website_screenshot',
            status: 'captured',
            storageKey,
            mimeType: 'image/png',
            width: 1280,
            height: 720,
            capturedAt: new Date().toISOString(),
            visualCheck: captured.visualCheck,
            source: {
              sandboxId: input.sandboxId,
              url: fileUrl,
            },
          };
        } catch (error) {
          return buildFailureSnapshot({
            status: 'capture_failed',
            reasonCode: 'html_file_capture_failed',
            message: truncateMessage(error),
            sandboxId: input.sandboxId,
            url: fileUrl,
          });
        } finally {
          await this.deps.e2b
            .runCommand(input.sandboxId, `rm -f ${shellEscape(screenshotPath)} ${shellEscape(`${screenshotPath}.dom.html`)}`, { timeoutMs: 10_000 })
            .catch(() => undefined);
        }
      }

      return buildFailureSnapshot({
        status: 'capture_unavailable',
        reasonCode: 'preview_start_command_missing',
        message: '未找到可识别的网站启动命令或 HTML 预览文件',
        sandboxId: input.sandboxId,
      });
    }

    const logPath = `/tmp/oneceo-preview-${input.runId}.log`;
    const screenshotPath = `/tmp/oneceo-preview-${input.runId}-${randomUUID()}.png`;
    const url = `http://127.0.0.1:${candidate.port}/`;

    try {
      const startCommand = this.buildStartCommand({
        command: candidate.command,
        port: candidate.port,
        runId: input.runId,
        logPath,
        appendVitePortArgs: candidate.appendVitePortArgs,
      });
      await this.deps.e2b.runCommand(input.sandboxId, startCommand, {
        cwd: input.workspaceRoot,
        timeoutMs: 20_000,
      });
      const ready = await this.waitForPort(input.sandboxId, candidate.port);
      if (!ready) {
        return buildFailureSnapshot({
          status: 'capture_failed',
          reasonCode: 'preview_port_not_ready',
          message: '网站预览服务端口未在限定时间内就绪',
          sandboxId: input.sandboxId,
          port: candidate.port,
          url,
          command: candidate.command,
          logPath,
        });
      }
      const captured = await this.captureScreenshot({
        sandboxId: input.sandboxId,
        url,
        outputPath: screenshotPath,
        width: 1280,
        height: 720,
      });
      if (!captured.captured) {
        return buildFailureSnapshot({
          status: 'capture_failed',
          reasonCode: 'chromium_capture_failed',
          message: truncateMessage(captured.stderr || captured.stdout || '浏览器截图失败'),
          sandboxId: input.sandboxId,
          port: candidate.port,
          url,
          command: candidate.command,
          logPath,
        });
      }
      if (captured.visualCheck?.status === 'failed') {
        return buildVisualCheckFailureSnapshot({
          visualCheck: captured.visualCheck,
          sandboxId: input.sandboxId,
          port: candidate.port,
          url,
          command: candidate.command,
          logPath,
        });
      }
      const bytes = Buffer.from(await this.deps.e2b.readFile(input.sandboxId, screenshotPath));
      const storageKey = this.buildStorageKey({
        sessionId: input.sessionId,
        runId: input.runId,
      });
      try {
        await this.deps.uploadToR2(storageKey, bytes);
      } catch (error) {
        return buildFailureSnapshot({
          status: 'storage_failed',
          reasonCode: 'preview_snapshot_storage_failed',
          message: truncateMessage(error),
          sandboxId: input.sandboxId,
          port: candidate.port,
          url,
          command: candidate.command,
          logPath,
        });
      }
      return {
        kind: 'website_screenshot',
        status: 'captured',
        storageKey,
        mimeType: 'image/png',
        width: 1280,
        height: 720,
        capturedAt: new Date().toISOString(),
        visualCheck: captured.visualCheck,
        source: {
          sandboxId: input.sandboxId,
          port: candidate.port,
          url,
          command: candidate.command,
          logPath,
        },
      };
    } catch (error) {
      return buildFailureSnapshot({
        status: 'capture_failed',
        reasonCode: 'preview_snapshot_capture_failed',
        message: truncateMessage(error),
        sandboxId: input.sandboxId,
        port: candidate.port,
        url,
        command: candidate.command,
        logPath,
      });
    } finally {
      await this.deps.e2b
        .runCommand(input.sandboxId, `rm -f ${shellEscape(screenshotPath)} ${shellEscape(`${screenshotPath}.dom.html`)}`, { timeoutMs: 10_000 })
        .catch(() => undefined);
    }
  }

  async getSessionPreviewSnapshotImage(input: {
    sessionId: string;
    runId: string;
  }): Promise<WebsitePreviewSnapshotImage | null> {
    const snapshot = await this.resolveStoredSnapshot(input);
    if (!snapshot?.storageKey || snapshot.status !== 'captured') {
      return null;
    }
    let body: Buffer;
    try {
      body = await this.deps.downloadFromR2(snapshot.storageKey);
    } catch {
      return null;
    }
    return {
      body,
      mimeType: 'image/png',
    };
  }

  async getBrowserActionScreenshotImage(input: {
    runId: string;
    toolCallId: string;
  }): Promise<WebsitePreviewSnapshotImage | null> {
    const events = await taskSessionRunDAO.listRunEvents(input.runId);
    const screenshot = [...events]
      .reverse()
      .map((event) => {
        const payload = asRecord((event as any).payloadJson);
        if (asText(payload.toolCallId) !== input.toolCallId) return null;
        return readBrowserActionScreenshot(payload.browserScreenshot);
      })
      .find((item): item is BrowserActionScreenshot => Boolean(item?.storageKey && item.status === 'captured'));
    if (!screenshot?.storageKey) {
      return null;
    }
    let body: Buffer;
    try {
      body = await this.deps.downloadFromR2(screenshot.storageKey);
    } catch {
      return null;
    }
    return {
      body,
      mimeType: 'image/png',
    };
  }

  async resolveStoredSnapshot(input: {
    sessionId: string;
    runId: string;
  }): Promise<WebsitePreviewSnapshot | null> {
    const messages = await taskCreationSessionDAO.getMessages(input.sessionId);
    const assistantSnapshot = [...messages]
      .reverse()
      .map((message) => {
        const metadata = asRecord((message as any).metadata);
        if (asText(metadata.runId) !== input.runId) return null;
        return readPreviewSnapshot(metadata.previewSnapshot);
      })
      .find((item): item is WebsitePreviewSnapshot => Boolean(item?.storageKey && item.status === 'captured'));
    if (assistantSnapshot) return assistantSnapshot;

    const events = await taskSessionRunDAO.listRunEvents(input.runId);
    const eventSnapshots = [...events]
      .reverse()
      .map((event) => readPreviewSnapshot(asRecord((event as any).payloadJson).previewSnapshot))
      .filter((item): item is WebsitePreviewSnapshot => Boolean(item?.storageKey && item.status === 'captured'));
    return eventSnapshots[0] || null;
  }
}

export const taskSessionWebsitePreviewSnapshotService = new TaskSessionWebsitePreviewSnapshotService();
