import { Template, defaultBuildLogger } from 'e2b';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { buildTemplate } from './template';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../apps/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../apps/api/.env') });

async function main() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (proxyUrl) {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  }

  const templateName =
    process.env.E2B_CODEX_WS_TEMPLATE ||
    process.env.E2B_TEMPLATE_CODEX_WS ||
    process.env.E2B_TEMPLATE_NAME ||
    'codex-ws-playwright-sandbox-v1';

  const template = buildTemplate();

  await Template.build(template, templateName, {
    cpuCount: 2,
    memoryMB: 4096,
    onBuildLogs: defaultBuildLogger(),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
