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

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return toBoolean(value, fallback);
  return fallback;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function escapeYamlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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

export type DebugReasonCode = 'missing_turn' | 'ice_failed';

type NekoIceServer = {
  urls: string[];
  username?: string;
  credential?: string;
};

const DEFAULT_ICE_SERVERS: NekoIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }];

function findLastIndex(content: string, token: string): number {
  return content.lastIndexOf(token);
}

/**
 * Only mark failed when we can assert the latest ICE state reached `failed`
 * and there is no subsequent `connected`.
 *
 * Rationale:
 * - n.eko logs may contain transient warnings such as "Failed to ping without candidate pairs"
 *   even when the same peer later reaches connected.
 * - after browser tab closes, logs may include socket/read warnings that should not be treated as
 *   persistent ICE failure for the debug runtime.
 */
export function detectIceFailureFromLog(logText: string): boolean {
  const content = String(logText || '');
  if (!content) return false;

  const lastFailed = findLastIndex(content, 'ICE connection state changed: failed');
  if (lastFailed < 0) return false;

  const lastConnected = findLastIndex(content, 'ICE connection state changed: connected');
  return lastConnected < lastFailed;
}

function parseIceServers(raw: string): NekoIceServer[] {
  if (!raw) {
    return DEFAULT_ICE_SERVERS;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('debug_ice_servers_invalid_json');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('debug_ice_servers_invalid_shape');
  }

  const normalized: NekoIceServer[] = parsed.map((item) => {
    const record = toRecord(item);
    const urls = toStringArray(record.urls);
    if (!urls.length) {
      throw new Error('debug_ice_servers_invalid_urls');
    }
    const entry: NekoIceServer = { urls };
    const username = asText(record.username);
    const credential = asText(record.credential);
    if (username) entry.username = username;
    if (credential) entry.credential = credential;
    return entry;
  });

  if (!normalized.length) {
    throw new Error('debug_ice_servers_empty');
  }

  return normalized;
}

function hasTurnIceServer(iceServers: NekoIceServer[]): boolean {
  return iceServers.some((server) =>
    server.urls.some((url) => {
      const normalized = url.trim().toLowerCase();
      return normalized.startsWith('turn:') || normalized.startsWith('turns:');
    })
  );
}

export function __parseIceServersForTest(raw: string): Array<{ urls: string[]; username?: string; credential?: string }> {
  return parseIceServers(raw);
}

export function __hasTurnIceServerForTest(
  servers: Array<{ urls: string[]; username?: string; credential?: string }>
): boolean {
  return hasTurnIceServer(servers as NekoIceServer[]);
}

function renderIceServersYaml(iceServers: NekoIceServer[]): string {
  return iceServers
    .map((server) => {
      const urls = server.urls.map((url) => `"${escapeYamlString(url)}"`).join(', ');
      const usernameLine = server.username ? `\n      username: "${escapeYamlString(server.username)}"` : '';
      const credentialLine = server.credential ? `\n      credential: "${escapeYamlString(server.credential)}"` : '';
      return `    - urls: [${urls}]${usernameLine}${credentialLine}`;
    })
    .join('\n');
}

export async function probeNekoIceHealth(sandboxId: string): Promise<{ failed: boolean; logTail?: string }> {
  try {
    const result = await e2bConnector.runCommand(sandboxId, 'tail -n 200 /tmp/neko.log || true', {
      timeoutMs: 20000,
    });
    const logTail = asText(result?.stdout);
    return {
      failed: detectIceFailureFromLog(logTail),
      logTail,
    };
  } catch {
    return { failed: false };
  }
}

