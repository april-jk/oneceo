import '../src/config/env';
import { e2bConnector } from '../src/connectors/e2b-connector';

const sandboxId = process.env.SANDBOX_ID || 'iq8ikcxxdl4ziyofut9oc';

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
  await run('grep -RIn "tcpmux|udpmux|epr|ice" /tmp/neko-src/server/internal | head -n 40');
  await run('sed -n "1,200p" /tmp/neko-src/server/internal/config/webrtc.go');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
