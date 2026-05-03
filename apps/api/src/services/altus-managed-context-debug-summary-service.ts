import type { ManagedContextCacheObservation } from './altus-managed-context-cache-observer';
import type { ManagedContextLedgerEntry, ManagedContextLedgerView } from './altus-managed-context-ledger-adapter';
import type { ManagedContextManifest } from './altus-managed-context-manifest-service';
import type { ManagedContextRecoveryReport } from './altus-managed-context-recovery-service';
import type { ManagedContextRoundTripReport } from './altus-managed-context-roundtrip-service';
import { asText, pickObject } from './altus-managed-shared';

export type ManagedContextDebugClarificationSummary = {
  pending: Array<{
    question: string;
    toolUseId: string | null;
    runId: string | null;
  }>;
  answered: Array<{
    question: string;
    answer: string;
    closed: boolean;
    toolUseId: string | null;
    runId: string | null;
  }>;
  duplicates: Array<{
    question: string;
    count: number;
  }>;
};

export type ManagedContextDebugSummary = {
  version: 1;
  sessionId: string;
  runId: string | null;
  recoveryState: ManagedContextRecoveryReport['recoveryState'];
  factsSource: ManagedContextRecoveryReport['factsSource'];
  clarification: ManagedContextDebugClarificationSummary;
  recentIntent: string[];
  toolPairing: ManagedContextManifest['pairing'];
  cache: {
    stableSystemChanged: boolean;
    toolSchemaChanged: boolean;
    dynamicContextChanged: boolean;
    apiMessagesChanged: boolean;
    budgetReplacementChanged: boolean;
    unresolvedToolPairing: boolean;
    cacheBreakReasons: ManagedContextCacheObservation['cacheBreakReasons'];
  };
  roundTrip: ManagedContextRoundTripReport;
};

type BuildSummaryInput = {
  recovery: ManagedContextRecoveryReport;
  cacheObservation: ManagedContextCacheObservation;
  previousCacheObservation?: ManagedContextCacheObservation | null;
};

function normalizeQuestion(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function entryContent(entry: ManagedContextLedgerEntry) {
  return asText(entry.content);
}

function entryQuestion(entry: ManagedContextLedgerEntry) {
  const metadata = pickObject(entry.metadata);
  const result = pickObject(entry.result);
  const args = pickObject(entry.arguments);
  return (
    entryContent(entry) ||
    asText(metadata.question) ||
    asText(args.question) ||
    asText(result.question) ||
    asText(pickObject(result.args).question)
  );
}

function entryAnswer(entry: ManagedContextLedgerEntry) {
  const metadata = pickObject(entry.metadata);
  const result = pickObject(entry.result);
  return entryContent(entry) || asText(metadata.answer) || asText(result.answer) || asText(result.content);
}

export class AltusManagedContextDebugSummaryService {
  buildSummary(input: BuildSummaryInput): ManagedContextDebugSummary {
    const ledger = input.recovery.ledger;
    const clarification = this.buildClarificationSummary(ledger);
    return {
      version: 1,
      sessionId: ledger.sessionId,
      runId: ledger.runId || null,
      recoveryState: input.recovery.recoveryState,
      factsSource: input.recovery.factsSource,
      clarification,
      recentIntent: this.buildRecentIntent(ledger),
      toolPairing: input.recovery.manifest.pairing,
      cache: this.buildCacheSummary(input.cacheObservation, input.previousCacheObservation || null),
      roundTrip: input.recovery.roundTrip,
    };
  }

  private buildClarificationSummary(ledger: ManagedContextLedgerView): ManagedContextDebugClarificationSummary {
    const questions = ledger.entries
      .filter((entry) => entry.kind === 'clarification_request')
      .map((entry) => ({
        question: normalizeQuestion(entryQuestion(entry)),
        toolUseId: entry.toolUseId || asText(pickObject(entry.metadata).toolCallId) || null,
        runId: entry.runId || null,
        sequence: entry.sequence,
      }))
      .filter((item) => item.question);
    const answers = ledger.entries
      .filter((entry) => entry.kind === 'clarification_answer' || entry.kind === 'user_message')
      .map((entry) => ({
        answer: entryAnswer(entry),
        toolUseId:
          entry.toolUseId ||
          asText(pickObject(entry.metadata).clarificationToolCallId) ||
          asText(pickObject(entry.metadata).toolCallId) ||
          null,
        runId: entry.runId || null,
        sequence: entry.sequence,
      }))
      .filter((item) => item.answer);

    const answered = [];
    const pending = [];
    const usedAnswerIndexes = new Set<number>();

    for (const question of questions) {
      const answerIndex = answers.findIndex((candidate, index) => {
        if (usedAnswerIndexes.has(index)) return false;
        if (question.toolUseId && candidate.toolUseId && question.toolUseId === candidate.toolUseId) return true;
        return candidate.sequence > question.sequence;
      });
      if (answerIndex >= 0) {
        const answer = answers[answerIndex];
        usedAnswerIndexes.add(answerIndex);
        answered.push({
          question: question.question,
          answer: answer.answer,
          closed: true,
          toolUseId: question.toolUseId || answer.toolUseId,
          runId: answer.runId || question.runId,
        });
      } else {
        pending.push({
          question: question.question,
          toolUseId: question.toolUseId,
          runId: question.runId,
        });
      }
    }

    return {
      pending,
      answered,
      duplicates: this.buildDuplicateQuestions(questions.map((item) => item.question)),
    };
  }

  private buildDuplicateQuestions(questions: string[]) {
    const counts = new Map<string, number>();
    for (const question of questions) {
      counts.set(question, (counts.get(question) || 0) + 1);
    }
    return Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([question, count]) => ({ question, count }))
      .sort((left, right) => left.question.localeCompare(right.question));
  }

  private buildRecentIntent(ledger: ManagedContextLedgerView) {
    return ledger.entries
      .filter((entry) => entry.kind === 'user_message' || entry.kind === 'clarification_answer')
      .map((entry) => entryContent(entry))
      .filter(Boolean)
      .slice(-5);
  }

  private buildCacheSummary(
    current: ManagedContextCacheObservation,
    previous: ManagedContextCacheObservation | null
  ): ManagedContextDebugSummary['cache'] {
    return {
      stableSystemChanged: previous ? current.stableSystemHash !== previous.stableSystemHash : false,
      toolSchemaChanged: previous ? current.toolSchemaHash !== previous.toolSchemaHash : false,
      dynamicContextChanged: previous
        ? current.mcpSnapshotHash !== previous.mcpSnapshotHash ||
          current.skillSnapshotHash !== previous.skillSnapshotHash ||
          current.memorySnapshotHash !== previous.memorySnapshotHash ||
          current.attachmentContextHash !== previous.attachmentContextHash ||
          current.volatileContextHash !== previous.volatileContextHash
        : false,
      apiMessagesChanged: previous ? current.apiMessageHash !== previous.apiMessageHash : false,
      budgetReplacementChanged: previous ? current.budgetReplacementHash !== previous.budgetReplacementHash : false,
      unresolvedToolPairing: current.cacheBreakReasons.includes('unresolved_tool_pairing'),
      cacheBreakReasons: current.cacheBreakReasons,
    };
  }
}

export const altusManagedContextDebugSummaryService = new AltusManagedContextDebugSummaryService();
