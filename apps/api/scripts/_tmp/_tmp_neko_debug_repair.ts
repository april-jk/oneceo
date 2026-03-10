import { ensureDatabaseConnection } from '../src/config/database';
import { ensureNekoDebug } from '../src/services/sandbox-debug-service';

async function main() {
  const sandboxId = process.argv[2];
  if (!sandboxId) {
    throw new Error('sandboxId required');
  }
  await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
  const result = await ensureNekoDebug(sandboxId);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('[debug] failed', error);
  process.exit(1);
});
