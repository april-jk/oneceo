import path from 'node:path';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const waitMs = Math.max(20_000, Number(process.argv[2] || 45_000));
  const userId = `codex-ws-test-user-${Date.now()}`;
  const taskSessionId = randomUUID();
  const prompt = process.argv.slice(3).join(' ').trim() || '请只回复“OK”，不要输出其他内容。';

  const { taskCreationSessionDAO, sandboxExecutionEnvironmentDAO } = await import('../../src/db/dao');
  const { taskCreationFileMemoryStore } = await import('../../src/agents/task-creation/file-memory-store');
  const { codexRemoteService } = await import('../../src/services/codex-remote-service');
  const { e2bConnector } = await import('../../src/connectors/e2b-connector');
  const { e2bConfig } = await import('../../src/config/e2b-config');

  await taskCreationSessionDAO.createSession({
    id: taskSessionId,
    userId,
    status: 'in_progress',
  });
  await taskCreationFileMemoryStore.createSession('codex ws template e2e', taskSessionId);
  await taskCreationFileMemoryStore.updateSessionMode(taskSessionId, 'sandbox');
  await taskCreationFileMemoryStore.updateSessionExecutor(taskSessionId, 'codex');
  await taskCreationFileMemoryStore.updateSessionCodexExecutionMode(taskSessionId, 'ws');
  await taskCreationFileMemoryStore.updateRuntimeBinding(taskSessionId, {
    executor: 'codex',
    transport: 'app_server',
  });

  codexRemoteService.initialize();

  let sandboxId = '';
  try {
    const accepted = await codexRemoteService.sendUserInput({
      taskSessionId,
      content: prompt,
      source: 'user',
    });

    await sleep(waitMs);

    const fileSession = await taskCreationFileMemoryStore.getSession(taskSessionId);
    const dbSession = await taskCreationSessionDAO.getSession(taskSessionId);

    sandboxId = String(fileSession?.runtime?.orchestratorSessionId || '').trim();
    const env = sandboxId ? await sandboxExecutionEnvironmentDAO.getBySessionId(sandboxId) : null;
    let inspect: Record<string, unknown> | null = null;
    if (sandboxId) {
      const [configToml, authJson, appServerLog, mcpList] = await Promise.all([
        e2bConnector.runCommand(sandboxId, 'cat /home/user/.codex/config.toml || true', { timeoutMs: 15_000 }),
        e2bConnector.runCommand(sandboxId, 'cat /home/user/.codex/auth.json || true', { timeoutMs: 15_000 }),
        e2bConnector.runCommand(sandboxId, 'tail -n 80 /tmp/codex-app-server.log || true', { timeoutMs: 15_000 }),
        e2bConnector.runCommand(sandboxId, 'codex mcp list || true', { timeoutMs: 30_000 }),
      ]);
      inspect = {
        configToml: String((configToml as any)?.stdout || ''),
        authJson: String((authJson as any)?.stdout || ''),
        appServerLog: String((appServerLog as any)?.stdout || ''),
        mcpList: String((mcpList as any)?.stdout || ''),
      };
    }

    const result = {
      accepted,
      expectedWsTemplate: e2bConfig.codexWsTemplate,
      fileSession: fileSession
        ? {
            id: fileSession.id,
            status: fileSession.status,
            stage: fileSession.stage,
            driver: fileSession.driver,
            executor: fileSession.executor,
            codexExecutionMode: fileSession.codexExecutionMode,
            runtime: fileSession.runtime,
            tail: fileSession.messages.slice(-10).map((message) => ({
              role: message.role,
              messageType: message.messageType,
              content: message.content,
              metadata: message.metadata,
            })),
          }
        : null,
      dbSession,
      environment: env
        ? {
            sessionId: env.sessionId,
            status: env.status,
            metadata: env.metadata,
          }
        : null,
      inspect,
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (sandboxId) {
      await e2bConnector.killSandbox(sandboxId).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
