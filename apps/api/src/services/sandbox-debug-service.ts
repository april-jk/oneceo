import { lookup as dnsLookup } from 'node:dns/promises';
import { e2bConnector } from '../connectors/e2b-connector';
import { sandboxExecutionEnvironmentDAO } from '../db/dao';

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function toBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
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
  const screenWidth = toPositiveInt(process.env.NEKO_SCREEN_WIDTH, 1280);
  const screenHeight = toPositiveInt(process.env.NEKO_SCREEN_HEIGHT, 1008);
  const configVersion = `neko-multiuser-epr-v2-${screenWidth}x${screenHeight}`;
  const nekoPort = toPositiveInt(process.env.NEKO_PORT, 8081);
  const cdpPort = toPositiveInt(process.env.NEKO_CDP_PORT, 9222);
  const display = process.env.NEKO_DISPLAY || ':0';
  const webrtcEprRaw = asText(process.env.NEKO_WEBRTC_EPR);
  const webrtcEprDisabled = ['0', 'off', 'false', 'disable', 'disabled'].includes(webrtcEprRaw.toLowerCase());
  const webrtcEpr = webrtcEprDisabled ? '' : webrtcEprRaw || '51000-51100';
  const forceMux = toBoolean(process.env.NEKO_WEBRTC_FORCE_MUX, false);
  const tcpMuxCandidate = toPositiveInt(process.env.NEKO_WEBRTC_TCPMUX, 0);
  const udpMuxCandidate = toPositiveInt(process.env.NEKO_WEBRTC_UDPMUX, 0);
  const tcpMuxPort = forceMux || !webrtcEpr ? tcpMuxCandidate : 0;
  const udpMuxPort = forceMux || !webrtcEpr ? udpMuxCandidate : 0;
  const iceLite = toBoolean(process.env.NEKO_WEBRTC_ICELITE, false);
  const autoNat = toBoolean(process.env.NEKO_AUTO_NAT1TO1, false);
  const nat1to1Manual = asText(process.env.NEKO_NAT1TO1);
  const nekoUsername = asText(process.env.NEKO_USER_NAME) || 'oneceo';
  const nekoPassword = asText(process.env.NEKO_USER_PASSWORD) || 'oneceo';
  const nekoAdminPassword = asText(process.env.NEKO_ADMIN_PASSWORD) || nekoPassword;

  const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
  if (!environment) {
    throw new Error('sandbox environment not found');
  }

  let nat1To1: string | null = null;
  if (nat1to1Manual) {
    nat1To1 = nat1to1Manual;
  } else if (autoNat) {
    const natPort = tcpMuxPort > 0 ? tcpMuxPort : nekoPort;
    const hostForNat = await e2bConnector.getSandboxHost(orchestratorSessionId, natPort);
    nat1To1 = await resolveHostIp(hostForNat);
  }
  const nat1To1Yaml = nat1To1 ? `  nat1to1:\n    - \"${nat1To1}\"\n` : '';
  const eprYaml = webrtcEpr ? `  epr: \"${webrtcEpr}\"\n` : '';
  const tcpMuxYaml = tcpMuxPort > 0 ? `  tcpmux: ${tcpMuxPort}\n` : '';
  const udpMuxYaml = udpMuxPort > 0 ? `  udpmux: ${udpMuxPort}\n` : '';
  const iceLiteYaml = iceLite ? '  icelite: true\n' : '';

  const metadata = toRecord(environment.metadata);
  const debugMeta = toRecord(metadata.debug);
  const nekoMeta = toRecord(debugMeta.neko);
  const existingUrl = asText(nekoMeta.baseUrl) || asText(nekoMeta.url);
  const startCommand = `
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

PLAYWRIGHT_BROWSERS_PATH="\${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright}"
NEKO_STATIC="/opt/neko/client/dist"
NEKO_CONFIG="/tmp/oneceo/neko.yml"

if ! command -v Xvfb >/dev/null 2>&1; then
  echo "[neko] Xvfb missing"
  exit 31
fi

if ! command -v neko >/dev/null 2>&1; then
  echo "[neko] neko binary missing"
  exit 32
fi

if [ ! -d "$NEKO_STATIC" ]; then
  echo "[neko] static assets missing at $NEKO_STATIC"
  exit 33
fi

CHROME_BIN=""
if command -v chromium-browser >/dev/null 2>&1; then
  CHROME_BIN=$(command -v chromium-browser)
elif command -v chromium >/dev/null 2>&1; then
  CHROME_BIN=$(command -v chromium)
else
  for candidate in "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-linux*/chrome; do
    if [ -x "$candidate" ]; then
      CHROME_BIN="$candidate"
      break
    fi
  done
fi

if [ -z "$CHROME_BIN" ]; then
  echo "[neko] chromium binary missing"
  exit 34
fi

mkdir -p /tmp/oneceo
cat <<EOF > "$NEKO_CONFIG"
server:
  bind: "0.0.0.0:${nekoPort}"
  static: "\${NEKO_STATIC}"
capture:
  display: "${display}"
  video_codec: "vp8"
  video_bitrate: 3000
webrtc:
  iceservers:
    - urls: ["stun:stun.l.google.com:19302"]
${iceLiteYaml}${tcpMuxYaml}${udpMuxYaml}${eprYaml}${nat1To1Yaml}session:
  merciful_reconnect: true
  implicit_hosting: true
  cookie:
    enabled: false
    secure: false
desktop:
  input:
    enabled: false
  screen: "${screenWidth}x${screenHeight}@30"
member:
  provider: "multiuser"
  multiuser:
    admin_password: "${nekoAdminPassword}"
    user_password: "${nekoPassword}"
EOF

pkill -x Xvfb || true
pkill -x chromium || true
pkill -x chromium-browser || true
sleep 1
nohup Xvfb ${display} -screen 0 ${screenWidth}x${screenHeight}x24 -nolisten tcp > /tmp/xvfb.log 2>&1 &

export DISPLAY=${display}
for i in $(seq 1 10); do
  if [ -S /tmp/.X11-unix/X0 ]; then
    break
  fi
  sleep 0.5
done

if command -v xrandr >/dev/null 2>&1; then
  xrandr -s ${screenWidth}x${screenHeight} || xrandr --output screen --mode ${screenWidth}x${screenHeight} || true
fi

cdp_ready="false"
if curl -fsSL --max-time 2 "http://127.0.0.1:${cdpPort}/json/version" >/dev/null 2>&1; then
  cdp_ready="true"
fi

if [[ "$cdp_ready" != "true" ]]; then
  if pgrep -x chromium >/dev/null 2>&1 || pgrep -x chromium-browser >/dev/null 2>&1; then
    pkill -x chromium || true
    pkill -x chromium-browser || true
    sleep 1
  fi
  nohup "$CHROME_BIN" \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --remote-debugging-port=${cdpPort} \
    --user-data-dir=/tmp/chromium-profile \
    --no-first-run \
    --no-default-browser-check \
    --disable-features=TranslateUI \
    --window-size=${screenWidth},${screenHeight} \
    about:blank \
    > /tmp/chromium.log 2>&1 &
  for i in $(seq 1 20); do
    if curl -fsSL --max-time 2 "http://127.0.0.1:${cdpPort}/json/version" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
fi

if pgrep -x neko >/dev/null 2>&1; then
  pkill -x neko || true
  sleep 1
fi
nohup neko serve --config "$NEKO_CONFIG" > /tmp/neko.log 2>&1 &
`;

  const setupCommand = startCommand;

  if (existingUrl) {
    const existingStatus = asText(nekoMeta.status) || environment.status;
    const existingVersion = asText(nekoMeta.configVersion);
    const existingPort = Number(nekoMeta.port);
    const existingUdpMux = Number(nekoMeta.udpMuxPort);
    const existingNat = asText(nekoMeta.nat1To1);
    const existingUser = asText(nekoMeta.username);
    const existingPass = asText(nekoMeta.password);
    const existingAdminPass = asText(nekoMeta.adminPassword);
    const shouldRefresh =
      existingVersion !== configVersion ||
      existingPort !== nekoPort ||
      existingUdpMux !== udpMuxPort ||
      existingNat !== (nat1To1 || '') ||
      existingUser !== nekoUsername ||
      existingPass !== nekoPassword ||
      existingAdminPass !== nekoAdminPassword;
    let ready = await probeNeko(orchestratorSessionId, nekoPort);
    if (!ready || shouldRefresh) {
      const check = await e2bConnector.runCommand(
        orchestratorSessionId,
        `command -v neko >/dev/null 2>&1 && test -d /opt/neko/client/dist && echo "OK" || echo "MISSING"`,
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
    const clientUrl = `${baseUrl}?pwd=${encodeURIComponent(nekoPassword)}&usr=${encodeURIComponent(nekoUsername)}`;
    const nextMetadata = {
      ...metadata,
      debug: {
        ...(metadata as any)?.debug,
        neko: {
          ...nekoMeta,
          baseUrl,
          clientUrl,
          port: nekoPort,
          display,
          cdpPort,
          screenWidth,
          screenHeight,
          tcpMuxPort,
          udpMuxPort,
          nat1To1: nat1To1 || '',
          username: nekoUsername,
          password: nekoPassword,
          adminPassword: nekoAdminPassword,
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
      url: clientUrl,
      status: nextStatus,
      updatedAt: new Date(environment.updatedAt as any).toISOString(),
      sandboxId: orchestratorSessionId,
      port: nekoPort,
      display,
      cdpPort,
      screenWidth,
      screenHeight,
      message: nextMessage,
    };
  }

  await e2bConnector.runCommand(orchestratorSessionId, setupCommand, { timeoutMs: 15 * 60 * 1000 });

  const ready = await waitForNeko(orchestratorSessionId, nekoPort);

  const host = await e2bConnector.getSandboxHost(orchestratorSessionId, nekoPort);
  const baseUrl = `https://${host}`;
  const clientUrl = `${baseUrl}?pwd=${encodeURIComponent(nekoPassword)}&usr=${encodeURIComponent(nekoUsername)}`;
  const status = ready ? 'running' : 'starting';
  const message = ready ? undefined : '调试服务启动中，请稍后重试';

  const nextMetadata = {
    ...metadata,
    debug: {
      ...(metadata as any)?.debug,
      neko: {
        baseUrl,
        clientUrl,
        port: nekoPort,
        display,
        cdpPort,
        tcpMuxPort,
        udpMuxPort,
        nat1To1: nat1To1 || '',
        username: nekoUsername,
        password: nekoPassword,
        adminPassword: nekoAdminPassword,
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
    url: clientUrl,
    status,
    updatedAt: new Date().toISOString(),
    sandboxId: orchestratorSessionId,
    port: nekoPort,
    display,
    cdpPort,
    message,
  };
}
