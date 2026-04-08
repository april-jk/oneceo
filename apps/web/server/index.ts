import express from "express";
import httpProxy from "http-proxy";
import fs from "node:fs";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const equalIndex = trimmed.indexOf('=');
  if (equalIndex <= 0) return null;
  const key = trimmed.slice(0, equalIndex).trim();
  if (!key) return null;
  let value = trimmed.slice(equalIndex + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function loadWebEnv(): string | null {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'apps', 'web', '.env'),
    path.resolve(process.cwd(), 'apps', '.env'),
    path.resolve(process.cwd(), '..', '.env'),
    path.resolve(process.cwd(), '..', 'web', '.env'),
    path.resolve(process.cwd(), '..', '..', 'apps', 'web', '.env'),
    path.resolve(process.cwd(), '..', '..', 'apps', '.env'),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const raw = fs.readFileSync(candidate, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      // .env has higher priority than injected env vars.
      process.env[parsed.key] = parsed.value;
    }
    return candidate;
  }

  return null;
}

const loadedWebEnv = loadWebEnv();
if (!loadedWebEnv) {
  console.warn('[WEB_ENV] 未找到 Web .env，继续使用系统环境变量');
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveApiProxyTarget(): string {
  const explicitTarget = (process.env.WEB_BFF_API_TARGET || "").trim();
  if (explicitTarget) {
    return trimTrailingSlash(explicitTarget);
  }

  const oneceoApiUrl = (process.env.ONECEO_API_URL || "").trim();
  if (oneceoApiUrl) {
    return trimTrailingSlash(oneceoApiUrl);
  }

  return "http://127.0.0.1:4000";
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  const apiProxyTarget = resolveApiProxyTarget();
  const proxy = httpProxy.createProxyServer({
    target: apiProxyTarget,
    changeOrigin: true,
    ws: true,
    xfwd: true,
    secure: false,
  });

  proxy.on("error", (error, req, res) => {
    const requestUrl = req.url || "unknown";
    console.error("[WEB_BFF][proxy_error]", requestUrl, error);

    if (res && "writeHead" in res && !res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ success: false, message: "Upstream api unavailable" }));
    }
  });

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "oneceo-web-bff",
      apiProxyTarget,
      timestamp: new Date().toISOString(),
    });
  });

  app.use("/api", (req, res) => {
    proxy.web(req, res, { target: apiProxyTarget });
  });

  app.use("/socket.io", (req, res) => {
    proxy.web(req, res, { target: apiProxyTarget });
  });

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    console.log(`[WEB_BFF] proxy target: ${apiProxyTarget}`);
  });

  server.on("upgrade", (req, socket, head) => {
    const url = req.url || "";
    if (url.startsWith("/ws/task-creation") || url.startsWith("/socket.io")) {
      proxy.ws(req, socket, head, { target: apiProxyTarget });
      return;
    }
    socket.destroy();
  });
}

startServer().catch(console.error);
