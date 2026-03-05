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
  console.log(`Inspect auth config: ${sandboxId}`);
  await run('cat /opt/neko/neko.yml || true');
  await run('grep -n \"session\" /tmp/neko-src/server/dev/runtime/config.yml | head -n 80 || true');
  await run('sed -n \"1,220p\" /tmp/neko-src/server/internal/session/auth.go || true');
  await run('sed -n \"1,200p\" /tmp/neko-src/server/internal/config/session.go || true');
  await run('grep -RIn \"token not found\" /tmp/neko-src/server | head -n 20 || true');
  await run('sed -n \"150,240p\" /tmp/neko-src/server/internal/http/legacy/session.go || true');
  await run(`curl -s -X POST http://127.0.0.1:8080/api/login -H 'Content-Type: application/json' -d '{"username":"oneceo","password":"oneceo"}' || true`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
