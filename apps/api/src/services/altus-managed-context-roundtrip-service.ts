import { stableStringify, type ManagedContextManifest } from './altus-managed-context-manifest-service';

export type ManagedContextRoundTripDiffCategory =
  | 'expected_volatile_change'
  | 'expected_dynamic_context_change'
  | 'unexpected_fact_drift'
  | 'missing_fact'
  | 'projection_bug';

export type ManagedContextRoundTripDiff = {
  path: string;
  category: ManagedContextRoundTripDiffCategory;
  before: unknown;
  after: unknown;
  message: string;
};

export type ManagedContextRoundTripReport = {
  equivalent: boolean;
  beforeContextHash: string;
  afterContextHash: string;
  diffs: ManagedContextRoundTripDiff[];
};

function same(left: unknown, right: unknown) {
  return stableStringify(left) === stableStringify(right);
}

function countWentMissing(before: Record<string, number>, after: Record<string, number>) {
  return Object.entries(before).some(([kind, count]) => (after[kind] || 0) < count);
}

export class AltusManagedContextRoundTripService {
  compareManifests(before: ManagedContextManifest, after: ManagedContextManifest): ManagedContextRoundTripReport {
    const diffs: ManagedContextRoundTripDiff[] = [];
    this.pushIfChanged(diffs, 'runId', before.runId || null, after.runId || null, 'expected_volatile_change', 'run 选择发生变化');
    this.pushIfChanged(
      diffs,
      'ledgerCursor',
      before.ledgerCursor,
      after.ledgerCursor,
      'expected_volatile_change',
      'ledger cursor 发生变化'
    );
    this.pushIfChanged(
      diffs,
      'includedContext.hash',
      before.includedContext?.hash || null,
      after.includedContext?.hash || null,
      'expected_dynamic_context_change',
      '动态上下文块发生变化'
    );
    if (!same(before.entryCounts, after.entryCounts)) {
      diffs.push({
        path: 'entryCounts',
        category: countWentMissing(before.entryCounts, after.entryCounts) ? 'missing_fact' : 'unexpected_fact_drift',
        before: before.entryCounts,
        after: after.entryCounts,
        message: 'ledger entry 计数不一致',
      });
    }
    if (!same(before.pairing, after.pairing)) {
      diffs.push({
        path: 'pairing',
        category: 'unexpected_fact_drift',
        before: before.pairing,
        after: after.pairing,
        message: 'tool_use / tool_result pairing 诊断不一致',
      });
    }
    if (before.contextHash !== after.contextHash) {
      diffs.push({
        path: 'contextHash',
        category: 'unexpected_fact_drift',
        before: before.contextHash,
        after: after.contextHash,
        message: '上下文事实 hash 不一致',
      });
    }
    return {
      equivalent: diffs.length === 0,
      beforeContextHash: before.contextHash,
      afterContextHash: after.contextHash,
      diffs,
    };
  }

  private pushIfChanged(
    diffs: ManagedContextRoundTripDiff[],
    path: string,
    before: unknown,
    after: unknown,
    category: ManagedContextRoundTripDiffCategory,
    message: string
  ) {
    if (same(before, after)) return;
    diffs.push({ path, category, before, after, message });
  }
}

export const altusManagedContextRoundTripService = new AltusManagedContextRoundTripService();
