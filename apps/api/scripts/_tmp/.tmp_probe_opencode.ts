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
const opencodeSessionId = process.argv[3];
if (!sandboxId || !opencodeSessionId) {
  console.error('Usage: tsx .tmp_probe_opencode.ts <sandboxId> <opencodeSessionId>');
  process.exit(1);
}

const { e2bConnector } = await import('./src/connectors/e2b-connector');
const cmds = [
  `curl -s -m 10 http://127.0.0.1:4096/session/${opencodeSessionId}`,
  `curl -s -m 10 http://127.0.0.1:4096/session/${opencodeSessionId}/diff`,
  `curl -s -m 10 http://127.0.0.1:4096/session/${opencodeSessionId}/message`,
];
for (const cmd of cmds) {
  const result = await e2bConnector.runCommand(sandboxId, cmd, { timeoutMs: 20000 });
  console.log(`\n$ ${cmd}`);
  if (result?.stdout) console.log(result.stdout.trim());
  if (result?.stderr) console.log(`[stderr]\n${result.stderr.trim()}`);
}
