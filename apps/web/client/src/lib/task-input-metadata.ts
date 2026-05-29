import type { TaskCreationPlatformSkill } from "@/lib/task-creation-client";
import {
  DEFAULT_AGENT_MODEL_TIER,
  normalizeAvailableAgentModelTier,
  type AgentModelTier,
} from "@/lib/agent-model-tiers";

export type TaskCreationMcpReference = {
  key: string;
  name: string;
  category: string;
};

export type ManagedTaskInputMetadata = {
  skills?: TaskCreationPlatformSkill[];
  mcpReferences?: TaskCreationMcpReference[];
  modelTier?: AgentModelTier;
  originalInput: string;
};

export function buildManagedTaskInputMetadata(input: {
  originalInput: string;
  skills: TaskCreationPlatformSkill[];
  mcpReferences: TaskCreationMcpReference[];
  fileCount: number;
  modelTier?: AgentModelTier;
}): ManagedTaskInputMetadata | undefined {
  const fileCount = Number.isFinite(input.fileCount)
    ? Math.max(0, Math.floor(input.fileCount))
    : 0;
  const hasReferences =
    fileCount > 0 || input.skills.length > 0 || input.mcpReferences.length > 0;
  const modelTier = normalizeAvailableAgentModelTier(
    input.modelTier || DEFAULT_AGENT_MODEL_TIER,
  );

  if (!hasReferences && !modelTier) {
    return undefined;
  }

  return {
    ...(input.skills.length ? { skills: input.skills } : {}),
    ...(input.mcpReferences.length
      ? { mcpReferences: input.mcpReferences }
      : {}),
    modelTier,
    originalInput: input.originalInput,
  };
}
