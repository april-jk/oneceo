function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export type OneceoRuntimeEnv = 'dev' | 'staging' | 'product';

export type RuntimeDebugCapabilities = {
  skipEmailVerificationOnRegister: boolean;
  allowDebugEndpoints: boolean;
  verboseSecurityLogs: boolean;
};

const VALID_RUNTIME_ENVS: OneceoRuntimeEnv[] = ['dev', 'staging', 'product'];

function parseRuntimeEnv(rawValue: unknown): OneceoRuntimeEnv {
  const normalized = asText(rawValue).toLowerCase();
  if ((VALID_RUNTIME_ENVS as string[]).includes(normalized)) {
    return normalized as OneceoRuntimeEnv;
  }
  if (normalized) {
    console.warn(`[RUNTIME_ENV] invalid ONECEO_RUNTIME_ENV="${normalized}", fallback to "product"`);
  }
  return 'product';
}

function parseDebugFlags(rawValue: unknown): Set<string> {
  const normalized = asText(rawValue).toLowerCase();
  if (!normalized) return new Set();
  return new Set(
    normalized
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

const runtimeEnv = parseRuntimeEnv(process.env.ONECEO_RUNTIME_ENV);
const debugFlags = parseDebugFlags(process.env.ONECEO_DEBUG_FLAGS);

function hasDebugFlag(flag: string) {
  return runtimeEnv === 'dev' && debugFlags.has(flag);
}

const runtimeDebugCapabilities: RuntimeDebugCapabilities = {
  skipEmailVerificationOnRegister:
    runtimeEnv === 'dev' || hasDebugFlag('skip_email_verification'),
  allowDebugEndpoints: runtimeEnv === 'dev' || hasDebugFlag('allow_debug_endpoints'),
  verboseSecurityLogs: runtimeEnv === 'dev' || hasDebugFlag('verbose_security_logs'),
};

export const runtimeEnvConfig = {
  runtimeEnv,
  debugFlags: Array.from(debugFlags),
  capabilities: runtimeDebugCapabilities,
};

