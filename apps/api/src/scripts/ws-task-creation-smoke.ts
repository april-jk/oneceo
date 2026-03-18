import '../config/env';
import WebSocket from 'ws';

const apiBase = process.env.TASK_CREATION_API_BASE || 'http://localhost:4000';
const wsUrl = process.env.TASK_CREATION_WS_URL || 'ws://localhost:4000/ws/task-creation';
const userInput =
  process.env.TASK_CREATION_INPUT || '新建一个 贪吃蛇的html并设计功能，单文件即可';
const waitMs = Number(process.env.TASK_CREATION_WAIT_MS || 150000);
const directMode = String(process.env.TASK_CREATION_DIRECT || '').trim() === '1';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const asText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function detectCompletionFromEvent(eventType: string, metadata: any): 'completed' | 'failed' | null {
  const lowerType = String(eventType || '').toLowerCase();
  if (!lowerType.startsWith('session.')) return null;
  if (lowerType === 'session.error') return 'failed';
  if (lowerType === 'session.idle') return 'completed';

  const event = (metadata?.event || {}) as Record<string, unknown>;
  const properties = (event.properties || {}) as Record<string, unknown>;
  const info = (properties.info || {}) as Record<string, unknown>;
  const statusRecord = (properties.status || {}) as Record<string, unknown>;
  const infoStatusRecord = (info.status || {}) as Record<string, unknown>;

  const states = [
    asText((event as any).state),
    asText((event as any).status),
    asText(properties.state),
    asText(properties.status),
    asText(statusRecord.type),
    asText(info.state),
    asText(info.status),
    asText(infoStatusRecord.type),
  ]
    .map((v) => v.toLowerCase())
    .filter(Boolean);

  const failStates = new Set(['failed', 'error', 'cancelled', 'canceled', 'aborted', 'timeout']);
  const doneStates = new Set(['completed', 'done', 'finished', 'success', 'succeeded', 'idle']);

  if (states.some((state) => failStates.has(state))) return 'failed';
  if (states.some((state) => doneStates.has(state))) return 'completed';
  return null;
}

function detectCompletionFromMessage(message: any): 'completed' | 'failed' | null {
  const type = String(message?.type || '').toLowerCase();
  const content = asText(message?.content || message?.message).toLowerCase();
  const metadata = message?.metadata || {};
  const outcome = asText(metadata?.outcome).toLowerCase();

  if (outcome === 'completed') return 'completed';
  if (outcome === 'failed') return 'failed';

  if (type === 'opencode_status' || type === 'status_update') {
    if (content.includes('执行完成') || content.includes('completed')) return 'completed';
    if (content.includes('执行失败') || content.includes('failed')) return 'failed';
  }
  return null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`request failed: ${resp.status} ${text}`);
  }
  return (await resp.json()) as T;
}

