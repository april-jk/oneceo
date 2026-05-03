import type { ChatMessage } from './altus-managed-shared';
import type { ManagedContextLedgerEntry, ManagedContextLedgerView } from './altus-managed-context-ledger-adapter';

export type ManagedContextCompilerOutput = {
  messages: ChatMessage[];
  droppedEntries: Array<{
    entryId: string;
    kind: string;
    reason: string;
  }>;
};

function stringifyToolContent(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    if (typeof object.contentForModel === 'string') {
      return object.contentForModel;
    }
  }
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return String(value ?? '');
  }
}

function stringifyArguments(value: Record<string, unknown> | null | undefined): string {
  try {
    return JSON.stringify(value || {});
  } catch {
    return '{}';
  }
}

export class AltusManagedContextCompiler {
  compile(ledger: ManagedContextLedgerView): ManagedContextCompilerOutput {
    const messages: ChatMessage[] = [];
    const droppedEntries: ManagedContextCompilerOutput['droppedEntries'] = [];

    for (const entry of ledger.entries) {
      const lowered = this.lowerEntry(entry);
      if (lowered) {
        messages.push(lowered);
        continue;
      }
      if (
        entry.kind !== 'attachment_ref' &&
        entry.kind !== 'skill_selection' &&
        entry.kind !== 'state_transition' &&
        entry.kind !== 'status_projection' &&
        entry.kind !== 'mcp_provider_snapshot'
      ) {
        droppedEntries.push({
          entryId: entry.id,
          kind: entry.kind,
          reason: 'entry_kind_not_lowerable',
        });
      }
    }

    return { messages, droppedEntries };
  }

  private lowerEntry(entry: ManagedContextLedgerEntry): ChatMessage | null {
    if (entry.kind === 'user_message' || entry.kind === 'clarification_answer') {
      return { role: 'user', content: entry.content || '' };
    }
    if (entry.kind === 'assistant_message' || entry.kind === 'clarification_request') {
      return { role: 'assistant', content: entry.content || '' };
    }
    if (entry.kind === 'assistant_tool_use') {
      if (!entry.toolUseId || !entry.toolName) return null;
      return {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: entry.toolUseId,
            type: 'function',
            function: {
              name: entry.toolName,
              arguments: stringifyArguments(entry.arguments),
            },
          },
        ],
      };
    }
    if (entry.kind === 'tool_result') {
      if (!entry.toolUseId) return null;
      return {
        role: 'tool',
        tool_call_id: entry.toolUseId,
        name: entry.toolName || undefined,
        content: stringifyToolContent(entry.result),
      };
    }
    return null;
  }
}

export const altusManagedContextCompiler = new AltusManagedContextCompiler();
