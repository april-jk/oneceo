import '../../src/config/env';
import { e2bConnector } from '../../src/connectors/e2b-connector';

async function main() {
  const sandboxId = 'ibzt2209vixy2b55comrh';
  const probeCommand = `
set -euo pipefail
archive_codex='/home/user/opencode/state/2d591395-c923-44f2-bb69-876726bc9405/codex-home/.codex'
runtime_codex='/home/user/.codex'

if [ ! -e "$archive_codex" ]; then
  exit 0
fi
if [ -L "$runtime_codex" ]; then
  current_target="$(readlink "$runtime_codex" || true)"
  if [ "$current_target" = "$archive_codex" ]; then
    printf 'READY:%s' "$current_target"
    exit 0
  fi
fi
exit 0
`;
  try {
    const result: any = await e2bConnector.runCommand(sandboxId, probeCommand, { timeoutMs: 10000 });
    console.log(JSON.stringify({ ok: true, stdout: result?.stdout || result?.output || '', stderr: result?.stderr || '' }, null, 2));
  } catch (error: any) {
    console.log(JSON.stringify({ ok: false, message: error?.message, result: error?.result || null }, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
