export type AltusRunTransitionReason =
  | 'initial_execution'
  | 'tool_result_continue'
  | 'tool_confirmation_requested'
  | 'plain_text_conversation_completed'
  | 'plain_text_continuation_prompted'
  | 'plain_text_continuation_failed'
  | 'clarification_requested'
  | 'tool_failed_but_recoverable'
  | 'tool_failed_user_action_required'
  | 'deployment_completion_blocked'
  | 'visual_detection_completion_blocked'
  | 'deliverable_persistence_failed'
  | 'deployment_repair_required'
  | 'model_retryable_error'
  | 'model_non_retryable_error'
  | 'tool_round_limit_near'
  | 'tool_round_limit_exceeded'
  | 'completed_with_deliverables'
  | 'completed_without_deliverables'
  | 'user_interrupt';

export type AltusRunRecoveryMode =
  | 'none'
  | 'model_retry'
  | 'tool_repair'
  | 'awaiting_user'
  | 'context_pressure';

export type AltusRunLoopSnapshot = {
  lastTransitionReason: AltusRunTransitionReason | null;
  recoveryMode: AltusRunRecoveryMode;
  currentRound: number;
  maxRounds: number;
  plainTextRecoveryUsed: boolean;
  lastToolName: string | null;
  lastToolCallId: string | null;
  updatedAt: string;
};

export type AltusRunLoopUpdate = Partial<Omit<AltusRunLoopSnapshot, 'updatedAt'>> & {
  updatedAt?: Date | string | null;
};

function asNonNegativeInt(value: unknown, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function asOptionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toIsoString(value?: Date | string | null) {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function createAltusRunLoopSnapshot(input?: AltusRunLoopUpdate | null): AltusRunLoopSnapshot {
  return {
    lastTransitionReason: (input?.lastTransitionReason as AltusRunTransitionReason | null | undefined) ?? null,
    recoveryMode: input?.recoveryMode || 'none',
    currentRound: asNonNegativeInt(input?.currentRound, 0),
    maxRounds: asNonNegativeInt(input?.maxRounds, 0),
    plainTextRecoveryUsed: Boolean(input?.plainTextRecoveryUsed),
    lastToolName: asOptionalText(input?.lastToolName),
    lastToolCallId: asOptionalText(input?.lastToolCallId),
    updatedAt: toIsoString(input?.updatedAt),
  };
}
