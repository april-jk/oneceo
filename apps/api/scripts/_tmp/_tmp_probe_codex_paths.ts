import '../../src/config/env';
import { e2bConnector } from '../../src/connectors/e2b-connector';

async function main() {
  const sandboxId = process.argv[2];
  if (!sandboxId) {
    throw new Error('sandboxId is required');
  }

  const cmd = `
set -e
printf '%s\n' '---home'
find /home/user -maxdepth 6 \\( -iname '*codex*' -o -iname '*rollout*' -o -name '*.db' -o -name '*.sqlite*' -o -path '*/.codex/*' \\) | sort | tail -n 300 || true
printf '%s\n' '---sessions-detail'
find /home/user/.codex/sessions -maxdepth 6 -type f | sort | tail -n 40 || true
latest_file="$(find /home/user/.codex/sessions -maxdepth 6 -type f | sort | tail -n 1)"
if [ -n "$latest_file" ]; then
  printf '%s\n' '---latest-rollout-head'
  head -n 20 "$latest_file" || true
fi
printf '%s\n' '---root'
find / -maxdepth 5 \\( -iname '*codex*' -o -iname '*rollout*' -o -name '*.db' -o -name '*.sqlite*' \\) 2>/dev/null | sort | tail -n 300 || true
`;

  const result: any = await e2bConnector.runCommand(sandboxId, cmd, { timeoutMs: 40_000 });
  console.log(String(result?.stdout || result?.output || '').trim());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
