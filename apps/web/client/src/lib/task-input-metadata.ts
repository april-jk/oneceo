import type { TaskCreationPlatformSkill } from "@/lib/task-creation-client";

export type TaskCreationMcpReference = {
  key: string;
  name: string;
  category: string;
};

export type ManagedTaskInputMetadata = {
  skills?: TaskCreationPlatformSkill[];
  mcpReferences?: TaskCreationMcpReference[];
  originalInput: string;
};

export function buildManagedTaskInputMetadata(input: {
  originalInput: string;
  skills: TaskCreationPlatformSkill[];
  mcpReferences: TaskCreationMcpReference[];
  fileCount: number;
}): ManagedTaskInputMetadata | undefined {
  const fileCount = Number.isFinite(input.fileCount)
    ? Math.max(0, Math.floor(input.fileCount))
    : 0;
  const hasReferences =
    fileCount > 0 || input.skills.length > 0 || input.mcpReferences.length > 0;

  if (!hasReferences) {
    return undefined;
  }

  return {
    ...(input.skills.length ? { skills: input.skills } : {}),
    ...(input.mcpReferences.length
      ? { mcpReferences: input.mcpReferences }
      : {}),
    originalInput: input.originalInput,
  };
}
