import { altusManagedContextCompiler, type ManagedContextCompilerOutput } from './altus-managed-context-compiler';
import {
  altusManagedContextLedgerAdapter,
  type ManagedContextLedgerView,
} from './altus-managed-context-ledger-adapter';
import {
  altusManagedContextManifestService,
  type ManagedContextManifest,
} from './altus-managed-context-manifest-service';
import {
  altusManagedContextReconciliationService,
  type ManagedContextReconciliationPreview,
} from './altus-managed-context-reconciliation-service';
import { altusManagedContextRoundTripService, type ManagedContextRoundTripReport } from './altus-managed-context-roundtrip-service';
import { altusManagedDynamicContextBlockService, type ManagedDynamicContextBlock } from './altus-managed-dynamic-context-blocks';

export type ManagedContextRecoveryReport = {
  version: 1;
  mode: 'db_backed_read_only';
  factsSource: {
    messages: 'task_creation_session_messages';
    runEvents: 'task_session_run_events';
    dynamicContext: 'db_snapshot_and_metadata';
    redis: 'not_fact_source';
    uiProjection: 'not_fact_source';
    promptCache: 'not_fact_source';
    partialSse: 'not_fact_source';
  };
  ledger: ManagedContextLedgerView;
  compiled: ManagedContextCompilerOutput;
  manifest: ManagedContextManifest;
  reconciliation: ManagedContextReconciliationPreview;
  roundTrip: ManagedContextRoundTripReport;
  recoveryState: 'recoverable' | 'needs_reconciliation' | 'fact_drift';
};

export class AltusManagedContextRecoveryService {
  async rebuildFromDbFacts(input: {
    sessionId: string;
    runId?: string | null;
    dynamicContextBlocks?: ManagedDynamicContextBlock[];
    previousManifest?: ManagedContextManifest | null;
  }): Promise<ManagedContextRecoveryReport> {
    const ledger = await altusManagedContextLedgerAdapter.buildForSession({
      sessionId: input.sessionId,
      runId: input.runId || null,
    });
    return this.rebuildFromLedger({
      ledger,
      dynamicContextBlocks: input.dynamicContextBlocks,
      previousManifest: input.previousManifest,
    });
  }

  rebuildFromLedger(input: {
    ledger: ManagedContextLedgerView;
    dynamicContextBlocks?: ManagedDynamicContextBlock[];
    previousManifest?: ManagedContextManifest | null;
  }): ManagedContextRecoveryReport {
    const includedContext = input.dynamicContextBlocks
      ? altusManagedDynamicContextBlockService.buildIncludedContextManifest(input.dynamicContextBlocks)
      : undefined;
    const manifest = altusManagedContextManifestService.buildManifest(input.ledger, { includedContext });
    const compiled = altusManagedContextCompiler.compile(input.ledger);
    const reconciliation = altusManagedContextReconciliationService.preview(input.ledger);
    const roundTrip = input.previousManifest
      ? altusManagedContextRoundTripService.compareManifests(input.previousManifest, manifest)
      : altusManagedContextRoundTripService.compareManifests(manifest, manifest);
    return {
      version: 1,
      mode: 'db_backed_read_only',
      factsSource: {
        messages: 'task_creation_session_messages',
        runEvents: 'task_session_run_events',
        dynamicContext: 'db_snapshot_and_metadata',
        redis: 'not_fact_source',
        uiProjection: 'not_fact_source',
        promptCache: 'not_fact_source',
        partialSse: 'not_fact_source',
      },
      ledger: input.ledger,
      compiled,
      manifest,
      reconciliation,
      roundTrip,
      recoveryState: this.resolveRecoveryState(reconciliation, roundTrip),
    };
  }

  private resolveRecoveryState(
    reconciliation: ManagedContextReconciliationPreview,
    roundTrip: ManagedContextRoundTripReport
  ): ManagedContextRecoveryReport['recoveryState'] {
    if (roundTrip.diffs.some((diff) => diff.category === 'unexpected_fact_drift' || diff.category === 'missing_fact')) {
      return 'fact_drift';
    }
    if (reconciliation.issues.some((issue) => issue.severity === 'warning')) {
      return 'needs_reconciliation';
    }
    return 'recoverable';
  }
}

export const altusManagedContextRecoveryService = new AltusManagedContextRecoveryService();
