import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '.env');
if (existsSync(envPath)) config({ path: envPath });
const envWindowsPath = resolve(__dirname, '.env.windows');
if (existsSync(envWindowsPath)) config({ path: envWindowsPath, override: false });

const sandboxId = process.argv[2];
if (!sandboxId) {
  console.error('Usage: tsx .tmp_fetch_sandbox_logs.ts <sandboxId>');
  process.exit(1);
}

async function main() {
  const { e2bConnector } = await import('./src/connectors/e2b-connector');
  const cmds = [
    'echo $PATH',
    'which playwright-mcp || true',
    'which npx || true',
    'which node || true',
    'npm -g bin || true',
    'ls -lah /usr/local/bin | head -n 50',
  ];
  for (const cmd of cmds) {
    const result = await e2bConnector.runCommand(sandboxId, cmd, { timeoutMs: 20000 });
    console.log(`\n$ ${cmd}`);
    if (result?.stdout) console.log(result.stdout.trim());
    if (result?.stderr) console.log(`[stderr]\n${result.stderr.trim()}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
