function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildVercelStdioBridgeCommand(): string {
  return [
    "const readline = require('node:readline');",
    "const endpoint = (process.env.VERCEL_INTERNAL_MCP_URL || '').trim();",
    "const internalToken = (process.env.VERCEL_INTERNAL_TOKEN || '').trim();",
    "const runtimeAuth = (process.env.VERCEL_BRIDGE_RUNTIME_AUTH || '').trim();",
    "const timeoutRaw = Number(process.env.VERCEL_BRIDGE_TIMEOUT_MS || '30000');",
    "const timeoutMs = Number.isFinite(timeoutRaw) ? Math.max(1000, Math.floor(timeoutRaw)) : 30000;",
    "if (!endpoint) {",
    "  process.stderr.write('[VERCEL_BRIDGE] missing VERCEL_INTERNAL_MCP_URL\\n');",
    "  process.exit(1);",
    "}",
    "if (!internalToken) {",
    "  process.stderr.write('[VERCEL_BRIDGE] missing VERCEL_INTERNAL_TOKEN\\n');",
    "  process.exit(1);",
    "}",
    "if (!runtimeAuth) {",
    "  process.stderr.write('[VERCEL_BRIDGE] missing VERCEL_BRIDGE_RUNTIME_AUTH\\n');",
    "  process.exit(1);",
    "}",
    "let mcpSessionId = '';",
    "const logEvent = (tag, payload) => {",
    "  try {",
    "    process.stderr.write(`${new Date().toISOString()} ${tag} ${JSON.stringify(payload)}\\n`);",
    "  } catch {",
    "    // best effort logging only",
    "  }",
    "};",
    "const writeMessage = (message) => process.stdout.write(`${JSON.stringify(message)}\\n`);",
    "const buildHeaders = (method) => {",
    "  const headers = {",
    "    'Content-Type': 'application/json',",
    "    Accept: 'application/json, text/event-stream',",
    "    'x-oneceo-internal-token': internalToken,",
    "    'x-oneceo-connector-runtime-auth': runtimeAuth,",
    "  };",
    "  if (mcpSessionId && method !== 'initialize') {",
    "    headers['Mcp-Session-Id'] = mcpSessionId;",
    "  }",
    "  return headers;",
    "};",
    "const sendRpc = async (payload) => {",
    "  const method = payload && typeof payload === 'object' ? String(payload.method || '') : '';",
    "  const requestId = payload && typeof payload === 'object' ? payload.id : undefined;",
    "  const startedAt = Date.now();",
    "  logEvent('[VERCEL_BRIDGE_UPSTREAM_REQUEST]', { method, hasId: requestId !== undefined && requestId !== null, hasSessionId: Boolean(mcpSessionId) });",
    "  const controller = new AbortController();",
    "  const timer = setTimeout(() => controller.abort(), timeoutMs);",
    "  try {",
    "    const response = await fetch(endpoint, {",
    "      method: 'POST',",
    "      headers: buildHeaders(method),",
    "      body: JSON.stringify(payload),",
    "      signal: controller.signal,",
    "    });",
    "    const nextSessionId = response.headers.get('mcp-session-id') || response.headers.get('Mcp-Session-Id') || '';",
    "    if (nextSessionId && nextSessionId !== mcpSessionId) {",
    "      mcpSessionId = nextSessionId;",
    "      logEvent('[VERCEL_BRIDGE_SESSION_UPDATED]', { method, hasSessionId: true });",
    "    }",
    "    const bodyText = await response.text();",
    "    if (!response.ok) {",
    "      const summary = bodyText.slice(0, 300);",
    "      throw new Error(`Vercel MCP request failed: HTTP ${response.status}${summary ? ` ${summary}` : ''}`);",
    "    }",
    "    logEvent('[VERCEL_BRIDGE_UPSTREAM_RESPONSE]', { method, hasId: requestId !== undefined && requestId !== null, durationMs: Date.now() - startedAt, statusCode: response.status, hasSessionId: Boolean(mcpSessionId) });",
    "    if (!bodyText.trim()) {",
    "      return null;",
    "    }",
    "    try {",
    "      return JSON.parse(bodyText);",
    "    } catch {",
    "      const summary = bodyText.slice(0, 300);",
    "      throw new Error(`Vercel MCP returned non-JSON payload: ${summary}`);",
    "    }",
    "  } finally {",
    "    clearTimeout(timer);",
    "  }",
    "};",
    "const respondError = (id, message) => {",
    "  if (id === undefined || id === null) return;",
    "  writeMessage({",
    "    jsonrpc: '2.0',",
    "    id,",
    "    error: {",
    "      code: -32000,",
    "      message,",
    "    },",
    "  });",
    "};",
    "const handleLine = async (line) => {",
    "  if (!line || !line.trim()) return;",
    "  let request;",
    "  try {",
    "    request = JSON.parse(line);",
    "  } catch {",
    "    return;",
    "  }",
    "  const requestId = request && typeof request === 'object' ? request.id : undefined;",
    "  const method = request && typeof request === 'object' ? String(request.method || '') : '';",
    "  const startedAt = Date.now();",
    "  try {",
    "    const response = await sendRpc(request);",
    "    if (response === null || response === undefined) return;",
    "    if (Array.isArray(response)) {",
    "      for (const item of response) {",
    "        writeMessage(item);",
    "      }",
    "      return;",
    "    }",
    "    writeMessage(response);",
    "  } catch (error) {",
    "    try {",
    "      logEvent('[VERCEL_BRIDGE_UPSTREAM_ERROR]', { method, hasId: requestId !== undefined && requestId !== null, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error), hasSessionId: Boolean(mcpSessionId) });",
    "    } catch {",
    "      // keep bridge alive even if logging fails",
    "    }",
    "    const message = error instanceof Error ? error.message : String(error);",
    "    respondError(requestId, message);",
    "  }",
    "};",
    "const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });",
    "let queue = Promise.resolve();",
    "input.on('line', (line) => {",
    "  queue = queue.then(() => handleLine(line)).catch(() => undefined);",
    "});",
    "input.on('close', () => process.exit(0));",
  ].join('\n');
}

