export interface OsacConfig {
  authToken: string | null;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
}

function toNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const osacConfig: OsacConfig = {
  authToken: process.env.OSAC_AUTH_TOKEN || process.env.OSAC_PSK || null,
  connectTimeoutMs: toNumber(process.env.OSAC_CONNECT_TIMEOUT_MS, 8000),
  requestTimeoutMs: toNumber(process.env.OSAC_REQUEST_TIMEOUT_MS, 20000),
};
