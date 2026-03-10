import { osacLlmProxyBridgeService } from './src/services/osac-llm-proxy-bridge';
import { osacConnectionManager } from './src/services/osac-connection-manager';
import { kvmConnector } from './src/connectors/kvm-connector';

const sid = process.env.SID || 'sess_d338267421d04ed7';

async function waitJob(jobId: string) {
  for (let i = 0; i < 80; i++) {
    const job = await kvmConnector.getJob(jobId);
    const status = (job.data as any)?.status;
    if (status && status !== 'queued' && status !== 'running') {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('job timeout: ' + jobId);
}

async function main() {
  osacLlmProxyBridgeService.initialize();

  const seen: any[] = [];
  osacConnectionManager.registerMessageHandler(async (sessionId, message) => {
    if (sessionId !== sid) return;
    seen.push(message);
    const payload: any = message.payload || {};
    if (['LLM_PROXY_REQUEST', 'LLM_PROXY_RESPONSE', 'LLM_PROXY_CHUNK', 'LLM_PROXY_END', 'LLM_PROXY_ERROR', 'ERROR', 'HEARTBEAT'].includes(message.type)) {
      console.log('MSG', message.type, JSON.stringify({
        path: payload.path,
        status: payload.status,
        requestId: payload.requestId || message.requestId,
        code: payload?.error?.code || payload.code,
      }));
    }
  });

  await osacConnectionManager.getConnection(sid);
  console.log('connected');

  const exec = await kvmConnector.execSession(sid, {
    path: '/bin/bash',
    args: ['-lc', 'curl -sS -m 20 http://127.0.0.1:18111/v1/models'],
    capture_output: true,
    timeout_seconds: 40,
  });

  const jobId =
    (exec as any)?.data?.jobId ||
    (exec as any)?.data?.job_id ||
    (exec as any)?.jobId ||
    (exec as any)?.job_id;

  const final = jobId ? await waitJob(String(jobId)) : exec;
  console.log('exec-final', JSON.stringify((final as any)?.data?.result || (final as any)?.data || final));

  await new Promise((resolve) => setTimeout(resolve, 5000));

  const counts: Record<string, number> = {};
  for (const message of seen) {
    counts[message.type] = (counts[message.type] || 0) + 1;
  }
  console.log('counts', JSON.stringify(counts));

  await osacConnectionManager.close(sid);
}

main().catch((error) => {
  console.error('probe failed', error);
  process.exit(1);
});
