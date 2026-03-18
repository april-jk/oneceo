import '../../src/config/env';
import { randomUUID } from 'node:crypto';
import { ensureDatabaseConnection } from '../../src/config/database';
import { codexRemoteService } from '../../src/services/codex-remote-service';
import { taskCreationFileMemoryStore } from '../../src/agents/task-creation/file-memory-store';
import { taskCreationSessionDAO } from '../../src/db/dao';
import { sandboxEnvironmentService } from '../../src/services/sandbox-environment-service';
import { archiveSandboxWorkspace } from '../../src/services/sandbox-archive-service';

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCompleted(taskSessionId: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = await taskCreationFileMemoryStore.getSession(taskSessionId);
    if (session?.status === 'completed' || session?.status === 'failed') {
      return session;
    }
    await sleep(1500);
  }
  return taskCreationFileMemoryStore.getSession(taskSessionId);
}

async function main() {
  await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
  codexRemoteService.initialize();

  const taskSessionId = randomUUID();
  const memoryToken = `MEM-${randomUUID().slice(0, 8)}`;
  const fileMark = `FILE-${randomUUID().slice(0, 8)}`;

  await taskCreationFileMemoryStore.createSession('codex platform restore smoke', taskSessionId);
  await taskCreationFileMemoryStore.updateSessionMode(taskSessionId, 'sandbox');
  await taskCreationFileMemoryStore.updateSessionExecutor(taskSessionId, 'codex');
  await taskCreationSessionDAO.createSession({ id: taskSessionId, status: 'in_progress' });

  const acceptedA = await codexRemoteService.sendUserInput({
    taskSessionId,
    content: [
      `Remember this memory token for our conversation only: ${memoryToken}.`,
      `Do not write ${memoryToken} to disk.`,
      `Create restore_note.txt containing exactly ${fileMark}.`,
      `Reply exactly: MEMORY=${memoryToken};MARK=${fileMark}`,
    ].join(' '),
  });

  const afterA = await waitForCompleted(taskSessionId);
  const oldOrchestratorSessionId = String(afterA?.runtime?.orchestratorSessionId || acceptedA.orchestratorSessionId || '');
  if (!oldOrchestratorSessionId) {
    throw new Error('missing old orchestrator session id');
  }

  await sleep(5000);
  await archiveSandboxWorkspace(oldOrchestratorSessionId, 'platform_restore_smoke', {
    forceUpload: true,
  });
  await sandboxEnvironmentService.closeEnvironment(oldOrchestratorSessionId);
  await sleep(3000);

  const acceptedB = await codexRemoteService.sendUserInput({
    taskSessionId,
    content: `From our previous conversation context only, reply exactly: MEMORY=${memoryToken};MARK=${fileMark}`,
  });

  const afterB = await waitForCompleted(taskSessionId);
  const dbMessages = await taskCreationSessionDAO.getMessages(taskSessionId);

  console.log(
    JSON.stringify(
      {
        taskSessionId,
        acceptedA,
        acceptedB,
        runtime: afterB?.runtime,
        status: afterB?.status,
        stage: afterB?.stage,
        tail: afterB?.messages.slice(-10).map((message) => ({
          role: message.role,
          type: message.messageType,
          content: message.content,
          metadata: message.metadata,
        })),
        dbTail: dbMessages.slice(-10).map((message) => ({
          role: message.role,
          type: message.messageType,
          content: message.content,
          metadata: message.metadata,
        })),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
