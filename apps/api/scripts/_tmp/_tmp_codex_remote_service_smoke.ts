import dotenv from 'dotenv';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const waitMs = Math.max(8_000, Number(process.argv[2] || 20_000));
  const taskSessionId = randomUUID();

  const { codexRemoteService } = await import('../../src/services/codex-remote-service');
  const { taskCreationFileMemoryStore } = await import('../../src/agents/task-creation/file-memory-store');
  const { taskCreationSessionDAO } = await import('../../src/db/dao');

  await taskCreationFileMemoryStore.createSession('codex remote smoke', taskSessionId);
  await taskCreationFileMemoryStore.updateSessionMode(taskSessionId, 'sandbox');
  await taskCreationFileMemoryStore.updateSessionExecutor(taskSessionId, 'codex');
  await taskCreationSessionDAO.createSession({ id: taskSessionId, status: 'in_progress' });

  const notifications: Array<Record<string, unknown>> = [];
  codexRemoteService.initialize();
  const unsubscribe = codexRemoteService.subscribe((payload) => {
    notifications.push({
      taskSessionId: payload.taskSessionId,
      type: payload.message.type,
      content: payload.message.content,
      stage: payload.message.stage,
      metadata: payload.message.metadata,
    });
  });

  try {
    const accepted = await codexRemoteService.sendUserInput({
      taskSessionId,
      content: 'Reply with exactly OK and nothing else.',
      source: 'user',
    });

    await sleep(waitMs);

    const fileSession = await taskCreationFileMemoryStore.getSession(taskSessionId);
    const dbSession = await taskCreationSessionDAO.getSession(taskSessionId);
    const dbMessages = await taskCreationSessionDAO.getMessages(taskSessionId);

    console.log(
      JSON.stringify(
        {
          phase: 'completed',
          waitedMs: waitMs,
          taskSessionId,
          accepted,
          fileSession: fileSession
            ? {
                id: fileSession.id,
                status: fileSession.status,
                stage: fileSession.stage,
                mode: fileSession.mode,
                driver: fileSession.driver,
                executor: fileSession.executor,
                runtime: fileSession.runtime,
                messageCount: fileSession.messages.length,
                tail: fileSession.messages.slice(-6).map((message) => ({
                  role: message.role,
                  messageType: message.messageType,
                  content: message.content,
                  metadata: message.metadata,
                })),
              }
            : null,
          dbSession,
          dbMessageCount: dbMessages.length,
          dbTail: dbMessages.slice(-6).map((message) => ({
            role: message.role,
            messageType: message.messageType,
            content: message.content,
            metadata: message.metadata,
          })),
          notifications,
        },
        null,
        2
      )
    );
  } finally {
    unsubscribe();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
