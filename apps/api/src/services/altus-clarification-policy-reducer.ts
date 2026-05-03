import type { TaskClarificationType } from './task-intent-shape-service';
import { altusCapabilityPolicyService, type AltusCapabilityPolicyService } from './altus-capability-policy-service';

export type ClarificationTransitionState = {
  status: 'none' | 'clarifying' | 'advisory' | 'ready_to_execute' | 'risk_confirmation' | 'new_turn';
  pendingClarificationType?: TaskClarificationType | null;
  pendingQuestion?: string | null;
  turnId?: string | null;
};

export type ClarificationTransitionAction =
  | 'answer_clarification'
  | 'delegate_to_agent_default'
  | 'switch_to_advisory_mode'
  | 'restart_as_new_turn'
  | 'request_followup_clarification'
  | 'request_risk_confirmation'
  | 'continue_execution';

export type ClarificationTransitionProposal = {
  action: ClarificationTransitionAction;
  clarificationType?: TaskClarificationType | null;
  answer?: string | null;
  assumedDefault?: string | null;
  confidence?: 'low' | 'medium' | 'high' | null;
  question?: string | null;
  options?: string[] | null;
  targetCapability?: string | null;
  riskCapability?: string | null;
  explicitConfirmation?: boolean | null;
  reason?: string | null;
  newUserIntentSummary?: string | null;
  assumptions?: string[] | null;
};

export type ClarificationReducerContext = {
  hasCredential?: (capability: string) => boolean;
  hasBoundResource?: (capability: string) => boolean;
};

export type ClarificationReducerResult =
  | {
      accepted: true;
      nextState: 'advisory' | 'ready_to_execute' | 'new_turn' | 'clarifying';
      clearedPending: boolean;
      assumptions?: string[];
      clarificationType?: TaskClarificationType;
      question?: string;
      options?: string[];
      reason?: string;
    }
  | {
      accepted: false;
      nextState: 'clarifying' | 'risk_confirmation';
      clearedPending: false;
      clarificationType?: TaskClarificationType;
      question: string;
      options?: string[];
      reason:
        | 'invalid_transition'
        | 'risk_requires_confirmation'
        | 'missing_capability'
        | 'missing_credential'
        | 'missing_bound_resource'
        | 'stale_turn'
        | 'low_confidence'
        | 'invalid_tool_arguments';
    };

const ALLOWED_TRANSITIONS: Record<ClarificationTransitionState['status'], ClarificationTransitionAction[]> = {
  none: ['switch_to_advisory_mode', 'continue_execution', 'request_followup_clarification'],
  clarifying: [
    'answer_clarification',
    'delegate_to_agent_default',
    'switch_to_advisory_mode',
    'restart_as_new_turn',
    'request_followup_clarification',
    'request_risk_confirmation',
    'continue_execution',
  ],
  advisory: ['continue_execution', 'restart_as_new_turn', 'switch_to_advisory_mode'],
  ready_to_execute: ['continue_execution', 'restart_as_new_turn'],
  risk_confirmation: ['answer_clarification', 'request_risk_confirmation'],
  new_turn: ['continue_execution', 'switch_to_advisory_mode', 'request_followup_clarification'],
};

function asConfidence(value: unknown): 'low' | 'medium' | 'high' {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'medium';
}

function cleanString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanOptions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options = value.map((item) => cleanString(item)).filter(Boolean).slice(0, 4);
  return options.length > 0 ? options : undefined;
}

function buildRiskQuestion(capability: string) {
  if (capability === 'deploy.production') {
    return '这会部署到生产环境，请明确确认是否继续。';
  }
  if (capability === 'deploy.preview') {
    return '这会触发外部预览部署，请确认是否继续。';
  }
  if (capability === 'connector.external_write') {
    return '这会写入外部系统，请确认目标系统和是否继续。';
  }
  if (capability === 'data.delete') {
    return '这会删除或覆盖数据，请明确确认范围和是否继续。';
  }
  return '这一步涉及外部副作用或高风险能力，请确认是否继续。';
}

function canIgnoreUnknownRiskForPendingClarification(clarificationType?: TaskClarificationType | null) {
  return (
    clarificationType === 'artifact_type' ||
    clarificationType === 'tech_stack' ||
    clarificationType === 'scope_boundary'
  );
}

export class AltusClarificationPolicyReducer {
  constructor(private readonly capabilityPolicyService: AltusCapabilityPolicyService = altusCapabilityPolicyService) {}

