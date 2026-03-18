import '../../src/config/env';
import { randomUUID } from 'node:crypto';
import { ensureDatabaseConnection } from '../../src/config/database';
import { sandboxAgentProvisionService } from '../../src/services/sandbox-agent-provision-service';
import { sandboxEnvironmentService } from '../../src/services/sandbox-environment-service';
import { sandboxExecutionEnvironmentDAO } from '../../src/db/dao';
import { osacAgentService } from '../../src/services/osac-agent-service';
import { osacConnectionManager } from '../../src/services/osac-connection-manager';
import { e2bConnector } from '../../src/connectors/e2b-connector';
import { resolveOpencodeWorkspacePath } from '../../src/utils/opencode-workspace';
import { osacBootstrapConfig } from '../../src/config/osac-bootstrap-config';

type VariantMode = 'current' | 'home_only' | 'home_xdg' | 'home_xdg_codex_home';

type RoundResult = {
  round: number;
  variant: VariantMode;
  taskSessionId: string;
  sandboxA: string;
  sandboxB?: string;
  acceptedExecutorSessionId?: string;
  resolvedExecutorSessionId?: string;
  fileRestored: boolean;
  sessionRestored: boolean;
  memoryRestored: boolean;
  stateProbeA?: string;
  stateProbeB?: string;
  fileContentB?: string;
  answerA?: string;
  answerB?: string;
  followupTerminalEvent?: string;
  error?: string;
  notes?: string[];
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

async function waitForExecutorTerminal(
  sessionId: string,
  offset: number,
  timeoutMs = 90_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = osacConnectionManager.getMessagesSince(sessionId, offset);
    const terminal = messages.find((message) => {
      if (message.type === 'EXECUTOR_ERROR') return true;
      if (message.type !== 'EXECUTOR_EVENT') return false;
      const payload = toRecord(message.payload);
      const eventType = asString(payload.eventType).toLowerCase();
      return eventType === 'turn.completed' || eventType === 'turn.failed' || eventType === 'turn.interrupted';
    });
    if (terminal) {
      return {
        terminal,
        messages,
      };
    }
    await sleep(1500);
  }
  return {
    terminal: null as any,
    messages: osacConnectionManager.getMessagesSince(sessionId, offset),
  };
}

function extractResolvedExecutorSessionId(messages: Array<{ type: string; payload?: unknown }>, fallback = ''): string {
  let resolved = fallback;
  for (const message of messages) {
    const payload = toRecord(message.payload);
    const candidate =
      asString(payload.executorSessionId) ||
      asString(payload.sessionId) ||
      asString(payload.threadId);
    if (candidate && !candidate.startsWith('local-')) {
      resolved = candidate;
    }
  }
  return resolved;
}

function extractLatestAgentAnswer(messages: Array<{ type: string; payload?: unknown }>): string {
  let answer = '';
  for (const message of messages) {
    if (message.type !== 'EXECUTOR_EVENT') continue;
    const payload = toRecord(message.payload);
    const event = toRecord(payload.event);
    const item = toRecord(event.item);
    const itemType = asString(item.type).toLowerCase();
    if (itemType !== 'agent_message') continue;
    const text = asString(item.text) || asString(item.content) || asString(item.message);
    if (text) answer = text;
  }
  return answer;
}

function extractTerminalEventType(message: { type: string; payload?: unknown } | null): string {
  if (!message) return '';
  if (message.type === 'EXECUTOR_ERROR') return 'EXECUTOR_ERROR';
  const payload = toRecord(message.payload);
  return asString(payload.eventType) || message.type;
}

async function inspectCodexState(sandboxId: string, stateRoot: string, workspacePath: string): Promise<string> {
  const cmd = `
set -e
echo '--- state-root'
find ${shellEscape(stateRoot)} -maxdepth 4 \\( -type f -o -type d \\) | sort | tail -n 120 || true
echo '--- recent-home'
find /home/user -maxdepth 4 \\( -iname '*codex*' -o -iname '*rollout*' -o -name '*.db' -o -name '*.sqlite*' \\) | sort | tail -n 120 || true
echo '--- workspace'
find ${shellEscape(workspacePath)} -maxdepth 3 \\( -type f -o -type d \\) | sort | tail -n 120 || true
`;
  const result: any = await e2bConnector.runCommand(sandboxId, cmd, { timeoutMs: 40_000 });
  return String(result?.stdout || result?.output || '').trim();
}

