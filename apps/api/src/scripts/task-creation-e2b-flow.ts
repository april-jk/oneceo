import '../config/env';
import crypto from 'crypto';
import { sandboxAgentProvisionService } from '../services/sandbox-agent-provision-service';
import { osacAgentService } from '../services/osac-agent-service';
import { sandboxEnvironmentService } from '../services/sandbox-environment-service';
import { e2bConnector } from '../connectors/e2b-connector';

async function main() {
  const taskSessionId = crypto.randomUUID();
  console.log('[flow] provision sandbox...');
  const provision = await sandboxAgentProvisionService.provision({
    metadata: {
      taskSessionId,
      taskTitle: 'e2b-flow-smoke',
    },
  });
  console.log('[flow] sandbox id:', provision.sessionId);

  const workspacePath = `/home/user/opencode/workspaces/${taskSessionId}`;
  console.log('[flow] create opencode session...');
  const created = await osacAgentService.createOpencodeSession(provision.sessionId, {
    workspacePath,
  });

  console.log('[flow] send prompt...');
  await osacAgentService.sendOpencodePrompt(provision.sessionId, {
    opencodeSessionId: created.opencodeSessionId,
    workspacePath,
    parts: [{ type: 'text', text: '输出 OK 并结束。' }],
  });

  console.log('[flow] prompt accepted');
  const verify: any = await e2bConnector.runCommand(
    provision.sessionId,
    'cat /tmp/oneceo_sandbox_verify.log 2>/dev/null || true',
    { timeoutMs: 15000 }
  );
  console.log('[flow] verify log:\\n' + String(verify?.stdout || verify?.output || ''));

  console.log('[flow] closing sandbox...');
  await sandboxEnvironmentService.closeEnvironment(provision.sessionId);
  console.log('[flow] done');
}

main().catch((error) => {
  console.error('[flow] failed:', error);
  process.exit(1);
});
