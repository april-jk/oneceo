import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

const cwd = `/tmp/codex-appserver-stdio-${Date.now()}`;
await fs.mkdir(cwd, { recursive: true });

const child = spawn('codex', ['app-server'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});

const pending = new Map();
const notifications = [];
let stdoutBuffer = '';
let stderr = '';

function request(id, method, params) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    ...(params ? { params } : {}),
  });
  child.stdin.write(`${payload}\n`);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

child.stdout.on('data', (chunk) => {
  stdoutBuffer += chunk.toString();
  while (true) {
    const newlineIndex = stdoutBuffer.indexOf('\n');
    if (newlineIndex < 0) break;
    const line = stdoutBuffer.slice(0, newlineIndex).trim();
    stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
    if (!line) continue;

    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      notifications.push({ method: 'invalid_json', params: { line } });
      continue;
    }

    if (payload.id !== undefined) {
      const deferred = pending.get(payload.id);
      if (!deferred) continue;
      pending.delete(payload.id);
      if (payload.error) {
        deferred.reject(new Error(payload.error.message || JSON.stringify(payload.error)));
      } else {
        deferred.resolve(payload.result);
      }
      continue;
    }

    if (payload.method) {
      notifications.push({ method: payload.method, params: payload.params });
    }
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const initializeResult = await request('init', 'initialize', {
    clientInfo: {
      name: 'oneceo-local-stdio-probe',
      title: 'oneceo local stdio probe',
      version: '0.0.1',
    },
    capabilities: {
      experimentalApi: true,
      optOutNotificationMethods: [],
    },
  });

  const threadStartResult = await request('thread-start', 'thread/start', {
    cwd,
    approvalPolicy: 'never',
    sandbox: 'workspace-write',
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  });
  const threadId = String(threadStartResult?.thread?.id || '').trim();
  if (!threadId) {
    throw new Error('thread/start did not return thread.id');
  }

  const turnStartResult = await request('turn-start', 'turn/start', {
    threadId,
    cwd,
    approvalPolicy: 'never',
    sandboxPolicy: {
      type: 'workspaceWrite',
      writableRoots: [cwd],
      networkAccess: true,
      excludeTmpDirEnvVar: false,
      excludeSlashTmp: false,
    },
    input: [
      {
        type: 'text',
        text: 'Create hello.txt with exact content hello from local stdio probe, then report completion briefly.',
      },
    ],
  });

  await sleep(25_000);

  const threadReadResult = await request('thread-read', 'thread/read', {
    threadId,
    includeTurns: true,
  });

  console.log(
    JSON.stringify(
      {
        initializeResult,
        cwd,
        threadId,
        turnId: turnStartResult?.turn?.id || null,
        relevantNotifications: notifications.filter((entry) =>
          [
            'turn/started',
            'turn/completed',
            'turn/diff/updated',
            'item/started',
            'item/completed',
            'item/fileChange/outputDelta',
            'item/agentMessage/delta',
          ].includes(entry.method)
        ),
        threadReadSummary: {
          turnCount: Array.isArray(threadReadResult?.thread?.turns) ? threadReadResult.thread.turns.length : 0,
          latestTurn: Array.isArray(threadReadResult?.thread?.turns)
            ? threadReadResult.thread.turns[threadReadResult.thread.turns.length - 1] || null
            : null,
        },
        stderr,
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  console.error(stderr);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
}
