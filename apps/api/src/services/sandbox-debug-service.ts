import { lookup as dnsLookup } from 'node:dns/promises';
import { e2bConnector } from '../connectors/e2b-connector';
import { sandboxExecutionEnvironmentDAO } from '../db/dao';

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function resolveHostIp(host: string): Promise<string | null> {
  if (!host) return null;
  try {
    const resolved = await dnsLookup(host, { family: 4 });
    return resolved.address;
  } catch {
    return null;
  }
}

async function probeNeko(sandboxId: string, port: number): Promise<boolean> {
  try {
    const probe = await e2bConnector.runCommand(
      sandboxId,
      `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${port}/ || true`,
      { timeoutMs: 20000 }
    );
    return (probe?.stdout || '').trim().startsWith('200');
  } catch {
    return false;
  }
}

async function waitForNeko(sandboxId: string, port: number, attempts = 8, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const ready = await probeNeko(sandboxId, port);
    if (ready) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

type EnsureDebugResult = {
  ready: boolean;
  url: string;
  status: string;
  updatedAt: string;
  sandboxId: string;
  port: number;
  display: string;
  cdpPort: number;
  message?: string;
};

export async function ensureNekoDebug(orchestratorSessionId: string): Promise<EnsureDebugResult> {
  const configVersion = 'neko-udpmux-v2';
  const nekoPort = toPositiveInt(process.env.NEKO_PORT, 8081);
  const cdpPort = toPositiveInt(process.env.NEKO_CDP_PORT, 9222);
  const display = process.env.NEKO_DISPLAY || ':0';
  const tcpMuxPort = toPositiveInt(process.env.NEKO_WEBRTC_TCPMUX, 0);
  const udpMuxPort = toPositiveInt(process.env.NEKO_WEBRTC_UDPMUX, 59000);
  const webrtcEpr = asText(process.env.NEKO_WEBRTC_EPR);

  const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
  if (!environment) {
    throw new Error('sandbox environment not found');
  }

  const hostForNat = await e2bConnector.getSandboxHost(orchestratorSessionId, nekoPort);
  const nat1To1 = await resolveHostIp(hostForNat);
  const nat1To1Yaml = nat1To1 ? `  nat1to1:\n    - \"${nat1To1}\"\n` : '';

  const metadata = toRecord(environment.metadata);
  const debugMeta = toRecord(metadata.debug);
  const nekoMeta = toRecord(debugMeta.neko);
  const existingUrl = asText(nekoMeta.baseUrl) || asText(nekoMeta.url);
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
  iceservers:
    - urls: ["stun:stun.l.google.com:19302"]
  tcpmux: ${tcpMuxPort}
  udpmux: ${udpMuxPort}
  epr: "${webrtcEpr}"
${nat1To1Yaml}desktop:
  input:
    enabled: false
member:
  provider: "noauth"
session:
  cookie:
    enabled: false
    secure: false
EOF

if ! pgrep -x Xvfb >/dev/null 2>&1; then
  nohup Xvfb ${display} -screen 0 1280x720x24 -nolisten tcp > /tmp/xvfb.log 2>&1 &
fi

export DISPLAY=${display}
for i in $(seq 1 10); do
  if [ -S /tmp/.X11-unix/X0 ]; then
    break
  fi
  sleep 0.5
done

if ! pgrep -x chromium >/dev/null 2>&1 && ! pgrep -x chromium-browser >/dev/null 2>&1; then
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

if pgrep -x neko >/dev/null 2>&1; then
  pkill -x neko || true
  sleep 1
fi
nohup neko serve --config /opt/neko/neko.yml > /tmp/neko.log 2>&1 &
`;

  const startCommand = `
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

ROOTCMD=""
if [[ "$(id -u)" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    ROOTCMD="sudo -n"
  fi
fi

if ! command -v neko >/dev/null 2>&1; then
  echo "NEKO_MISSING"
  exit 0
fi

if [ ! -d /tmp/neko-src/client/dist ]; then
  echo "NEKO_CLIENT_MISSING"
  exit 0
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
  iceservers:
    - urls: ["stun:stun.l.google.com:19302"]
  tcpmux: ${tcpMuxPort}
  udpmux: ${udpMuxPort}
  epr: "${webrtcEpr}"
${nat1To1Yaml}desktop:
  input:
    enabled: false
member:
  provider: "noauth"
session:
  cookie:
    enabled: false
    secure: false
EOF

if ! pgrep -x Xvfb >/dev/null 2>&1; then
  nohup Xvfb ${display} -screen 0 1280x720x24 -nolisten tcp > /tmp/xvfb.log 2>&1 &
fi

export DISPLAY=${display}
for i in $(seq 1 10); do
  if [ -S /tmp/.X11-unix/X0 ]; then
    break
  fi
  sleep 0.5
done

if ! pgrep -x chromium >/dev/null 2>&1 && ! pgrep -x chromium-browser >/dev/null 2>&1; then
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

if pgrep -x neko >/dev/null 2>&1; then
  pkill -x neko || true
  sleep 1
fi
nohup neko serve --config /opt/neko/neko.yml > /tmp/neko.log 2>&1 &
`;

  if (existingUrl) {
    const existingStatus = asText(nekoMeta.status) || environment.status;
    const existingVersion = asText(nekoMeta.configVersion);
    const existingPort = Number(nekoMeta.port);
    const existingUdpMux = Number(nekoMeta.udpMuxPort);
    const existingNat = asText(nekoMeta.nat1To1);
    const shouldRefresh =
      existingVersion !== configVersion ||
      existingPort !== nekoPort ||
      existingUdpMux !== udpMuxPort ||
      existingNat !== (nat1To1 || '');
    let ready = await probeNeko(orchestratorSessionId, nekoPort);
    if (!ready || shouldRefresh) {
      const check = await e2bConnector.runCommand(
        orchestratorSessionId,
        `command -v neko >/dev/null 2>&1 && test -d /tmp/neko-src/client/dist && echo "OK" || echo "MISSING"`,
        { timeoutMs: 20000 }
      );
      const installed = (check?.stdout || '').trim() === 'OK';
      if (installed) {
        await e2bConnector.runCommand(orchestratorSessionId, startCommand, { timeoutMs: 2 * 60 * 1000 });
      } else {
        await e2bConnector.runCommand(orchestratorSessionId, setupCommand, { timeoutMs: 15 * 60 * 1000 });
      }
      ready = await waitForNeko(orchestratorSessionId, nekoPort);
    }

    const nextStatus = ready ? 'running' : existingStatus || 'starting';
    const nextMessage = ready ? undefined : asText(nekoMeta.message) || '调试服务启动中，请稍后重试';
    const baseUrl = `https://${await e2bConnector.getSandboxHost(orchestratorSessionId, nekoPort)}`;
    const nextMetadata = {
      ...metadata,
      debug: {
        ...(metadata as any)?.debug,
        neko: {
          ...nekoMeta,
          baseUrl,
          port: nekoPort,
          display,
          cdpPort,
          tcpMuxPort,
          udpMuxPort,
          nat1To1: nat1To1 || '',
          configVersion,
          status: nextStatus,
          message: nextMessage,
          updatedAt: new Date().toISOString(),
        },
      },
    };
    await sandboxExecutionEnvironmentDAO.updateMetadata(orchestratorSessionId, nextMetadata);

    return {
      ready,
      url: baseUrl,
      status: nextStatus,
      updatedAt: new Date(environment.updatedAt as any).toISOString(),
      sandboxId: orchestratorSessionId,
      port: nekoPort,
      display,
      cdpPort,
      message: nextMessage,
    };
  }

  await e2bConnector.runCommand(orchestratorSessionId, setupCommand, { timeoutMs: 15 * 60 * 1000 });

  const ready = await waitForNeko(orchestratorSessionId, nekoPort);

  const host = await e2bConnector.getSandboxHost(orchestratorSessionId, nekoPort);
  const baseUrl = `https://${host}`;
  const status = ready ? 'running' : 'starting';
  const message = ready ? undefined : '调试服务启动中，请稍后重试';

  const nextMetadata = {
    ...metadata,
    debug: {
      ...(metadata as any)?.debug,
      neko: {
        baseUrl,
        port: nekoPort,
        display,
        cdpPort,
        tcpMuxPort,
        udpMuxPort,
        nat1To1: nat1To1 || '',
        configVersion,
        status,
        message,
        updatedAt: new Date().toISOString(),
      },
    },
  };

  await sandboxExecutionEnvironmentDAO.updateMetadata(orchestratorSessionId, nextMetadata);

  return {
    ready,
    url: baseUrl,
    status,
    updatedAt: new Date().toISOString(),
    sandboxId: orchestratorSessionId,
    port: nekoPort,
    display,
    cdpPort,
    message,
  };
}
