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
  console.log(`Inspect client connection logic: ${sandboxId}`);
  await run('sed -n "1,140p" /tmp/neko-src/client/src/neko/base.ts');
  await run('sed -n "1,220p" /tmp/neko-src/client/src/components/connect.vue');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
