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
};

export type WebsitePreviewSnapshotImage = {
  body: Buffer;
  mimeType: 'image/png';
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

function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '').trim();
  if (!normalized || normalized.split('/').some((part) => part === '..')) return '';
  return normalized;
}

function isHtmlPath(value: string): boolean {
  return /\.html?$/i.test(value);
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
    source: {
      sandboxId: asText(sourceRecord.sandboxId) || undefined,
      port: port || undefined,
      url: asText(sourceRecord.url) || undefined,
      command: asText(sourceRecord.command) || undefined,
      logPath: asText(sourceRecord.logPath) || undefined,
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
  }) {
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
`;
    const result = await this.deps.e2b.runCommand(input.sandboxId, command, {
      timeoutMs: 30_000,
    });
    return Number((result as any)?.exitCode ?? 1) === 0;
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
      return buildFailureSnapshot({
        status: 'capture_unavailable',
        reasonCode: 'preview_start_command_missing',
        message: '未找到可识别的网站启动命令',
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
      if (!captured) {
        return buildFailureSnapshot({
          status: 'capture_failed',
          reasonCode: 'chromium_capture_failed',
          message: '浏览器截图失败',
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
        .runCommand(input.sandboxId, `rm -f ${shellEscape(screenshotPath)}`, { timeoutMs: 10_000 })
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