async function fetchLatestSessionId(): Promise<string | null> {
  try {
    const result = await fetchJson<{ data?: { id: string }[] }>(
      `${apiBase}/api/task-creation/sessions?limit=1`
    );
    const id = result?.data?.[0]?.id;
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

async function fetchWorkspaceTree(sessionId: string) {
  return fetchJson<{ data?: { root: string; items: any[] } }>(
    `${apiBase}/api/task-creation/sessions/${encodeURIComponent(sessionId)}/workspace/tree`
  );
}

async function main() {
  let sessionId: string | null = null;
  let opencodeSessionId: string | null = null;
  let orchestratorSessionId: string | null = null;
  let lastEventType: string | null = null;
  let lastError: string | null = null;
  let timedOut = false;
  let done = false;
  let lastSessionStatus: string | null = null;

  const ws = new WebSocket(wsUrl);

  const completion = new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (!done) {
        lastError = lastError || 'timeout waiting for completion';
        timedOut = true;
      }
      resolve();
    }, waitMs);

    ws.on('open', () => {
      ws.send(
        JSON.stringify(
          directMode
            ? {
                type: 'opencode_input',
                content: userInput,
                metadata: {
                  altusMode: 'sandbox',
                  executor: 'opencode',
                },
              }
            : { type: 'user_input', content: userInput }
        )
      );
    });

    ws.on('message', (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!sessionId && typeof msg.sessionId === 'string') {
        sessionId = msg.sessionId;
      }
      if (msg.metadata) {
        if (!orchestratorSessionId && typeof msg.metadata.orchestratorSessionId === 'string') {
          orchestratorSessionId = msg.metadata.orchestratorSessionId;
        }
        if (!opencodeSessionId && typeof msg.metadata.opencodeSessionId === 'string') {
          opencodeSessionId = msg.metadata.opencodeSessionId;
        }
      }
      if (msg.type === 'opencode_event' && msg.metadata) {
        lastEventType = msg.metadata.eventType || lastEventType;
        if (String(msg.metadata.eventType || '').toLowerCase().startsWith('session.')) {
          const event = (msg.metadata.event || {}) as Record<string, unknown>;
          const properties = (event.properties || {}) as Record<string, unknown>;
          const info = (properties.info || {}) as Record<string, unknown>;
          const status = asText(properties.status) || asText(info.status) || asText((event as any).status);
          if (status && status !== lastSessionStatus) {
            lastSessionStatus = status;
            console.log(`[ws-smoke] session.status=${status}`);
          }
        }
        const outcome = detectCompletionFromEvent(msg.metadata.eventType, msg.metadata);
        if (outcome === 'failed') {
          lastError = msg.content || 'session.error';
          done = true;
          clearTimeout(timeout);
          resolve();
        }
        if (outcome === 'completed') {
          done = true;
          clearTimeout(timeout);
          resolve();
        }
      }
      if (
        msg.type === 'opencode_status' &&
        typeof msg.sessionId === 'string' &&
        msg.sessionId.trim()
      ) {
        sessionId = msg.sessionId.trim();
      }
      const messageOutcome = detectCompletionFromMessage(msg);
      if (messageOutcome === 'failed') {
        lastError = msg.content || msg.message || 'status.failed';
        done = true;
        clearTimeout(timeout);
        resolve();
      }
      if (messageOutcome === 'completed') {
        done = true;
        clearTimeout(timeout);
        resolve();
      }
      if (msg.type === 'error') {
        lastError = msg.message || 'error';
        done = true;
        clearTimeout(timeout);
        resolve();
      }
    });

    ws.on('error', (err) => {
      lastError = err instanceof Error ? err.message : String(err);
      done = true;
      clearTimeout(timeout);
      resolve();
    });
  });

  // Attempt to discover session id via REST if not yet captured.
  for (let i = 0; i < 5 && !sessionId; i += 1) {
    await sleep(4000);
    sessionId = await fetchLatestSessionId();
  }

  await completion;
  ws.close();

  let treeInfo: { root?: string; items?: any[] } | null = null;
  if (sessionId) {
    for (let i = 0; i < 3; i += 1) {
      try {
        const tree = await fetchWorkspaceTree(sessionId);
        treeInfo = tree.data || null;
        break;
      } catch {
        await sleep(3000);
      }
    }
  }

  console.log('[ws-smoke] sessionId=', sessionId || '');
  console.log('[ws-smoke] orchestratorSessionId=', orchestratorSessionId || '');
  console.log('[ws-smoke] opencodeSessionId=', opencodeSessionId || '');
  console.log('[ws-smoke] lastEventType=', lastEventType || '');
  console.log('[ws-smoke] error=', lastError || '');
  if (treeInfo) {
    console.log('[ws-smoke] workspace root=', treeInfo.root || '');
    console.log('[ws-smoke] workspace items=', Array.isArray(treeInfo.items) ? treeInfo.items.length : 0);
  } else {
    console.log('[ws-smoke] workspace tree unavailable');
  }

  if (lastError) {
    process.exit(1);
  }
  if (timedOut) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error('[ws-smoke] failed:', error);
  process.exit(1);
});
