import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

const cwd = `/tmp/codex-appserver-resume-${Date.now()}`;
await fs.mkdir(cwd, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTurn({ threadId, prompt }) {
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
      const payload = JSON.parse(line);
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

  try {
    await request('init', 'initialize', {
      clientInfo: {
        name: 'oneceo-local-resume-probe',
        title: 'oneceo local resume probe',
        version: '0.0.1',
      },
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: [],
      },
    });

    const threadResult = threadId
      ? await request('thread-resume', 'thread/resume', { threadId, cwd })
      : await request('thread-start', 'thread/start', {
          cwd,
          approvalPolicy: 'never',
          sandbox: 'workspace-write',
          experimentalRawEvents: false,
          persistExtendedHistory: true,
        });

    const resolvedThreadId = String(threadResult?.thread?.id || threadId || '').trim();
    if (!resolvedThreadId) {
      throw new Error('thread id missing');
    }

    const turnResult = await request(`turn-${Date.now()}`, 'turn/start', {
      threadId: resolvedThreadId,
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
          text: prompt,
        },
      ],
    });

    await sleep(20_000);

    const threadRead = await request(`read-${Date.now()}`, 'thread/read', {
      threadId: resolvedThreadId,
      includeTurns: true,
    });

    return {
      threadId: resolvedThreadId,
      turnId: turnResult?.turn?.id || null,
      threadRead,
      notifications,
      stderr,
    };
  } finally {
    child.kill('SIGTERM');
  }
}

const first = await runTurn({
  prompt: 'Create note.txt with exact content first turn memory token ABC123.',
});

const second = await runTurn({
  threadId: first.threadId,
  prompt: 'What token did I ask you to write in the previous turn? Answer with the token only.',
});

const turns = Array.isArray(second.threadRead?.thread?.turns) ? second.threadRead.thread.turns : [];
const latestTurn = turns.length > 0 ? turns[turns.length - 1] : null;

console.log(
  JSON.stringify(
    {
      cwd,
      firstSummary: {
        threadId: first.threadId,
        turnCount: Array.isArray(first.threadRead?.thread?.turns) ? first.threadRead.thread.turns.length : 0,
      },
      secondSummary: {
        threadId: second.threadId,
        turnCount: turns.length,
        latestTurn,
      },
      secondNotifications: second.notifications.filter((entry) =>
        ['item/completed', 'turn/completed', 'turn/diff/updated'].includes(entry.method)
      ),
      secondStderr: second.stderr,
    },
    null,
    2
  )
);
