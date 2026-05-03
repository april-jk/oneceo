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
      'python3-venv',
      'xvfb',
    ])
    .runCmd([
      'python3 -m venv /opt/browser-use',
      '/opt/browser-use/bin/pip install --upgrade pip',
      '/opt/browser-use/bin/pip install browser-use',
      'ln -sf /opt/browser-use/bin/browser-use /usr/local/bin/browser-use',
      `mkdir -p ${playwrightPath}`,
      'npm install -g playwright @playwright/mcp@latest',
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
    });
}

export const template = buildTemplate();
