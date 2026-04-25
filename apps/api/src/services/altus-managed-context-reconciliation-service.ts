import type { ManagedContextLedgerView } from './altus-managed-context-ledger-adapter';
import { altusManagedContextManifestService, type ManagedContextManifest } from './altus-managed-context-manifest-service';

export type ManagedContextReconciliationPreview = {
  mode: 'dry_run';
  wouldWrite: false;
  manifest: ManagedContextManifest;
  issues: Array<{
    code: 'missing_tool_result' | 'orphan_tool_result' | 'duplicate_tool_result' | 'pending_clarification_without_user_reply';
    severity: 'info' | 'warning';
    toolUseId?: string;
    message?: string;
  }>;
};

export class AltusManagedContextReconciliationService {
  preview(ledger: ManagedContextLedgerView): ManagedContextReconciliationPreview {
    const manifest = altusManagedContextManifestService.buildManifest(ledger);
    const issues: ManagedContextReconciliationPreview['issues'] = [];

    for (const toolUseId of manifest.pairing.missingToolResults) {
      issues.push({
        code: 'missing_tool_result',
        severity: 'warning',
        toolUseId,
        message: 'assistant tool_use 没有对应 tool_result',
      });
    }
    for (const toolUseId of manifest.pairing.orphanToolResults) {
      issues.push({
        code: 'orphan_tool_result',
        severity: 'warning',
        toolUseId,
        message: 'tool_result 没有对应 assistant tool_use',
      });
    }
    for (const toolUseId of manifest.pairing.duplicateToolResults) {
      issues.push({
        code: 'duplicate_tool_result',
        severity: 'warning',
        toolUseId,
        message: '同一个 assistant tool_use 出现了多个 tool_result',
      });
    }

    const latestClarificationIndex = ledger.entries.map((entry) => entry.kind).lastIndexOf('clarification_request');
    if (latestClarificationIndex >= 0) {
      const hasLaterUserReply = ledger.entries
        .slice(latestClarificationIndex + 1)
        .some((entry) => entry.kind === 'user_message');
      if (!hasLaterUserReply) {
        issues.push({
          code: 'pending_clarification_without_user_reply',
          severity: 'info',
          message: '最近一次 clarification_request 后还没有用户回复',
        });
      }
    }

    return {
      mode: 'dry_run',
      wouldWrite: false,
      manifest,
      issues,
    };
  }
}

export const altusManagedContextReconciliationService = new AltusManagedContextReconciliationService();
