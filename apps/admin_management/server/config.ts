import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  ADMIN_MANAGEMENT_PORT: z.coerce.number().int().positive().default(9310),
  KVM_ORCHESTRATOR_URL: z.string().url().default('http://localhost:8500'),
  KVM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  KVM_REQUEST_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  ADMIN_MANAGEMENT_CORS_ORIGIN: z.string().default('http://localhost:5174'),
});

const parsed = envSchema.parse(process.env);

export const config = {
  port: parsed.ADMIN_MANAGEMENT_PORT,
  corsOrigin: parsed.ADMIN_MANAGEMENT_CORS_ORIGIN,
  kvmOrchestratorUrl: parsed.KVM_ORCHESTRATOR_URL.replace(/\/+$/, ''),
  kvmRequestTimeoutMs: parsed.KVM_REQUEST_TIMEOUT_MS,
  kvmRequestRetries: parsed.KVM_REQUEST_RETRIES,
};
