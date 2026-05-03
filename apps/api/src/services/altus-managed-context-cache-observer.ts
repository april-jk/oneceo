import type { ChatMessage } from './altus-managed-shared';
import type { ManagedContextLedgerView } from './altus-managed-context-ledger-adapter';
import { hashStableJson, type ManagedContextManifest } from './altus-managed-context-manifest-service';
import type { AltusManagedTurnSnapshot } from './altus-managed-turn-snapshot-service';

export type ManagedContextCacheBreakReason =
  | 'initial_observation'
  | 'system_prompt_changed'
  | 'tool_schema_changed'
  | 'mcp_snapshot_changed'
  | 'skill_snapshot_changed'
  | 'memory_snapshot_changed'
  | 'attachment_context_changed'
  | 'volatile_context_changed'
  | 'api_messages_changed'
  | 'budget_replacement_changed'
  | 'unresolved_tool_pairing';

export type ManagedContextCacheObservation = {
  version: 1;
  stableSystemHash: string;
  toolSchemaHash: string;
  mcpSnapshotHash: string;
  skillSnapshotHash: string;
  memorySnapshotHash: string;
  attachmentContextHash: string;
  volatileContextHash: string;
  apiMessageHash: string;
  budgetReplacementHash: string;
  unresolvedToolPairingHash: string;
  cacheBreakReasons: ManagedContextCacheBreakReason[];
};

function blocksByType(manifest: ManagedContextManifest, type: string) {
  return (manifest.includedContext?.blocks || [])
    .filter((block) => block.type === type)
    .map((block) => ({ id: block.id, hash: block.hash, visibility: block.visibility }));
}

function hasUnresolvedToolPairing(manifest: ManagedContextManifest) {
  return (
    manifest.pairing.missingToolResults.length > 0 ||
    manifest.pairing.orphanToolResults.length > 0 ||
    manifest.pairing.duplicateToolResults.length > 0
  );
}

export class AltusManagedContextCacheObserver {
  buildObservation(input: {
    ledger: ManagedContextLedgerView;
    manifest: ManagedContextManifest;
    snapshot: AltusManagedTurnSnapshot;
    apiMessages: ChatMessage[];
    previous?: ManagedContextCacheObservation | null;
    stableSystemKey?: string | null;
    budgetReplacementSummary?: unknown;
  }): ManagedContextCacheObservation {
    const stableSystemHash = hashStableJson({
      system: input.stableSystemKey || 'altus-managed-system-contract:v1',
    });
    const memorySnapshotHash = hashStableJson(blocksByType(input.manifest, 'memory'));
    const attachmentContextHash = hashStableJson(blocksByType(input.manifest, 'attachment'));
    const budgetReplacementHash = hashStableJson(input.budgetReplacementSummary || null);
    const unresolvedToolPairingHash = hashStableJson(input.manifest.pairing);
    const volatileContextHash = hashStableJson({
      runId: input.manifest.runId || null,
      ledgerCursor: input.ledger.ledgerCursor,
      includedContextHash: input.manifest.includedContext?.hash || null,
      budgetReplacementHash,
      unresolvedToolPairingHash,
    });
    const observation: ManagedContextCacheObservation = {
      version: 1,
      stableSystemHash,
      toolSchemaHash: input.snapshot.toolDefinitionsHash,
      mcpSnapshotHash: input.snapshot.mcpProviderSnapshotHash,
      skillSnapshotHash: input.snapshot.skillSnapshotHash,
      memorySnapshotHash,
      attachmentContextHash,
      volatileContextHash,
      apiMessageHash: hashStableJson(input.apiMessages),
      budgetReplacementHash,
      unresolvedToolPairingHash,
      cacheBreakReasons: [],
    };
    observation.cacheBreakReasons = this.resolveBreakReasons(observation, input.previous || null, input.manifest);
    return observation;
  }

  private resolveBreakReasons(
    current: Omit<ManagedContextCacheObservation, 'cacheBreakReasons'>,
    previous: ManagedContextCacheObservation | null,
    manifest: ManagedContextManifest
  ): ManagedContextCacheBreakReason[] {
    const reasons: ManagedContextCacheBreakReason[] = [];
    if (!previous) {
      reasons.push('initial_observation');
    } else {
      if (current.stableSystemHash !== previous.stableSystemHash) reasons.push('system_prompt_changed');
      if (current.toolSchemaHash !== previous.toolSchemaHash) reasons.push('tool_schema_changed');
      if (current.mcpSnapshotHash !== previous.mcpSnapshotHash) reasons.push('mcp_snapshot_changed');
      if (current.skillSnapshotHash !== previous.skillSnapshotHash) reasons.push('skill_snapshot_changed');
      if (current.memorySnapshotHash !== previous.memorySnapshotHash) reasons.push('memory_snapshot_changed');
      if (current.attachmentContextHash !== previous.attachmentContextHash) reasons.push('attachment_context_changed');
      if (current.volatileContextHash !== previous.volatileContextHash) reasons.push('volatile_context_changed');
      if (current.apiMessageHash !== previous.apiMessageHash) reasons.push('api_messages_changed');
      if (current.budgetReplacementHash !== previous.budgetReplacementHash) reasons.push('budget_replacement_changed');
    }
    if (hasUnresolvedToolPairing(manifest)) {
      reasons.push('unresolved_tool_pairing');
    }
    return Array.from(new Set(reasons));
  }
}

export const altusManagedContextCacheObserver = new AltusManagedContextCacheObserver();
