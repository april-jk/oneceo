import '../src/config/env';
import { e2bConnector } from '../src/connectors/e2b-connector';

const sandboxId = process.env.SANDBOX_ID || 'izq6qwmslxdx47exe5okl';

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
  console.log(`Inspect sandbox: ${sandboxId}`);
  await run('whoami');
  await run('command -v neko || true');
  await run('ls -la /usr/local/bin/neko || true');
  await run('command -v pgrep || true');
  await run('command -v Xvfb || true');
  await run('command -v chromium-browser || true');
  await run('command -v chromium || true');
  await run('pgrep -af Xvfb || true');
  await run('pgrep -af chromium || true');
  await run('pgrep -af neko || true');
  await run('pgrep -af \"[X]vfb :0\" || true');
  await run('pgrep -af \"[c]hromium.*remote-debugging-port=9222\" || true');
  await run('pgrep -af \"[n]eko serve\" || true');
  await run('grep -RIn "username\\|user name\\|login" /tmp/neko-src/client | head -n 40 || true');
  await run('sed -n \"1,240p\" /tmp/neko-src/client/src/components/connect.vue || true');
  await run('sed -n \"1,220p\" /tmp/neko-src/client/src/neko/base.ts || true');
  await run('sed -n \"1,220p\" /tmp/neko-src/server/dev/runtime/config.yml || true');
  await run('sed -n \"1,220p\" /tmp/neko-src/server/internal/session/auth.go || true');
  await run('grep -RIn "noauth" /tmp/neko-src/server | head -n 40 || true');
  await run('grep -RIn "member" /tmp/neko-src/server | head -n 40 || true');
  await run('grep -RIn "token not found" /tmp/neko-src/server | head -n 20 || true');
  await run('grep -RIn "cookie" /tmp/neko-src/server | head -n 40 || true');
  await run('ps aux | egrep "neko|Xvfb|chromium" | grep -v grep || true');
  await run('ss -ltnp | grep :8080 || true');
  await run('ss -ltnp | grep :9222 || true');
  await run('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/ || true');
  await run('ls -la /opt/neko || true');
  await run('ls -la /tmp/neko-src/client/dist | head -n 5 || true');
  await run('tail -n 200 /tmp/neko.log || true');
  await run('tail -n 200 /tmp/chromium.log || true');
  await run('tail -n 200 /tmp/xvfb.log || true');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
