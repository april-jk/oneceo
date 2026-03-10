import { e2bConnector } from '../src/connectors/e2b-connector';

async function main() {
  const sandboxId = process.argv[2];
  if (!sandboxId) throw new Error('sandboxId required');
  const cmd = `
set -e
nohup Xvfb :0 -screen 0 1280x720x24 -nolisten tcp > /tmp/xvfb.log 2>&1 &
export DISPLAY=:0
sleep 0.5
if command -v chromium-browser >/dev/null 2>&1; then
  CHROME_BIN=$(command -v chromium-browser)
else
  CHROME_BIN=$(command -v chromium)
fi
nohup "$CHROME_BIN" --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=9222 --user-data-dir=/tmp/chromium-profile --window-size=1280,720 about:blank > /tmp/chromium.log 2>&1 &
nohup neko serve --config /opt/neko/neko.yml > /tmp/neko.log 2>&1 &
sleep 1
ps aux | grep -E "(neko|Xvfb|chromium)" | grep -v grep || true
ss -ltnp | grep -E ":8080|:9222" || true
`;
  const result = await e2bConnector.runCommand(sandboxId, cmd, { timeoutMs: 60000 });
  console.log(result?.stdout || '');
  console.error(result?.stderr || '');
}

main().catch((error) => {
  console.error('[debug] failed', error);
  process.exit(1);
});