async function inspectOsacLog(sandboxId: string): Promise<string> {
  const remoteBaseDir = (osacBootstrapConfig.remoteBaseDir || '/opt/.altus/opencode').replace(/\/+$/, '');
  const logPath = `${remoteBaseDir}/log/osac.log`;
  const result: any = await e2bConnector.runCommand(
    sandboxId,
    `tail -n 120 ${shellEscape(logPath)} || true`,
    { timeoutMs: 20_000 }
  );
  return String(result?.stdout || result?.output || '').trim();
}

async function restartOsacForCodexState(
  sandboxId: string,
  mode: VariantMode,
  workspacePath: string,
  stateRoot: string,
  authToken: string
) {
  if (mode === 'current') return;

  const remoteBaseDir = (osacBootstrapConfig.remoteBaseDir || '/opt/.altus/opencode').replace(/\/+$/, '');
  const remoteBinary = `${remoteBaseDir}/${osacBootstrapConfig.osacBinaryName || 'osac'}`;
  const osacLogDir = `${remoteBaseDir}/log`;
  const osacTmpDir = `${remoteBaseDir}/tmp`;
  const osacLockPath = `${remoteBaseDir}/osac.lock`;
  const codexHome = `${stateRoot.replace(/\/+$/, '')}/codex-home`;
  const xdgData = `${stateRoot.replace(/\/+$/, '')}/codex-xdg/data`;
  const xdgState = `${stateRoot.replace(/\/+$/, '')}/codex-xdg/state`;
  const xdgConfig = `${stateRoot.replace(/\/+$/, '')}/codex-xdg/config`;

  const envParts = [
    `OSAC_AUTH_TOKEN=${shellEscape(authToken)}`,
    `OSAC_LISTEN_ADDR=':${osacBootstrapConfig.osacPort}'`,
    `OSAC_LOG_DIR=${shellEscape(osacLogDir)}`,
    `OSAC_UPDATE_TMP=${shellEscape(osacTmpDir)}`,
    `OSAC_INSTANCE_LOCK_PATH=${shellEscape(osacLockPath)}`,
    `OSAC_CODEX_PATH='codex'`,
    `OSAC_CODEX_DEFAULT_WORKTREE=${shellEscape(workspacePath)}`,
    `OSAC_OPENCODE_PATH='opencode'`,
    `OSAC_OPENCODE_DEFAULT_WORKTREE=${shellEscape(workspacePath)}`,
    `OSAC_LLM_PROXY_ENABLE='false'`,
    `HOME=${shellEscape(codexHome)}`,
  ];

  const passThroughEnvNames = [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
    'CODEX_API_KEY',
    'CODEX_BASE_URL',
    'CODEX_MODEL',
    'ANTHROPIC_API_KEY',
    'LLM_PROXY_URL',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
  ];
  for (const envName of passThroughEnvNames) {
    const envValue = process.env[envName];
    if (!envValue) continue;
    envParts.push(`${envName}=${shellEscape(envValue)}`);
  }

  if (mode === 'home_xdg' || mode === 'home_xdg_codex_home') {
    envParts.push(`XDG_DATA_HOME=${shellEscape(xdgData)}`);
    envParts.push(`XDG_STATE_HOME=${shellEscape(xdgState)}`);
    envParts.push(`XDG_CONFIG_HOME=${shellEscape(xdgConfig)}`);
  }
  if (mode === 'home_xdg_codex_home') {
    envParts.push(`CODEX_HOME=${shellEscape(`${stateRoot.replace(/\/+$/, '')}/codex-home-root`)}`);
  }

  const restartCmd = `
set -euo pipefail
mkdir -p ${shellEscape(remoteBaseDir)} ${shellEscape(osacLogDir)} ${shellEscape(osacTmpDir)} \
  ${shellEscape(codexHome)} ${shellEscape(xdgData)} ${shellEscape(xdgState)} ${shellEscape(xdgConfig)}
pkill -x ${shellEscape(osacBootstrapConfig.osacBinaryName || 'osac')} || true
rm -f ${shellEscape(osacLockPath)}
${envParts.map((entry) => `export ${entry}`).join('\n')}
nohup ${shellEscape(remoteBinary)} >> ${shellEscape(`${osacLogDir}/osac.log`)} 2>&1 < /dev/null &
sleep 2
if command -v ss >/dev/null 2>&1; then
  ss -ltnp | grep -E ':${osacBootstrapConfig.osacPort}\\b' || true
fi
`;
  await e2bConnector.runCommand(sandboxId, restartCmd, { timeoutMs: 40_000 });
  await osacConnectionManager.close(sandboxId);
  await sleep(2500);
}

