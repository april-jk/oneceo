import { Template } from 'e2b';

const playwrightPath = '/opt/ms-playwright';
const opencodeBaseDir = '/opt/.altus/opencode';
const sandboxUser = 'user:user';

export function buildTemplate(input?: {
  patchUrl?: string;
  osacDownloadUrl?: string;
  osacSha256?: string;
  osacVersion?: string;
}) {
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
          `printf '%s  %s\n' '${input.osacSha256}' '${opencodeBaseDir}/osac' | sha256sum -c -`,
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
      'nodejs',
      'npm',
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
      'curl -fsSL -o /tmp/go.tgz https://go.dev/dl/go1.24.5.linux-amd64.tar.gz',
      'rm -rf /usr/local/go && tar -C /usr/local -xzf /tmp/go.tgz',
      'mkdir -p /tmp/neko-build',
      'GOBIN=/tmp/neko-build GO111MODULE=on /usr/local/go/bin/go install github.com/m1k1o/neko/server/cmd/neko@latest',
      'mv /tmp/neko-build/neko /usr/local/bin/neko',
      'rm -rf /opt/neko-src',
      'git clone --depth 1 https://github.com/m1k1o/neko.git /opt/neko-src',
      ...patchSteps,
      'cd /opt/neko-src/client && npm install && npm run build',
      'rm -rf /opt/neko && mkdir -p /opt/neko/client/dist',
      'cp -R /opt/neko-src/client/dist/* /opt/neko/client/dist/',
      'chmod -R 755 /opt/neko',
      ...osacSteps,
      'python3 -m venv /opt/browser-use',
      '/opt/browser-use/bin/pip install --upgrade pip',
      '/opt/browser-use/bin/pip install browser-use',
      'ln -sf /opt/browser-use/bin/browser-use /usr/local/bin/browser-use',
      `chown -R ${sandboxUser} /opt/browser-use`,
      `mkdir -p ${playwrightPath}`,
      'npm install -g playwright @playwright/mcp@latest',
      `PLAYWRIGHT_BROWSERS_PATH=${playwrightPath} playwright install --with-deps chromium`,
      `chmod -R 755 ${playwrightPath}`,
      `chown -R ${sandboxUser} ${playwrightPath}`,
    ])
    .setUser('user')
    .setEnvs({
      PLAYWRIGHT_BROWSERS_PATH: playwrightPath,
      OSAC_TEMPLATE_PREBUILT_VERSION: input?.osacVersion || '',
    });
}

export const template = buildTemplate();