export function buildVercelBridgeEnvironment(input: {
  mcpUrl: string;
  internalToken: string;
  runtimeAuth: string;
  timeoutMs?: number;
  proxyEnabled?: boolean;
}): Record<string, string> {
  const mcpUrl = asText(input.mcpUrl);
  if (!mcpUrl) {
    throw new Error('Vercel 连接器缺少 internal MCP URL');
  }

  const internalToken = asText(input.internalToken);
  if (!internalToken) {
    throw new Error('ONECEO_INTERNAL_TOKEN 未配置，无法启动 Vercel bridge');
  }

  const runtimeAuth = asText(input.runtimeAuth);
  if (!runtimeAuth) {
    throw new Error('Vercel bridge 缺少运行时鉴权上下文');
  }

  const timeoutMs = Number.isFinite(input.timeoutMs)
    ? Math.max(1000, Math.floor(Number(input.timeoutMs)))
    : 30000;

  const env: Record<string, string> = {
    VERCEL_INTERNAL_MCP_URL: mcpUrl,
    VERCEL_INTERNAL_TOKEN: internalToken,
    VERCEL_BRIDGE_RUNTIME_AUTH: runtimeAuth,
    VERCEL_BRIDGE_TIMEOUT_MS: String(timeoutMs),
  };

  const proxyEnabled = input.proxyEnabled !== false;
  if (!proxyEnabled) {
    return env;
  }

  const httpProxy = asText(process.env.HTTP_PROXY || process.env.http_proxy);
  const httpsProxy = asText(process.env.HTTPS_PROXY || process.env.https_proxy) || httpProxy;
  const noProxy = asText(process.env.NO_PROXY || process.env.no_proxy);

  if (httpProxy) {
    env.HTTP_PROXY = httpProxy;
    env.http_proxy = httpProxy;
  }
  if (httpsProxy) {
    env.HTTPS_PROXY = httpsProxy;
    env.https_proxy = httpsProxy;
  }
  if (noProxy) {
    env.NO_PROXY = noProxy;
    env.no_proxy = noProxy;
  }

  return env;
}
