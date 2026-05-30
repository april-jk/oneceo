import express from "express";
import httpProxy from "http-proxy";
import fs from "node:fs";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildRobotsTxt,
  buildSitemapXml,
  isIndexablePath,
  resolveSiteOrigin,
} from "../shared/site-seo";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXCLUSIVE_ENV_PREFIXES = [
  "ONECEO_",
  "AGENT_",
  "LLM_",
  "OPENCODE_",
  "NOTION_",
  "KVM_",
  "CONNECTOR_",
  "WEB_BFF_",
  "OSAC_",
  "SUPABASE_",
  "OPENAI_",
  "ANTHROPIC_",
  "GOOGLE_",
  "GEMINI_",
  "AZURE_OPENAI_",
  "REDIS_",
  "DATABASE_",
  "FRONTEND_",
  "ADMIN_",
  "CORS_",
  "SESSION_",
  "JWT_",
  "E2B_",
  "VITE_",
] as const;
const EXCLUSIVE_ENV_KEYS = new Set([
  "DATABASE_URL",
  "REDIS_URL",
  "PORT",
  "API_HOST",
  "FRONTEND_URL",
  "ONECEO_API_URL",
  "WEB_BFF_API_TARGET",
  "OSAC_LLM_PROXY_PORT",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
]);

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const equalIndex = trimmed.indexOf("=");
  if (equalIndex <= 0) return null;
  const key = trimmed.slice(0, equalIndex).trim();
  if (!key) return null;
  let value = trimmed.slice(equalIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function isExclusiveBusinessEnvKey(key: string): boolean {
  if (EXCLUSIVE_ENV_KEYS.has(key)) return true;
  return EXCLUSIVE_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function clearExclusiveBusinessEnvKeys(): void {
  for (const key of Object.keys(process.env)) {
    if (!isExclusiveBusinessEnvKey(key)) continue;
    delete process.env[key];
  }
}

function loadWebEnv(): string | null {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "apps", "web", ".env"),
    path.resolve(process.cwd(), "apps", ".env"),
    path.resolve(process.cwd(), "..", ".env"),
    path.resolve(process.cwd(), "..", "web", ".env"),
    path.resolve(process.cwd(), "..", "..", "apps", "web", ".env"),
    path.resolve(process.cwd(), "..", "..", "apps", ".env"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    clearExclusiveBusinessEnvKeys();
    const raw = fs.readFileSync(candidate, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      process.env[parsed.key] = parsed.value;
    }
    process.env.ONECEO_ENV_SOURCE = "dotenv";
    return candidate;
  }

  process.env.ONECEO_ENV_SOURCE = "process_env";
  return null;
}

const loadedWebEnv = loadWebEnv();
if (!loadedWebEnv) {
  console.warn("[WEB_ENV] 未找到 Web .env，继续使用系统环境变量");
} else {
  console.log(`[WEB_ENV] 检测到 .env，已进入 dotenv 模式: ${loadedWebEnv}`);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveFrontendOrigin(): string {
  const explicit = (process.env.FRONTEND_URL || "").trim();
  return resolveSiteOrigin(explicit || "https://oneceo.ai");
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
  const frontendOrigin = resolveFrontendOrigin();
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
      res.end(
        JSON.stringify({ success: false, message: "Upstream api unavailable" }),
      );
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
      frontendOrigin,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain; charset=utf-8");
    res.send(buildRobotsTxt(frontendOrigin));
  });

  app.get("/sitemap.xml", (_req, res) => {
    res.type("application/xml; charset=utf-8");
    res.send(buildSitemapXml(frontendOrigin));
  });

  app.use("/api", (req, res) => {
    req.url = req.originalUrl || req.url;
    proxy.web(req, res, { target: apiProxyTarget });
  });

  app.use("/socket.io", (req, res) => {
    req.url = req.originalUrl || req.url;
    proxy.web(req, res, { target: apiProxyTarget });
  });

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (req, res) => {
    if (!isIndexablePath(req.path || "/")) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
    }
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
