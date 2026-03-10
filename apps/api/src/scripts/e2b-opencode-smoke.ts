import '../config/env';
import { e2bConnector } from '../connectors/e2b-connector';
import { e2bConfig } from '../config/e2b-config';
import { opencodeHttpClient } from '../connectors/opencode-http-client';

async function main() {
  const withTimeout = async <T>(label: string, promise: Promise<T>, ms: number): Promise<T> => {
    let timeoutHandle: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
        }),
      ]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  };

  console.log('[smoke] creating sandbox...');
  const envs: Record<string, string> = {};
  const passthrough = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENCODE_MODEL', 'OPENCODE_PROVIDER_ID'];
  for (const key of passthrough) {
    const value = process.env[key];
    if (value && value.trim()) envs[key] = value.trim();
  }
  const sandbox = await withTimeout(
    'createSandbox',
    e2bConnector.createSandbox({
    template: e2bConfig.template,
    timeoutMs: e2bConfig.timeoutMs,
    allowInternetAccess: e2bConfig.allowInternetAccess,
    allowPublicTraffic: e2bConfig.allowPublicTraffic,
    envs,
    }),
    60_000
  );

  const sandboxId = sandbox.sandboxId;
  const trafficAccessToken = sandbox.trafficAccessToken || undefined;
  const host = await e2bConnector.getSandboxHost(sandboxId, e2bConfig.opencodePort);
  const baseUrl = `https://${host}`;

  console.log('[smoke] starting opencode serve...');
  await withTimeout(
    'startOpencode',
    e2bConnector.runCommand(
      sandboxId,
      `nohup opencode serve --hostname ${e2bConfig.opencodeHost} --port ${e2bConfig.opencodePort} > /tmp/opencode-server.log 2>&1 &`,
      { timeoutMs: 30000 }
    ),
    45_000
  );

  console.log('[smoke] waiting for health...');
  await withTimeout('healthCheck', opencodeHttpClient.ensureServerReady(baseUrl, trafficAccessToken), 60_000);

  console.log('[smoke] creating session...');
  const session = await withTimeout(
    'createSession',
    opencodeHttpClient.createSession(baseUrl, { directory: '/home/user' }, trafficAccessToken),
    30_000
  );

  console.log('[smoke] sending prompt...');
  await withTimeout(
    'sendPrompt',
    opencodeHttpClient.sendPrompt(
      baseUrl,
      {
        sessionId: session.id,
        parts: [{ type: 'text', text: '输出 OK 并结束。' }],
      },
      trafficAccessToken
    ),
    30_000
  );

  console.log('[smoke] prompt accepted:', session.id);
  await sandbox.kill();
  console.log('[smoke] sandbox killed.');
}

main().catch((error) => {
  console.error('[smoke] failed:', error);
  process.exit(1);
});
