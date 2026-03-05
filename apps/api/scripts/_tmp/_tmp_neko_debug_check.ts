import { e2bConnector } from '../src/connectors/e2b-connector';

async function main() {
  const sandboxId = process.argv[2];
  if (!sandboxId) throw new Error('sandboxId required');
  const cmd = `
set -e
echo "-- which --"
which Xvfb || true
which chromium-browser || true
which chromium || true
which neko || true
echo "\n-- neko help (input flags) --"
neko serve --help | grep -i input || true
echo "\n-- neko config --"
cat /opt/neko/neko.yml || true
echo "\n-- neko dir --"
ls -la /opt/neko || true
echo "\n-- identity --"
id -u || true
command -v sudo || true
ps aux | grep -E "(neko|Xvfb|chromium)" | grep -v grep || true
printf "\n-- neko log --\n"
if [ -f /tmp/neko.log ]; then tail -n 50 /tmp/neko.log; else echo "no neko log"; fi
printf "\n-- chromium log --\n"
if [ -f /tmp/chromium.log ]; then tail -n 50 /tmp/chromium.log; else echo "no chromium log"; fi
printf "\n-- xvfb log --\n"
if [ -f /tmp/xvfb.log ]; then tail -n 50 /tmp/xvfb.log; else echo "no xvfb log"; fi
printf "\n-- ports --\n"
ss -ltnp | grep -E "(:8080|:9222)" || true
`;
  const result = await e2bConnector.runCommand(sandboxId, cmd, { timeoutMs: 120000 });
  console.log(result?.stdout || '');
  console.error(result?.stderr || '');
}

main().catch((error) => {
  console.error('[debug] failed', error);
  process.exit(1);
});
