import { Template } from 'e2b';

const playwrightPath = '/opt/ms-playwright';

export function buildTemplate() {
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
      'xvfb',
    ])
    .runCmd([
      `mkdir -p ${playwrightPath}`,
      'npm install -g playwright @playwright/mcp@latest',
      `PLAYWRIGHT_BROWSERS_PATH=${playwrightPath} playwright install --with-deps chromium`,
      `chmod -R 755 ${playwrightPath}`,
      `mkdir -p /home/user/.codex`,
      'chown -R 1000:1000 /home/user/.codex',
      `chown -R 1000:1000 ${playwrightPath}`,
    ])
    .setUser('user')
    .setEnvs({
      PLAYWRIGHT_BROWSERS_PATH: playwrightPath,
    });
}

export const template = buildTemplate();
