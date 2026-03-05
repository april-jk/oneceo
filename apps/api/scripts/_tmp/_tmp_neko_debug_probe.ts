import { e2bConnector } from '../src/connectors/e2b-connector';

async function main() {
  const sandboxId = process.argv[2];
  if (!sandboxId) throw new Error('sandboxId required');
  const cmd = "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/ || true";
  const result = await e2bConnector.runCommand(sandboxId, cmd, { timeoutMs: 20000 });
  console.log(result?.stdout || '');
  console.error(result?.stderr || '');
}

main().catch((error) => {
  console.error('[debug] failed', error);
  process.exit(1);
});
