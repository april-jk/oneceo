import '../src/config/env';
import { ensureNekoDebug } from '../src/services/sandbox-debug-service';

const sandboxId = process.env.SANDBOX_ID || 'iq8ikcxxdl4ziyofut9oc';

async function main() {
  const result = await ensureNekoDebug(sandboxId);
  console.log(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
