import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const waitMs = Math.max(5_000, Number(process.argv[2] || 15_000));
  const { sandboxAgentProvisionService } = await import('../../src/services/sandbox-agent-provision-service');
  const { osacAgentService } = await import('../../src/services/osac-agent-service');
  const { osacConnectionManager } = await import('../../src/services/osac-connection-manager');
  const { sandboxExecutionEnvironmentDAO } = await import('../../src/db/dao');
  const { e2bConnector } = await import('../../src/connectors/e2b-connector');
  const { resolveOpencodeWorkspacePath } = await import('../../src/utils/opencode-workspace');

  const taskSessionId = `codex_executor_smoke_${Date.now()}`;
  const workspacePath = resolveOpencodeWorkspacePath(taskSessionId);
  const provision = await sandboxAgentProvisionService.provisionWithLock({
    executor: 'codex',
    metadata: {
      owner: 'codex-live-test',
      purpose: 'codex-executor-smoke',
      taskSessionId,
      taskTitle: 'codex executor smoke',
      executor: 'codex',
    },
  });

  const sessionId = provision.sessionId;
  console.log(
    JSON.stringify(
      {
        phase: 'provisioned',
        sessionId,
        osacEndpoint: provision.osacEndpoint,
        osacConnectionMode: provision.osacConnectionMode,
        hasToken: Boolean(provision.osacAuthToken),
        workspacePath,
      },
      null,
      2
    )
  );

  try {
    const runtime = await osacAgentService.ensureExecutorRuntime(sessionId, {
      executor: 'codex',
      workspacePath,
    });
    console.log(JSON.stringify({ phase: 'runtime_ready', runtime }, null, 2));

    const accepted = await osacAgentService.sendExecutorInput(sessionId, {
      executor: 'codex',
      workspacePath,
      parts: [{ type: 'text', text: 'Reply with exactly OK and nothing else.' }],
    });
    await sleep(waitMs);
    const messages = osacConnectionManager.listMessages(sessionId, 20);
    console.log(
      JSON.stringify(
        {
          phase: 'accepted',
          waitedMs: waitMs,
          accepted,
          messages: messages.map((message) => ({
            type: message.type,
            payload: message.payload,
          })),
        },
        null,
        2
      )
    );
  } catch (error) {
    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
    let osacLog = '';
    try {
      const logResult = await e2bConnector.runCommand(
        sessionId,
        'tail -n 120 /home/user/opencode/log/osac.log 2>/dev/null || true',
        { timeoutMs: 20_000 }
      );
      osacLog = String((logResult as any)?.stdout || '').slice(0, 6000);
    } catch {
      // ignore log tail failure
    }
    console.error(
      JSON.stringify(
        {
          phase: 'failed',
          error: error instanceof Error ? error.message : String(error),
          environmentMetadata: environment?.metadata || null,
          bufferedMessages: osacConnectionManager.listMessages(sessionId, 20),
          osacLog,
        },
        null,
        2
      )
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
