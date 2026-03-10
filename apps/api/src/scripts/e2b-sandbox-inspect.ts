import '../config/env';
import { e2bConnector } from '../connectors/e2b-connector';

async function main() {
  const sandboxId = process.argv[2] || process.env.E2B_SANDBOX_ID;
  if (!sandboxId) {
    console.error('missing sandbox id');
    process.exit(1);
  }
  const commands = [
    'echo "[inspect] uname"',
    'uname -a',
    'echo "[inspect] opencode server log"',
    'tail -n 120 /tmp/opencode-server.log || true',
    'echo "[inspect] opencode runtime log"',
    'latest_log=$(ls -1t /home/user/.local/share/opencode/log/*.log 2>/dev/null | head -1)',
    'if [ -n "$latest_log" ]; then echo "latest_log=$latest_log"; tail -n 200 "$latest_log"; else echo "no opencode log"; fi',
    'echo "[inspect] opencode prompt logs"',
    'ls -la /tmp/opencode-prompt-* 2>/dev/null || true',
    'for f in /tmp/opencode-prompt-*.log; do echo \"--- $f\"; tail -n 120 \"$f\"; done 2>/dev/null || true',
    'echo "[inspect] verify log"',
    'tail -n 120 /tmp/oneceo_sandbox_verify.log || true',
    'echo "[inspect] workspaces"',
    'ls -la /home/user/opencode/workspaces || true',
  ].join(' && ');
  const result: any = await e2bConnector.runCommand(sandboxId, commands, { timeoutMs: 30000 });
  const output = String(result?.stdout || result?.output || '');
  console.log(output);
}

main().catch((error) => {
  console.error('[inspect] failed:', error);
  process.exit(1);
});
