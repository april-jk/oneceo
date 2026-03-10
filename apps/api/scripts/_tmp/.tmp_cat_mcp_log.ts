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
if (!sandboxId) process.exit(1);

const { e2bConnector } = await import('./src/connectors/e2b-connector');
const cmd = 'cat /tmp/playwright-mcp-output/1772368134698/console-2026-03-01T12-28-54-751Z.log';
const res = await e2bConnector.runCommand(sandboxId, cmd, { timeoutMs: 20000 });
console.log(res?.stdout || '');
if (res?.stderr) console.log(`[stderr]\n${res.stderr}`);
