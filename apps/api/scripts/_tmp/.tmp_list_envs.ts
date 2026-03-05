import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  config({ path: envPath });
}

async function main() {
  const { sandboxExecutionEnvironmentDAO } = await import('./src/db/dao');
  const rows = await sandboxExecutionEnvironmentDAO.listRecent(10);
  for (const row of rows) {
    const meta = (row.metadata || {}) as Record<string, any>;
    const taskSessionId = meta.taskSessionId || meta.taskTitle;
    console.log(
      JSON.stringify(
        {
          sessionId: row.sessionId,
          status: row.status,
          taskSessionId,
          taskTitle: meta.taskTitle,
          sandboxId: meta?.e2b?.sandboxId,
          updatedAt: row.updatedAt,
        },
        null,
        2
      )
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
