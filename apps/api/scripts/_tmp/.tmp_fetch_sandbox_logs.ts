import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '.env');
if (existsSync(envPath)) {
  config({ path: envPath });
}
const envWindowsPath = resolve(__dirname, '.env.windows');
if (existsSync(envWindowsPath)) {
  config({ path: envWindowsPath, override: false });
}

const sandboxId = process.argv[2];
if (!sandboxId) {
  console.error('Usage: tsx .tmp_fetch_sandbox_logs.ts <sandboxId>');
  process.exit(1);
}

async function main() {
  const { e2bConnector } = await import('./src/connectors/e2b-connector');

  async function run(cmd: string) {
    try {
      const result = await e2bConnector.runCommand(sandboxId, cmd, { timeoutMs: 30000 });
      const stdout = (result?.stdout || '').trim();
      const stderr = (result?.stderr || '').trim();
      console.log(`\n$ ${cmd}`);
      if (stdout) console.log(stdout);
      if (stderr) console.log(`[stderr]\n${stderr}`);
    } catch (err) {
      console.log(`\n$ ${cmd}`);
      console.error(err);
    }
  }

  await run('date');
  await run('ps -ef | grep -E "neko|chromium|opencode|playwright" | grep -v grep');
  await run('ls -lah /tmp');
  await run('ls -lah /tmp/oneceo || true');
  await run('tail -n 200 /tmp/neko.log || true');
  await run('tail -n 200 /tmp/chromium.log || true');
  await run('tail -n 200 /tmp/opencode-server.log || true');
  await run('ls -lah /tmp/opencode-prompt-* 2>/dev/null || true');
  await run('tail -n 200 /tmp/opencode-prompt-*.log 2>/dev/null || true');
  await run('tail -n 120 /tmp/opencode-prompt-*.py 2>/dev/null || true');
  await run('ls -lah /tmp/playwright-mcp-output || true');
  await run('find /tmp/playwright-mcp-output -type f -maxdepth 2 -print');
  await run('tail -n 200 /tmp/playwright-mcp-output/* 2>/dev/null || true');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
