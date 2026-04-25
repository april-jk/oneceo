import { taskCreationFileMemoryStore, type FileSessionRecord } from '../agents/task-creation/file-memory-store';
import { taskSessionRunDAO } from '../db/dao';
import type { AltusRunEventWriter } from './altus-run-event-writer';
import { altusRunEventWriter } from './altus-run-event-writer';
import type { AltusManagedTaskIntentProfile } from './altus-managed-prompt-service';
import { asText, parseToolArguments, pickObject, truncate } from './altus-managed-shared';
import { buildManagedToolResultEnvelope } from './altus-managed-tool-result-envelope';

export type AltusAskUserAnswerKind =
  | 'direct_answer'
  | 'delegated_to_agent'
  | 'scope_softening'
  | 'redirect'
  | 'cancelled';

export type PendingAskUserPairing = {
  runId: string;
  sessionId: string;
  toolCallId: string;
  toolName: 'ask_user';
  messageKey: string;
  question: string;
};

export type ClosedAskUserPairing = {
  closed: boolean;
  answerKind: AltusAskUserAnswerKind;
  pending?: PendingAskUserPairing;
};

function isCancellation(text: string) {
  return /^(取消|不用了|先不做了|暂停|停止|算了|cancel|stop)$/i.test(text.trim());
}

function mapTransitionReasonToKind(reason?: string | null, nextState?: string | null): AltusAskUserAnswerKind {
  if (reason === 'delegate_to_agent_default') return 'delegated_to_agent';
  if (reason === 'switch_to_advisory_mode' || nextState === 'advisory') return 'scope_softening';
  if (reason === 'restart_as_new_turn' || nextState === 'new_turn') return 'redirect';
  return 'direct_answer';
}

function readPendingFromMemory(sessionId: string, sessionMemory?: FileSessionRecord | null): PendingAskUserPairing | null {
  const pending = sessionMemory?.pendingAskUser;
  if (!pending?.runId || !pending?.toolCallId || !pending?.messageKey) return null;
  return {
    runId: pending.runId,
    sessionId,
    toolCallId: pending.toolCallId,
    toolName: 'ask_user',
    messageKey: pending.messageKey,
    question: pending.question || sessionMemory?.pendingQuestion || '',
  };
}

export class AltusManagedAskUserPairingService {
  constructor(private readonly eventWriter: AltusRunEventWriter = altusRunEventWriter) {}

  async resolvePending(
    sessionId: string,
    sessionMemory?: FileSessionRecord | null
  ): Promise<PendingAskUserPairing | null> {
    const fromMemory = readPendingFromMemory(sessionId, sessionMemory);
    if (fromMemory) return fromMemory;

    const latestRun = await taskSessionRunDAO.getLatestRun(sessionId);
    if (!latestRun || latestRun.status !== 'waiting_user') return null;
    const events = await taskSessionRunDAO.listRunEvents(latestRun.id);
    const completedIds = new Set(
      events
        .filter((event) => event.eventType === 'tool_call_completed' || event.eventType === 'tool_call_failed')
        .map((event) => asText(pickObject(event.payloadJson).toolCallId))
        .filter(Boolean)
    );
    const askUserStarted = [...events]
      .reverse()
      .find((event) => {
        const payload = pickObject(event.payloadJson);
        const toolCallId = asText(payload.toolCallId);
        return (
          event.eventType === 'tool_call_started' &&
          asText(payload.toolName) === 'ask_user' &&
          toolCallId &&
          !completedIds.has(toolCallId)
        );
      });
    if (!askUserStarted) return null;
    const payload = pickObject(askUserStarted.payloadJson);
    const args = parseToolArguments(
      typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments || {})
    );
    const toolCallId = asText(payload.toolCallId);
    if (!toolCallId) return null;
    return {
      runId: latestRun.id,
      sessionId,
      toolCallId,
      toolName: 'ask_user',
      messageKey: asText(sessionMemory?.pendingAskUser?.messageKey) || `managed:${latestRun.id}:clarification`,
      question: asText(args.question) || asText(sessionMemory?.pendingQuestion),
    };
  }

  classifyAnswer(input: {
    answer: string;
    taskIntentProfile?: AltusManagedTaskIntentProfile | null;
  }): AltusAskUserAnswerKind {
    const answer = asText(input.answer);
    if (isCancellation(answer)) return 'cancelled';
    const transition = input.taskIntentProfile?.clarificationTransition;
    return mapTransitionReasonToKind(transition?.reason, transition?.nextState);
  }

  async closePending(input: {
    sessionId: string;
    userId: string;
    pending: PendingAskUserPairing | null;
    answer: string;
    answerRunId: string;
    answerMessageKey: string;
    taskIntentProfile?: AltusManagedTaskIntentProfile | null;
  }): Promise<ClosedAskUserPairing> {
    const answerKind = this.classifyAnswer({
      answer: input.answer,
      taskIntentProfile: input.taskIntentProfile,
    });
    if (!input.pending) {
      return { closed: false, answerKind };
    }

    const resultPayload = {
      status: 'answered',
      answerKind,
      answer: input.answer,
      answerRunId: input.answerRunId,
      answerMessageKey: input.answerMessageKey,
      question: input.pending.question,
      clarificationMessageKey: input.pending.messageKey,
    };
    await this.eventWriter.appendRunEvent(
      input.pending.runId,
      input.sessionId,
      input.userId,
      'clarification_answered',
      {
        ...resultPayload,
        content: truncate(input.answer, 2000),
        toolName: 'ask_user',
        toolCallId: input.pending.toolCallId,
      }
    );
    await this.eventWriter.appendRunEvent(
      input.pending.runId,
      input.sessionId,
      input.userId,
      'tool_call_completed',
      {
        toolName: 'ask_user',
        toolCallId: input.pending.toolCallId,
        content: '用户已回答补充信息',
        toolResultEnvelope: buildManagedToolResultEnvelope({
          status: 'ok',
          runId: input.pending.runId,
          toolUseId: input.pending.toolCallId,
          toolName: 'ask_user',
          modelRoundId: 'clarification_answer',
          args: {},
          content: JSON.stringify(resultPayload),
          contentForUser: '用户已回答补充信息',
          result: resultPayload,
        }),
        result: resultPayload,
        outputPreview: truncate(input.answer, 2000),
        transitionReason: 'clarification_answered',
      }
    );
    await this.eventWriter.appendRunEvent(
      input.pending.runId,
      input.sessionId,
      input.userId,
      'run_status',
      {
        status: 'completed',
        content: '补充信息已回答，当前等待已闭合',
        transitionReason: 'clarification_answered',
      }
    );
    await taskSessionRunDAO.updateRunStatus(input.pending.runId, 'completed', {
      stopReason: 'clarification_answered',
      completedAt: new Date(),
    });
    await taskCreationFileMemoryStore.clearPendingClarification(input.sessionId);

    return {
      closed: true,
      answerKind,
      pending: input.pending,
    };
  }
}

export const altusManagedAskUserPairingService = new AltusManagedAskUserPairingService();
