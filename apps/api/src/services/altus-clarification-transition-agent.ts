import { asText } from './altus-managed-shared';
import type { TaskClarificationType, TaskIntentShape } from './task-intent-shape-service';
import type { ClarificationTransitionProposal } from './altus-clarification-policy-reducer';

type TransitionAgentInput = {
  currentText: string;
  recentUserTexts: string[];
  recentMessages?: Array<{
    role: 'user' | 'assistant' | 'system';
    messageType?: string;
    content: string;
  }>;
  pendingClarificationType?: TaskClarificationType | null;
  pendingQuestion?: string | null;
  pendingOptions?: string[] | null;
  shape: TaskIntentShape;
};

const TRANSITION_TOOL_NAMES = [
  'answer_clarification',
  'delegate_to_agent_default',
  'switch_to_advisory_mode',
  'restart_as_new_turn',
  'request_followup_clarification',
  'request_risk_confirmation',
  'continue_execution',
] as const;

const CAPABILITY_NAMES = [
  'project.local_scaffold',
  'advisory.response',
  'connector.external_read',
  'connector.external_write',
  'deploy.preview',
  'deploy.production',
  'data.delete',
] as const;

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function canUseRiskConfirmationTool(input: TransitionAgentInput) {
  return input.pendingClarificationType === 'acceptance_requirement';
}

function hasPendingClarification(input: TransitionAgentInput) {
  return Boolean(input.pendingClarificationType && input.pendingClarificationType !== 'none');
}

