import { Template } from 'e2b';

const playwrightPath = '/opt/ms-playwright';
const globalNodeModules = '/usr/local/lib/node_modules';
const opencodeBaseDir = '/opt/.altus/opencode';
const sandboxUser = 'user:user';
const nodeVersion = '20.19.5';
const pnpmVersion = '9.12.3';

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

export function buildTemplate(input?: {
  patchUrl?: string;
  osacDownloadUrl?: string;
  osacSha256?: string;
  osacVersion?: string;
}) {
  const nekoVersion = readTemplateVersion('ONECEO_TEMPLATE_NEKO_VERSION', 'v3.1.4');
  const playwrightVersion = readTemplateVersion('ONECEO_TEMPLATE_PLAYWRIGHT_VERSION', '1.60.0');
  const playwrightMcpVersion = readTemplateVersion('ONECEO_TEMPLATE_PLAYWRIGHT_MCP_VERSION', '0.0.75');
  const browserUseVersion = readTemplateVersion('ONECEO_TEMPLATE_BROWSER_USE_VERSION', '0.12.8');
  const patchSteps = input?.patchUrl
    ? [
        `curl -fsSL -o /tmp/neko-ui.patch "${input.patchUrl}"`,
        'cd /opt/neko-src && git apply --ignore-space-change --ignore-whitespace /tmp/neko-ui.patch',
      ]
    : [];
  const osacSteps =
    input?.osacDownloadUrl && input?.osacSha256
      ? [
          `mkdir -p ${opencodeBaseDir} ${opencodeBaseDir}/log ${opencodeBaseDir}/tmp ${opencodeBaseDir}/workspaces ${opencodeBaseDir}/state`,
          `curl -fsSL -o ${opencodeBaseDir}/osac "${input.osacDownloadUrl}"`,
          `printf '%s  %s\\n' '${input.osacSha256}' '${opencodeBaseDir}/osac' | sha256sum -c -`,
          `chmod +x ${opencodeBaseDir}/osac`,
          `chown -R ${sandboxUser} ${opencodeBaseDir}`,
        ]
      : [];

  return Template()
    .fromTemplate('opencode')
    .setUser('root')
    .aptInstall([
      'xvfb',
      'curl',
      'wget',
      'unzip',
      'ca-certificates',
      'gnupg',
      'git',
      'make',
      'pkg-config',
      'build-essential',
      'python3',
      'python3-pip',
      'python3-venv',
      'gstreamer1.0-plugins-base',
      'gstreamer1.0-plugins-good',
      'gstreamer1.0-plugins-bad',
      'gstreamer1.0-plugins-ugly',
      'gstreamer1.0-libav',
      'libgstreamer1.0-dev',
      'libgstreamer-plugins-base1.0-dev',
      'libgtk-3-dev',
      'libx11-dev',
      'libxext-dev',
      'libxi-dev',
      'libxfixes-dev',
      'libxrandr-dev',
      'libxrender-dev',
      'libxkbfile-dev',
      'libxtst-dev',
      'libxcomposite-dev',
      'libxdamage-dev',
      'libxinerama-dev',
      'libxcvt-dev',
    ])
    .runCmd([
      // Pin node runtime at template build time so deploy preflight never drifts with base apt packages.
      `curl -fsSL -o /tmp/node-v${nodeVersion}-linux-x64.tar.xz https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-linux-x64.tar.xz`,
      'rm -rf /usr/local/lib/nodejs',
      'mkdir -p /usr/local/lib/nodejs',
      `tar -xJf /tmp/node-v${nodeVersion}-linux-x64.tar.xz -C /usr/local/lib/nodejs`,
      `ln -sf /usr/local/lib/nodejs/node-v${nodeVersion}-linux-x64/bin/node /usr/local/bin/node`,
      `ln -sf /usr/local/lib/nodejs/node-v${nodeVersion}-linux-x64/bin/npm /usr/local/bin/npm`,
      `ln -sf /usr/local/lib/nodejs/node-v${nodeVersion}-linux-x64/bin/npx /usr/local/bin/npx`,
      `npm install -g pnpm@${pnpmVersion}`,
      `ln -sf /usr/local/lib/nodejs/node-v${nodeVersion}-linux-x64/bin/pnpm /usr/local/bin/pnpm`,
      'node --version',
      'npm --version',
      'pnpm --version',
      'curl -fsSL -o /tmp/go.tgz https://go.dev/dl/go1.24.5.linux-amd64.tar.gz',
      'rm -rf /usr/local/go && tar -C /usr/local -xzf /tmp/go.tgz',
      'mkdir -p /tmp/neko-build',
      `GOBIN=/tmp/neko-build GO111MODULE=on /usr/local/go/bin/go install github.com/m1k1o/neko/server/cmd/neko@${nekoVersion}`,
      'mv /tmp/neko-build/neko /usr/local/bin/neko',
      'rm -rf /opt/neko-src',
      `git clone --depth 1 --branch ${nekoVersion} https://github.com/m1k1o/neko.git /opt/neko-src`,
      ...patchSteps,
      'cd /opt/neko-src/client && npm install && npm run build',
      'rm -rf /opt/neko && mkdir -p /opt/neko/client/dist',
      'cp -R /opt/neko-src/client/dist/* /opt/neko/client/dist/',
      'chmod -R 755 /opt/neko',
      ...osacSteps,
      'python3 -m venv /opt/browser-use',
      '/opt/browser-use/bin/pip install --upgrade pip',
      `/opt/browser-use/bin/pip install browser-use==${browserUseVersion}`,
      'ln -sf /opt/browser-use/bin/browser-use /usr/local/bin/browser-use',
      `chown -R ${sandboxUser} /opt/browser-use`,
      `mkdir -p ${playwrightPath}`,
      `npm install -g playwright@${playwrightVersion} @playwright/mcp@${playwrightMcpVersion}`,
      playwrightMcpWrapperInstall,
      `PLAYWRIGHT_BROWSERS_PATH=${playwrightPath} npx playwright install --with-deps chromium`,
      `chmod -R 755 ${playwrightPath}`,
      `chown -R ${sandboxUser} ${playwrightPath}`,
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
      ONECEO_NEKO_BINARY: '/usr/local/bin/neko',
      ONECEO_NEKO_STATIC_ROOT: '/opt/neko/client/dist',
      OSAC_TEMPLATE_PREBUILT_VERSION: input?.osacVersion || '',
      ONECEO_TEMPLATE_PROFILE: 'deploy_stable',
      ONECEO_TEMPLATE_NODE_VERSION: nodeVersion,
      ONECEO_TEMPLATE_PNPM_VERSION: pnpmVersion,
      ONECEO_TEMPLATE_NEKO_VERSION: nekoVersion,
      ONECEO_TEMPLATE_PLAYWRIGHT_VERSION: playwrightVersion,
      ONECEO_TEMPLATE_PLAYWRIGHT_MCP_VERSION: playwrightMcpVersion,
      ONECEO_TEMPLATE_BROWSER_USE_VERSION: browserUseVersion,
    });
}

export const template = buildTemplate();
