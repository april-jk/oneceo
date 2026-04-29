import path from 'node:path';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

async function main() {
  const taskSessionId = randomUUID();
  const userId = `codex-ws-mcp-list-${Date.now()}`;

  const { taskCreationSessionDAO } = await import('../../src/db/dao/task-creation-session.dao');
  const { taskCreationFileMemoryStore } = await import('../../src/agents/task-creation/file-memory-store');
  const { sandboxAgentProvisionService } = await import('../../src/services/sandbox-agent-provision-service');
  const { e2bConnector } = await import('../../src/connectors/e2b-connector');

  await taskCreationSessionDAO.createSession({
    id: taskSessionId,
    userId,
    status: 'in_progress',
  });
  await taskCreationFileMemoryStore.createSession('codex ws mcp list', taskSessionId);
  await taskCreationFileMemoryStore.updateSessionMode(taskSessionId, 'sandbox');
  await taskCreationFileMemoryStore.updateSessionExecutor(taskSessionId, 'codex');
  await taskCreationFileMemoryStore.updateSessionCodexExecutionMode(taskSessionId, 'ws');
  await taskCreationFileMemoryStore.updateRuntimeBinding(taskSessionId, {
    executor: 'codex',
    transport: 'app_server',
  });

  const provisioned = await sandboxAgentProvisionService.provision({
    taskSessionId,
    executor: 'codex',
    metadata: {
      codexExecutionMode: 'ws',
      codexMode: 'ws',
      transport: 'app_server',
    },
  });

  const sessionId = provisioned.sessionId;
  try {
    const [mcpList, configToml] = await Promise.all([
      e2bConnector.runCommand(sessionId, 'codex mcp list || true', { timeoutMs: 30_000 }),
      e2bConnector.runCommand(sessionId, 'cat /home/user/.codex/config.toml || true', { timeoutMs: 15_000 }),
    ]);
    console.log(
      JSON.stringify(
        {
          sessionId,
          mcpList: String((mcpList as any)?.stdout || ''),
          configToml: String((configToml as any)?.stdout || ''),
        },
        null,
        2
      )
    );
  } finally {
    await e2bConnector.killSandbox(sessionId).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
