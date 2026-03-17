import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

async function main() {
  const sid = String(process.argv[2] || '').trim();
  if (!sid) {
    throw new Error('Usage: pnpm exec tsx -r dotenv/config scripts/_tmp/_tmp_probe_sandbox_env.ts <sessionId>');
  }

  const { e2bConnector } = await import('../../src/connectors/e2b-connector');
  const result = await e2bConnector.runCommand(
    sid,
    [
      'set -e',
      'for key in OPENAI_API_KEY OPENAI_BASE_URL OPENAI_API_BASE CODEX_API_KEY; do',
      '  val=$(printenv "$key" || true)',
      '  if [ -n "$val" ]; then',
      '    echo "$key=set"',
      '    case "$key" in',
      '      OPENAI_BASE_URL|OPENAI_API_BASE) echo "$val" ;;',
      '    esac',
      '  else',
      '    echo "$key=missing"',
      '  fi',
      'done',
    ].join('\n'),
    { timeoutMs: 20_000 }
  );
  console.log(String((result as any)?.stdout || ''));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
