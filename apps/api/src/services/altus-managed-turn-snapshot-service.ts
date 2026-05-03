import type { ManagedMcpProvider, ManagedSkillContext } from './altus-managed-shared';
import { buildManagedToolDefinitionsWithMcp } from './altus-managed-shared';
import { hashStableJson } from './altus-managed-context-manifest-service';

export type AltusManagedTurnSnapshot = {
  sessionId: string;
  runId?: string | null;
  model?: string | null;
  provider?: string | null;
  createdAt: string;
  toolDefinitionsHash: string;
  mcpProviderSnapshotHash: string;
  skillSnapshotHash: string;
  mcpProviders: Array<{
    providerId: string;
    connectorKey?: string | null;
    toolNames: string[];
  }>;
  skills: Array<{
    sourceType: 'platform' | 'custom';
    skillId: string;
    revisionId: string;
    slug: string;
  }>;
};

export class AltusManagedTurnSnapshotService {
  createReadOnlySnapshot(input: {
    sessionId: string;
    runId?: string | null;
    model?: string | null;
    provider?: string | null;
    mcpProviders?: ManagedMcpProvider[];
    skills?: ManagedSkillContext[];
  }): AltusManagedTurnSnapshot {
    const mcpProviders = input.mcpProviders || [];
    const skills = input.skills || [];
    const toolDefinitions = buildManagedToolDefinitionsWithMcp({ mcpProviders });
    return {
      sessionId: input.sessionId,
      runId: input.runId || null,
      model: input.model || null,
      provider: input.provider || null,
      createdAt: new Date().toISOString(),
      toolDefinitionsHash: hashStableJson(toolDefinitions),
      mcpProviderSnapshotHash: hashStableJson(mcpProviders),
      skillSnapshotHash: hashStableJson(skills),
      mcpProviders: mcpProviders.map((provider) => ({
        providerId: provider.providerId,
        connectorKey: provider.connectorKey || null,
        toolNames: provider.tools.map((tool) => tool.toolName).sort(),
      })),
      skills: skills.map((skill) => ({
        sourceType: skill.sourceType,
        skillId: skill.skillId,
        revisionId: skill.revisionId,
        slug: skill.slug,
      })),
    };
  }
}

export const altusManagedTurnSnapshotService = new AltusManagedTurnSnapshotService();
