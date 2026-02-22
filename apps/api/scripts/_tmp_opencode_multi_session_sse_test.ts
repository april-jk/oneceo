import 'dotenv/config';
import WebSocket from 'ws';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';

const WS_URL = process.env.TEST_WS_URL || 'ws://127.0.0.1:4000/ws/task-creation';
const ORCH_SESSION_ID = (process.env.OSAC_FIXED_SANDBOX_SESSION_ID || '').trim();

type SeenEvent = {
  sessionId: string;
  opencodeSessionId?: string;
  content?: string;
  eventType?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createSession(title: string): Promise<string> {
  const session = await taskCreationFileMemoryStore.createSession(title);
  return session.id;
}

async function openClient(sessionId: string, label: string) {
  return new Promise<{
    ws: WebSocket;
    seen: SeenEvent[];
  }>((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const seen: SeenEvent[] = [];

    const timer = setTimeout(() => {
      reject(new Error(`[${label}] ws connect timeout`));
    }, 15000);

    ws.on('open', () => {
      clearTimeout(timer);
      resolve({ ws, seen });
    });

    ws.on('message', (data) => {
      try {
        const payload = JSON.parse(data.toString());
        const messageType = String(payload?.type || '');
        if (messageType !== 'opencode_event') return;
        const metadata = (payload?.metadata || {}) as Record<string, unknown>;
        seen.push({
          sessionId: payload?.sessionId || payload?.metadata?.sessionId || sessionId,
          opencodeSessionId: String(metadata.opencodeSessionId || ''),
          content: payload?.content,
          eventType: String(metadata.eventType || ''),
        });
      } catch {
        // ignore parse errors
      }
    });

    ws.on('error', (err) => reject(err));
  });
}

async function sendOpencodeInput(ws: WebSocket, sessionId: string, content: string) {
  ws.send(
    JSON.stringify({
      type: 'opencode_input',
      sessionId,
      content,
      metadata: {
        orchestratorSessionId: ORCH_SESSION_ID || undefined,
      },
    })
  );
}

async function main() {
  if (!ORCH_SESSION_ID) {
    throw new Error('OSAC_FIXED_SANDBOX_SESSION_ID is required');
  }

  const sessionA = await createSession('opencode-sse-test-A');
  const sessionB = await createSession('opencode-sse-test-B');

  const [clientA, clientB] = await Promise.all([
    openClient(sessionA, 'A'),
    openClient(sessionB, 'B'),
  ]);

  await sendOpencodeInput(clientA.ws, sessionA, 'Say "A_OK" and output a short sentence.');
  await sendOpencodeInput(clientB.ws, sessionB, 'Say "B_OK" and output a short sentence.');

  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const hasA = clientA.seen.some((item) => item.opencodeSessionId && item.content);
    const hasB = clientB.seen.some((item) => item.opencodeSessionId && item.content);
    if (hasA && hasB) break;
    await sleep(1500);
  }

  clientA.ws.close();
  clientB.ws.close();

  const aEvents = clientA.seen.filter((item) => item.opencodeSessionId);
  const bEvents = clientB.seen.filter((item) => item.opencodeSessionId);

  if (aEvents.length === 0 || bEvents.length === 0) {
    throw new Error(`Missing events: A=${aEvents.length} B=${bEvents.length}`);
  }

  const aOpencodeIds = new Set(aEvents.map((e) => e.opencodeSessionId));
  const bOpencodeIds = new Set(bEvents.map((e) => e.opencodeSessionId));
  const overlap = [...aOpencodeIds].filter((id) => bOpencodeIds.has(id));
  if (overlap.length > 0) {
    throw new Error(`Session overlap detected: ${overlap.join(',')}`);
  }

  console.log('[test] ok', {
    sessionA,
    sessionB,
    opencodeA: [...aOpencodeIds],
    opencodeB: [...bOpencodeIds],
    aEvents: aEvents.length,
    bEvents: bEvents.length,
  });
}

main().catch((error) => {
  console.error('[test] failed', error);
  process.exit(1);
});
