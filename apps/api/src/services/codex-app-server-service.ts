import { e2bConnector } from '../connectors/e2b-connector';
import { ensurePlaywrightMcpInConfigToml } from '../utils/codex-runtime-config';

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export type CodexAppServerEnsureInput = {
  sessionId: string;
  port?: number;
  workspaceRoot?: string | null;
  codexBinaryPath?: string | null;
  configToml?: string | null;
  authJson?: string | null;
};

export type CodexAppServerEnsureResult = {
  sessionId: string;
  port: number;
  listenUrl: string;
  localEndpoint: string;
  logPath: string;
  started: boolean;
};

const defaultPort = toPositiveInt(process.env.CODEX_APP_SERVER_PORT, 4321);
const defaultLogPath = '/tmp/codex-app-server.log';

async function isPortListening(sessionId: string, port: number): Promise<boolean> {
  const command = `bash -lc 'if command -v ss >/dev/null 2>&1; then ss -lnt | grep -q ":${port} "; else netstat -lnt 2>/dev/null | grep -q ":${port} "; fi && echo READY || echo NOT_READY'`;
  const result = await e2bConnector.runCommand(sessionId, command, { timeoutMs: 15_000 });
  return asString((result as any)?.stdout).toUpperCase() === 'READY';
}

async function writeCodexRuntimeFiles(
  sessionId: string,
  configToml?: string | null,
  authJson?: string | null
): Promise<void> {
  const normalizedConfigToml = ensurePlaywrightMcpInConfigToml(asString(configToml));
  if (!normalizedConfigToml && !asString(authJson)) {
    return;
  }
  const payloadBase64 = Buffer.from(
    JSON.stringify({
      configToml: normalizedConfigToml || null,
      authJson: asString(authJson) || null,
    }),
    'utf-8'
  ).toString('base64');
  const command = `python3 - <<'PY'
import base64
import json
import os

payload = json.loads(base64.b64decode(${shellEscape(payloadBase64)}).decode('utf-8'))
codex_home = os.path.expanduser('~/.codex')
os.makedirs(codex_home, exist_ok=True)
config_toml = payload.get('configToml') or ''
auth_json = payload.get('authJson') or ''
if config_toml:
    with open(os.path.join(codex_home, 'config.toml'), 'w', encoding='utf-8') as fh:
        fh.write(config_toml)
if auth_json:
    with open(os.path.join(codex_home, 'auth.json'), 'w', encoding='utf-8') as fh:
        fh.write(auth_json)
print('READY')
PY`;
  await e2bConnector.runCommand(sessionId, command, { timeoutMs: 20_000 });
}

export class CodexAppServerService {
  async ensureRuntimeFiles(input: {
    sessionId: string;
    configToml?: string | null;
    authJson?: string | null;
  }): Promise<void> {
    await writeCodexRuntimeFiles(input.sessionId, input.configToml, input.authJson);
  }

  async ensureServer(input: CodexAppServerEnsureInput): Promise<CodexAppServerEnsureResult> {
    const port = input.port || defaultPort;
    const listenUrl = `ws://0.0.0.0:${port}`;
    const localEndpoint = `ws://127.0.0.1:${port}`;

    await writeCodexRuntimeFiles(input.sessionId, input.configToml, input.authJson);

    if (await isPortListening(input.sessionId, port)) {
      return {
        sessionId: input.sessionId,
        port,
        listenUrl,
        localEndpoint,
        logPath: defaultLogPath,
        started: false,
      };
    }

    const cwdPrefix = input.workspaceRoot
      ? `mkdir -p ${shellEscape(input.workspaceRoot)} && cd ${shellEscape(input.workspaceRoot)} && `
      : '';
    const binary = shellEscape(asString(input.codexBinaryPath) || 'codex');
    const startCommand = `${cwdPrefix}nohup env -u OPENAI_BASE_URL -u OPENAI_API_BASE -u CODEX_BASE_URL ${binary} app-server --listen ${listenUrl} >${defaultLogPath} 2>&1 < /dev/null &`;
    await e2bConnector.runCommand(input.sessionId, startCommand, {
      background: true,
      timeoutMs: 5_000,
    });

    const attempts = toPositiveInt(process.env.CODEX_APP_SERVER_READY_ATTEMPTS, 20);
    const delayMs = toPositiveInt(process.env.CODEX_APP_SERVER_READY_DELAY_MS, 1000);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await isPortListening(input.sessionId, port)) {
        return {
          sessionId: input.sessionId,
          port,
          listenUrl,
          localEndpoint,
          logPath: defaultLogPath,
          started: true,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const log = await this.readLog(input.sessionId);
    throw new Error(`codex app-server 启动失败: port ${port} 未就绪\n${log}`);
  }

  async readLog(sessionId: string): Promise<string> {
    const result = await e2bConnector.runCommand(sessionId, `cat ${defaultLogPath} || true`, {
      timeoutMs: 15_000,
    });
    return asString((result as any)?.stdout);
  }

  async stopServer(sessionId: string): Promise<void> {
    try {
      await e2bConnector.runCommand(sessionId, `pkill -f "codex app-server" || true`, {
        timeoutMs: 15_000,
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error || '');
      if (/signal:\s*terminated/i.test(text) || /\bterminated\b/i.test(text)) {
        return;
      }
      throw error;
    }
  }
}

export const codexAppServerService = new CodexAppServerService();
