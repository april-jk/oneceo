import { e2bConnector } from '../connectors/e2b-connector';
import type { DeploymentTemplateBaselineData } from './task-creation-deployment-source-service';

export type TaskSessionDeploymentLocalPreflightPhase =
  | 'unsupported'
  | 'dependency_install'
  | 'build'
  | 'start'
  | 'healthcheck'
  | 'browser_smoke';

export type TaskSessionDeploymentLocalPreflightReport = {
  status: 'passed' | 'failed' | 'skipped';
  phase: TaskSessionDeploymentLocalPreflightPhase;
  failureKind?: 'workspace_code' | 'platform_capability';
  checkedAt: string;
  workspaceRoot: string;
  buildCommand?: string;
  startCommand?: string;
  healthcheckPath?: string;
  port?: number;
  rootUrl?: string;
  healthUrl?: string;
  message?: string;
  installOutput?: string;
  buildOutput?: string;
  serverOutput?: string;
  browserOutput?: string;
  browserMode?: 'playwright_node' | 'playwright_cli';
  screenshotPath?: string;
};

const REPORT_MARKER = '__ONECEO_DEPLOYMENT_LOCAL_PREFLIGHT__';
const SUPPORTED_STACK_PATTERNS = [
  'oneceo_fixed_vite_node_shell',
  'static_node_http_api_dbless',
  'frontend_dist_http_api_dbless',
  'node_script_http_api_dbless',
  'vite',
  'node',
  'static',
  'frontend',
];

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function shellEscape(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function truncate(value: unknown, maxLength = 4000): string | undefined {
  const text = asText(value);
  if (!text) return undefined;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...[truncated ${text.length - maxLength} chars]`;
}

function normalizeHealthcheckPath(value: unknown): string {
  const text = asText(value);
  if (!text) return '/';
  return text.startsWith('/') ? text : `/${text}`;
}

export function isTaskSessionDeploymentLocalPreflightSupported(
  baseline: Pick<DeploymentTemplateBaselineData, 'appType' | 'stack' | 'buildCommand' | 'startCommand'>
) {
  const stack = asText(baseline.stack).toLowerCase();
  return (
    baseline.appType === 'web_app' &&
    Boolean(asText(baseline.buildCommand)) &&
    Boolean(asText(baseline.startCommand)) &&
    SUPPORTED_STACK_PATTERNS.some((pattern) => stack.includes(pattern))
  );
}

function buildSkippedReport(input: {
  workspaceRoot: string;
  baseline: DeploymentTemplateBaselineData;
  message: string;
}): TaskSessionDeploymentLocalPreflightReport {
  return {
    status: 'skipped',
    phase: 'unsupported',
    checkedAt: new Date().toISOString(),
    workspaceRoot: input.workspaceRoot,
    buildCommand: input.baseline.buildCommand,
    startCommand: input.baseline.startCommand,
    healthcheckPath: input.baseline.healthcheckPath,
    message: input.message,
  };
}

function parsePreflightReport(
  stdout: string,
  fallback: TaskSessionDeploymentLocalPreflightReport
): TaskSessionDeploymentLocalPreflightReport {
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((item) => item.startsWith(REPORT_MARKER));
  if (!line) return fallback;
  try {
    const parsed = JSON.parse(line.slice(REPORT_MARKER.length));
    return {
      ...fallback,
      ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}),
    } as TaskSessionDeploymentLocalPreflightReport;
  } catch {
    return fallback;
  }
}

function buildPreflightScript(input: {
  buildCommand: string;
  startCommand: string;
  healthcheckPath: string;
  port: number;
  runId: string;
}) {
  const rootUrl = `http://127.0.0.1:${input.port}/`;
  const healthUrl = `http://127.0.0.1:${input.port}${input.healthcheckPath}`;
  const workDir = `/tmp/oneceo-deployment-local-preflight-${input.runId}`;
  const installLog = `${workDir}/install.log`;
  const buildLog = `${workDir}/build.log`;
  const serverLog = `${workDir}/server.log`;
  const browserLog = `${workDir}/browser.log`;
  const browserScript = `${workDir}/browser-smoke.js`;
  const screenshotPath = `${workDir}/browser-smoke.png`;
  const pidPath = `${workDir}/server.pid`;

  return [
    'set +e',
    `build_command=${shellEscape(input.buildCommand)}`,
    `start_command=${shellEscape(input.startCommand)}`,
    `health_path=${shellEscape(input.healthcheckPath)}`,
    `port=${input.port}`,
    `root_url=${shellEscape(rootUrl)}`,
    `health_url=${shellEscape(healthUrl)}`,
    `work_dir=${shellEscape(workDir)}`,
    `install_log=${shellEscape(installLog)}`,
    `build_log=${shellEscape(buildLog)}`,
    `server_log=${shellEscape(serverLog)}`,
    `browser_log=${shellEscape(browserLog)}`,
    `browser_script=${shellEscape(browserScript)}`,
    `screenshot_path=${shellEscape(screenshotPath)}`,
    `pid_path=${shellEscape(pidPath)}`,
    'mkdir -p "$work_dir"',
    'cleanup() {',
    '  if [ -f "$pid_path" ]; then',
    '    pid="$(cat "$pid_path" 2>/dev/null || true)"',
    '    if [ -n "$pid" ]; then kill "$pid" >/dev/null 2>&1 || true; fi',
    '  fi',
    '}',
    'trap cleanup EXIT',
    'write_report() {',
    '  status="$1"; phase="$2"; message="$3"; browser_mode="$4"; failure_kind="$5"',
    '  STATUS="$status" PHASE="$phase" MESSAGE="$message" BROWSER_MODE="$browser_mode" FAILURE_KIND="$failure_kind" \\',
    '  BUILD_COMMAND="$build_command" START_COMMAND="$start_command" HEALTH_PATH="$health_path" \\',
    '  PORT_VALUE="$port" ROOT_URL="$root_url" HEALTH_URL="$health_url" SCREENSHOT_PATH="$screenshot_path" \\',
    '  INSTALL_LOG="$install_log" BUILD_LOG="$build_log" SERVER_LOG="$server_log" BROWSER_LOG="$browser_log" \\',
    '  node <<\'NODE\'',
    'const fs = require("node:fs");',
    'function tail(path, limit = 4000) {',
    '  try {',
    '    const value = fs.readFileSync(path, "utf8");',
    '    return value.length > limit ? value.slice(-limit) : value;',
    '  } catch {',
    '    return undefined;',
    '  }',
    '}',
    'const report = {',
    '  status: process.env.STATUS,',
    '  phase: process.env.PHASE,',
    '  failureKind: process.env.FAILURE_KIND || undefined,',
    '  checkedAt: new Date().toISOString(),',
    '  buildCommand: process.env.BUILD_COMMAND || undefined,',
    '  startCommand: process.env.START_COMMAND || undefined,',
    '  healthcheckPath: process.env.HEALTH_PATH || undefined,',
    '  port: Number(process.env.PORT_VALUE || 0) || undefined,',
    '  rootUrl: process.env.ROOT_URL || undefined,',
    '  healthUrl: process.env.HEALTH_URL || undefined,',
    '  message: process.env.MESSAGE || undefined,',
    '  installOutput: tail(process.env.INSTALL_LOG),',
    '  buildOutput: tail(process.env.BUILD_LOG),',
    '  serverOutput: tail(process.env.SERVER_LOG),',
    '  browserOutput: tail(process.env.BROWSER_LOG),',
    '  browserMode: process.env.BROWSER_MODE || undefined,',
    '  screenshotPath: fs.existsSync(process.env.SCREENSHOT_PATH || "") ? process.env.SCREENSHOT_PATH : undefined,',
    '};',
    `console.log(${JSON.stringify(REPORT_MARKER)} + JSON.stringify(report));`,
    'NODE',
    '}',
    'if [ -f package.json ] && [ ! -d node_modules ]; then',
    '  if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then',
    '    pnpm install --frozen-lockfile > "$install_log" 2>&1',
    '  elif [ -f yarn.lock ] && command -v yarn >/dev/null 2>&1; then',
    '    yarn install --frozen-lockfile > "$install_log" 2>&1',
    '  elif [ -f package-lock.json ]; then',
    '    npm ci --no-audit --no-fund > "$install_log" 2>&1',
    '  elif printf "%s" "$build_command $start_command" | grep -q "\\bpnpm\\b" && command -v pnpm >/dev/null 2>&1; then',
    '    pnpm install --no-frozen-lockfile > "$install_log" 2>&1',
    '  elif printf "%s" "$build_command $start_command" | grep -q "\\byarn\\b" && command -v yarn >/dev/null 2>&1; then',
    '    yarn install > "$install_log" 2>&1',
    '  else',
    '    npm install --package-lock=false --no-audit --no-fund > "$install_log" 2>&1',
    '  fi',
    '  install_status=$?',
    '  if [ "$install_status" -ne 0 ]; then',
    '    write_report failed dependency_install "Dependency install failed before local deployment preflight." "" workspace_code',
    '    exit 0',
    '  fi',
    'fi',
    'bash -lc "$build_command" > "$build_log" 2>&1',
    'build_status=$?',
    'if [ "$build_status" -ne 0 ]; then',
    '  write_report failed build "Build command failed before Railway deployment." "" workspace_code',
    '  exit 0',
    'fi',
    'env PORT="$port" bash -lc "$start_command" > "$server_log" 2>&1 &',
    'server_pid=$!',
    'echo "$server_pid" > "$pid_path"',
    'sleep 1',
    'if ! kill -0 "$server_pid" >/dev/null 2>&1; then',
    '  write_report failed start "Start command exited before the local healthcheck became reachable." "" workspace_code',
    '  exit 0',
    'fi',
    'health_ok=0',
    'for _ in $(seq 1 30); do',
    '  if curl -fsS --max-time 2 "$health_url" >/dev/null 2>&1; then health_ok=1; break; fi',
    '  if ! kill -0 "$server_pid" >/dev/null 2>&1; then break; fi',
    '  sleep 1',
    'done',
    'if [ "$health_ok" -ne 1 ]; then',
    '  write_report failed healthcheck "Local service did not pass the manifest healthcheck before deployment." "" workspace_code',
    '  exit 0',
    'fi',
    'cat > "$browser_script" <<\'NODE\'',
    'const fs = require("node:fs");',
    'const url = process.env.ONECEO_PREFLIGHT_ROOT_URL;',
    'const screenshotPath = process.env.ONECEO_PREFLIGHT_SCREENSHOT_PATH;',
    'function isBenignConsoleError(text) {',
    '  return /favicon|analytics|umami|failed to load resource.*404/i.test(String(text || ""));',
    '}',
    '(async () => {',
    '  let chromium;',
    '  try {',
    '    ({ chromium } = require("playwright"));',
    '  } catch (error) {',
    '    throw new Error("__ONECEO_PLATFORM_CAPABILITY__MODULE__:" + (error && error.stack ? error.stack : String(error)));',
    '  }',
    '  let browser;',
    '  try {',
    '    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });',
    '  } catch (error) {',
    '    const text = error && error.stack ? error.stack : String(error);',
    "    if (/Executable doesn't exist|Looks like Playwright was just installed|browser.*not installed/i.test(text)) {",
    '      throw new Error("__ONECEO_PLATFORM_CAPABILITY__BROWSER__:" + text);',
    '    }',
    '    throw error;',
    '  }',
    '  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });',
    '  const pageErrors = [];',
    '  const consoleErrors = [];',
    '  page.on("pageerror", (error) => pageErrors.push(error.message || String(error)));',
    '  page.on("console", (message) => {',
    '    if (message.type() === "error") consoleErrors.push(message.text());',
    '  });',
    '  await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });',
    '  await page.screenshot({ path: screenshotPath, fullPage: true });',
    '  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");',
    '  const bodyHtml = await page.locator("body").evaluate((el) => el.innerHTML).catch(() => "");',
    '  const fatalConsoleErrors = consoleErrors.filter((item) => !isBenignConsoleError(item));',
    '  const failureMarkers = /Internal Server Error|Application error|Cannot GET|ReferenceError|SyntaxError/i;',
    '  const appState = await page.evaluate(() => {',
    '    const root = document.querySelector("#root, #app");',
    '    const status = window.__ONECEO_APP_STATUS__ && typeof window.__ONECEO_APP_STATUS__ === "object" ? window.__ONECEO_APP_STATUS__ : null;',
    '    return {',
    '      status: status && typeof status.status === "string" ? status.status : "",',
    '      rootStatus: root && root.getAttribute ? root.getAttribute("data-oneceo-app-status") || "" : "",',
    '      errors: status && Array.isArray(status.errors) ? status.errors.slice(0, 3).map((item) => String(item).slice(0, 500)) : [],',
    '      rootChildCount: root ? root.childElementCount : 0,',
    '      rootTextLength: root ? String(root.textContent || "").trim().length : 0,',
    '    };',
    '  }).catch(() => ({ status: "", rootStatus: "", errors: [], rootChildCount: 0, rootTextLength: 0 }));',
    '  if (!bodyText.trim() && !bodyHtml.trim()) throw new Error("__ONECEO_EMPTY_BODY__");',
    '  if (failureMarkers.test(bodyText)) throw new Error("__ONECEO_BROWSER_ERROR_TEXT__:" + bodyText.slice(0, 500));',
    '  if (appState.status === "error" || appState.rootStatus === "error") throw new Error("__ONECEO_APP_RUNTIME_ERROR__:" + (appState.errors.join(" | ") || "OneCEO app status is error"));',
    '  if (appState.rootChildCount === 0 && appState.rootStatus && appState.rootStatus !== "mounted") throw new Error("__ONECEO_APP_NOT_MOUNTED__:" + JSON.stringify(appState));',
    '  if (pageErrors.length > 0) throw new Error("__ONECEO_PAGE_ERROR__:" + pageErrors.slice(0, 3).join(" | "));',
    '  if (fatalConsoleErrors.length > 0) throw new Error("__ONECEO_CONSOLE_ERROR__:" + fatalConsoleErrors.slice(0, 3).join(" | "));',
    '  console.log(JSON.stringify({ ok: true, title: await page.title(), bodyTextLength: bodyText.length, consoleErrors, appState }));',
    '  await browser.close();',
    '})().catch((error) => {',
    '  console.error(error && error.stack ? error.stack : String(error));',
    '  process.exit(1);',
    '});',
    'NODE',
    'playwright_node_path="$(npm root -g 2>/dev/null || true)"',
    'playwright_node_path="${playwright_node_path:-/usr/lib/node_modules}"',
    'PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright}" \\',
    'NODE_PATH="$playwright_node_path${NODE_PATH:+:$NODE_PATH}" \\',
    'ONECEO_PREFLIGHT_ROOT_URL="$root_url" ONECEO_PREFLIGHT_SCREENSHOT_PATH="$screenshot_path" node "$browser_script" > "$browser_log" 2>&1',
    'browser_status=$?',
    'if [ "$browser_status" -eq 0 ]; then',
    '  write_report passed browser_smoke "Local build, start, healthcheck, and Playwright smoke passed." playwright_node ""',
    '  exit 0',
    'fi',
    'if grep -E "__ONECEO_EMPTY_BODY__|__ONECEO_BROWSER_ERROR_TEXT__|__ONECEO_APP_RUNTIME_ERROR__|__ONECEO_APP_NOT_MOUNTED__|__ONECEO_PAGE_ERROR__|__ONECEO_CONSOLE_ERROR__" "$browser_log" >/dev/null 2>&1; then',
    '  write_report failed browser_smoke "Playwright smoke test found a browser runtime or render failure before Railway deployment." playwright_node workspace_code',
    '  exit 0',
    'fi',
    'if command -v playwright >/dev/null 2>&1; then',
    '  PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright}" playwright screenshot --timeout=15000 "$root_url" "$screenshot_path" >> "$browser_log" 2>&1',
    '  cli_status=$?',
    '  if [ "$cli_status" -eq 0 ]; then',
    '    write_report passed browser_smoke "Local build, start, healthcheck, and Playwright CLI smoke passed." playwright_cli ""',
    '    exit 0',
    '  fi',
    'fi',
    'if grep -E "__ONECEO_PLATFORM_CAPABILITY__|Cannot find module .playwright.|Executable doesn.t exist|Looks like Playwright was just installed|chromium executable missing|chromium browser not installed|browsers path missing" "$browser_log" >/dev/null 2>&1; then',
    '  write_report failed browser_smoke "Playwright smoke test failed because sandbox Playwright capability is unavailable before Railway deployment." playwright_node platform_capability',
    '  exit 0',
    'fi',
    'write_report failed browser_smoke "Playwright smoke test failed before Railway deployment." playwright_node workspace_code',
    'exit 0',
  ].join('\n');
}

export async function runTaskSessionDeploymentLocalPreflight(input: {
  orchestratorSessionId: string;
  workspaceRoot: string;
  baseline: DeploymentTemplateBaselineData;
}): Promise<TaskSessionDeploymentLocalPreflightReport> {
  if (!isTaskSessionDeploymentLocalPreflightSupported(input.baseline)) {
    return buildSkippedReport({
      workspaceRoot: input.workspaceRoot,
      baseline: input.baseline,
      message:
        'Local deployment preflight skipped because this manifest stack is outside the current node/js/html fast lane.',
    });
  }

  const buildCommand = asText(input.baseline.buildCommand);
  const startCommand = asText(input.baseline.startCommand);
  const healthcheckPath = normalizeHealthcheckPath(input.baseline.healthcheckPath);
  const port = 18_080 + Math.floor(Math.random() * 1000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fallback: TaskSessionDeploymentLocalPreflightReport = {
    status: 'failed',
    phase: 'build',
    checkedAt: new Date().toISOString(),
    workspaceRoot: input.workspaceRoot,
    buildCommand,
    startCommand,
    healthcheckPath,
    port,
    rootUrl: `http://127.0.0.1:${port}/`,
    healthUrl: `http://127.0.0.1:${port}${healthcheckPath}`,
    message: 'Local deployment preflight did not return a structured report.',
  };

  try {
    const result: any = await e2bConnector.runCommand(
      input.orchestratorSessionId,
      buildPreflightScript({
        buildCommand,
        startCommand,
        healthcheckPath,
        port,
        runId,
      }),
      {
        cwd: input.workspaceRoot,
        timeoutMs: 180_000,
      }
    );
    const report = parsePreflightReport(asText(result?.stdout || result?.output), fallback);
    return {
      ...report,
      workspaceRoot: input.workspaceRoot,
      installOutput: truncate(report.installOutput),
      buildOutput: truncate(report.buildOutput),
      serverOutput: truncate(report.serverOutput),
      browserOutput: truncate(report.browserOutput),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...fallback,
      phase: 'build',
      message: `Local deployment preflight command failed: ${message}`,
    };
  }
}

export function isTaskSessionDeploymentLocalPreflightPlatformFailure(
  report: Pick<TaskSessionDeploymentLocalPreflightReport, 'failureKind' | 'browserOutput' | 'message'>
) {
  if (report.failureKind === 'platform_capability') {
    return true;
  }
  const text = [report.message, report.browserOutput].map((item) => asText(item)).filter(Boolean).join('\n');
  return (
    text.includes('__ONECEO_PLATFORM_CAPABILITY__') ||
    /Cannot find module ['"]playwright['"]/i.test(text) ||
    /Executable doesn't exist/i.test(text) ||
    /Looks like Playwright was just installed/i.test(text) ||
    /chromium executable missing/i.test(text) ||
    /chromium browser not installed/i.test(text) ||
    /browsers path missing/i.test(text)
  );
}

export function formatTaskSessionDeploymentLocalPreflightFailure(
  report: TaskSessionDeploymentLocalPreflightReport
) {
  const details = [
    report.message,
    report.phase ? `phase=${report.phase}` : '',
    report.buildCommand ? `build=${report.buildCommand}` : '',
    report.startCommand ? `start=${report.startCommand}` : '',
    report.healthUrl ? `health=${report.healthUrl}` : '',
    report.installOutput ? `installLog=${report.installOutput}` : '',
    report.buildOutput ? `buildLog=${report.buildOutput}` : '',
    report.serverOutput ? `serverLog=${report.serverOutput}` : '',
    report.browserOutput ? `browserLog=${report.browserOutput}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return `本地运行验收未通过，已停止 Railway 发布。\n${details}`;
}
