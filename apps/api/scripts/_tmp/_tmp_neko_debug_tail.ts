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
  console.log(`Inspect logs: ${sandboxId}`);
  await run('ps aux | grep -E "neko|Xvfb|chromium" | grep -v grep || true');
  await run('ss -ltnp | grep 8080 || true');
  await run('tail -n 120 /tmp/neko.log || true');
  await run('tail -n 80 /tmp/xvfb.log || true');
  await run('tail -n 80 /tmp/chromium.log || true');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