function buildTransitionTools(input: TransitionAgentInput) {
  const clarificationType = {
    type: 'string',
    enum: ['artifact_type', 'tech_stack', 'scope_boundary', 'integration_target', 'acceptance_requirement'],
  };
  const confidence = {
    type: 'string',
    enum: ['low', 'medium', 'high'],
  };
  const capabilityName = {
    type: 'string',
    enum: [...CAPABILITY_NAMES],
  };
  return [
    ...(hasPendingClarification(input)
      ? [
          {
            type: 'function',
            function: {
              name: 'answer_clarification',
              description: 'Use when the user answered the pending clarification.',
              parameters: objectSchema(
                {
                  clarificationType,
                  answer: { type: 'string' },
                  confidence,
                  reason: { type: 'string' },
                },
                ['clarificationType', 'answer', 'confidence', 'reason']
              ),
            },
          },
          {
            type: 'function',
            function: {
              name: 'delegate_to_agent_default',
              description: 'Use when the user asks Altus to choose a reasonable default.',
              parameters: objectSchema(
                {
                  clarificationType,
                  assumedDefault: { type: 'string' },
                  confidence,
                  reason: { type: 'string' },
                  targetCapability: capabilityName,
                  explicitConfirmation: { type: 'boolean' },
                },
                ['clarificationType', 'assumedDefault', 'confidence', 'reason']
              ),
            },
          },
        ]
      : []),
    {
      type: 'function',
      function: {
        name: 'switch_to_advisory_mode',
        description: 'Use when the user wants advice, planning, discussion, or a proposal before execution.',
        parameters: objectSchema(
          {
            reason: { type: 'string' },
            expectedResponseShape: {
              type: 'string',
              enum: ['strategy', 'proposal', 'analysis', 'scope_discussion'],
            },
          },
          ['reason', 'expectedResponseShape']
        ),
      },
    },
    ...(hasPendingClarification(input)
      ? [
          {
            type: 'function',
            function: {
              name: 'restart_as_new_turn',
              description: 'Use when the user changed topic and the old pending clarification should not apply.',
              parameters: objectSchema(
                {
                  reason: { type: 'string' },
                  newUserIntentSummary: { type: 'string' },
                },
                ['reason', 'newUserIntentSummary']
              ),
            },
          },
        ]
      : []),
    {
      type: 'function',
      function: {
        name: 'request_followup_clarification',
        description: 'Use when a more specific follow-up clarification is still needed.',
        parameters: objectSchema(
          {
            clarificationType,
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
            reason: { type: 'string' },
          },
          ['clarificationType', 'question', 'reason']
        ),
      },
    },
    ...(canUseRiskConfirmationTool(input)
      ? [
          {
            type: 'function',
            function: {
              name: 'request_risk_confirmation',
              description:
                'Use only when this reply itself authorizes a known protected side effect such as production deploy, external write, or delete.',
              parameters: objectSchema(
                {
                  clarificationType,
                  riskCapability: capabilityName,
                  riskLevel: { type: 'string', enum: ['medium', 'high'] },
                  question: { type: 'string' },
                  reason: { type: 'string' },
                },
                ['riskCapability', 'riskLevel', 'question', 'reason']
              ),
            },
          },
        ]
      : []),
    {
      type: 'function',
      function: {
        name: 'continue_execution',
        description: 'Use when there is enough information to continue and no clarification is needed.',
        parameters: objectSchema(
          {
            reason: { type: 'string' },
            assumptions: { type: 'array', items: { type: 'string' } },
            targetCapability: capabilityName,
            explicitConfirmation: { type: 'boolean' },
          },
          ['reason']
        ),
      },
    },
  ];
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function proposalFromToolCall(toolCall: any): ClarificationTransitionProposal | null {
  const name = asText(toolCall?.function?.name || toolCall?.name);
  if (!TRANSITION_TOOL_NAMES.includes(name as any)) return null;
  const args = parseArguments(toolCall?.function?.arguments ?? toolCall?.input);
  return {
    action: name as ClarificationTransitionProposal['action'],
    clarificationType: asText(args.clarificationType) as TaskClarificationType,
    answer: asText(args.answer) || null,
    assumedDefault: asText(args.assumedDefault) || null,
    confidence: asText(args.confidence) as any,
    question: asText(args.question) || null,
    options: Array.isArray(args.options) ? args.options.map((item) => asText(item)).filter(Boolean) : null,
    targetCapability: asText(args.targetCapability) || null,
    riskCapability: asText(args.riskCapability) || null,
    explicitConfirmation: typeof args.explicitConfirmation === 'boolean' ? args.explicitConfirmation : null,
    reason: asText(args.reason) || null,
    newUserIntentSummary: asText(args.newUserIntentSummary) || null,
    assumptions: Array.isArray(args.assumptions) ? args.assumptions.map((item) => asText(item)).filter(Boolean) : null,
  };
}

export class AltusClarificationTransitionAgent {
  private getModelName() {
    return (
      asText(process.env.ALTUS_CLARIFICATION_TRANSITION_MODEL) ||
      asText(process.env.ALTUS_MANAGED_MODEL) ||
      asText(process.env.AGENT_OPENAI_MODEL) ||
      asText(process.env.OPENAI_MODEL) ||
      'claude-haiku-4-5-20251001'
    );
  }

  private isAvailable() {
    if (asText(process.env.ALTUS_CLARIFICATION_TRANSITION_DISABLED).toLowerCase() === 'true') {
      return false;
    }
    return Boolean(asText(process.env.LLM_PROXY_UPSTREAM_BASE_URL));
  }

  async propose(input: TransitionAgentInput): Promise<ClarificationTransitionProposal | null> {
    if (!this.isAvailable()) return null;
    const baseUrl = `http://127.0.0.1:${process.env.PORT || '4000'}/api/llm-proxy/v1/chat/completions`;
    const transcriptMessages = (input.recentMessages || [])
      .filter((item) => asText(item.content))
      .slice(-8)
      .map((item) => ({
        role: item.role,
        content: item.content,
      }));
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.getModelName(),
        messages: [
          {
            role: 'system',
            content: [
              'You are the clarification transition agent for Altus.',
              'Choose exactly one tool call. Do not answer the user directly.',
              'Interpret the user reply semantically. Do not rely on keyword matching.',
              'Judge the latest user reply against the immediately preceding Altus clarification question.',
              'When there is no pending clarification question, judge only the current user request.',
              'If there is no pending clarification question and the current request already names the artifact and delivery scope, call continue_execution.',
              'Examples of enough current-request scope: complete website code only, source code only, local runnable app, tested app, or deploy this app.',
              'A short fragment or option such as "网页应用" is often a complete answer when the pending question lists options.',
              'Use the transcript as the primary context; use the JSON state only to identify the active pending field.',
              'If the user wants advice, planning, discussion, or a proposal before execution, call switch_to_advisory_mode.',
              'If the user delegates a missing choice to Altus, call delegate_to_agent_default.',
              'If the user answered the pending question, call answer_clarification.',
              'After an answer_clarification, do not ask a second optional clarification in the same transition; the main agent can continue with reasonable defaults.',
              'If the user changed topic, call restart_as_new_turn.',
              'Selecting artifact type, scope, tech stack, or advisory mode is not a risky side effect.',
              'Do not call request_risk_confirmation for ordinary answers such as web app, API, local script, complete system, React, Vue, or use your recommendation.',
              'Call request_risk_confirmation only when this reply explicitly authorizes a known protected action: production deploy, external write, or data deletion.',
            ].join('\n'),
          },
          {
            role: 'system',
            content: JSON.stringify({
              activeState: 'clarification_transition',
              currentText: input.currentText,
              pendingClarificationType: input.pendingClarificationType || null,
              pendingQuestion: input.pendingQuestion || null,
              pendingOptions: Array.isArray(input.pendingOptions) ? input.pendingOptions : [],
              intentShape: {
                suggestedIntentType: input.shape.suggestedIntentType,
                artifactKind: input.shape.artifactKind,
                deliveryMode: input.shape.deliveryMode,
                needsClarification: input.shape.needsClarification,
                candidateClarificationType: input.shape.candidateClarificationType,
                candidateClarificationQuestion: input.shape.candidateClarificationQuestion,
              },
            }),
          },
          ...(transcriptMessages.length > 0
            ? transcriptMessages
            : [
                ...(input.pendingQuestion
                  ? [
                      {
                        role: 'assistant',
                        content: input.pendingQuestion,
                      },
                    ]
                  : []),
                {
                  role: 'user',
                  content: input.currentText,
                },
              ]),
        ],
        tools: buildTransitionTools(input),
        tool_choice: 'required',
        temperature: 0,
        max_tokens: 320,
        stream: false,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `clarification_transition_llm_failed:${response.status}`);
    }
    const payload = await response.json() as any;
    const message = payload?.choices?.[0]?.message;
    const toolCall = Array.isArray(message?.tool_calls) ? message.tool_calls[0] : null;
    return proposalFromToolCall(toolCall);
  }
}

export const altusClarificationTransitionAgent = new AltusClarificationTransitionAgent();
