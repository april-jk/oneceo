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

function truncateText(value: unknown, maxLength = 4000): string {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 24))}\n...<truncated>...`;
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

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
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

async function probeChromiumCdp(sandboxId: string, port: number): Promise<boolean> {
  try {
    const probe = await e2bConnector.runCommand(
      sandboxId,
      `curl -fsSL --max-time 2 http://127.0.0.1:${port}/json/version >/dev/null 2>&1 && echo OK || echo MISSING`,
      { timeoutMs: 10000 }
    );
    return (probe?.stdout || '').trim() === 'OK';
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

async function waitForChromiumCdp(sandboxId: string, port: number, attempts = 8, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const ready = await probeChromiumCdp(sandboxId, port);
    if (ready) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

export type DebugReasonCode =
  | 'missing_turn'
  | 'ice_failed'
  | 'cdp_not_ready'
  | 'neko_not_ready'
  | 'preflight_failed'
  | 'xvfb_missing'
  | 'neko_binary_missing'
  | 'neko_static_missing'
  | 'chromium_binary_missing'
  | 'start_script_failed';

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

function renderNekoMemberYaml(): string {
  return ['member:', '  provider: "noauth"'].join('\n');
}

function buildNekoClientUrl(baseUrl: string): string {
  return baseUrl;
}

export function __renderNekoMemberYamlForTest(): string {
  return renderNekoMemberYaml();
}

export function __buildNekoClientUrlForTest(baseUrl: string): string {
  return buildNekoClientUrl(baseUrl);
}

export async function __probeChromiumCdpForTest(sandboxId: string, port: number): Promise<boolean> {
  return probeChromiumCdp(sandboxId, port);
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
  chromiumLogTail?: string;
  xvfbLogTail?: string;
  listeningPorts?: string;
  startScriptStdout?: string;
  startScriptStderr?: string;
  startScriptExitCode?: number;
  startScriptError?: string;
}> {
  try {
    const result = await e2bConnector.runCommand(
      sandboxId,
      [
        'echo "__CFG__"',
        'sed -n "1,220p" /tmp/oneceo/neko.yml 2>/dev/null || true',
        'echo "__LOG__"',
        'tail -n 200 /tmp/neko.log 2>/dev/null || true',
        'echo "__CHROMIUM_LOG__"',
        'tail -n 200 /tmp/chromium.log 2>/dev/null || true',
        'echo "__XVFB_LOG__"',
        'tail -n 120 /tmp/xvfb.log 2>/dev/null || true',
        'echo "__PORTS__"',
        'ss -ltnup | grep -E "8081|8082|8083|9222|18080" || true',
      ].join('\n'),
      { timeoutMs: 30000 }
    );
    const stdout = String(result?.stdout || '');
    const cfgIdx = stdout.indexOf('__CFG__');
    const logIdx = stdout.indexOf('__LOG__');
    const chromiumIdx = stdout.indexOf('__CHROMIUM_LOG__');
    const xvfbIdx = stdout.indexOf('__XVFB_LOG__');
    const portsIdx = stdout.indexOf('__PORTS__');
    const getSlice = (start: number, end: number) =>
      start >= 0 && end >= 0 && end > start ? stdout.slice(start, end).trim() : '';
    const nekoConfig = getSlice(cfgIdx + '__CFG__'.length, logIdx);
    const nekoLogTail = getSlice(logIdx + '__LOG__'.length, chromiumIdx);
    const chromiumLogTail = getSlice(chromiumIdx + '__CHROMIUM_LOG__'.length, xvfbIdx);
    const xvfbLogTail = getSlice(xvfbIdx + '__XVFB_LOG__'.length, portsIdx);
    const listeningPorts = portsIdx >= 0 ? stdout.slice(portsIdx + '__PORTS__'.length).trim() : '';
    return {
      nekoConfig: nekoConfig || undefined,
      nekoLogTail: nekoLogTail || undefined,
      chromiumLogTail: chromiumLogTail || undefined,
      xvfbLogTail: xvfbLogTail || undefined,
      listeningPorts: listeningPorts || undefined,
    };
  } catch {
    return {};
  }
}

function classifyNekoStartFailure(input: {
  stdout?: string;
  stderr?: string;
  errorMessage?: string;
  exitCode?: number;
}): DebugReasonCode {
  const combined = [input.stdout, input.stderr, input.errorMessage].map((item) => asText(item).toLowerCase()).join('\n');
  if (combined.includes('[neko] xvfb missing')) return 'xvfb_missing';
  if (combined.includes('[neko] neko binary missing')) return 'neko_binary_missing';
  if (combined.includes('[neko] static assets missing')) return 'neko_static_missing';
  if (combined.includes('[neko] chromium binary missing')) return 'chromium_binary_missing';
  if (combined.includes('pipefail') || combined.includes('[[: not found') || combined.includes('bad substitution')) {
    return 'start_script_failed';
  }
  if (input.exitCode === 31) return 'xvfb_missing';
  if (input.exitCode === 32) return 'neko_binary_missing';
  if (input.exitCode === 33) return 'neko_static_missing';
  if (input.exitCode === 34) return 'chromium_binary_missing';
  return 'start_script_failed';
}

function buildNekoStartFailureMessage(reasonCode: DebugReasonCode): string {
  switch (reasonCode) {
    case 'xvfb_missing':
      return '调试浏览器启动失败：Sandbox 缺少 Xvfb。';
    case 'neko_binary_missing':
      return '调试浏览器启动失败：Sandbox 缺少 n.eko 可执行文件。';
    case 'neko_static_missing':
      return '调试浏览器启动失败：Sandbox 缺少 n.eko 前端静态资源。';
    case 'chromium_binary_missing':
      return '调试浏览器启动失败：Sandbox 缺少 Chromium 浏览器。';
    default:
      return '调试浏览器启动脚本失败，无法打开调试页面。';
  }
}

function buildStartScriptFailureDiagnostics(
  diagnostics: Awaited<ReturnType<typeof collectNekoDebugDiagnostics>> | undefined,
  input: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    errorMessage?: string;
  }
): Awaited<ReturnType<typeof collectNekoDebugDiagnostics>> {
  return {
    ...(diagnostics || {}),
    startScriptStdout: truncateText(input.stdout, 4000) || undefined,
    startScriptStderr: truncateText(input.stderr, 4000) || undefined,
    startScriptExitCode: Number.isFinite(input.exitCode) ? input.exitCode : undefined,
    startScriptError: truncateText(input.errorMessage, 2000) || undefined,
  };
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
  const udpMuxCandidate = toPositiveInt(process.env.NEKO_WEBRTC_UDPMUX, 8083);
  const useMux = forceMux || !webrtcEpr;
  const tcpMuxPort = useMux ? tcpMuxCandidate : 0;
  const udpMuxPort = useMux ? udpMuxCandidate : 0;
  const iceLite = toBoolean(process.env.NEKO_WEBRTC_ICELITE, false);
  const autoNat = toBoolean(process.env.NEKO_AUTO_NAT1TO1, false);
  const nat1to1Manual = asText(process.env.NEKO_NAT1TO1);
  const natConfigTag = nat1to1Manual ? `manual-${nat1to1Manual}` : autoNat ? 'auto' : 'none';
  const iceTag = requireTurn ? (turnConfigured ? 'turn-on' : 'turn-off') : 'turn-optional';
  const configVersion = [
    'neko-noauth-v3-edgefill',
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
EDGE_CSS_NAME="oneceo-edgefill-v3.css"

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

cat <<'EOF_EDGE_CSS' > "$NEKO_STATIC/$EDGE_CSS_NAME"
html,
body,
#app,
#neko,
#neko.minimal,
.neko-main,
.video-container,
.video,
.player,
.player-container {
  box-sizing: border-box !important;
  width: 100% !important;
  height: 100% !important;
  min-width: 0 !important;
  min-height: 0 !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  background: transparent !important;
}

html,
body {
  width: 100vw !important;
  height: 100vh !important;
  overscroll-behavior: none !important;
}

#neko,
#neko.minimal,
.neko-main,
.video-container,
.video,
.player,
.player-container {
  display: flex !important;
  flex: 1 1 auto !important;
}

#app,
#neko,
#neko.minimal,
.neko-main,
.video-container,
.video,
.player,
.player-container {
  position: absolute !important;
  inset: 0 !important;
}

.player-container video,
video,
canvas {
  position: absolute !important;
  inset: -1px !important;
  width: calc(100% + 2px) !important;
  height: calc(100% + 2px) !important;
  object-fit: fill !important;
  background: transparent !important;
}

.player-overlay {
  background: transparent !important;
}

.player-aspect {
  display: none !important;
}
EOF_EDGE_CSS

for html in "$NEKO_STATIC"/index.html "$NEKO_STATIC"/*.html; do
  if [ -f "$html" ]; then
    sed -i 's#<link[^>]*oneceo-edgefill[^>]*>##g' "$html" || true
    sed -i "s#</head>#<link rel=\\"stylesheet\\" href=\\"/$EDGE_CSS_NAME\\"></head>#" "$html" || true
  fi
done

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
${renderNekoMemberYaml()}
EOF_CFG

pkill -x Xvfb || true
pkill -x chromium || true
pkill -x chromium-browser || true
pkill -x chrome || true
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
  xrandr --fb ${screenWidth}x${screenHeight} || true
  xrandr -s ${screenWidth}x${screenHeight} || xrandr --output screen --mode ${screenWidth}x${screenHeight} || true
fi

if command -v xsetroot >/dev/null 2>&1; then
  xsetroot -solid "#f9fbfd" || true
fi

cdp_ready="false"
if curl -fsSL --max-time 2 "http://127.0.0.1:${cdpPort}/json/version" >/dev/null 2>&1; then
  cdp_ready="true"
fi

if [[ "$cdp_ready" != "true" ]]; then
  if pgrep -x chromium >/dev/null 2>&1 || pgrep -x chromium-browser >/dev/null 2>&1 || pgrep -x chrome >/dev/null 2>&1; then
    pkill -x chromium || true
    pkill -x chromium-browser || true
    pkill -x chrome || true
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
    --force-device-scale-factor=1 \
    --window-position=0,0 \
    --window-size=${screenWidth},${screenHeight} \
    --start-maximized \
    --start-fullscreen \
    --kiosk \
    --app=about:blank \
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
  const existingAuthProvider = asText(nekoMeta.authProvider);
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
    existingAuthProvider !== 'noauth' ||
    existingStatus === 'failed';

  let nekoReady = await probeNeko(orchestratorSessionId, nekoPort);
  let cdpReady = await probeChromiumCdp(orchestratorSessionId, cdpPort);
  if (!nekoReady || !cdpReady || shouldRefresh) {
    const check = await e2bConnector.runCommand(
      orchestratorSessionId,
      `command -v neko >/dev/null 2>&1 && test -d /opt/neko/client/dist && echo "OK" || echo "MISSING"`,
      { timeoutMs: 20000 }
    );
    const installed = (check?.stdout || '').trim() === 'OK';
    try {
      await e2bConnector.runCommand(orchestratorSessionId, `bash -lc ${shellEscape(startCommand)}`, {
        timeoutMs: installed ? 2 * 60 * 1000 : 15 * 60 * 1000,
      });
    } catch (error) {
      const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
      const exitCodeCandidate = Number(record.exitCode ?? record.code ?? 1);
      const startFailure = {
        stdout: asText(record.stdout),
        stderr: asText(record.stderr),
        exitCode: Number.isFinite(exitCodeCandidate) ? exitCodeCandidate : 1,
        errorMessage: error instanceof Error ? error.message : String(error || 'debug start script failed'),
      };
      const diagnostics = buildStartScriptFailureDiagnostics(
        await collectNekoDebugDiagnostics(orchestratorSessionId),
        startFailure
      );
      const reasonCode = classifyNekoStartFailure(startFailure);
      const message = buildNekoStartFailureMessage(reasonCode);
      const host = await e2bConnector.getSandboxHost(orchestratorSessionId, nekoPort).catch(() => '');
      const baseUrl = host ? `https://${host}` : previousBaseUrl;
      await updateMetadata({
        ...(baseUrl
          ? {
              baseUrl,
              clientUrl: buildNekoClientUrl(baseUrl),
            }
          : {}),
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
        authProvider: 'noauth',
        configVersion,
        turnConfigured,
        requireTurn,
        strictIceCheck,
        iceServers,
        diagnostics,
        status: 'failed',
        reasonCode,
        message,
      });
      return {
        ready: false,
        url: baseUrl ? buildNekoClientUrl(baseUrl) : previousBaseUrl || undefined,
        status: 'failed',
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
    nekoReady = await waitForNeko(orchestratorSessionId, nekoPort);
    cdpReady = await waitForChromiumCdp(orchestratorSessionId, cdpPort);
  }

  let ready = nekoReady && cdpReady;
  let status = ready ? 'running' : 'starting';
  let reasonCode: DebugReasonCode | undefined;
  let message = ready ? undefined : asText(nekoMeta.message) || '调试服务启动中，请稍后重试';
  let diagnostics: Awaited<ReturnType<typeof collectNekoDebugDiagnostics>> | undefined;

  if (nekoReady && !cdpReady) {
    diagnostics = await collectNekoDebugDiagnostics(orchestratorSessionId);
    status = 'failed';
    reasonCode = 'cdp_not_ready';
    message = 'Chromium CDP 调试端口未就绪，无法打开调试页面';
    ready = false;
  } else if (!nekoReady) {
    diagnostics = await collectNekoDebugDiagnostics(orchestratorSessionId);
    status = 'failed';
    reasonCode = 'neko_not_ready';
    message = 'n.eko 调试服务未就绪，无法打开调试页面';
    ready = false;
  }

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
  const clientUrl = buildNekoClientUrl(baseUrl);

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
    authProvider: 'noauth',
    username: '',
    password: '',
    adminPassword: '',
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