  reduce(
    state: ClarificationTransitionState,
    proposal: ClarificationTransitionProposal,
    context: ClarificationReducerContext = {}
  ): ClarificationReducerResult {
    if (!proposal || !proposal.action) {
      return this.rejectInvalid(state);
    }
    if (!ALLOWED_TRANSITIONS[state.status]?.includes(proposal.action)) {
      return this.rejectInvalid(state);
    }

    const targetCapability = cleanString(proposal.targetCapability);
    const riskCapability = cleanString(proposal.riskCapability);
    const capability = riskCapability || targetCapability;
    const policy = this.capabilityPolicyService.getPolicy(capability);
    if (riskCapability && !policy) {
      const clarificationType = state.pendingClarificationType || proposal.clarificationType || undefined;
      if (canIgnoreUnknownRiskForPendingClarification(clarificationType)) {
        return {
          accepted: true,
          nextState: 'ready_to_execute',
          clearedPending: true,
          reason: 'ignored_unknown_risk_capability',
        };
      }
      return {
        accepted: false,
        nextState: 'risk_confirmation',
        clearedPending: false,
        clarificationType,
        question: '这一步涉及未声明的平台能力，我需要先确认目标和风险边界。',
        reason: 'missing_capability',
      };
    }
    if (policy?.requiresExplicitConfirmation && proposal.explicitConfirmation !== true) {
      return {
        accepted: false,
        nextState: 'risk_confirmation',
        clearedPending: false,
        clarificationType: state.pendingClarificationType || proposal.clarificationType || undefined,
        question: cleanString(proposal.question) || buildRiskQuestion(policy.capability),
        options: cleanOptions(proposal.options),
        reason: 'risk_requires_confirmation',
      };
    }
    if (policy?.requiresCredential && context.hasCredential && !context.hasCredential(policy.capability)) {
      return {
        accepted: false,
        nextState: 'risk_confirmation',
        clearedPending: false,
        clarificationType: state.pendingClarificationType || proposal.clarificationType || undefined,
        question: '这一步需要可用授权或凭证。请先完成连接，或改为不使用该外部能力。',
        reason: 'missing_credential',
      };
    }
    if (policy?.requiresBoundResource && context.hasBoundResource && !context.hasBoundResource(policy.capability)) {
      return {
        accepted: false,
        nextState: 'risk_confirmation',
        clearedPending: false,
        clarificationType: state.pendingClarificationType || proposal.clarificationType || undefined,
        question: '这一步需要明确的目标资源。请先确认目标项目、环境或外部系统。',
        reason: 'missing_bound_resource',
      };
    }

    const confidence = asConfidence(proposal.confidence);
    switch (proposal.action) {
      case 'answer_clarification':
        if (state.pendingClarificationType && confidence === 'low') {
          return {
            accepted: false,
            nextState: 'clarifying',
            clearedPending: false,
            clarificationType: state.pendingClarificationType,
            question: state.pendingQuestion || '我还需要你确认上一条补充信息。',
            reason: 'low_confidence',
          };
        }
        return {
          accepted: true,
          nextState: 'ready_to_execute',
          clearedPending: true,
          assumptions: cleanString(proposal.answer) ? [cleanString(proposal.answer)] : undefined,
          reason: 'answer_clarification',
        };
      case 'delegate_to_agent_default':
        return {
          accepted: true,
          nextState: 'ready_to_execute',
          clearedPending: true,
          assumptions: cleanString(proposal.assumedDefault) ? [cleanString(proposal.assumedDefault)] : undefined,
          reason: 'delegate_to_agent_default',
        };
      case 'switch_to_advisory_mode':
        return {
          accepted: true,
          nextState: 'advisory',
          clearedPending: true,
          reason: cleanString(proposal.reason) || 'switch_to_advisory_mode',
        };
      case 'restart_as_new_turn':
        return {
          accepted: true,
          nextState: 'new_turn',
          clearedPending: true,
          assumptions: cleanString(proposal.newUserIntentSummary)
            ? [cleanString(proposal.newUserIntentSummary)]
            : undefined,
          reason: 'restart_as_new_turn',
        };
      case 'request_followup_clarification': {
        const question = cleanString(proposal.question);
        if (!question || (state.pendingQuestion && question === state.pendingQuestion)) {
          return this.rejectInvalid(state);
        }
        return {
          accepted: true,
          nextState: 'clarifying',
          clearedPending: false,
          clarificationType: proposal.clarificationType || state.pendingClarificationType || undefined,
          question,
          options: cleanOptions(proposal.options),
          reason: 'request_followup_clarification',
        };
      }
      case 'request_risk_confirmation':
        return {
          accepted: false,
          nextState: 'risk_confirmation',
          clearedPending: false,
          clarificationType: proposal.clarificationType || state.pendingClarificationType || undefined,
          question: cleanString(proposal.question) || '这一步存在风险，请确认是否继续。',
          options: cleanOptions(proposal.options),
          reason: 'risk_requires_confirmation',
        };
      case 'continue_execution':
        return {
          accepted: true,
          nextState: 'ready_to_execute',
          clearedPending: true,
          assumptions: cleanOptions(proposal.assumptions),
          reason: 'continue_execution',
        };
    }
  }

  private rejectInvalid(state: ClarificationTransitionState): ClarificationReducerResult {
    return {
      accepted: false,
      nextState: 'clarifying',
      clearedPending: false,
      clarificationType: state.pendingClarificationType || undefined,
      question: state.pendingQuestion || '我还需要你确认上一条补充信息。',
      reason: 'invalid_transition',
    };
  }
}

export const altusClarificationPolicyReducer = new AltusClarificationPolicyReducer();
