import { randomUUID } from 'node:crypto';

export const LLM_PROXY_INTERNAL_OVERRIDE_HEADER = 'x-oneceo-internal-llm-override-token';

const internalOverrideToken = process.env.LLM_PROXY_INTERNAL_OVERRIDE_TOKEN || randomUUID();

export function getLlmProxyInternalOverrideToken(): string {
  return internalOverrideToken;
}

export function isValidLlmProxyInternalOverrideToken(value: unknown): boolean {
  return typeof value === 'string' && value === internalOverrideToken;
}