async function runRound(round: number, variant: VariantMode): Promise<RoundResult> {
  const taskSessionId = `codex_restore_${variant}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const workspacePath = resolveOpencodeWorkspacePath(taskSessionId);
  const fileName = 'restore_note.txt';
  const filePath = `${workspacePath}/${fileName}`;
  const memoryToken = `MEM-${randomUUID().slice(0, 8)}`;
  const fileMark = `FILE-${randomUUID().slice(0, 8)}`;
  const result: RoundResult = {
    round,
    variant,
    taskSessionId,
    sandboxA: '',
    fileRestored: false,
    sessionRestored: false,
    memoryRestored: false,
    notes: [],
  };

  let sandboxA = '';
  let sandboxB = '';
  try {
    const provisionA = await sandboxAgentProvisionService.provisionWithLock({
      executor: 'codex',
      metadata: {
        owner: 'codex-session-restore-test',
        purpose: `codex-session-restore-${variant}`,
        taskSessionId,
        taskTitle: `codex restore ${variant}`,
        executor: 'codex',
      },
    });
    sandboxA = provisionA.sessionId;
    result.sandboxA = sandboxA;

    const envA = await sandboxExecutionEnvironmentDAO.getBySessionId(sandboxA);
    const metaA = toRecord(envA?.metadata);
    const stateRootA = asString(metaA.opencodeStateRoot);
    const authTokenA = asString(metaA.osacAuthToken);
    if (!stateRootA || !authTokenA) {
      throw new Error('sandbox A 缺少 stateRoot 或 osacAuthToken');
    }

    await restartOsacForCodexState(sandboxA, variant, workspacePath, stateRootA, authTokenA);

    await osacAgentService.ensureExecutorRuntime(sandboxA, {
      executor: 'codex',
      workspacePath,
    });
    const beforeA = osacConnectionManager.getMessageCount(sandboxA);
    const acceptedA = await osacAgentService.sendExecutorInput(sandboxA, {
      executor: 'codex',
      workspacePath,
      parts: [
        {
          type: 'text',
          text: [
            `Remember this memory token for our conversation only: ${memoryToken}.`,
            `Do not write ${memoryToken} to disk.`,
            `Create ${fileName} containing exactly ${fileMark} and nothing else.`,
            `Then reply exactly: MEMORY=${memoryToken};FILE=${fileName};MARK=${fileMark}`,
          ].join(' '),
        },
      ],
    });
    result.acceptedExecutorSessionId = acceptedA.executorSessionId;

    const waitedA = await waitForExecutorTerminal(sandboxA, beforeA, 120_000);
    const messagesA = waitedA.messages.map((message) => ({
      type: message.type,
      payload: message.payload,
    }));
    const resolvedExecutorSessionId = extractResolvedExecutorSessionId(
      messagesA,
      acceptedA.executorSessionId
    );
    result.resolvedExecutorSessionId = resolvedExecutorSessionId;
    result.answerA = extractLatestAgentAnswer(messagesA);
    result.followupTerminalEvent = extractTerminalEventType(waitedA.terminal);

    const fileReadA: any = await e2bConnector.runCommand(sandboxA, `cat ${shellEscape(filePath)}`, {
      timeoutMs: 20_000,
    });
    const fileContentA = String(fileReadA?.stdout || fileReadA?.output || '').trim();
    if (fileContentA !== fileMark) {
      result.notes?.push(`A 文件内容异常: ${fileContentA}`);
    }
    result.stateProbeA = await inspectCodexState(sandboxA, stateRootA, workspacePath);

    await sandboxEnvironmentService.closeEnvironment(sandboxA);

    const provisionB = await sandboxAgentProvisionService.provisionWithLock({
      executor: 'codex',
      metadata: {
        owner: 'codex-session-restore-test',
        purpose: `codex-session-restore-${variant}-restore`,
        taskSessionId,
        taskTitle: `codex restore ${variant} restore`,
        executor: 'codex',
      },
    });
    sandboxB = provisionB.sessionId;
    result.sandboxB = sandboxB;

    const envB = await sandboxExecutionEnvironmentDAO.getBySessionId(sandboxB);
    const metaB = toRecord(envB?.metadata);
    const stateRootB = asString(metaB.opencodeStateRoot);
    const authTokenB = asString(metaB.osacAuthToken);
    if (!stateRootB || !authTokenB) {
      throw new Error('sandbox B 缺少 stateRoot 或 osacAuthToken');
    }

    await restartOsacForCodexState(sandboxB, variant, workspacePath, stateRootB, authTokenB);

    const fileReadB: any = await e2bConnector.runCommand(sandboxB, `cat ${shellEscape(filePath)}`, {
      timeoutMs: 20_000,
    });
    const fileContentB = String(fileReadB?.stdout || fileReadB?.output || '').trim();
    result.fileContentB = fileContentB;
    result.fileRestored = fileContentB === fileMark;

    await osacAgentService.ensureExecutorRuntime(sandboxB, {
      executor: 'codex',
      workspacePath,
    });
    const beforeB = osacConnectionManager.getMessageCount(sandboxB);
    await osacAgentService.resumeExecutorSession(sandboxB, {
      executor: 'codex',
      executorSessionId: resolvedExecutorSessionId || acceptedA.executorSessionId,
      workspacePath,
    });
    const acceptedB = await osacAgentService.sendExecutorInput(sandboxB, {
      executor: 'codex',
      executorSessionId: resolvedExecutorSessionId || acceptedA.executorSessionId,
      workspacePath,
      parts: [
        {
          type: 'text',
          text: [
            'From our previous conversation context only, reply exactly in this format:',
            `MEMORY=${memoryToken};FILE=${fileName};MARK=${fileMark}`,
            'Do not explain.',
          ].join(' '),
        },
      ],
    });
    result.notes?.push(`B accepted executorSessionId=${acceptedB.executorSessionId}`);

    const waitedB = await waitForExecutorTerminal(sandboxB, beforeB, 120_000);
    const messagesB = waitedB.messages.map((message) => ({
      type: message.type,
      payload: message.payload,
    }));
    result.answerB = extractLatestAgentAnswer(messagesB);
    result.followupTerminalEvent = extractTerminalEventType(waitedB.terminal);
    result.stateProbeB = await inspectCodexState(sandboxB, stateRootB, workspacePath);

    const answerB = result.answerB || '';
    result.memoryRestored = answerB.includes(memoryToken);
    result.sessionRestored =
      result.memoryRestored &&
      result.fileRestored &&
      extractTerminalEventType(waitedB.terminal).toLowerCase() === 'turn.completed';

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    for (const [label, sandboxId] of [
      ['A', sandboxA],
      ['B', sandboxB],
    ] as const) {
      if (!sandboxId) continue;
      try {
        const env = await sandboxExecutionEnvironmentDAO.getBySessionId(sandboxId);
        const stateRoot = asString(toRecord(env?.metadata).opencodeStateRoot);
        result.notes?.push(
          `${label}_osac_log=${await inspectOsacLog(sandboxId)}`
        );
        if (stateRoot) {
          result.notes?.push(
            `${label}_state_probe=${await inspectCodexState(sandboxId, stateRoot, workspacePath)}`
          );
        }
      } catch (inspectError) {
        result.notes?.push(
          `${label}_inspect_failed=${inspectError instanceof Error ? inspectError.message : String(inspectError)}`
        );
      }
    }
    return result;
  } finally {
    for (const sandboxId of [sandboxA, sandboxB]) {
      if (!sandboxId) continue;
      try {
        await sandboxEnvironmentService.closeEnvironment(sandboxId);
      } catch {
        // ignore cleanup failure
      }
    }
  }
}

async function main() {
  await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
  const maxRounds = Math.max(1, Math.min(10, Number(process.argv[2] || 4)));
  const allVariants: VariantMode[] = [
    'current',
    'home_only',
    'home_xdg',
    'home_xdg_codex_home',
  ];
  const variantArg = String(process.argv[3] || '').trim();
  const variants = variantArg
    ? variantArg
        .split(',')
        .map((value) => value.trim())
        .filter((value): value is VariantMode => allVariants.includes(value as VariantMode))
    : allVariants;

  const rounds: RoundResult[] = [];
  for (let index = 0; index < Math.min(maxRounds, variants.length); index += 1) {
    const variant = variants[index];
    const round = await runRound(index + 1, variant);
    rounds.push(round);
    console.log(
      JSON.stringify(
        {
          phase: 'round_complete',
          round: round.round,
          variant: round.variant,
          taskSessionId: round.taskSessionId,
          sandboxA: round.sandboxA,
          sandboxB: round.sandboxB,
          acceptedExecutorSessionId: round.acceptedExecutorSessionId,
          resolvedExecutorSessionId: round.resolvedExecutorSessionId,
          fileRestored: round.fileRestored,
          memoryRestored: round.memoryRestored,
          sessionRestored: round.sessionRestored,
          answerA: round.answerA,
          answerB: round.answerB,
          followupTerminalEvent: round.followupTerminalEvent,
          error: round.error,
        },
        null,
        2
      )
    );
    if (round.sessionRestored) {
      break;
    }
  }

  console.log(JSON.stringify({ phase: 'summary', rounds }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
