import { Template } from 'e2b';

const playwrightPath = '/opt/ms-playwright';
const globalNodeModules = '/usr/local/lib/node_modules';

function readTemplateVersion(envName: string, defaultValue: string) {
  const value = (process.env[envName] || defaultValue).trim();
  if (!/^[0-9A-Za-z._+-]+$/.test(value)) {
    throw new Error(`${envName} contains unsupported characters: ${value}`);
  }
  return value;
}

const playwrightMcpWrapperInstall = `node <<'NODE'
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const root = childProcess.execSync('npm root -g', { encoding: 'utf8' }).trim();
const packageDir = path.join(root, '@playwright', 'mcp');
const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
const bin = packageJson.bin;
const relativeBin = typeof bin === 'string'
  ? bin
  : bin && typeof bin === 'object'
    ? bin['playwright-mcp'] || Object.values(bin)[0]
    : '';
if (!relativeBin) {
  throw new Error('@playwright/mcp package.json does not expose a bin entry');
}
const binPath = path.resolve(packageDir, relativeBin);
if (!fs.existsSync(binPath)) {
  throw new Error('@playwright/mcp bin entry is missing: ' + binPath);
}
fs.writeFileSync('/usr/local/bin/playwright-mcp', [
  '#!/usr/bin/env bash',
  'export NODE_PATH="\${NODE_PATH:-/usr/local/lib/node_modules}"',
  'exec node ' + JSON.stringify(binPath) + ' "$@"',
  '',
].join('\\n'), { mode: 0o755 });
NODE`;

export function buildTemplate() {
  const playwrightVersion = readTemplateVersion('ONECEO_TEMPLATE_PLAYWRIGHT_VERSION', '1.60.0');
  const playwrightMcpVersion = readTemplateVersion('ONECEO_TEMPLATE_PLAYWRIGHT_MCP_VERSION', '0.0.75');
  const browserUseVersion = readTemplateVersion('ONECEO_TEMPLATE_BROWSER_USE_VERSION', '0.12.8');

  return Template()
    .fromTemplate('codex')
    .setUser('root')
    .aptInstall([
      'curl',
      'wget',
      'unzip',
      'ca-certificates',
      'git',
      'nodejs',
      'npm',
      'python3',
      'python3-pip',
      'python3-venv',
      'xvfb',
    ])
    .runCmd([
      'python3 -m venv /opt/browser-use',
      '/opt/browser-use/bin/pip install --upgrade pip',
      `/opt/browser-use/bin/pip install browser-use==${browserUseVersion}`,
      'ln -sf /opt/browser-use/bin/browser-use /usr/local/bin/browser-use',
      `mkdir -p ${playwrightPath}`,
      `npm install -g playwright@${playwrightVersion} @playwright/mcp@${playwrightMcpVersion}`,
      playwrightMcpWrapperInstall,
      `PLAYWRIGHT_BROWSERS_PATH=${playwrightPath} playwright install --with-deps chromium`,
      `chmod -R 755 ${playwrightPath}`,
      'chown -R 1000:1000 /opt/browser-use',
      `mkdir -p /home/user/.codex`,
      'chown -R 1000:1000 /home/user/.codex',
      `chown -R 1000:1000 ${playwrightPath}`,
    ])
    .setUser('user')
    .setEnvs({
      PLAYWRIGHT_BROWSERS_PATH: playwrightPath,
      PLAYWRIGHT_HEADLESS: 'false',
      ONECEO_PLAYWRIGHT_CDP_URL: 'http://127.0.0.1:9222',
      ONECEO_NPM_GLOBAL_ROOT: globalNodeModules,
      NODE_PATH: globalNodeModules,
      ONECEO_PLAYWRIGHT_MCP_COMMAND: 'playwright-mcp',
      ONECEO_BROWSER_USE_COMMAND: 'browser-use',
      ONECEO_BROWSER_USE_VENV: '/opt/browser-use',
      ONECEO_TEMPLATE_PLAYWRIGHT_VERSION: playwrightVersion,
      ONECEO_TEMPLATE_PLAYWRIGHT_MCP_VERSION: playwrightMcpVersion,
      ONECEO_TEMPLATE_BROWSER_USE_VERSION: browserUseVersion,
    });
}

export const template = buildTemplate();
