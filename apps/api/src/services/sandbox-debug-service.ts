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

const DEBUG_BROWSER_RUNTIME_VERSION = 'debug-browser-runtime-v1';
const DEBUG_BROWSER_ROOT = '/tmp/oneceo/debug-browser';
const DEBUG_BROWSER_LOG_DIR = `${DEBUG_BROWSER_ROOT}/logs`;
const DEBUG_BROWSER_RUN_DIR = `${DEBUG_BROWSER_ROOT}/run`;
const DEBUG_BROWSER_STATE_DIR = `${DEBUG_BROWSER_ROOT}/state`;
const DEBUG_BROWSER_TMP_DIR = `${DEBUG_BROWSER_ROOT}/tmp`;
const DEBUG_BROWSER_NEKO_STATIC = `${DEBUG_BROWSER_ROOT}/neko-static`;
const DEBUG_BROWSER_NEKO_CONFIG = `${DEBUG_BROWSER_ROOT}/neko.yml`;
const DEBUG_BROWSER_START_SCRIPT = `${DEBUG_BROWSER_ROOT}/neko-start.sh`;
const DEBUG_BROWSER_MANIFEST = `${DEBUG_BROWSER_STATE_DIR}/manifest.json`;
const DEBUG_BROWSER_NEKO_LOG = `${DEBUG_BROWSER_LOG_DIR}/neko.log`;
const DEBUG_BROWSER_CHROMIUM_LOG = `${DEBUG_BROWSER_LOG_DIR}/chromium.log`;
const DEBUG_BROWSER_XVFB_LOG = `${DEBUG_BROWSER_LOG_DIR}/xvfb.log`;
const DEBUG_BROWSER_START_LOG = `${DEBUG_BROWSER_LOG_DIR}/neko-start.log`;

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
  | 'neko_static_copy_failed'
  | 'neko_static_patch_failed'
  | 'chromium_binary_missing'
  | 'xvfb_start_failed'
  | 'chromium_start_failed'
  | 'neko_start_failed'
  | 'debug_browser_lock_timeout'
  | 'debug_browser_resource_conflict'
  | 'permission_denied'
  | 'start_script_failed';

type DebugFailureLayer =
  | 'template'
  | 'runtime'
  | 'browser'
  | 'media_forwarding'
  | 'target_preview'
  | 'authz'
  | 'unknown';

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

function manifestMatchesDebugRuntime(manifest: string | undefined, configVersion: string): boolean {
  const raw = asText(manifest);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return (
      asText(parsed.runtimeVersion) === DEBUG_BROWSER_RUNTIME_VERSION &&
      asText(parsed.configVersion) === configVersion &&
      asText(parsed.status).toLowerCase() === 'running'
    );
  } catch {
    return (
      raw.includes(`"runtimeVersion": "${DEBUG_BROWSER_RUNTIME_VERSION}"`) &&
      raw.includes(`"configVersion": "${configVersion}"`) &&
      raw.includes('"status": "running"')
    );
  }
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

export function __buildNekoStartCommandForTest(startScript: string): string {
  return buildNekoStartCommand(startScript);
}

