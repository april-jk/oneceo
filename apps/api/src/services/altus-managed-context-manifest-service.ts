import { createHash } from 'node:crypto';
import type { ManagedContextLedgerEntry, ManagedContextLedgerView } from './altus-managed-context-ledger-adapter';

export type ManagedContextPairingDiagnostic = {
  toolUseIds: string[];
  toolResultIds: string[];
  missingToolResults: string[];
  orphanToolResults: string[];
  duplicateToolResults: string[];
};

export type ManagedContextManifest = {
  version: 1;
  sessionId: string;
  runId?: string | null;
  ledgerCursor: string;
  contextHash: string;
  entryCounts: Record<string, number>;
  pairing: ManagedContextPairingDiagnostic;
  includedContext?: {
    hash: string;
    blocks: Array<{
      type: string;
      id: string;
      hash: string;
      visibility: string;
    }>;
  };
};

export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashStableJson(value: unknown) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export class AltusManagedContextManifestService {
  buildManifest(
    ledger: ManagedContextLedgerView,
    options?: { includedContext?: ManagedContextManifest['includedContext'] }
  ): ManagedContextManifest {
    const entryCounts: Record<string, number> = {};
    for (const entry of ledger.entries) {
      entryCounts[entry.kind] = (entryCounts[entry.kind] || 0) + 1;
    }
    return {
      version: 1,
      sessionId: ledger.sessionId,
      runId: ledger.runId || null,
      ledgerCursor: ledger.ledgerCursor,
      contextHash: hashStableJson(this.hashableEntries(ledger.entries)),
      entryCounts,
      pairing: this.buildPairingDiagnostic(ledger.entries),
      ...(options?.includedContext ? { includedContext: options.includedContext } : {}),
    };
  }

  buildPairingDiagnostic(entries: ManagedContextLedgerEntry[]): ManagedContextPairingDiagnostic {
    const toolUseIds = Array.from(
      new Set(entries.filter((entry) => entry.kind === 'assistant_tool_use' && entry.toolUseId).map((entry) => entry.toolUseId as string))
    ).sort();
    const toolResultIds = Array.from(
      new Set(entries.filter((entry) => entry.kind === 'tool_result' && entry.toolUseId).map((entry) => entry.toolUseId as string))
    ).sort();
    const resultCounts = new Map<string, number>();
    for (const entry of entries) {
      if (entry.kind === 'tool_result' && entry.toolUseId) {
        resultCounts.set(entry.toolUseId, (resultCounts.get(entry.toolUseId) || 0) + 1);
      }
    }
    const resultSet = new Set(toolResultIds);
    const useSet = new Set(toolUseIds);
    return {
      toolUseIds,
      toolResultIds,
      missingToolResults: toolUseIds.filter((id) => !resultSet.has(id)),
      orphanToolResults: toolResultIds.filter((id) => !useSet.has(id)),
      duplicateToolResults: Array.from(resultCounts.entries())
        .filter(([, count]) => count > 1)
        .map(([id]) => id)
        .sort(),
    };
  }

  private hashableEntries(entries: ManagedContextLedgerEntry[]) {
    return entries.map((entry) => ({
      kind: entry.kind,
      source: entry.source,
      sourceId: entry.sourceId,
      sequence: entry.sequence,
      role: entry.role || null,
      content: entry.content || null,
      messageType: entry.messageType || null,
      toolUseId: entry.toolUseId || null,
      toolName: entry.toolName || null,
      arguments: entry.arguments || null,
      result: entry.result ?? null,
      status: entry.status || null,
    }));
  }
}

export const altusManagedContextManifestService = new AltusManagedContextManifestService();
