import type { ManagedMcpProvider, ManagedSkillCatalogEntry, ManagedSkillContext } from './altus-managed-shared';
import { asText, buildManagedMcpToolName, pickObject } from './altus-managed-shared';
import { hashStableJson } from './altus-managed-context-manifest-service';

export type ManagedDynamicContextBlockType = 'skill' | 'mcp' | 'attachment' | 'memory';

export type ManagedDynamicContextBlock = {
  type: ManagedDynamicContextBlockType;
  id: string;
  hash: string;
  priority: number;
  visibility: 'tool_runtime' | 'model_context' | 'next_turn_delta' | 'diagnostic';
  payload: Record<string, unknown>;
};

function block(input: Omit<ManagedDynamicContextBlock, 'hash'>): ManagedDynamicContextBlock {
  return {
    ...input,
    hash: hashStableJson({
      type: input.type,
      id: input.id,
      visibility: input.visibility,
      payload: input.payload,
    }),
  };
}

function sortBlocks(blocks: ManagedDynamicContextBlock[]) {
  return [...blocks].sort((left, right) => {
    return (
      left.priority - right.priority ||
      left.type.localeCompare(right.type) ||
      left.id.localeCompare(right.id)
    );
  });
}

export class AltusManagedDynamicContextBlockService {
  buildSkillBlocks(input: {
    activeSkills?: ManagedSkillContext[];
    catalog?: ManagedSkillCatalogEntry[];
    autoAttachedSkills?: ManagedSkillContext[];
    toolName?: string | null;
    sandboxMaterialized?: boolean;
  }): ManagedDynamicContextBlock[] {
    const blocks: ManagedDynamicContextBlock[] = [];
    for (const skill of input.activeSkills || []) {
      blocks.push(
        block({
          type: 'skill',
          id: `skill:${skill.sourceType}:${skill.skillId}:${skill.revisionId}`,
          priority: 20,
          visibility: 'model_context',
          payload: this.skillPayload(skill, {
            activatedBy: 'selected',
            activatedAt: 'snapshot',
            toolName: null,
            sandboxMaterialized: input.sandboxMaterialized !== false,
            contextVisibility: 'model_context',
          }),
        })
      );
    }
    for (const skill of input.autoAttachedSkills || []) {
      blocks.push(
        block({
          type: 'skill',
          id: `skill-delta:${skill.sourceType}:${skill.skillId}:${skill.revisionId}:${asText(input.toolName) || 'tool'}`,
          priority: 25,
          visibility: 'next_turn_delta',
          payload: this.skillPayload(skill, {
            activatedBy: 'auto_attached',
            activatedAt: 'tool_result',
            toolName: asText(input.toolName) || null,
            sandboxMaterialized: input.sandboxMaterialized !== false,
            contextVisibility: 'next_turn_delta',
          }),
        })
      );
    }
    for (const skill of input.catalog || []) {
      blocks.push(
        block({
          type: 'skill',
          id: `skill-catalog:${skill.sourceType}:${skill.skillId}:${skill.revisionId}`,
          priority: 80,
          visibility: 'diagnostic',
          payload: this.skillPayload(skill, {
            activatedBy: 'catalog',
            activatedAt: 'snapshot',
            toolName: null,
            sandboxMaterialized: false,
            contextVisibility: 'diagnostic',
          }),
        })
      );
    }
    return sortBlocks(blocks);
  }

  buildMcpBlocks(input: {
    providers?: ManagedMcpProvider[];
    snapshotId?: string | null;
    loadedGuideRevisions?: Record<string, string | null | undefined>;
  }): ManagedDynamicContextBlock[] {
    const blocks: ManagedDynamicContextBlock[] = [];
    for (const provider of input.providers || []) {
      for (const tool of provider.tools || []) {
        const connectorKey = asText(provider.connectorKey);
        const guideRevisionId = connectorKey ? asText(input.loadedGuideRevisions?.[connectorKey]) || null : null;
        blocks.push(
          block({
            type: 'mcp',
            id: `mcp:${provider.providerId}:${tool.toolName}`,
            priority: 30,
            visibility: 'tool_runtime',
            payload: {
              providerId: provider.providerId,
              connectorKey: connectorKey || null,
              toolName: tool.toolName,
              managedToolName: buildManagedMcpToolName(provider.providerId, tool.toolName),
              snapshotId: input.snapshotId || null,
              guideLoaded: Boolean(guideRevisionId),
              guideRevisionId,
              runtimeStatus: 'available',
            },
          })
        );
      }
    }
    return sortBlocks(blocks);
  }

