export type AgentModelTier = "lite" | "pro" | "max";

export const DEFAULT_AGENT_MODEL_TIER: AgentModelTier = "lite";

// Keep public task entrypoints aligned with the default membership entitlement.
// When user-specific entitlement data is exposed to the frontend, widen this list from that source.
export const AVAILABLE_AGENT_MODEL_TIERS = ["lite"] as const;

export type AvailableAgentModelTier = (typeof AVAILABLE_AGENT_MODEL_TIERS)[number];

export const AGENT_MODEL_TIER_LABELS: Record<AgentModelTier, string> = {
  lite: "Agent Lite",
  pro: "Agent Pro",
  max: "Agent Max",
};

export function normalizeAgentModelTier(value: unknown): AgentModelTier {
  return value === "lite" || value === "pro" || value === "max"
    ? value
    : DEFAULT_AGENT_MODEL_TIER;
}

export function normalizeAvailableAgentModelTier(
  value: unknown,
): AvailableAgentModelTier {
  const tier = normalizeAgentModelTier(value);
  return AVAILABLE_AGENT_MODEL_TIERS.includes(tier as AvailableAgentModelTier)
    ? (tier as AvailableAgentModelTier)
    : (DEFAULT_AGENT_MODEL_TIER as AvailableAgentModelTier);
}
