import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function resolveLocalOsacBinary(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), '../../OSAC_client/dist/osac-linux-amd64_v1.1.2.fix22'),
    path.resolve(process.cwd(), '../../OSAC_client/dist/osac-linux-amd64_v1.1.2.fix22_debug'),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // keep scanning
    }
  }
  throw new Error(`local osac binary missing: ${candidates.join(', ')}`);
}

async function main() {
  const { sandboxEnvironmentService } = await import('../../src/services/sandbox-environment-service');
  const { e2bConnector } = await import('../../src/connectors/e2b-connector');
  const { osacBootstrapConfig } = await import('../../src/config/osac-bootstrap-config');
  const { resolveOpencodeWorkspacePath } = await import('../../src/utils/opencode-workspace');

  const opened = await sandboxEnvironmentService.openEnvironment({
    metadata: {
      owner: 'codex-live-test',
      purpose: 'codex-osac-diagnose',
    },
    templateOverride: 'codex',
  });
  const sessionId = opened.sessionId;
  const osacBinaryPath = await resolveLocalOsacBinary();
  const osacBuffer = await fs.readFile(osacBinaryPath);
  const workspaceRoot = resolveOpencodeWorkspacePath(`codex_diagnose_${Date.now()}`);
  const remoteBaseDir =
    (osacBootstrapConfig.remoteBaseDir || '').trim() && osacBootstrapConfig.remoteBaseDir !== '/opt/.altus/opencode'
      ? osacBootstrapConfig.remoteBaseDir
      : workspaceRoot.replace(/\/workspaces\/[^/]+$/, '');
  const remoteBinaryName = osacBootstrapConfig.osacBinaryName || 'osac';
  const remoteBinary = `${remoteBaseDir.replace(/\/+$/, '')}/${remoteBinaryName}`;

  console.log(`SID=${sessionId}`);

  async function run(label: string, command: string, timeoutMs = 30_000) {
    try {
      const result = await e2bConnector.runCommand(sessionId, command, { timeoutMs });
      const summary = {
        exitCode: (result as any)?.exitCode ?? null,
        stdout: String((result as any)?.stdout || '').slice(0, 1500),
        stderr: String((result as any)?.stderr || '').slice(0, 1500),
      };
      console.log(`STEP_OK ${label} ${JSON.stringify(summary)}`);
      return result;
    } catch (error) {
      console.log(`STEP_FAIL ${label} ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  await run('commands_ready', 'echo ready', 10_000);
  await run('codex_check', 'set -euo pipefail\ncommand -v codex\ncodex --version || true', 20_000);
  await run(
    'prepare_dirs',
    `set -euo pipefail\nmkdir -p ${shellQuote(remoteBaseDir)} ${shellQuote(`${remoteBaseDir}/log`)} ${shellQuote(`${remoteBaseDir}/tmp`)}`,
    20_000
  );

  await e2bConnector.writeFile(sessionId, remoteBinary, osacBuffer);

  await run(
    'inspect_binary',
    `set -euo pipefail\nchmod +x ${shellQuote(remoteBinary)}\nls -l ${shellQuote(remoteBinary)}\nfile ${shellQuote(remoteBinary)} || true`,
    20_000
  );

  const token = `diag_${Date.now()}`;
  await run(
    'start_osac',
    [
      'set -euxo pipefail',
      `chmod +x ${shellQuote(remoteBinary)}`,
      `pkill -x ${shellQuote(remoteBinaryName)} || true`,
      `rm -f ${shellQuote(`${remoteBaseDir}/osac.lock`)}`,
      [
        'nohup env',
        `OSAC_AUTH_TOKEN=${shellQuote(token)}`,
        "OSAC_LISTEN_ADDR=':18080'",
        `OSAC_LOG_DIR=${shellQuote(`${remoteBaseDir}/log`)}`,
        `OSAC_UPDATE_TMP=${shellQuote(`${remoteBaseDir}/tmp`)}`,
        `OSAC_INSTANCE_LOCK_PATH=${shellQuote(`${remoteBaseDir}/osac.lock`)}`,
        "OSAC_CODEX_PATH='codex'",
        "OSAC_OPENCODE_PATH='opencode'",
        "OSAC_LLM_PROXY_ENABLE='false'",
        shellQuote(remoteBinary),
        `>> ${shellQuote(`${remoteBaseDir}/log/osac.log`)} 2>&1 < /dev/null &`,
      ].join(' '),
      'sleep 2',
      `pgrep -af ${shellQuote(remoteBinary)} || true`,
      `if command -v ss >/dev/null 2>&1; then ss -ltnp | grep -E ':18080\\\\b' || true; else netstat -ltnp | grep -E ':18080\\\\b' || true; fi`,
      `tail -n 80 ${shellQuote(`${remoteBaseDir}/log/osac.log`)} || true`,
    ].join('\n'),
    30_000
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
