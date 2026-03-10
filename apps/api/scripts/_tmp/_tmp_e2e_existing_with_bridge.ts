import dotenv from 'dotenv';
import express from 'express';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
if (!sid) {
  console.error('usage: pnpm exec tsx scripts/_tmp_e2e_existing_with_bridge.ts <sessionId>');
  process.exit(1);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function startLocalBridge(port: number) {
  const llmProxyRoutes = (await import('../src/routes/llm-proxy-routes')).default;
  const app = express();
  app.use('/api/llm-proxy', express.raw({ type: '*/*' }), llmProxyRoutes);

  const server = await new Promise<any>((resolve, reject) => {
    const s = app.listen(port, '127.0.0.1');
    s.once('listening', () => resolve(s));
    s.once('error', (err: any) => reject(err));
  });

  return {
    baseUrl: `http://127.0.0.1:${port}/api/llm-proxy`,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function execCmd(sessionId: string, command: string, timeoutSeconds = 120) {
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const submit: any = await kvmConnector.execSession(sessionId, {
    path: '/bin/bash',
    args: ['-lc', command],
    capture_output: true,
    timeout_seconds: timeoutSeconds,
  });
  const jobId = submit?.data?.jobId || submit?.data?.job_id || submit?.jobId || submit?.job_id;
  let final: any = submit;
  if (jobId) {
    for (let i = 0; i < 180; i++) {
      const job: any = await kvmConnector.getJob(String(jobId));
      const status = String(job?.data?.status || '').toLowerCase();
      if (status && status !== 'queued' && status !== 'running') {
        final = job;
        break;
      }
      await sleep(1000);
    }
  }
  const payload = final?.data?.result || final?.data || final || {};
  return {
    status: String(final?.data?.status || payload.status || 'unknown'),
    exit: payload.exitcode ?? payload.exitCode ?? null,
    stdout: String(payload.stdout || payload.output || ''),
    stderr: String(payload.stderr || ''),
  };
}

async function main() {
  const { osacConnectionManager } = await import('../src/services/osac-connection-manager');
  const { osacLlmProxyBridgeService } = await import('../src/services/osac-llm-proxy-bridge');

  const localPort = Number(process.env.PORT || 4000);
  const bridge = await startLocalBridge(localPort);
  process.env.OSAC_LLM_PROXY_BRIDGE_BASE_URL = bridge.baseUrl;

  osacLlmProxyBridgeService.initialize();
  const ready = await osacConnectionManager.ensurePersistent(sid);
  console.log('persistentReady=', ready);

  await sleep(1500);

  const models = await execCmd(
    sid,
    'curl -sS -m 60 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy"',
    90
  );
  console.log(
    'MODELS=',
    JSON.stringify(
      {
        status: models.status,
        exit: models.exit,
        stdout: models.stdout.slice(0, 1400),
        stderr: models.stderr.slice(0, 400),
      },
      null,
      2
    )
  );

  const model = process.env.OPENCODE_MODEL || 'claude-haiku-4-5-20251001';
  const payload = JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Reply ONLY: sandbox_proxy_ok' }],
    max_tokens: 24,
  }).replace(/'/g, "'\\''");

  const chat = await execCmd(
    sid,
    `curl -sS -m 70 http://127.0.0.1:18111/v1/chat/completions -H "Authorization: Bearer local-proxy" -H "Content-Type: application/json" -d '${payload}'`,
    110
  );
  console.log(
    'CHAT=',
    JSON.stringify(
      {
        status: chat.status,
        exit: chat.exit,
        stdout: chat.stdout.slice(0, 1600),
        stderr: chat.stderr.slice(0, 400),
      },
      null,
      2
    )
  );

  await osacConnectionManager.close(sid);
  await bridge.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