export async function probeNekoIceHealth(sandboxId: string): Promise<{ failed: boolean; logTail?: string }> {
  try {
    const result = await e2bConnector.runCommand(sandboxId, `tail -n 200 ${shellEscape(DEBUG_BROWSER_NEKO_LOG)} 2>/dev/null || tail -n 200 /tmp/neko.log 2>/dev/null || true`, {
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
  startLogTail?: string;
  manifest?: string;
  runtimeTree?: string;
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
        `sed -n "1,220p" ${shellEscape(DEBUG_BROWSER_NEKO_CONFIG)} 2>/dev/null || sed -n "1,220p" /tmp/oneceo/neko.yml 2>/dev/null || true`,
        'echo "__LOG__"',
        `tail -n 200 ${shellEscape(DEBUG_BROWSER_NEKO_LOG)} 2>/dev/null || tail -n 200 /tmp/neko.log 2>/dev/null || true`,
        'echo "__CHROMIUM_LOG__"',
        `tail -n 200 ${shellEscape(DEBUG_BROWSER_CHROMIUM_LOG)} 2>/dev/null || tail -n 200 /tmp/chromium.log 2>/dev/null || true`,
        'echo "__XVFB_LOG__"',
        `tail -n 120 ${shellEscape(DEBUG_BROWSER_XVFB_LOG)} 2>/dev/null || tail -n 120 /tmp/xvfb.log 2>/dev/null || true`,
        'echo "__START_LOG__"',
        `tail -n 200 ${shellEscape(DEBUG_BROWSER_START_LOG)} 2>/dev/null || true`,
        'echo "__MANIFEST__"',
        `sed -n "1,220p" ${shellEscape(DEBUG_BROWSER_MANIFEST)} 2>/dev/null || true`,
        'echo "__TREE__"',
        `find ${shellEscape(DEBUG_BROWSER_ROOT)} -maxdepth 3 -printf "%M %u %g %s %p\\n" 2>/dev/null | sort | head -n 120 || true`,
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
    const startLogIdx = stdout.indexOf('__START_LOG__');
    const manifestIdx = stdout.indexOf('__MANIFEST__');
    const treeIdx = stdout.indexOf('__TREE__');
    const portsIdx = stdout.indexOf('__PORTS__');
    const getSlice = (start: number, end: number) =>
      start >= 0 && end >= 0 && end > start ? stdout.slice(start, end).trim() : '';
    const nekoConfig = getSlice(cfgIdx + '__CFG__'.length, logIdx);
    const nekoLogTail = getSlice(logIdx + '__LOG__'.length, chromiumIdx);
    const chromiumLogTail = getSlice(chromiumIdx + '__CHROMIUM_LOG__'.length, xvfbIdx);
    const xvfbLogTail = getSlice(xvfbIdx + '__XVFB_LOG__'.length, startLogIdx);
    const startLogTail = getSlice(startLogIdx + '__START_LOG__'.length, manifestIdx);
    const manifest = getSlice(manifestIdx + '__MANIFEST__'.length, treeIdx);
    const runtimeTree = getSlice(treeIdx + '__TREE__'.length, portsIdx);
    const listeningPorts = portsIdx >= 0 ? stdout.slice(portsIdx + '__PORTS__'.length).trim() : '';
    return {
      nekoConfig: nekoConfig || undefined,
      nekoLogTail: nekoLogTail || undefined,
      chromiumLogTail: chromiumLogTail || undefined,
      xvfbLogTail: xvfbLogTail || undefined,
      startLogTail: startLogTail || undefined,
      manifest: manifest || undefined,
      runtimeTree: runtimeTree || undefined,
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
  if (combined.includes('[neko] static copy failed')) return 'neko_static_copy_failed';
  if (combined.includes('[neko] static patch failed')) return 'neko_static_patch_failed';
  if (combined.includes('[neko] chromium binary missing')) return 'chromium_binary_missing';
  if (combined.includes('[neko] xvfb start failed')) return 'xvfb_start_failed';
  if (combined.includes('[neko] chromium start failed')) return 'chromium_start_failed';
  if (combined.includes('[neko] neko start failed')) return 'neko_start_failed';
  if (combined.includes('[neko] debug browser lock timeout')) return 'debug_browser_lock_timeout';
  if (combined.includes('[neko] debug browser resource conflict')) return 'debug_browser_resource_conflict';
  if (combined.includes('permission denied')) return 'permission_denied';
  if (combined.includes('pipefail') || combined.includes('[[: not found') || combined.includes('bad substitution')) {
    return 'start_script_failed';
  }
  if (input.exitCode === 31) return 'xvfb_missing';
  if (input.exitCode === 32) return 'neko_binary_missing';
  if (input.exitCode === 33) return 'neko_static_missing';
  if (input.exitCode === 34) return 'chromium_binary_missing';
  if (input.exitCode === 35) return 'neko_static_copy_failed';
  if (input.exitCode === 36) return 'neko_static_patch_failed';
  if (input.exitCode === 37) return 'debug_browser_resource_conflict';
  if (input.exitCode === 38) return 'xvfb_start_failed';
  if (input.exitCode === 39) return 'chromium_start_failed';
  if (input.exitCode === 40) return 'neko_start_failed';
  if (input.exitCode === 41) return 'permission_denied';
  if (input.exitCode === 42) return 'debug_browser_lock_timeout';
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
    case 'neko_static_copy_failed':
      return '调试浏览器启动失败：无法复制 n.eko 静态资源到运行时目录。';
    case 'neko_static_patch_failed':
      return '调试浏览器启动失败：无法写入 n.eko 运行时静态资源补丁。';
    case 'chromium_binary_missing':
      return '调试浏览器启动失败：Sandbox 缺少 Chromium 浏览器。';
    case 'xvfb_start_failed':
      return '调试浏览器启动失败：Xvfb 显示服务未就绪。';
    case 'chromium_start_failed':
      return '调试浏览器启动失败：Chromium CDP 未就绪。';
    case 'neko_start_failed':
      return '调试浏览器启动失败：n.eko 服务未就绪。';
    case 'debug_browser_lock_timeout':
      return '调试浏览器启动失败：已有调试浏览器启动流程仍在运行。';
    case 'debug_browser_resource_conflict':
      return '调试浏览器启动失败：固定端口或 Display 被非受控进程占用。';
    case 'permission_denied':
      return '调试浏览器启动失败：运行时目录或模板资源权限不足。';
    default:
      return '调试浏览器启动脚本失败，无法打开调试页面。';
  }
}

function failureLayerForReason(reasonCode: DebugReasonCode | undefined): DebugFailureLayer | undefined {
  switch (reasonCode) {
    case 'xvfb_missing':
    case 'neko_binary_missing':
    case 'neko_static_missing':
    case 'chromium_binary_missing':
      return 'template';
    case 'cdp_not_ready':
    case 'chromium_start_failed':
      return 'browser';
    case 'missing_turn':
    case 'ice_failed':
      return 'media_forwarding';
    case 'neko_static_copy_failed':
    case 'neko_static_patch_failed':
    case 'xvfb_start_failed':
    case 'neko_start_failed':
    case 'neko_not_ready':
    case 'debug_browser_lock_timeout':
    case 'debug_browser_resource_conflict':
    case 'permission_denied':
    case 'preflight_failed':
    case 'start_script_failed':
      return 'runtime';
    default:
      return reasonCode ? 'unknown' : undefined;
  }
}

function nextActionForReason(reasonCode: DebugReasonCode | undefined): string | undefined {
  switch (reasonCode) {
    case 'xvfb_missing':
    case 'neko_binary_missing':
    case 'neko_static_missing':
    case 'chromium_binary_missing':
      return 'sandbox_template_rebuild_required';
    case 'missing_turn':
    case 'ice_failed':
      return 'refresh_turn_or_media_forwarding_configuration';
    case 'debug_browser_lock_timeout':
      return 'retry_after_current_debug_browser_start_finishes';
    case 'debug_browser_resource_conflict':
      return 'inspect_conflicting_port_or_display_owner';
    case 'cdp_not_ready':
    case 'chromium_start_failed':
      return 'restart_managed_chromium_or_rebuild_profile';
    case 'neko_not_ready':
    case 'neko_start_failed':
      return 'restart_managed_neko';
    case 'neko_static_copy_failed':
    case 'neko_static_patch_failed':
    case 'xvfb_start_failed':
    case 'permission_denied':
    case 'preflight_failed':
    case 'start_script_failed':
      return 'inspect_debug_browser_runtime_diagnostics';
    default:
      return reasonCode ? 'inspect_debug_browser_diagnostics' : undefined;
  }
}

function buildNekoStartCommand(
  startScript: string,
  input: { nekoPort?: number; cdpPort?: number; configVersion?: string } = {}
): string {
  const nekoPort = toPositiveInt(String(input.nekoPort || ''), 8081);
  const cdpPort = toPositiveInt(String(input.cdpPort || ''), 9222);
  return [
    'set -euo pipefail',
    `mkdir -p ${shellEscape(DEBUG_BROWSER_LOG_DIR)} ${shellEscape(DEBUG_BROWSER_RUN_DIR)} ${shellEscape(DEBUG_BROWSER_STATE_DIR)} ${shellEscape(DEBUG_BROWSER_TMP_DIR)}`,
    `cat <<'EOF_ONECEO_NEKO_START' > ${shellEscape(DEBUG_BROWSER_START_SCRIPT)}`,
    startScript,
    'EOF_ONECEO_NEKO_START',
    `chmod +x ${shellEscape(DEBUG_BROWSER_START_SCRIPT)}`,
    `if [ -f ${shellEscape(DEBUG_BROWSER_START_LOG)}.2 ]; then mv -f ${shellEscape(DEBUG_BROWSER_START_LOG)}.2 ${shellEscape(DEBUG_BROWSER_START_LOG)}.3 || true; fi`,
    `if [ -f ${shellEscape(DEBUG_BROWSER_START_LOG)}.1 ]; then mv -f ${shellEscape(DEBUG_BROWSER_START_LOG)}.1 ${shellEscape(DEBUG_BROWSER_START_LOG)}.2 || true; fi`,
    `if [ -f ${shellEscape(DEBUG_BROWSER_START_LOG)} ]; then mv -f ${shellEscape(DEBUG_BROWSER_START_LOG)} ${shellEscape(DEBUG_BROWSER_START_LOG)}.1 || true; fi`,
    `LOCK_FILE=${shellEscape(`${DEBUG_BROWSER_RUN_DIR}/ensure.lock`)}`,
    `LOCK_OWNER=${shellEscape(`${DEBUG_BROWSER_RUN_DIR}/ensure.lock.owner`)}`,
    'LOCK_DIAG="$(date -Is 2>/dev/null || date)"',
    'describe_lock_owner() {',
    '  echo "[neko] debug browser lock diagnostic at ${LOCK_DIAG}" >&2',
    '  if [ -f "$LOCK_OWNER" ]; then',
    '    echo "[neko] lock owner file:" >&2',
    '    sed -n "1,20p" "$LOCK_OWNER" >&2 || true',
    '  else',
    '    echo "[neko] lock owner file missing" >&2',
    '  fi',
    '  if command -v fuser >/dev/null 2>&1; then',
    '    echo "[neko] lock fuser: $(fuser "$LOCK_FILE" 2>/dev/null || true)" >&2',
    '  fi',
    '  if command -v lsof >/dev/null 2>&1; then',
    '    lsof "$LOCK_FILE" 2>/dev/null | sed -n "1,20p" >&2 || true',
    '  fi',
    '}',
    'lock_has_live_holder() {',
    '  local inspected="false"',
    '  if command -v fuser >/dev/null 2>&1; then',
    '    inspected="true"',
    '    if fuser "$LOCK_FILE" >/dev/null 2>&1; then return 0; fi',
    '  fi',
    '  if command -v lsof >/dev/null 2>&1; then',
    '    inspected="true"',
    '    if lsof "$LOCK_FILE" >/dev/null 2>&1; then return 0; fi',
    '  fi',
    '  if [ "$inspected" != "true" ]; then return 2; fi',
    '  return 1',
    '}',
    'write_lock_owner() {',
    '  printf \'{\\n  "ownerPid": %s,\\n  "ownerPpid": %s,\\n  "startedAt": "%s",\\n  "runtimeVersion": "%s",\\n  "script": "%s"\\n}\\n\' "$$" "$PPID" "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date)" "${ONECEO_DEBUG_RUNTIME_VERSION:-unknown}" "${ONECEO_DEBUG_START_SCRIPT:-}" > "$LOCK_OWNER"',
    '}',
    'read_lock_owner_pid() {',
    '  sed -n \'s/.*"ownerPid"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p\' "$LOCK_OWNER" 2>/dev/null | head -n 1 || true',
    '}',
    'debug_runtime_ready_after_lock() {',
    '  if [ ! -f "$ONECEO_DEBUG_MANIFEST" ]; then return 1; fi',
    '  grep -F "\\"runtimeVersion\\": \\"${ONECEO_DEBUG_RUNTIME_VERSION}\\"" "$ONECEO_DEBUG_MANIFEST" >/dev/null 2>&1 || return 1',
    '  grep -F "\\"configVersion\\": \\"${ONECEO_DEBUG_CONFIG_VERSION}\\"" "$ONECEO_DEBUG_MANIFEST" >/dev/null 2>&1 || return 1',
    '  curl -fsSL --max-time 2 "http://127.0.0.1:${ONECEO_DEBUG_CDP_PORT}/json/version" >/dev/null 2>&1 || return 1',
    '  curl -fsSL --max-time 2 "http://127.0.0.1:${ONECEO_DEBUG_NEKO_PORT}/" >/dev/null 2>&1 || return 1',
    '  return 0',
    '}',
    'run_locked_start() {',
    '  write_lock_owner',
    '  trap \'rm -f "$LOCK_OWNER"\' EXIT',
    '  if debug_runtime_ready_after_lock; then',
    '    echo "[neko] debug browser already ready after lock acquisition; skipping restart"',
    '    exit 0',
    '  fi',
    `  bash ${shellEscape(DEBUG_BROWSER_START_SCRIPT)} > ${shellEscape(DEBUG_BROWSER_START_LOG)} 2>&1`,
    '}',
    `export ONECEO_DEBUG_START_SCRIPT=${shellEscape(DEBUG_BROWSER_START_SCRIPT)}`,
    `export ONECEO_DEBUG_RUNTIME_VERSION=${shellEscape(DEBUG_BROWSER_RUNTIME_VERSION)}`,
    `export ONECEO_DEBUG_CONFIG_VERSION=${shellEscape(input.configVersion || '')}`,
    `export ONECEO_DEBUG_MANIFEST=${shellEscape(DEBUG_BROWSER_MANIFEST)}`,
    `export ONECEO_DEBUG_NEKO_PORT=${nekoPort}`,
    `export ONECEO_DEBUG_CDP_PORT=${cdpPort}`,
    'export LOCK_FILE LOCK_OWNER ONECEO_DEBUG_START_SCRIPT ONECEO_DEBUG_RUNTIME_VERSION ONECEO_DEBUG_CONFIG_VERSION ONECEO_DEBUG_MANIFEST ONECEO_DEBUG_NEKO_PORT ONECEO_DEBUG_CDP_PORT',
    'export -f run_locked_start write_lock_owner read_lock_owner_pid debug_runtime_ready_after_lock',
    'if command -v flock >/dev/null 2>&1; then',
    '  if flock -E 42 -w 20 "$LOCK_FILE" bash -c \'run_locked_start\' ; then',
    '    :',
    '  else',
    '    status=$?',
    '    if [ "$status" = "42" ]; then',
    '      describe_lock_owner',
    '      holder_status=0',
    '      lock_has_live_holder || holder_status=$?',
    '      if [ "$holder_status" = "1" ]; then',
    '        echo "[neko] debug browser stale lock suspected; clearing owner marker and retrying once" >&2',
    '        rm -f "$LOCK_OWNER" "$LOCK_FILE" 2>/dev/null || true',
    '        if flock -E 42 -w 5 "$LOCK_FILE" bash -c \'run_locked_start\' ; then',
    '          exit 0',
    '        fi',
    '        status=$?',
    '      elif [ "$holder_status" = "2" ]; then',
    '        echo "[neko] debug browser lock holder could not be inspected; refusing stale cleanup" >&2',
    '      fi',
    '      echo "[neko] debug browser lock timeout" >&2',
    '      exit "$status"',
    '    fi',
    '    exit "$status"',
    '  fi',
    'else',
    `  LOCK_DIR=${shellEscape(`${DEBUG_BROWSER_RUN_DIR}/ensure.lockdir`)}`,
    '  acquired="false"',
    '  for _ in $(seq 1 40); do',
    '    if mkdir "$LOCK_DIR" 2>/dev/null; then',
    '      acquired="true"',
    '      break',
    '    fi',
    '    sleep 0.5',
    '  done',
    '  if [ "$acquired" != "true" ]; then',
    '    describe_lock_owner',
    '    owner_pid="$(read_lock_owner_pid)"',
    '    if [ -n "$owner_pid" ] && ! kill -0 "$owner_pid" 2>/dev/null; then',
    '      echo "[neko] debug browser stale lockdir owner pid=$owner_pid; retrying once" >&2',
    '      rm -rf "$LOCK_DIR" "$LOCK_OWNER" 2>/dev/null || true',
    '      if mkdir "$LOCK_DIR" 2>/dev/null; then',
    '        acquired="true"',
    '      fi',
    '    fi',
    '    if [ "$acquired" != "true" ]; then',
    '      echo "[neko] debug browser lock timeout" >&2',
    '      exit 42',
    '    fi',
    '  fi',
    '  write_lock_owner',
    '  trap \'rm -f "$LOCK_OWNER"; rmdir "$LOCK_DIR" 2>/dev/null || true\' EXIT',
    '  if debug_runtime_ready_after_lock; then',
    '    echo "[neko] debug browser already ready after lockdir acquisition; skipping restart"',
    '    exit 0',
    '  fi',
    `  bash ${shellEscape(DEBUG_BROWSER_START_SCRIPT)} > ${shellEscape(DEBUG_BROWSER_START_LOG)} 2>&1`,
    'fi',
  ].join('\n');
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
      failureLayer: failureLayerForReason('missing_turn'),
      nextAction: nextActionForReason('missing_turn'),
      message: failureMessage,
      configVersion,
      runtimeVersion: DEBUG_BROWSER_RUNTIME_VERSION,
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
#!/usr/bin/env bash
set -Eeuo pipefail
trap 'status=$?; echo "[oneceo-debug-browser] failed line=$LINENO status=$status command=$BASH_COMMAND" >&2' ERR
export DEBIAN_FRONTEND=noninteractive

PLAYWRIGHT_BROWSERS_PATH="\${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright}"
NEKO_STATIC_SOURCE="\${ONECEO_NEKO_STATIC_ROOT:-/opt/neko/client/dist}"
NEKO_RUNTIME_ROOT="${DEBUG_BROWSER_ROOT}"
NEKO_STATIC="${DEBUG_BROWSER_NEKO_STATIC}"
NEKO_CONFIG="${DEBUG_BROWSER_NEKO_CONFIG}"
NEKO_LOG_DIR="${DEBUG_BROWSER_LOG_DIR}"
NEKO_RUN_DIR="${DEBUG_BROWSER_RUN_DIR}"
NEKO_STATE_DIR="${DEBUG_BROWSER_STATE_DIR}"
NEKO_TMP_DIR="${DEBUG_BROWSER_TMP_DIR}"
NEKO_MANIFEST="${DEBUG_BROWSER_MANIFEST}"
NEKO_LOG="${DEBUG_BROWSER_NEKO_LOG}"
CHROMIUM_LOG="${DEBUG_BROWSER_CHROMIUM_LOG}"
XVFB_LOG="${DEBUG_BROWSER_XVFB_LOG}"
EDGE_CSS_NAME="oneceo-edgefill-v3.css"
RUNTIME_VERSION="${DEBUG_BROWSER_RUNTIME_VERSION}"

mkdir -p "$NEKO_LOG_DIR" "$NEKO_RUN_DIR" "$NEKO_STATE_DIR" "$NEKO_TMP_DIR"

rotate_log() {
  local path="$1"
  if [ -f "$path.2" ]; then mv -f "$path.2" "$path.3" || true; fi
  if [ -f "$path.1" ]; then mv -f "$path.1" "$path.2" || true; fi
  if [ -f "$path" ]; then mv -f "$path" "$path.1" || true; fi
}

write_manifest() {
  local status="$1"
  local message="$2"
  cat > "$NEKO_MANIFEST" <<EOF_MANIFEST
{
  "schemaVersion": 1,
  "runtimeVersion": "$RUNTIME_VERSION",
  "configVersion": "${configVersion}",
  "status": "$status",
  "message": "$message",
  "ports": {
    "neko": ${nekoPort},
    "cdp": ${cdpPort},
    "tcpMux": ${tcpMuxPort},
    "udpMux": ${udpMuxPort}
  },
  "display": "${display}",
  "screen": "${screenWidth}x${screenHeight}",
  "pidFiles": {
    "xvfb": "$NEKO_RUN_DIR/xvfb.pid",
    "chromium": "$NEKO_RUN_DIR/chromium.pid",
    "neko": "$NEKO_RUN_DIR/neko.pid"
  },
  "logFiles": {
    "start": "${DEBUG_BROWSER_START_LOG}",
    "xvfb": "$XVFB_LOG",
    "chromium": "$CHROMIUM_LOG",
    "neko": "$NEKO_LOG"
  },
  "startedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "lastHealthCheckAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF_MANIFEST
}

is_pid_command_match() {
  local pid="$1"
  local pattern="$2"
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi
  tr '\\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -F "$pattern" >/dev/null 2>&1
}

stop_pid_file() {
  local pid_file="$1"
  local pattern="$2"
  if [ ! -f "$pid_file" ]; then
    return 0
  fi
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if is_pid_command_match "$pid" "$pattern"; then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$pid_file"
}

port_owned_by_pid_file() {
  local port="$1"
  local pid_file="$2"
  if [ ! -f "$pid_file" ]; then
    return 1
  fi
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  ss -ltnp 2>/dev/null | grep -F ":$port " | grep -F "pid=$pid," >/dev/null 2>&1
}

assert_port_available_or_owned() {
  local port="$1"
  local pid_file="$2"
  if ss -ltnp 2>/dev/null | grep -F ":$port " >/dev/null 2>&1; then
    if ! port_owned_by_pid_file "$port" "$pid_file"; then
      echo "[neko] debug browser resource conflict on port $port"
      ss -ltnp 2>/dev/null | grep -F ":$port " || true
      exit 37
    fi
  fi
}

# Upgrade cleanup for pre-runtime-v1 debug browser processes owned by oneceo.
if pgrep -f "neko serve --config /tmp/oneceo/neko.yml" >/dev/null 2>&1; then
  pkill -f "neko serve --config /tmp/oneceo/neko.yml" || true
fi
if pgrep -f -- "--user-data-dir=/tmp/chromium-profile" >/dev/null 2>&1; then
  pkill -f -- "--user-data-dir=/tmp/chromium-profile" || true
fi
if [ -f /tmp/oneceo/neko.yml ] || [ -d /tmp/chromium-profile ]; then
  if pgrep -f "Xvfb ${display} -screen 0" >/dev/null 2>&1; then
    pkill -f "Xvfb ${display} -screen 0" || true
  fi
fi
sleep 0.5

assert_port_available_or_owned ${nekoPort} "$NEKO_RUN_DIR/neko.pid"
assert_port_available_or_owned ${cdpPort} "$NEKO_RUN_DIR/chromium.pid"

if ! command -v Xvfb >/dev/null 2>&1; then
  echo "[neko] Xvfb missing"
  exit 31
fi

if ! command -v neko >/dev/null 2>&1; then
  echo "[neko] neko binary missing"
  exit 32
fi

if [ ! -d "$NEKO_STATIC_SOURCE" ]; then
  echo "[neko] static assets missing at $NEKO_STATIC_SOURCE"
  exit 33
fi

rotate_log "$NEKO_LOG"
rotate_log "$CHROMIUM_LOG"
rotate_log "$XVFB_LOG"

rm -rf "$NEKO_STATIC"
mkdir -p "$NEKO_STATIC"
if ! cp -R "$NEKO_STATIC_SOURCE"/. "$NEKO_STATIC"/; then
  echo "[neko] static copy failed from $NEKO_STATIC_SOURCE to $NEKO_STATIC"
  exit 35
fi

if ! cat <<'EOF_EDGE_CSS' > "$NEKO_STATIC/$EDGE_CSS_NAME"
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
then
  echo "[neko] static patch failed writing css"
  exit 36
fi

for html in "$NEKO_STATIC"/index.html "$NEKO_STATIC"/*.html; do
  if [ -f "$html" ]; then
    sed -i 's#<link[^>]*oneceo-edgefill[^>]*>##g' "$html" || { echo "[neko] static patch failed cleaning $html"; exit 36; }
    sed -i "s#</head>#<link rel=\\"stylesheet\\" href=\\"/$EDGE_CSS_NAME\\"></head>#" "$html" || { echo "[neko] static patch failed injecting $html"; exit 36; }
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

stop_pid_file "$NEKO_RUN_DIR/neko.pid" "neko serve --config $NEKO_CONFIG"
stop_pid_file "$NEKO_RUN_DIR/chromium.pid" "--user-data-dir=$NEKO_RUNTIME_ROOT/chromium-profile"
stop_pid_file "$NEKO_RUN_DIR/xvfb.pid" "Xvfb ${display}"
sleep 1
nohup Xvfb ${display} -screen 0 ${screenWidth}x${screenHeight}x24 -nolisten tcp > "$XVFB_LOG" 2>&1 &
echo $! > "$NEKO_RUN_DIR/xvfb.pid"

export DISPLAY=${display}
display_ready="false"
for i in $(seq 1 10); do
  display_socket="/tmp/.X11-unix/X\${DISPLAY#:}"
  if [ -S "$display_socket" ]; then
    display_ready="true"
    break
  fi
  sleep 0.5
done
if [ "$display_ready" != "true" ]; then
  echo "[neko] xvfb start failed"
  exit 38
fi

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
  stop_pid_file "$NEKO_RUN_DIR/chromium.pid" "--user-data-dir=$NEKO_RUNTIME_ROOT/chromium-profile"
  nohup "$CHROME_BIN" \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port=${cdpPort} \
    --user-data-dir="$NEKO_RUNTIME_ROOT/chromium-profile" \
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
    > "$CHROMIUM_LOG" 2>&1 &
  echo $! > "$NEKO_RUN_DIR/chromium.pid"
  cdp_ready="false"
  for i in $(seq 1 20); do
    if curl -fsSL --max-time 2 "http://127.0.0.1:${cdpPort}/json/version" >/dev/null 2>&1; then
      cdp_ready="true"
      break
    fi
    sleep 0.5
  done
fi
if [[ "$cdp_ready" != "true" ]]; then
  echo "[neko] chromium start failed"
  exit 39
fi

stop_pid_file "$NEKO_RUN_DIR/neko.pid" "neko serve --config $NEKO_CONFIG"
nohup neko serve --config "$NEKO_CONFIG" > "$NEKO_LOG" 2>&1 &
echo $! > "$NEKO_RUN_DIR/neko.pid"
neko_ready="false"
for i in $(seq 1 20); do
  if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${nekoPort}/" | grep -q "^200"; then
    neko_ready="true"
    break
  fi
  sleep 0.5
done
if [[ "$neko_ready" != "true" ]]; then
  echo "[neko] neko start failed"
  exit 40
fi

write_manifest "running" "debug browser ready"
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
  const existingRuntimeVersion = asText(nekoMeta.runtimeVersion);
  const configMismatch =
    existingRuntimeVersion !== DEBUG_BROWSER_RUNTIME_VERSION ||
    existingVersion !== configVersion ||
    existingPort !== nekoPort ||
    existingTcpMux !== tcpMuxPort ||
    existingUdpMux !== udpMuxPort ||
    existingNat !== (nat1To1 || '') ||
    existingEpr !== (webrtcEpr || '') ||
    existingForceMux !== forceMux ||
    existingIceLite !== iceLite ||
    existingAutoNat !== autoNat ||
    existingAuthProvider !== 'noauth';

  let nekoReady = await probeNeko(orchestratorSessionId, nekoPort);
  let cdpReady = await probeChromiumCdp(orchestratorSessionId, cdpPort);
  const shouldRefresh = configMismatch || !nekoReady || !cdpReady;
  if (!nekoReady || !cdpReady || shouldRefresh) {
    const check = await e2bConnector.runCommand(
      orchestratorSessionId,
      `command -v neko >/dev/null 2>&1 && test -d /opt/neko/client/dist && echo "OK" || echo "MISSING"`,
      { timeoutMs: 20000 }
    );
    const installed = (check?.stdout || '').trim() === 'OK';
    try {
      await e2bConnector.runCommand(
        orchestratorSessionId,
        `bash -lc ${shellEscape(buildNekoStartCommand(startCommand, { nekoPort, cdpPort, configVersion }))}`,
        {
          timeoutMs: installed ? 2 * 60 * 1000 : 15 * 60 * 1000,
        }
      );
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
      const reconciledNekoReady = await probeNeko(orchestratorSessionId, nekoPort);
      const reconciledCdpReady = await probeChromiumCdp(orchestratorSessionId, cdpPort);
      const reconciledDiagnostics = diagnostics;
      if (
        reconciledNekoReady &&
        reconciledCdpReady &&
        manifestMatchesDebugRuntime(reconciledDiagnostics.manifest, configVersion) &&
        (!strictIceCheck || !(await probeNekoIceHealth(orchestratorSessionId)).failed)
      ) {
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
          configVersion,
          turnConfigured,
          requireTurn,
          strictIceCheck,
          iceServers,
          diagnostics: reconciledDiagnostics,
          status: 'running',
          reasonCode: undefined,
          failureLayer: undefined,
          nextAction: undefined,
          message: undefined,
          runtimeVersion: DEBUG_BROWSER_RUNTIME_VERSION,
        });
        return {
          ready: true,
          url: clientUrl,
          status: 'running',
          updatedAt: new Date().toISOString(),
          sandboxId: orchestratorSessionId,
          port: nekoPort,
          display,
          cdpPort,
          screenWidth,
          screenHeight,
        };
      }
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
        failureLayer: failureLayerForReason(reasonCode),
        nextAction: nextActionForReason(reasonCode),
        message,
        runtimeVersion: DEBUG_BROWSER_RUNTIME_VERSION,
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
    failureLayer: failureLayerForReason(reasonCode),
    nextAction: nextActionForReason(reasonCode),
    message,
    runtimeVersion: DEBUG_BROWSER_RUNTIME_VERSION,
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