export async function collectNekoDebugDiagnostics(sandboxId: string): Promise<{
  nekoConfig?: string;
  nekoLogTail?: string;
  listeningPorts?: string;
}> {
  try {
    const result = await e2bConnector.runCommand(
      sandboxId,
      [
        'echo "__CFG__"',
        'sed -n "1,220p" /tmp/oneceo/neko.yml 2>/dev/null || true',
        'echo "__LOG__"',
        'tail -n 200 /tmp/neko.log 2>/dev/null || true',
        'echo "__PORTS__"',
        'ss -ltnup | grep -E "8081|8082|18080" || true',
      ].join('\n'),
      { timeoutMs: 30000 }
    );
    const stdout = String(result?.stdout || '');
    const cfgIdx = stdout.indexOf('__CFG__');
    const logIdx = stdout.indexOf('__LOG__');
    const portsIdx = stdout.indexOf('__PORTS__');
    const getSlice = (start: number, end: number) =>
      start >= 0 && end >= 0 && end > start ? stdout.slice(start, end).trim() : '';
    const nekoConfig = getSlice(cfgIdx + '__CFG__'.length, logIdx);
    const nekoLogTail = getSlice(logIdx + '__LOG__'.length, portsIdx);
    const listeningPorts = portsIdx >= 0 ? stdout.slice(portsIdx + '__PORTS__'.length).trim() : '';
    return {
      nekoConfig: nekoConfig || undefined,
      nekoLogTail: nekoLogTail || undefined,
      listeningPorts: listeningPorts || undefined,
    };
  } catch {
    return {};
  }
}

type EnsureDebugResult = {
  ready: boolean;
  url?: string;
  status: string;
  updatedAt: string;
  sandboxId: string;
  port: number;
  display: string;
  cdpPort: number;
  screenWidth?: number;
  screenHeight?: number;
  message?: string;
  reasonCode?: DebugReasonCode;
};

type EnsureDebugOptions = {
  requireTurn?: boolean;
  strictIceCheck?: boolean;
  iceServers?: Array<{ urls: string[]; username?: string; credential?: string }>;
};

