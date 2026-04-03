import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

const envCandidates = [
  path.resolve(process.cwd(), '..', '.env'),
  path.resolve(process.cwd(), 'apps', '.env'),
  path.resolve(process.cwd(), '..', '..', 'apps', '.env'),
];

let loaded = false;
for (const candidate of envCandidates) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    loaded = true;
    break;
  }
}

if (!loaded) {
  dotenv.config();
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseCommaSeparatedList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isPrivateIpv4(hostname: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

const envSchema = z.object({
  ADMIN_MANAGEMENT_PORT: z.coerce.number().int().positive().default(9310),
  KVM_ORCHESTRATOR_URL: z.string().url().default('http://192.168.10.128:8500'),
  KVM_ORCH_TOKEN: z.string().default(''),
  KVM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  KVM_REQUEST_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  HOST_METRICS_CACHE_MS: z.coerce.number().int().min(10000).max(900000).default(90000),
  HOST_METRICS_CONCURRENCY: z.coerce.number().int().min(1).max(12).default(4),
  ONECEO_API_URL: z.string().url().default('http://127.0.0.1:4000'),
  ONECEO_INTERNAL_TOKEN: z.string().default(''),
  ONECEO_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  ONECEO_REQUEST_RETRIES: z.coerce.number().int().min(0).max(5).default(1),
  ADMIN_MANAGEMENT_CORS_ORIGIN: z.string().default('http://localhost:5174'),
  E2B_API_KEY: z.string().optional(),
});

const parsed = envSchema.parse(process.env);
const bindHost =
  asText(process.env.ADMIN_MANAGEMENT_BIND_HOST) ||
  asText(process.env.ADMIN_MANAGEMENT_HOST) ||
  '0.0.0.0';
const webPort = Number(asText(process.env.ADMIN_MANAGEMENT_WEB_PORT) || asText(process.env.VITE_DEV_PORT) || '5174');
const explicitCorsOrigins = parseCommaSeparatedList(
  asText(process.env.ADMIN_MANAGEMENT_CORS_ORIGINS) || asText(process.env.ADMIN_MANAGEMENT_CORS_ORIGIN)
);
const defaultCorsOrigins = [`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`];
const allowedCorsOrigins = Array.from(new Set([...defaultCorsOrigins, ...explicitCorsOrigins]));

export const config = {
  host: bindHost,
  port: parsed.ADMIN_MANAGEMENT_PORT,
  webPort,
  corsOrigins: allowedCorsOrigins,
  kvmOrchestratorUrl: parsed.KVM_ORCHESTRATOR_URL.replace(/\/+$/, ''),
  kvmOrchToken: parsed.KVM_ORCH_TOKEN,
  kvmRequestTimeoutMs: parsed.KVM_REQUEST_TIMEOUT_MS,
  kvmRequestRetries: parsed.KVM_REQUEST_RETRIES,
  hostMetricsCacheMs: parsed.HOST_METRICS_CACHE_MS,
  hostMetricsConcurrency: parsed.HOST_METRICS_CONCURRENCY,
  oneceoApiUrl: parsed.ONECEO_API_URL.replace(/\/+$/, ''),
  oneceoInternalToken: parsed.ONECEO_INTERNAL_TOKEN,
  oneceoRequestTimeoutMs: parsed.ONECEO_REQUEST_TIMEOUT_MS,
  oneceoRequestRetries: parsed.ONECEO_REQUEST_RETRIES,
  e2bApiKey: parsed.E2B_API_KEY || '',
};

export function isAllowedCorsOrigin(origin: string | undefined) {
  if (!origin) return true;
  if (config.corsOrigins.includes(origin)) return true;

  try {
    const parsedOrigin = new URL(origin);
    if (!['http:', 'https:'].includes(parsedOrigin.protocol)) {
      return false;
    }

    const hostname = parsedOrigin.hostname;
    const port = Number(parsedOrigin.port || (parsedOrigin.protocol === 'https:' ? 443 : 80));
    if (port !== config.webPort) {
      return false;
    }

    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      isPrivateIpv4(hostname)
    );
  } catch {
    return false;
  }
}
