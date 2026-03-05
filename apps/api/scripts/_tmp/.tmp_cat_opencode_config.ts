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
const res = await e2bConnector.runCommand(sandboxId, 'cat /home/user/.config/opencode/opencode.json', { timeoutMs: 20000 });
console.log(res?.stdout || '');
