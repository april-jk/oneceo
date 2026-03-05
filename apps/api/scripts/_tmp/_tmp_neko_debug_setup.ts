import { sandboxAgentProvisionService } from '../src/services/sandbox-agent-provision-service';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { sandboxExecutionEnvironmentDAO } from '../src/db/dao';
import { e2bConnector } from '../src/connectors/e2b-connector';
import { ensureDatabaseConnection } from '../src/config/database';

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

async function main() {
  await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });

  const title = process.argv[2] || 'neko-debug-session';
  const session = await taskCreationFileMemoryStore.createSession(title);

  const provision = await sandboxAgentProvisionService.provisionWithLock({
    metadata: {
      taskSessionId: session.id,
      taskTitle: session.title,
    },
  });

  const sandboxId = provision.sessionId;
  await taskCreationFileMemoryStore.updateRuntimeBinding(session.id, {
    orchestratorSessionId: sandboxId,
    opencodeSessionId: '',
  });
  console.log('[debug] sandboxId=', sandboxId);
  const nekoPort = toNumber(process.env.NEKO_PORT, 8080);
  const cdpPort = toNumber(process.env.NEKO_CDP_PORT, 9222);
  const display = process.env.NEKO_DISPLAY || ':0';

  const setupCommand = `
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

APT="apt-get"
ROOTCMD=""
if [[ "$(id -u)" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    APT="sudo -n apt-get"
    ROOTCMD="sudo -n"
  fi
fi

wait_apt() {
  local max=30
  local count=0
  while pgrep -x apt-get >/dev/null 2>&1 || pgrep -x dpkg >/dev/null 2>&1; do
    count=$((count + 1))
    if [[ $count -ge $max ]]; then
      break
    fi
    sleep 2
  done
}

if ! command -v Xvfb >/dev/null 2>&1; then
  wait_apt
  $APT update
  wait_apt
  $APT install -y xvfb curl wget unzip ca-certificates gnupg gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav
fi

if ! command -v chromium-browser >/dev/null 2>&1 && ! command -v chromium >/dev/null 2>&1; then
  wait_apt
  $APT install -y chromium-browser || true
  if ! command -v chromium-browser >/dev/null 2>&1 && ! command -v chromium >/dev/null 2>&1; then
    $APT install -y chromium || true
  fi
fi

if ! command -v neko >/dev/null 2>&1; then
  wait_apt
  $APT install -y git make pkg-config \
    libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
    libgtk-3-dev libx11-dev libxext-dev libxi-dev libxfixes-dev libxrandr-dev \
    libxrender-dev libxkbfile-dev libxtst-dev libxcomposite-dev libxdamage-dev \
    libxinerama-dev libxcvt-dev
  GO_BIN=/usr/local/go/bin/go
  if [[ ! -x "$GO_BIN" ]]; then
    curl -fsSL -o /tmp/go.tgz https://go.dev/dl/go1.24.5.linux-amd64.tar.gz
    $ROOTCMD rm -rf /usr/local/go
    $ROOTCMD tar -C /usr/local -xzf /tmp/go.tgz
  fi
  GO_BIN=/usr/local/go/bin/go
  mkdir -p /tmp/neko-build
  GOBIN=/tmp/neko-build GO111MODULE=on "$GO_BIN" install github.com/m1k1o/neko/server/cmd/neko@latest
  if [[ -f /tmp/neko-build/neko ]]; then
    $ROOTCMD mv /tmp/neko-build/neko /usr/local/bin/neko
  fi
fi

if [ ! -d /tmp/neko-src ]; then
  wait_apt
  $APT install -y git
  git clone --depth 1 https://github.com/m1k1o/neko.git /tmp/neko-src
fi

if [ ! -d /tmp/neko-src/client/dist ]; then
  wait_apt
  if ! command -v npm >/dev/null 2>&1; then
    $APT install -y nodejs npm
  fi
  cd /tmp/neko-src/client
  npm install
  npm run build
  cd /
fi

$ROOTCMD mkdir -p /opt/neko
cat <<EOF | $ROOTCMD tee /opt/neko/neko.yml >/dev/null
server:
  bind: "0.0.0.0:${nekoPort}"
  static: "/tmp/neko-src/client/dist"
capture:
  display: "${display}"
  video_codec: "h264"
  video_bitrate: 3000
webrtc:
  ice_servers:
    - urls: ["stun:stun.l.google.com:19302"]
  epr: 51000-51100
desktop:
  input:
    enabled: false
member:
  provider: "noauth"
EOF

if ! pgrep -f "Xvfb ${display}" >/dev/null 2>&1; then
  nohup Xvfb ${display} -screen 0 1280x720x24 -nolisten tcp > /tmp/xvfb.log 2>&1 &
fi

export DISPLAY=${display}
for i in $(seq 1 10); do
  if [ -S /tmp/.X11-unix/X0 ]; then
    break
  fi
  sleep 0.5
done

if ! pgrep -f "chromium.*remote-debugging-port=${cdpPort}" >/dev/null 2>&1; then
  if command -v chromium-browser >/dev/null 2>&1; then
    CHROME_BIN=$(command -v chromium-browser)
  else
    CHROME_BIN=$(command -v chromium)
  fi
  nohup "$CHROME_BIN" \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --remote-debugging-port=${cdpPort} \
    --user-data-dir=/tmp/chromium-profile \
    --window-size=1280,720 \
    about:blank \
    > /tmp/chromium.log 2>&1 &
fi

if ! pgrep -f "neko serve" >/dev/null 2>&1; then
  nohup neko serve --config /opt/neko/neko.yml > /tmp/neko.log 2>&1 &
fi
`;

  const setupResult = await e2bConnector.runCommand(sandboxId, setupCommand, { timeoutMs: 12 * 60 * 1000 });
  if (typeof (setupResult as any)?.exitCode === 'number') {
    console.log('[debug] setup exitCode=', (setupResult as any).exitCode);
  }
  if (setupResult?.stderr) {
    console.error('[debug] setup stderr:', setupResult.stderr);
  }
  if (setupResult?.stdout) {
    console.log('[debug] setup stdout tail:', setupResult.stdout.slice(-4000));
  }

  const host = await e2bConnector.getSandboxHost(sandboxId, nekoPort);
  const baseUrl = `https://${host}`;

  const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(sandboxId);
  const metadata = (environment?.metadata || {}) as Record<string, unknown>;
  const nextMetadata = {
    ...metadata,
    debug: {
      ...(metadata as any)?.debug,
      neko: {
        baseUrl,
        port: nekoPort,
        display,
        cdpPort,
        status: 'running',
        updatedAt: new Date().toISOString(),
      },
    },
  };
  await sandboxExecutionEnvironmentDAO.updateMetadata(sandboxId, nextMetadata);

  console.log('[debug] taskSessionId=', session.id);
  console.log('[debug] sandboxId=', sandboxId);
  console.log('[debug] nekoUrl=', baseUrl);
}

main().catch((error) => {
  console.error('[debug] failed', error);
  process.exit(1);
});
