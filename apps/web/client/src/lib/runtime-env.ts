export type OneceoRuntimeEnv = "dev" | "staging" | "product";

export function normalizeRuntimeEnv(value: unknown): OneceoRuntimeEnv {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "dev" || normalized === "staging" || normalized === "product") {
    return normalized;
  }
  return "product";
}

export function getRuntimeEnv(): OneceoRuntimeEnv {
  return normalizeRuntimeEnv(import.meta.env.VITE_RUNTIME_ENV);
}

export function isDevRuntime() {
  return getRuntimeEnv() === "dev";
}
