import { asText } from './altus-managed-shared';

export type AgentModelTier = 'lite' | 'pro' | 'max';

export type AgentRuntimeSnapshot = {
  billingTargetType: 'agent_tier';
  billingTargetKey: `agent.${AgentModelTier}`;
  tier: AgentModelTier;
  model: string;
  baseUrl: string | null;
  baseUrlHost: string | null;
  apiType: string;
  tokenState: 'configured' | 'inherited' | 'missing';
  runtimeSnapshotVersion: string;
};

export type AgentRuntimeProfile = AgentRuntimeSnapshot & {
  tokenSource: string;
};

const TIERS: AgentModelTier[] = ['lite', 'pro', 'max'];

export function normalizeAgentModelTier(value: unknown): AgentModelTier {
  const text = asText(value).toLowerCase();
  return (TIERS as string[]).includes(text) ? (text as AgentModelTier) : 'pro';
}

function env(name: string) {
  return asText(process.env[name]);
}

function hostOf(url: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || null;
  }
}

export function toAgentRuntimeSnapshot(profile: AgentRuntimeProfile): AgentRuntimeSnapshot {
  const { tokenSource: _tokenSource, ...snapshot } = profile;
  return snapshot;
}

export function resolveAgentRuntimeProfile(input: { tier: AgentModelTier; needsVision?: boolean }): AgentRuntimeProfile {
  const tier = normalizeAgentModelTier(input.tier);
  const suffix = tier.toUpperCase();
  const model = input.needsVision
    ? env('ALTUS_MANAGED_VISION_MODEL') || env(`ALTUS_MANAGED_MODEL_${suffix}`)
    : env(`ALTUS_MANAGED_MODEL_${suffix}`);
  const resolvedModel = model || env('ALTUS_MANAGED_MODEL') || env('AGENT_OPENAI_MODEL') || env('OPENAI_MODEL') || 'claude-haiku-4-5-20251001';
  const tierBaseUrl = env(`ALTUS_MANAGED_BASE_URL_${suffix}`);
  const fallbackBaseUrl = env('LLM_PROXY_UPSTREAM_BASE_URL') || env('OPENAI_BASE_URL');
  const tierApiKey = env(`ALTUS_MANAGED_API_KEY_${suffix}`);
  const fallbackApiKey = env('LLM_PROXY_UPSTREAM_API_KEY') || env('OPENAI_API_KEY');
  const tierApiType = env(`ALTUS_MANAGED_API_TYPE_${suffix}`).toLowerCase();
  const tierProfileUsable = !tierApiType || tierApiType === 'openai';
  const apiType = tierProfileUsable ? (tierApiType || env('LLM_PROXY_UPSTREAM_API_TYPE') || 'openai') : (env('LLM_PROXY_UPSTREAM_API_TYPE') || 'openai');
  const resolvedBaseUrl = tierProfileUsable ? (tierBaseUrl || fallbackBaseUrl) : fallbackBaseUrl;
  const fallbackTokenSource = env('LLM_PROXY_UPSTREAM_API_KEY')
    ? 'LLM_PROXY_UPSTREAM_API_KEY'
    : env('OPENAI_API_KEY')
      ? 'OPENAI_API_KEY'
      : `ALTUS_MANAGED_API_KEY_${suffix}`;
  const resolvedTokenSource = tierProfileUsable && tierApiKey
    ? `ALTUS_MANAGED_API_KEY_${suffix}`
    : fallbackTokenSource;
  const resolvedTokenState = tierProfileUsable && tierApiKey ? 'configured' : (fallbackApiKey ? 'inherited' : 'missing');
  return {
    billingTargetType: 'agent_tier',
    billingTargetKey: `agent.${tier}`,
    tier,
    model: resolvedModel,
    baseUrl: resolvedBaseUrl || null,
    baseUrlHost: hostOf(resolvedBaseUrl),
    apiType,
    tokenSource: resolvedTokenSource,
    tokenState: resolvedTokenState,
    runtimeSnapshotVersion: 'agent-runtime-v1',
  };
}
