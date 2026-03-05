import '../src/config/env';
import { e2bConnector } from '../src/connectors/e2b-connector';

const sandboxId = process.env.SANDBOX_ID || '';

if (!sandboxId) {
  console.error('SANDBOX_ID required');
  process.exit(1);
}

async function run(cmd: string) {
  console.log(`\n$ ${cmd}`);
  const result = await e2bConnector.runCommand(sandboxId, cmd, { timeoutMs: 60000 });
  if (result?.stdout) {
    console.log(result.stdout.trim());
  }
  if (result?.stderr) {
    console.error(result.stderr.trim());
  }
}

async function main() {
  await run('grep -RIn \"legacy\" /tmp/neko-src/server/internal | head -n 80');
  await run('grep -RIn \"legacy\" /tmp/neko-src/server | head -n 80');
  await run('grep -RIn \"legacy\" /tmp/neko-src/client/src | head -n 80');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
