import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  config({ path: envPath });
}

const sessionId = process.argv[2];
if (!sessionId) {
  console.error('Usage: tsx .tmp_get_env_detail.ts <sessionId>');
  process.exit(1);
}

async function main() {
  const { sandboxExecutionEnvironmentDAO } = await import('./src/db/dao');
  const env = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
  console.log(JSON.stringify(env, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