export async function ensureNekoDebug(
  orchestratorSessionId: string,
  options: EnsureDebugOptions = {}
): Promise<EnsureDebugResult> {
  const screenWidth = toPositiveInt(process.env.NEKO_SCREEN_WIDTH, 1280);
  const screenHeight = toPositiveInt(process.env.NEKO_SCREEN_HEIGHT, 1008);
  const nekoPort = toPositiveInt(process.env.NEKO_PORT, 8081);
  const cdpPort = toPositiveInt(process.env.NEKO_CDP_PORT, 9222);
  const display = process.env.NEKO_DISPLAY || ':0';
  const requireTurn = options.requireTurn ?? toBoolean(process.env.NEKO_DEBUG_REQUIRE_TURN, false);
  const strictIceCheck = options.strictIceCheck ?? requireTurn;
  const inlineIceServers = Array.isArray(options.iceServers) ? options.iceServers : null;
  const iceServersRaw = asText(process.env.NEKO_ICE_SERVERS_JSON);
  const iceServers = inlineIceServers && inlineIceServers.length > 0 ? parseIceServers(JSON.stringify(inlineIceServers)) : parseIceServers(iceServersRaw);
  const turnConfigured = hasTurnIceServer(iceServers);
  const webrtcEprRaw = asText(process.env.NEKO_WEBRTC_EPR);
  const webrtcEprDisabled =
    !webrtcEprRaw || ['0', 'off', 'false', 'disable', 'disabled'].includes(webrtcEprRaw.toLowerCase());
  const webrtcEpr = webrtcEprDisabled ? '' : webrtcEprRaw;
  const forceMux = toBoolean(process.env.NEKO_WEBRTC_FORCE_MUX, true);
  const tcpMuxCandidate = toPositiveInt(process.env.NEKO_WEBRTC_TCPMUX, 8082);
  const udpMuxCandidate = toPositiveInt(process.env.NEKO_WEBRTC_UDPMUX, 0);
  const useMux = forceMux || !webrtcEpr;
  const tcpMuxPort = useMux ? tcpMuxCandidate : 0;
  const udpMuxPort = useMux ? udpMuxCandidate : 0;
  const iceLite = toBoolean(process.env.NEKO_WEBRTC_ICELITE, false);
  const autoNat = toBoolean(process.env.NEKO_AUTO_NAT1TO1, false);
  const nat1to1Manual = asText(process.env.NEKO_NAT1TO1);
  const nekoUsername = asText(process.env.NEKO_USER_NAME) || 'oneceo';
  const nekoPassword = asText(process.env.NEKO_USER_PASSWORD) || 'oneceo';
  const nekoAdminPassword = asText(process.env.NEKO_ADMIN_PASSWORD) || nekoPassword;
  const natConfigTag = nat1to1Manual ? `manual-${nat1to1Manual}` : autoNat ? 'auto' : 'none';
  const iceTag = requireTurn ? (turnConfigured ? 'turn-on' : 'turn-off') : 'turn-optional';
  const configVersion = [
    'neko-multiuser-v4',
    `${screenWidth}x${screenHeight}`,
    `mode-${useMux ? 'mux' : 'epr'}`,
    `tcp-${tcpMuxPort}`,
    `udp-${udpMuxPort}`,
    `epr-${webrtcEpr || 'off'}`,
    `icelite-${iceLite ? 'on' : 'off'}`,
    `nat-${natConfigTag}`,
    iceTag,
  ].join('-');

  const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
  if (!environment) {
    throw new Error('sandbox environment not found');
  }

  const metadata = toRecord(environment.metadata);
  const debugMeta = toRecord(metadata.debug);
  const nekoMeta = toRecord(debugMeta.neko);
  const previousBaseUrl = asText(nekoMeta.baseUrl) || asText(nekoMeta.url);

  const updateMetadata = async (patch: Record<string, unknown>) => {
    const nextMetadata = {
      ...metadata,
      debug: {
        ...(metadata as any)?.debug,
        neko: {
          ...nekoMeta,
          ...patch,
          updatedAt: new Date().toISOString(),
        },
      },
    };
    await sandboxExecutionEnvironmentDAO.updateMetadata(orchestratorSessionId, nextMetadata);
  };

  if (requireTurn && !turnConfigured) {
    const failureMessage = '缺少 TURN 配置，无法建立远程调试媒体链路';
    const diagnostics = await collectNekoDebugDiagnostics(orchestratorSessionId);
    await updateMetadata({
      status: 'failed',
      reasonCode: 'missing_turn',
      message: failureMessage,
      configVersion,
      turnConfigured,
      iceServers,
      diagnostics,
    });
    return {
      ready: false,
      url: previousBaseUrl || undefined,
      status: 'failed',
      updatedAt: new Date().toISOString(),
      sandboxId: orchestratorSessionId,
      port: nekoPort,
      display,
      cdpPort,
      screenWidth,
      screenHeight,
      reasonCode: 'missing_turn',
      message: failureMessage,
    };
  }

  let nat1To1: string | null = null;
  if (nat1to1Manual) {
    nat1To1 = nat1to1Manual;
  } else if (autoNat) {
    const natPort = tcpMuxPort > 0 ? tcpMuxPort : nekoPort;
    const hostForNat = await e2bConnector.getSandboxHost(orchestratorSessionId, natPort);
    nat1To1 = await resolveHostIp(hostForNat);
  }
  const nat1To1Yaml = nat1To1 ? `  nat1to1:\n    - "${nat1To1}"\n` : '';
  const eprYaml = webrtcEpr ? `  epr: "${webrtcEpr}"\n` : '';
  const tcpMuxYaml = tcpMuxPort > 0 ? `  tcpmux: ${tcpMuxPort}\n` : '';
  const udpMuxYaml = udpMuxPort > 0 ? `  udpmux: ${udpMuxPort}\n` : '';
  const iceLiteYaml = iceLite ? '  icelite: true\n' : '';
  const iceServersYaml = renderIceServersYaml(iceServers);

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
cat <<EOF_CFG > "$NEKO_CONFIG"
server:
  bind: "0.0.0.0:${nekoPort}"
  static: "\${NEKO_STATIC}"
capture:
  display: "${display}"
  video_codec: "vp8"
  video_bitrate: 3000
webrtc:
  iceservers:
${iceServersYaml}
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
EOF_CFG

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

  const existingVersion = asText(nekoMeta.configVersion);
  const existingPort = Number(nekoMeta.port);
  const existingTcpMux = Number(nekoMeta.tcpMuxPort);
  const existingUdpMux = Number(nekoMeta.udpMuxPort);
  const existingNat = asText(nekoMeta.nat1To1);
  const existingEpr = asText(nekoMeta.webrtcEpr);
  const existingForceMux = asBoolean(nekoMeta.forceMux, false);
  const existingIceLite = asBoolean(nekoMeta.iceLite, false);
  const existingAutoNat = asBoolean(nekoMeta.autoNat, false);
  const existingUser = asText(nekoMeta.username);
  const existingPass = asText(nekoMeta.password);
  const existingAdminPass = asText(nekoMeta.adminPassword);
  const existingStatus = asText(nekoMeta.status).toLowerCase();
  const shouldRefresh =
    existingVersion !== configVersion ||
    existingPort !== nekoPort ||
    existingTcpMux !== tcpMuxPort ||
    existingUdpMux !== udpMuxPort ||
    existingNat !== (nat1To1 || '') ||
    existingEpr !== (webrtcEpr || '') ||
    existingForceMux !== forceMux ||
    existingIceLite !== iceLite ||
    existingAutoNat !== autoNat ||
    existingUser !== nekoUsername ||
    existingPass !== nekoPassword ||
    existingAdminPass !== nekoAdminPassword ||
    existingStatus === 'failed';

  let ready = await probeNeko(orchestratorSessionId, nekoPort);
  if (!ready || shouldRefresh) {
    const check = await e2bConnector.runCommand(
      orchestratorSessionId,
      `command -v neko >/dev/null 2>&1 && test -d /opt/neko/client/dist && echo "OK" || echo "MISSING"`,
      { timeoutMs: 20000 }
    );
    const installed = (check?.stdout || '').trim() === 'OK';
    await e2bConnector.runCommand(orchestratorSessionId, startCommand, {
      timeoutMs: installed ? 2 * 60 * 1000 : 15 * 60 * 1000,
    });
    ready = await waitForNeko(orchestratorSessionId, nekoPort);
  }

  let status = ready ? 'running' : 'starting';
  let reasonCode: DebugReasonCode | undefined;
  let message = ready ? undefined : asText(nekoMeta.message) || '调试服务启动中，请稍后重试';
  let diagnostics: Awaited<ReturnType<typeof collectNekoDebugDiagnostics>> | undefined;

  if (strictIceCheck) {
    const health = await probeNekoIceHealth(orchestratorSessionId);
    if (health.failed) {
      diagnostics = await collectNekoDebugDiagnostics(orchestratorSessionId);
      status = 'failed';
      reasonCode = 'ice_failed';
      message = '远程调试 ICE 连接失败，请检查 TURN 配置后重试';
      ready = false;
    }
  }

  const host = await e2bConnector.getSandboxHost(orchestratorSessionId, nekoPort);
  const baseUrl = `https://${host}`;
  const clientUrl = `${baseUrl}?pwd=${encodeURIComponent(nekoPassword)}&usr=${encodeURIComponent(nekoUsername)}`;

  await updateMetadata({
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
    webrtcMode: useMux ? 'mux' : 'epr',
    webrtcEpr: webrtcEpr || '',
    forceMux,
    iceLite,
    autoNat,
    username: nekoUsername,
    password: nekoPassword,
    adminPassword: nekoAdminPassword,
    configVersion,
    turnConfigured,
    requireTurn,
    strictIceCheck,
    iceServers,
    diagnostics,
    status,
    reasonCode,
    message,
  });

  return {
    ready,
    url: clientUrl,
    status,
    updatedAt: new Date().toISOString(),
    sandboxId: orchestratorSessionId,
    port: nekoPort,
    display,
    cdpPort,
    screenWidth,
    screenHeight,
    reasonCode,
    message,
  };
}
