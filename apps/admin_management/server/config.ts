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

const envSchema = z.object({
  ADMIN_MANAGEMENT_PORT: z.coerce.number().int().positive().default(9310),
  KVM_ORCHESTRATOR_URL: z.string().url().default('http://192.168.10.128:8500'),
  KVM_ORCH_TOKEN: z.string().default(''),
  KVM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  KVM_REQUEST_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  HOST_METRICS_CACHE_MS: z.coerce.number().int().min(10000).max(900000).default(90000),
  HOST_METRICS_CONCURRENCY: z.coerce.number().int().min(1).max(12).default(4),
  ONECEO_API_URL: z.string().url().default('http://192.168.10.128:4000'),
  ONECEO_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  ONECEO_REQUEST_RETRIES: z.coerce.number().int().min(0).max(5).default(1),
  ADMIN_MANAGEMENT_CORS_ORIGIN: z.string().default('http://localhost:5174'),
});

const parsed = envSchema.parse(process.env);

export const config = {
  port: parsed.ADMIN_MANAGEMENT_PORT,
  corsOrigin: parsed.ADMIN_MANAGEMENT_CORS_ORIGIN,
  kvmOrchestratorUrl: parsed.KVM_ORCHESTRATOR_URL.replace(/\/+$/, ''),
  kvmOrchToken: parsed.KVM_ORCH_TOKEN,
  kvmRequestTimeoutMs: parsed.KVM_REQUEST_TIMEOUT_MS,
  kvmRequestRetries: parsed.KVM_REQUEST_RETRIES,
  hostMetricsCacheMs: parsed.HOST_METRICS_CACHE_MS,
  hostMetricsConcurrency: parsed.HOST_METRICS_CONCURRENCY,
  oneceoApiUrl: parsed.ONECEO_API_URL.replace(/\/+$/, ''),
  oneceoRequestTimeoutMs: parsed.ONECEO_REQUEST_TIMEOUT_MS,
  oneceoRequestRetries: parsed.ONECEO_REQUEST_RETRIES,
};