  buildAttachmentBlocks(history: Array<{ metadata?: unknown; messageKey?: string | null; createdAt?: unknown }>): ManagedDynamicContextBlock[] {
    const blocks: ManagedDynamicContextBlock[] = [];
    const seen = new Set<string>();
    for (const item of history || []) {
      const metadata = pickObject(item.metadata);
      const attachments = Array.isArray(metadata.attachments) ? metadata.attachments : [];
      for (const raw of attachments) {
        const attachment = pickObject(raw);
        const externalObjectKey = asText(attachment.externalObjectKey);
        const path = asText(attachment.path);
        const key = externalObjectKey || path;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        blocks.push(
          block({
            type: 'attachment',
            id: `attachment:${key}`,
            priority: 40,
            visibility: 'model_context',
            payload: {
              externalObjectKey: externalObjectKey || null,
              filename: asText(attachment.name) || path.split('/').pop() || 'attachment',
              path: path || null,
              mimeType: asText(attachment.mimeType) || null,
              messageKey: asText(item.messageKey) || asText(metadata.messageKey) || null,
              createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : asText(item.createdAt) || null,
              apiVisibility: externalObjectKey ? 'signed_url_refreshable' : 'path_ref',
              contentRef: externalObjectKey || path || null,
            },
          })
        );
      }
    }
    return sortBlocks(blocks);
  }

  buildMemoryBlocks(input: {
    userMemory?: unknown;
    projectMemory?: unknown;
    sessionMemory?: unknown;
    runtimeMemoryPrompt?: string | null;
    skillMemory?: unknown;
  }): ManagedDynamicContextBlock[] {
    const sources: Array<[string, unknown, number]> = [
      ['user', input.userMemory, 50],
      ['project', input.projectMemory, 51],
      ['session', input.sessionMemory, 52],
      ['runtime', input.runtimeMemoryPrompt, 53],
      ['skill', input.skillMemory, 54],
    ];
    return sortBlocks(
      sources
        .filter(([, value]) => {
          if (value === undefined || value === null) return false;
          return typeof value === 'string' ? value.trim() !== '' : true;
        })
        .map(([source, value, priority]) =>
          block({
            type: 'memory',
            id: `memory:${source}`,
            priority,
            visibility: 'model_context',
            payload: {
              source,
              value,
              precedence: 'session_explicit_fact_wins',
            },
          })
        )
    );
  }

  renderBlockIndex(blocks: ManagedDynamicContextBlock[]) {
    const ordered = sortBlocks(blocks);
    if (ordered.length === 0) return '';
    return [
      '# Dynamic context blocks',
      '- This block is a typed index of dynamic context. Stable operating rules remain in the system prompt.',
      ...ordered.map((item) => {
        const label = asText(item.payload.slug) || asText(item.payload.toolName) || asText(item.payload.filename) || asText(item.payload.source) || item.id;
        return `- ${item.type}:${label} | id=${item.id} | visibility=${item.visibility} | hash=${item.hash}`;
      }),
    ].join('\n');
  }

  buildIncludedContextManifest(blocks: ManagedDynamicContextBlock[]) {
    const ordered = sortBlocks(blocks);
    return {
      hash: hashStableJson(ordered.map((item) => ({ type: item.type, id: item.id, hash: item.hash }))),
      blocks: ordered.map((item) => ({
        type: item.type,
        id: item.id,
        hash: item.hash,
        visibility: item.visibility,
      })),
    };
  }

  private skillPayload(
    skill: ManagedSkillContext | ManagedSkillCatalogEntry,
    input: {
      activatedBy: 'selected' | 'auto_attached' | 'catalog';
      activatedAt: string;
      toolName: string | null;
      sandboxMaterialized: boolean;
      contextVisibility: string;
    }
  ) {
    return {
      sourceType: skill.sourceType,
      skillId: skill.skillId,
      revisionId: skill.revisionId,
      slug: skill.slug,
      name: skill.name,
      activatedBy: input.activatedBy,
      activatedAt: input.activatedAt,
      toolName: input.toolName,
      sandboxMaterialized: input.sandboxMaterialized,
      contextVisibility: input.contextVisibility,
      revisionNumber: skill.revisionNumber,
      resourceSummary: skill.resourceSummary || null,
    };
  }
}

export const altusManagedDynamicContextBlockService = new AltusManagedDynamicContextBlockService();
