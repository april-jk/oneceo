import '../config/env';
import crypto from 'crypto';
import { ensureDatabaseConnection } from '../config/database';
import { sandboxAgentProvisionService } from '../services/sandbox-agent-provision-service';
import { sandboxEnvironmentService } from '../services/sandbox-environment-service';
import { e2bConnector } from '../connectors/e2b-connector';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import { touchSandbox } from '../services/sandbox-activity-service';
import { startSandboxArchiveJob } from '../services/sandbox-archive-job';
import { existsInR2 } from '../services/r2-client';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
  const taskSessionId = crypto.randomUUID();
  console.log('[r2-smoke] taskSessionId:', taskSessionId);

  console.log('[r2-smoke] provision sandbox...');
  const provision = await sandboxAgentProvisionService.provision({
    metadata: {
      taskSessionId,
      taskTitle: 'r2-archive-smoke',
    },
  });

  const sandboxId = provision.sessionId;
  const workspacePath = resolveOpencodeWorkspacePath(taskSessionId);
  const marker = `r2-smoke-${Date.now()}`;
  const filePath = `${workspacePath}/r2_smoke.txt`;

  console.log('[r2-smoke] write marker file...');
  await e2bConnector.runCommand(
    sandboxId,
    `mkdir -p ${workspacePath} && echo "${marker}" > ${filePath}`,
    { timeoutMs: 30000 }
  );
  await touchSandbox(sandboxId, 'smoke_write');

  console.log('[r2-smoke] start archive job and wait...');
  startSandboxArchiveJob();
  await sleep(90_000);

  const archiveKey = `sessions/${taskSessionId}/workspace.tar.gz`;
  const exists = await existsInR2(archiveKey);
  console.log('[r2-smoke] archive exists:', exists);
  if (!exists) {
    throw new Error('R2 archive not found');
  }

  console.log('[r2-smoke] close sandbox...');
  await sandboxEnvironmentService.closeEnvironment(sandboxId);

  console.log('[r2-smoke] provision sandbox again (restore)...');
  const provision2 = await sandboxAgentProvisionService.provision({
    metadata: {
      taskSessionId,
      taskTitle: 'r2-archive-restore',
    },
  });

  console.log('[r2-smoke] verify restored file...');
  const result: any = await e2bConnector.runCommand(
    provision2.sessionId,
    `cat ${filePath}`,
    { timeoutMs: 30000 }
  );
  const output = String(result?.stdout || result?.output || '').trim();
  console.log('[r2-smoke] restored content:', output);

  if (output !== marker) {
    throw new Error(`Restored content mismatch: ${output}`);
  }

  console.log('[r2-smoke] success');
}

main().catch((error) => {
  console.error('[r2-smoke] failed:', error);
  process.exit(1);
});
