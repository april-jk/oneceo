import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { OsacClient } from '../src/clients/osac-client';

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function tryConnect(url: string, token: string) {
  const client = new OsacClient(url, {
    authToken: token,
    connectTimeoutMs: 4500,
    requestTimeoutMs: 8000,
  });
  try {
    await client.connect();
    const reply = await client.request(
      { type: 'GET_SESSION_LIST', payload: { maxCount: 1, format: 'json' } },
      (msg) => msg.type === 'SESSION_LIST_RESPONSE'
    );
    client.close();
    return { ok: true, replyType: reply.type };
  } catch (e: any) {
    try { client.close(); } catch {}
    return { ok: false, error: e?.message || String(e) };
  }
}

async function main() {
  const { sandboxAgentProvisionService } = await import('../src/services/sandbox-agent-provision-service');
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');

  const provision = await withTimeout(
    sandboxAgentProvisionService.provision({
      metadata: { owner: 'codex-test', purpose: 'mapped-vs-direct-60s' },
      idempotencyKey: `mapped-direct-${Date.now()}`,
    }),
    360000,
    'provision'
  );

  const sid = provision.sessionId;
  const env = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
  const md = (env?.metadata || {}) as any;
  const token = String(md.osacAuthToken || '');
  const mapped = String(md.osacEndpoint || '');
  const vmIp = String(md.vmIpAddress || '').trim();
  const direct = vmIp ? `ws://${vmIp}:18080/ws` : '';

  console.log('sessionId=', sid);
  console.log('mapped=', mapped);
  console.log('direct=', direct || '(none)');

  const start = Date.now();
  let mappedOkAt: number | null = null;
  let directOkAt: number | null = null;

  while (Date.now() - start < 60000) {
    const elapsed = Math.floor((Date.now() - start) / 1000);

    if (!mappedOkAt && mapped) {
      const mappedRes = await tryConnect(mapped, token);
      console.log(`t=${elapsed}s mapped=`, JSON.stringify(mappedRes));
      if (mappedRes.ok) {
        mappedOkAt = Date.now();
      }
    }

    if (!directOkAt && direct) {
      const directRes = await tryConnect(direct, token);
      console.log(`t=${elapsed}s direct=`, JSON.stringify(directRes));
      if (directRes.ok) {
        directOkAt = Date.now();
      }
    }

    if (mappedOkAt && (directOkAt || !direct)) {
      break;
    }

    await sleep(5000);
  }

  const mappedSec = mappedOkAt ? Math.floor((mappedOkAt - start) / 1000) : null;
  const directSec = directOkAt ? Math.floor((directOkAt - start) / 1000) : null;

  console.log('summary=', JSON.stringify({ mappedSec, directSec }));
}

main().catch((error) => {
  console.error('mapped-vs-direct failed:', error?.message || String(error));
  process.exit(1);
});
