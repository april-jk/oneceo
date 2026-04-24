import { taskCreationFileMemoryStore } from '../agents/task-creation/file-memory-store';
import { AltusManagedToolRuntime } from './altus-managed-tool-runtime';
import {
  altusManagedPromptService,
  type AltusManagedTaskIntentProfile,
} from './altus-managed-prompt-service';
import { connectorGuideService } from './connector-guide-service';
import {
  asText,
  buildManagedToolDefinitionsWithMcp,
  parseToolArguments,
  truncate,
  type ChatMessage,
  type ToolCall,
} from './altus-managed-shared';
import { AltusManagedSetupService, altusManagedSetupService } from './altus-managed-setup-service';
import { AltusRunEventWriter, altusRunEventWriter } from './altus-run-event-writer';
import { AltusRunLifecycleService, altusRunLifecycleService } from './altus-run-lifecycle-service';
import {
  AltusManagedContextBudgetService,
  altusManagedContextBudgetService,
} from './altus-managed-context-budget-service';
import { AltusManagedToolExecutor } from './altus-managed-tool-executor';
import { AltusRunState } from './altus-run-state';
import {
  type AltusRunRecoveryMode,
  type AltusRunTransitionReason,
} from './altus-run-loop-state';
import { sandboxSkillSyncService } from './sandbox-skill-sync-service';
import { taskSessionAltusMemoryService } from './task-session-altus-memory-service';
import { taskSessionSkillStateService } from './task-session-skill-state-service';
import { writeConnectorDebugLog } from '../utils/connector-debug-log';
import {
  TaskSessionDeliverableService,
  taskSessionDeliverableService,
} from './task-session-deliverable-service';
import {
  isValidOpenAiToolCallArguments,
  normalizeOpenAiToolCallArguments,
} from '../utils/openai-chat-sanitizer';

const DELIVERABLES_READY_TEXT = '交付文件已生成';
const DEPLOYMENT_COMPLETION_BLOCKED_PREFIX = 'deployment_completion_blocked:';
const DEPLOYMENT_PENDING_STATUSES = new Set([
  '',
  'unknown',
  'building',
  'deploying',
  'initializing',
  'queued',
  'waiting',
  'pending',
  'provisioning',
]);

type DeploymentCompletionIntent = {
  mode: 'none' | 'deploy' | 'redeploy' | 'rollback';
  acceptedToolNames: string[];
  requiresManagedSuccess: boolean;
};

type DeploymentCompletionEvidence = {
  toolName: string;
  status: string;
  deploymentStatus: string;
  summary: string;
};

type DeploymentToolViewProjection = {
  userView: {
    summary: string;
    preview: string;
    detail: string;
  };
  internalView?: {
    detail: string;
  };
};

type StreamedToolCallDelta = {
  index?: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type StreamedToolCallState = {
  index: number;
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

function basenameLike(value: unknown) {
  const text = asText(value).replace(/\\/g, '/');
  if (!text) return '';
  const normalized = text.replace(/\/+$/, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

type ExtractedJsonStringField = {
  value: string;
  closed: boolean;
};

function decodeJsonStringFragment(value: string) {
  if (!value) return '';
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function extractJsonStringField(raw: string, field: string): ExtractedJsonStringField {
  if (!raw || !field) {
    return { value: '', closed: false };
  }
  const marker = `"${field}"`;
  const markerIndex = raw.indexOf(marker);
  if (markerIndex < 0) {
    return { value: '', closed: false };
  }
  const colonIndex = raw.indexOf(':', markerIndex + marker.length);
  if (colonIndex < 0) {
    return { value: '', closed: false };
  }
  let quoteIndex = colonIndex + 1;
  while (quoteIndex < raw.length && /\s/.test(raw[quoteIndex]!)) {
    quoteIndex += 1;
  }
  if (raw[quoteIndex] !== '"') {
    return { value: '', closed: false };
  }

  let escaped = false;
  let closed = false;
  let cursor = quoteIndex + 1;
  let collected = '';
  while (cursor < raw.length) {
    const char = raw[cursor]!;
    if (escaped) {
      collected += char;
      escaped = false;
      cursor += 1;
      continue;
    }
    if (char === '\\') {
      collected += char;
      escaped = true;
      cursor += 1;
      continue;
    }
    if (char === '"') {
      closed = true;
      break;
    }
    collected += char;
    cursor += 1;
  }

  return {
    value: decodeJsonStringFragment(collected),
    closed,
  };
}

function buildWriteFileProgress(rawArguments: string) {
  const pathField = extractJsonStringField(rawArguments, 'path');
  const contentField = extractJsonStringField(rawArguments, 'content');
  const generatedChars = contentField.value.length;
  const preview = contentField.value;
  return {
    path: pathField.value || '',
    generatedChars,
    preview,
    contentClosed: contentField.closed,
  };
}

function sanitizeMessagesForModel(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    let nextMessage = message;
    if (Array.isArray(message.content)) {
      nextMessage = {
        ...nextMessage,
        content: message.content.map((part) => {
          if (part?.type !== 'image_url') {
            return part;
          }
          return {
            type: 'image_url' as const,
            image_url: {
              url: part.image_url.url,
            },
          };
        }),
      };
    }

    if (Array.isArray(message.tool_calls)) {
      nextMessage = {
        ...nextMessage,
        tool_calls: message.tool_calls.map((toolCall) => ({
          ...toolCall,
          function: {
            ...toolCall.function,
            arguments: normalizeOpenAiToolCallArguments(toolCall?.function?.arguments),
          },
        })),
      };
    }

    return nextMessage;
  });
}

function hasVisionInput(messages: ChatMessage[]) {
  return messages.some((message) => {
    if (!Array.isArray(message.content)) return false;
    return message.content.some((part) => part?.type === 'image_url' && Boolean(part.image_url?.url));
  });
}

export class AltusRunCoordinator {
  constructor(
    private readonly setupService: AltusManagedSetupService = altusManagedSetupService,
    private readonly eventWriter: AltusRunEventWriter = altusRunEventWriter,
    private readonly lifecycleService: AltusRunLifecycleService = altusRunLifecycleService,
    private readonly deliverableService: TaskSessionDeliverableService = taskSessionDeliverableService,
    private readonly budgetService: AltusManagedContextBudgetService = altusManagedContextBudgetService
  ) {}

  private getModelName(messages: ChatMessage[], fallbackModel?: string | null) {
    const needsVision = hasVisionInput(messages);
    if (needsVision) {
      return (
        asText(process.env.ALTUS_MANAGED_VISION_MODEL) ||
        asText(process.env.AGENT_OPENAI_VISION_MODEL) ||
        'qwen3-vl-plus'
      );
    }
    return (
      asText(process.env.ALTUS_MANAGED_MODEL) ||
      asText(fallbackModel) ||
      asText(process.env.AGENT_OPENAI_MODEL) ||
      asText(process.env.OPENAI_MODEL) ||
      'claude-haiku-4-5-20251001'
    );
  }

  private getMaxToolRounds() {
    const fallback = 192;
    const parsed = Number(process.env.ALTUS_MANAGED_MAX_TOOL_ROUNDS || fallback);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(384, Math.floor(parsed));
  }

  private getModelRetryLimit() {
    const fallback = 3;
    const parsed = Number(process.env.ALTUS_MANAGED_MODEL_RETRIES || fallback);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.min(5, Math.floor(parsed));
  }

  private getModelRetryDelayMs(attempt: number) {
    const parsed = Number(process.env.ALTUS_MANAGED_MODEL_RETRY_DELAY_MS || 800);
    const baseDelay = !Number.isFinite(parsed) || parsed <= 0 ? 800 : Math.floor(parsed);
    return Math.min(5000, baseDelay * Math.max(1, attempt));
  }

  private async delay(ms: number) {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async flushSandboxSkillMemory(
    state: AltusRunState,
    reason: 'waiting_user' | 'completed' | 'failed' | 'stopped'
  ) {
    if (!state.sandboxId || !state.workspaceRoot) return;
    try {
      await taskSessionSkillStateService.saveSandboxFileMemoryToDb({
        sessionId: state.input.sessionId,
        sandboxId: state.sandboxId,
        workspaceRoot: state.workspaceRoot,
        reason,
      });
    } catch (error) {
      console.warn('[ALTUS_RUN_SKILL_MEMORY_FLUSH_WARN]', {
        sessionId: state.input.sessionId,
        runId: state.input.runId,
        sandboxId: state.sandboxId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async flushSandboxAltusMemory(
    state: AltusRunState,
    reason: 'waiting_user' | 'completed' | 'failed' | 'stopped'
  ) {
    if (!state.sandboxId || !state.workspaceRoot) {
      try {
        const next = await taskSessionAltusMemoryService.saveTimelineDerivedMemory({
          sessionId: state.input.sessionId,
          runId: state.input.runId,
          reason,
        });
        state.input.sessionAltusMemory = next;
      } catch (error) {
        console.warn('[ALTUS_RUN_MEMORY_DERIVED_FLUSH_WARN]', {
          sessionId: state.input.sessionId,
          runId: state.input.runId,
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    try {
      const next = await taskSessionAltusMemoryService.saveSandboxFileMemoryToDb({
        sessionId: state.input.sessionId,
        sandboxId: state.sandboxId,
        workspaceRoot: state.workspaceRoot,
        runId: state.input.runId,
        reason,
      });
      state.input.sessionAltusMemory = next;
    } catch (error) {
      console.warn('[ALTUS_RUN_MEMORY_FLUSH_WARN]', {
        sessionId: state.input.sessionId,
        runId: state.input.runId,
        sandboxId: state.sandboxId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private extractModelError(error: unknown) {
    const raw = error instanceof Error ? error.message : String(error || 'managed_model_error');
    try {
      const parsed = JSON.parse(raw) as {
        error?: {
          message?: unknown;
          type?: unknown;
          code?: unknown;
        };
      };
      const payload = parsed?.error;
      return {
        raw,
        message: asText(payload?.message) || raw,
        type: asText(payload?.type),
        code: asText(payload?.code),
      };
    } catch {
      return {
        raw,
        message: raw,
        type: '',
        code: '',
      };
    }
  }

  private isRetryableModelError(error: unknown) {
    const parsed = this.extractModelError(error);
    const normalized = `${parsed.code} ${parsed.type} ${parsed.message}`.toLowerCase();
    return (
      normalized.includes('upstream_timeout') ||
      normalized.includes('upstream_unavailable') ||
      normalized.includes('fetch failed') ||
      normalized.includes('network error')
    );
  }

  private isClarificationResponse(content: string) {
    const normalized = asText(content);
    if (!normalized) return false;
    if (/[?？]/.test(normalized)) return true;
    const keywords = [
      'please clarify',
      'please confirm',
      'could you clarify',
      'can you clarify',
      'what kind',
      'what would you like',
      'which option',
      'please specify',
      'tell me what you want me to do',
      '请说明',
      '请确认',
      '请告诉我',
      '请直接告诉我',
      '请明确',
      '请问',
      '请补充',
      '给出具体指令',
      '具体任务',
      '为了更有针对性',
      '希望优化哪些方面',
      '是否需要',
      '能否提供',
      '哪个',
      '哪种',
      '哪一个',
    ];
    const lower = normalized.toLowerCase();
    return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
  }

  private isPlainTextCapabilityQuestion(userInput: string) {
    const normalized = asText(userInput).toLowerCase();
    if (!normalized) return false;
    const capabilityKeywords = [
      '你能做什么',
      '你可以做什么',
      '你会做什么',
      '能做什么',
      '还能做什么',
      '有什么功能',
      '怎么用',
      '如何使用',
      '什么？',
      '什么?',
      'what can you do',
      'what else can you do',
      'what do you do',
      'how can i use you',
      'help',
      'capabilities',
    ];
    return capabilityKeywords.some((keyword) => normalized.includes(keyword));
  }

  private shouldAcceptPlainTextConversationCompletion(userInput: string, assistantContent: string) {
    const normalizedInput = asText(userInput).toLowerCase();
    const normalizedAssistant = asText(assistantContent);
    if (!normalizedInput || !normalizedAssistant) return false;

    if (this.isPlainTextCapabilityQuestion(normalizedInput)) {
      return true;
    }

    const conversationKeywords = [
      '我是谁',
      '你是谁',
      '记得我吗',
      '你还记得我吗',
      '我叫什么',
      '我的名字',
      '我的职业',
      '我的身份',
      '我在哪',
      '我的所在地',
      '我的偏好',
      '你知道我什么',
      '介绍一下我',
      'who am i',
      'who are you',
      'do you remember me',
      'what is my name',
      'what do you know about me',
      'what are my preferences',
      'where am i from',
    ];
    const actionKeywords = [
      '帮我',
      '请帮',
      '修复',
      '开发',
      '实现',
      '创建',
      '修改',
      '部署',
      '上线',
      '调试',
      '测试',
      '检查',
      '分析',
      '查一下',
      'run ',
      'debug',
      'fix ',
      'build ',
      'deploy',
      'implement',
      'create ',
      'write ',
      'search ',
      'test ',
      'investigate',
    ];
    if (!conversationKeywords.some((keyword) => normalizedInput.includes(keyword))) {
      return false;
    }
    if (actionKeywords.some((keyword) => normalizedInput.includes(keyword))) {
      return false;
    }
    return !this.isClarificationResponse(normalizedAssistant);
  }

  private buildContinuationReminder(assistantContent: string) {
    const reminder = [
      'System reminder: continue from the latest tool result.',
      'Do not repeat the request or ask for optional clarification unless the task is truly blocked.',
      'Choose the next required tool call immediately, or call complete_task if the work is already done and verified.',
    ];
    const excerpt = truncate(asText(assistantContent), 600);
    if (!excerpt) {
      return reminder.join(' ');
    }
    return `${reminder.join(' ')} Latest plain assistant text: ${excerpt}`;
  }

  private resolvePreExecutionClarificationQuestion(state: AltusRunState) {
    const profile = state.input.taskIntentProfile;
    const question = asText(profile?.clarificationQuestion);
    if (!profile?.needsClarification || !question) {
      return '';
    }
    return question;
  }

  private resolvePreExecutionClarificationOptions(state: AltusRunState) {
    const profile = state.input.taskIntentProfile;
    if (!profile?.needsClarification || !Array.isArray(profile.clarificationOptions)) {
      return undefined;
    }
    const options = profile.clarificationOptions.map((item) => asText(item)).filter(Boolean);
    return options.length > 0 ? options : undefined;
  }

  private resolvePreExecutionClarificationType(state: AltusRunState) {
    const profile = state.input.taskIntentProfile;
    return profile?.needsClarification && profile.clarificationType !== 'none'
      ? profile.clarificationType
      : undefined;
  }

  private async finalizePlainTextConversationCompletion(
    state: AltusRunState,
    assistantContent: string,
    assistantStreamMessageKey: string,
  ) {
    const finalContent = truncate(asText(assistantContent), 24000).trim();
    if (!finalContent) {
      throw new Error('managed_plain_text_conversation_completion_empty');
    }
    await this.setupService.persistTimelineMessage({
      sessionId: state.input.sessionId,
      role: 'agent',
      messageType: 'assistant_message',
      content: finalContent,
      metadata: {
        agent: 'altus',
        runId: state.input.runId,
        completionMode: 'plain_text_conversation',
      },
      messageKey: assistantStreamMessageKey,
    });
    await this.eventWriter.appendRunEvent(
      state.input.runId,
      state.input.sessionId,
      state.input.userId,
      'assistant_message',
      {
        content: finalContent,
        messageKey: assistantStreamMessageKey,
        completionMode: 'plain_text_conversation',
      }
    );
    return { outcome: 'completed' as const, content: finalContent, deliverables: [] };
  }

  private resolveDeploymentCompletionIntent(
    userInput: string,
    taskIntentProfile?: AltusManagedTaskIntentProfile
  ): DeploymentCompletionIntent {
    if (taskIntentProfile && !taskIntentProfile.deploymentAllowed) {
      return {
        mode: 'none',
        acceptedToolNames: [],
        requiresManagedSuccess: false,
      };
    }
    const normalized = asText(userInput).toLowerCase();
    if (!normalized) {
      return {
        mode: 'none',
        acceptedToolNames: [],
        requiresManagedSuccess: false,
      };
    }

    const includesAny = (keywords: string[]) => keywords.some((keyword) => normalized.includes(keyword));
    if (
      includesAny([
        '不要部署',
        '不需要部署',
        '无需部署',
        '不要发布',
        '不需要发布',
        '无需发布',
        '不要上线',
        '无需上线',
        'do not deploy',
        "don't deploy",
        'no deploy',
        'do not publish',
      ])
    ) {
      return {
        mode: 'none',
        acceptedToolNames: [],
        requiresManagedSuccess: false,
      };
    }

    if (
      includesAny([
        '回滚',
        '回退部署',
        '恢复上一个部署',
        'rollback',
        'revert deployment',
      ])
    ) {
      return {
        mode: 'rollback',
        acceptedToolNames: ['rollback_application_deployment', 'get_application_deployment_status'],
        requiresManagedSuccess: true,
      };
    }

    if (
      includesAny([
        '重新部署',
        '重部署',
        '再部署',
        '重新发布',
        '再次发布',
        'redeploy',
      ])
    ) {
      return {
        mode: 'redeploy',
        acceptedToolNames: ['redeploy_application', 'deploy_application', 'get_application_deployment_status'],
        requiresManagedSuccess: true,
      };
    }

    if (
      includesAny([
        '部署',
        '发布',
        '上线',
        'deploy',
        'go live',
      ])
    ) {
      return {
        mode: 'deploy',
        acceptedToolNames: ['deploy_application', 'redeploy_application', 'get_application_deployment_status'],
        requiresManagedSuccess: true,
      };
    }

    return {
      mode: 'none',
      acceptedToolNames: [],
      requiresManagedSuccess: false,
    };
  }

  private parseDeploymentCompletionEvidence(content: string): DeploymentCompletionEvidence | null {
    const raw = asText(content);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        toolName: asText(parsed.toolName),
        status: asText(parsed.status).toLowerCase(),
        deploymentStatus: asText(parsed.deploymentStatus).toLowerCase(),
        summary: asText(parsed.summary),
      };
    } catch {
      return null;
    }
  }

  private isManagedDeploymentEvidenceSuccessful(
    intent: DeploymentCompletionIntent,
    evidence: DeploymentCompletionEvidence | null
  ) {
    if (!intent.requiresManagedSuccess || !evidence) {
      return false;
    }
    if (!intent.acceptedToolNames.includes(evidence.toolName)) {
      return false;
    }
    if (evidence.status !== 'success') {
      return false;
    }
    if (evidence.toolName !== 'get_application_deployment_status') {
      return true;
    }
    return !DEPLOYMENT_PENDING_STATUSES.has(evidence.deploymentStatus);
  }

  private buildDeploymentCompletionBlockedError(
    intent: DeploymentCompletionIntent,
    evidence: DeploymentCompletionEvidence | null
  ) {
    const lastTool = evidence?.toolName || 'none';
    const lastStatus = evidence?.status || 'unknown';
    const lastDeploymentStatus = evidence?.deploymentStatus || 'unknown';
    const mode = intent.mode || 'deploy';
    return [
      DEPLOYMENT_COMPLETION_BLOCKED_PREFIX,
      `current request is ${mode}`,
      'managed deployment is not successful yet',
      `last_tool=${lastTool}`,
      `last_status=${lastStatus}`,
      `last_deployment_status=${lastDeploymentStatus}`,
      'do_not_treat_debug_open_page_or_local_server_as_deploy_success',
      'repair_and_call_the_managed_deployment_tool_again',
    ].join(' ');
  }

  private isDeploymentTool(toolName: string) {
    return (
      toolName === 'deploy_application' ||
      toolName === 'redeploy_application' ||
      toolName === 'rollback_application_deployment' ||
      toolName === 'get_application_deployment_status'
    );
  }

  private buildDeploymentToolViewProjection(
    toolName: string,
    rawResultContent: string
  ): DeploymentToolViewProjection | null {
    const raw = asText(rawResultContent);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const repair = parsed.repair && typeof parsed.repair === 'object' ? (parsed.repair as Record<string, unknown>) : {};
      const debug = parsed.debug && typeof parsed.debug === 'object' ? (parsed.debug as Record<string, unknown>) : {};
      const summary = asText(parsed.summary);
      const status = asText(parsed.status);
      const phase = asText(parsed.phase);
      const deploymentStatus = asText(parsed.deploymentStatus);
      const url = asText(parsed.url);
      const deploymentId = asText(parsed.deploymentId);
      const repairCategory = asText(repair.category);
      const repairChecks = Array.isArray(repair.checks)
        ? repair.checks.map((item) => asText(item)).filter(Boolean)
        : [];
      const suggestedActions = Array.isArray(repair.suggestedActions)
        ? repair.suggestedActions.map((item) => asText(item)).filter(Boolean)
        : [];
      const baselineErrors = Array.isArray(debug.baselineErrors)
        ? debug.baselineErrors.map((item) => asText(item)).filter(Boolean)
        : [];

      const publicLines: string[] = [];
      if (summary) publicLines.push(summary);
      if (status === 'retryable_repair_required') {
        publicLines.push(
          repairCategory === 'resource_binding'
            ? 'Altus 正在优先修复平台部署资源绑定，并将在资源恢复后重试发布。'
            : 'Altus 正在按平台部署基线自动修复后重试。'
        );
      } else if (deploymentStatus) {
        publicLines.push(`当前状态：${deploymentStatus}`);
      }
      if (url) {
        publicLines.push(`访问地址：${url}`);
      }
      const publicDetail = publicLines.filter(Boolean).join('\n');
      const publicPreview = url
        ? `访问地址 ${url}`
        : status === 'retryable_repair_required'
          ? repairCategory === 'resource_binding'
            ? '已识别到平台部署资源问题，Altus 正在修复绑定后重试。'
            : '已识别到发布配置问题，Altus 正在自动修复后重试。'
          : summary || this.buildToolEventContent(toolName, 'completed');

      const internalLines: string[] = [];
      internalLines.push(`工具: ${toolName}`);
      if (phase) internalLines.push(`phase: ${phase}`);
      if (status) internalLines.push(`status: ${status}`);
      if (deploymentStatus) internalLines.push(`deploymentStatus: ${deploymentStatus}`);
      if (url) internalLines.push(`url: ${url}`);
      if (deploymentId) internalLines.push(`deploymentId: ${deploymentId}`);
      if (repairCategory) internalLines.push(`repairCategory: ${repairCategory}`);
      if (repairChecks.length > 0) internalLines.push(`repairChecks: ${repairChecks.join(', ')}`);
      if (suggestedActions.length > 0) internalLines.push(`suggestedActions: ${suggestedActions.join(' | ')}`);
      if (asText(debug.rawError)) internalLines.push(`rawError: ${asText(debug.rawError)}`);
      if (asText(debug.baselineStatus)) internalLines.push(`baselineStatus: ${asText(debug.baselineStatus)}`);
      if (baselineErrors.length > 0) internalLines.push(`baselineErrors: ${baselineErrors.join(' | ')}`);
      if (asText(debug.latestStatus)) internalLines.push(`latestStatus: ${asText(debug.latestStatus)}`);
      if (asText(debug.latestUrl)) internalLines.push(`latestUrl: ${asText(debug.latestUrl)}`);

      return {
        userView: {
          summary: summary || this.buildToolEventContent(toolName, 'completed'),
          preview: publicPreview,
          detail: publicDetail || (summary || this.buildToolEventContent(toolName, 'completed')),
        },
        internalView:
          internalLines.length > 0
            ? {
                detail: internalLines.join('\n'),
              }
            : undefined,
      };
    } catch {
      return null;
    }
  }

  private buildToolEventContent(
    toolName: string,
    status: 'started' | 'progress' | 'completed' | 'failed'
  ) {
    if (toolName === 'deploy_application') {
      if (status === 'started' || status === 'progress') return '正在准备发布应用';
      if (status === 'completed') return '发布工具已完成';
      return '发布暂未完成';
    }
    if (toolName === 'redeploy_application') {
      if (status === 'started' || status === 'progress') return '正在重新发布应用';
      if (status === 'completed') return '重新发布工具已完成';
      return '重新发布暂未完成';
    }
    if (toolName === 'rollback_application_deployment') {
      if (status === 'started' || status === 'progress') return '正在回滚部署';
      if (status === 'completed') return '回滚工具已完成';
      return '回滚暂未完成';
    }
    if (toolName === 'get_application_deployment_status') {
      if (status === 'started' || status === 'progress') return '正在查询部署状态';
      if (status === 'completed') return '部署状态查询已完成';
      return '部署状态查询暂未完成';
    }
    if (status === 'started') return `调用工具 ${toolName}`;
    if (status === 'completed') return `工具 ${toolName} 已完成`;
    if (status === 'failed') return `工具 ${toolName} 失败`;
    return `正在准备工具 ${toolName}`;
  }

  private buildPostToolRunStatusContent(input: {
    toolName: string;
    args?: Record<string, unknown>;
    outcome: 'completed' | 'failed';
    transitionReason?: AltusRunTransitionReason;
    error?: string;
  }) {
    const toolName = asText(input.toolName);
    const args = input.args || {};
    const pathValue = asText(args.path);
    const commandValue = asText(args.command);
    const urlValue = asText(args.url);
    const displayPath = basenameLike(pathValue);
    const lowerDisplayPath = displayPath.toLowerCase();

    if (input.outcome === 'failed') {
      if (toolName === 'shell_execute') {
        return '刚才那一步执行没成功，我换个方式继续';
      }
      if (toolName === 'debug_open_page') {
        return '页面打开得不太对，我正在检查启动方式和访问地址';
      }
      if (toolName === 'write_file') {
        return displayPath
          ? `${displayPath} 这一步出了点问题，我先修正后继续`
          : '刚才写文件时出了点问题，我先修正后继续';
      }
      if (toolName === 'complete_task') {
        return '最后收尾检查还没过，我再修一下';
      }
      return '刚才那一步没成功，我调整后继续';
    }

    if (toolName === 'write_file') {
      if (lowerDisplayPath === 'index.html') {
        return '页面框架已经搭好，我继续把样式和交互补完整';
      }
      if (lowerDisplayPath === 'style.css') {
        return '界面样式已经整理好了，我继续补上操作逻辑';
      }
      if (lowerDisplayPath === 'script.js' || lowerDisplayPath === 'game.js') {
        return '主要交互已经接上了，我继续补齐运行需要的内容';
      }
      if (lowerDisplayPath === 'package.json') {
        return '项目运行配置已经准备好，我继续把启动流程收好';
      }
      if (lowerDisplayPath === 'server.js') {
        return '预览服务已经准备好，我继续检查能不能顺利跑起来';
      }
      if (lowerDisplayPath === 'oneceo.manifest.json') {
        return '发布清单已经准备好，我继续做最后检查';
      }
      return displayPath
        ? `${displayPath} 已经处理好了，我继续完善剩下的部分`
        : '这一部分已经处理好了，我继续完善剩下的部分';
    }
    if (toolName === 'read_file') {
      return displayPath
        ? `${displayPath} 我已经看过了，接着往下处理`
        : '这部分内容我已经看过了，接着往下处理';
    }
    if (toolName === 'list_directory') {
      return '目录结构已经理清了，我继续往下完善';
    }
    if (toolName === 'search_code') {
      const queryValue = asText(args.query);
      return queryValue
        ? `和“${queryValue}”相关的位置我已经找到了，继续往下处理`
        : '相关代码位置我已经找到了，继续往下处理';
    }
    if (toolName === 'shell_execute') {
      if (commandValue.includes('mkdir')) {
        return '运行环境已经准备好了，我开始生成项目内容';
      }
      if (commandValue.includes('ls')) {
        return '文件我已经核对过了，接着做最后整理';
      }
      return '这一步已经跑完了，我继续处理后面的内容';
    }
    if (toolName === 'debug_open_page') {
      return '页面已经打开，我正在确认实际效果';
    }
    if (toolName === 'get_application_deployment_status') {
      return '部署状态我已经拿到了，正在确认是否一切正常';
    }
    if (toolName === 'deploy_application' || toolName === 'redeploy_application') {
      return '部署已经发出去了，我继续盯一下结果';
    }
    if (toolName === 'rollback_application_deployment') {
      return '回滚已经开始，我继续确认是否恢复正常';
    }
    return '这一步已经完成，我继续处理下一步';
  }

  private sanitizeToolEventError(toolName: string, errorMessage: string) {
    if (errorMessage.startsWith(DEPLOYMENT_COMPLETION_BLOCKED_PREFIX)) {
      return '线上部署尚未完成，Altus 将继续修复并重试发布。';
    }
    if (errorMessage.startsWith('deployment_tool_not_allowed_without_explicit_request')) {
      return '当前任务没有明确部署请求，Altus 已阻止误触发部署，并将继续按交付物生成处理。';
    }
    if (!this.isDeploymentTool(toolName)) {
      return errorMessage;
    }
    if (toolName === 'get_application_deployment_status') {
      return '当前还无法获取部署状态，内部调试信息已记录。';
    }
    if (toolName === 'rollback_application_deployment') {
      return '当前还无法回滚部署，内部调试信息已记录。';
    }
    return '发布暂未完成，内部调试信息已记录。';
  }

  private async requestClarification(
    state: AltusRunState,
    input: {
      question: string;
      options?: string[];
      clarificationType?: Exclude<AltusManagedTaskIntentProfile['clarificationType'], 'none'>;
    }
  ) {
    const clarificationMessageKey = `managed:${state.input.runId}:clarification`;
    await taskCreationFileMemoryStore.setPendingClarification(
      state.input.sessionId,
      input.question,
      input.options,
      input.clarificationType
    );
    await this.setupService.persistTimelineMessage({
      sessionId: state.input.sessionId,
      role: 'agent',
      messageType: 'clarification_request',
      content: input.question,
      metadata: {
        question: input.question,
        options: input.options,
        clarificationType: input.clarificationType,
        runId: state.input.runId,
      },
      messageKey: clarificationMessageKey,
    });
    await this.eventWriter.appendRunEvent(
      state.input.runId,
      state.input.sessionId,
      state.input.userId,
      'clarification_requested',
      {
      question: input.question,
      options: input.options,
      clarificationType: input.clarificationType,
      content: input.question,
      messageKey: clarificationMessageKey,
      transitionReason: 'clarification_requested',
      }
    );
    return {
      outcome: 'waiting_user' as const,
      question: input.question,
      options: input.options,
    };
  }

  private async callModel(input: {
    messages: ChatMessage[];
    signal: AbortSignal;
    mcpProviders?: any[];
    onToolCallDelta?: (toolCall: ToolCall) => Promise<void> | void;
    onAssistantTextDelta?: (deltaText: string, fullText: string) => Promise<void> | void;
    fallbackModel?: string | null;
  }) {
    const baseUrl = `http://127.0.0.1:${process.env.PORT || '4000'}/api/llm-proxy/v1/chat/completions`;
    const projectedMessages = this.budgetService.projectMessagesForModel(input.messages);
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.getModelName(projectedMessages, input.fallbackModel),
        messages: sanitizeMessagesForModel(projectedMessages),
        tools: buildManagedToolDefinitionsWithMcp({
          mcpProviders: Array.isArray(input.mcpProviders) ? input.mcpProviders : [],
        }),
        tool_choice: 'auto',
        temperature: 0.2,
        stream: true,
      }),
      signal: input.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `llm_proxy_failed:${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream') && response.body) {
      return this.readStreamedModelChoice({
        response,
        signal: input.signal,
        onToolCallDelta: input.onToolCallDelta,
        onAssistantTextDelta: input.onAssistantTextDelta,
      });
    }

    const payload = (await response.json()) as any;
    const choice = payload?.choices?.[0]?.message;
    if (!choice || typeof choice !== 'object') {
      throw new Error('managed_model_empty_choice');
    }
    return choice as {
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }

  private async callModelWithRetry(input: {
    messages: ChatMessage[];
    signal: AbortSignal;
    mcpProviders?: any[];
    onToolCallDelta?: (toolCall: ToolCall) => Promise<void> | void;
    onAssistantTextDelta?: (deltaText: string, fullText: string) => Promise<void> | void;
    onRetryableError?: (error: unknown, attempt: number, delayMs: number) => Promise<void> | void;
    fallbackModel?: string | null;
  }) {
    const maxAttempts = Math.max(1, this.getModelRetryLimit() + 1);
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (input.signal.aborted) {
        throw new Error('managed_run_aborted');
      }
      try {
        return await this.callModel(input);
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !this.isRetryableModelError(error)) {
          throw error;
        }
        const delayMs = this.getModelRetryDelayMs(attempt);
        await input.onRetryableError?.(error, attempt, delayMs);
        await this.delay(delayMs);
      }
    }
    throw (lastError instanceof Error ? lastError : new Error(String(lastError || 'managed_model_error')));
  }

  private async syncLoopSnapshot(
    state: AltusRunState,
    input: {
      lastTransitionReason: AltusRunTransitionReason;
      recoveryMode?: AltusRunRecoveryMode;
      currentRound?: number;
      maxRounds?: number;
      plainTextRecoveryUsed?: boolean;
      lastToolName?: string | null;
      lastToolCallId?: string | null;
    }
  ) {
    await (this.lifecycleService as AltusRunLifecycleService & {
      syncLoopSnapshot?: (state: AltusRunState, loop: Record<string, unknown>) => Promise<void>;
    }).syncLoopSnapshot?.(state, {
      ...input,
      updatedAt: new Date(),
    });
  }

  private parseSseBlock(rawBlock: string) {
    const lines = rawBlock.split(/\r?\n/);
    const dataLines: string[] = [];
    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }
    if (dataLines.length === 0) return null;
    const rawData = dataLines.join('\n');
    if (rawData === '[DONE]') {
      return { done: true as const, payload: null };
    }
    try {
      return {
        done: false as const,
        payload: JSON.parse(rawData) as any,
      };
    } catch {
      return null;
    }
  }

  private mergeStreamToolCall(
    toolCallsByIndex: Map<number, StreamedToolCallState>,
    delta: StreamedToolCallDelta
  ) {
    const index = Number.isFinite(delta?.index) ? Math.max(0, Math.floor(Number(delta.index))) : 0;
    const existing =
      toolCallsByIndex.get(index) ||
      ({
        index,
        id: '',
        type: 'function',
        function: {
          name: '',
          arguments: '',
        },
      } satisfies StreamedToolCallState);

    const incomingId = asText(delta?.id);
    if (incomingId) {
      existing.id = incomingId;
    }

    const incomingType = asText(delta?.type);
    if (incomingType === 'function') {
      existing.type = 'function';
    }

    const incomingName = asText(delta?.function?.name);
    if (incomingName) {
      if (!existing.function.name) {
        existing.function.name = incomingName;
      } else if (!existing.function.name.endsWith(incomingName)) {
        existing.function.name += incomingName;
      }
    }

    const incomingArguments = typeof delta?.function?.arguments === 'string' ? delta.function.arguments : '';
    if (incomingArguments) {
      existing.function.arguments += incomingArguments;
    }

    toolCallsByIndex.set(index, existing);
    return existing;
  }

  private toToolCalls(toolCallsByIndex: Map<number, StreamedToolCallState>): ToolCall[] {
    return Array.from(toolCallsByIndex.entries())
      .sort(([left], [right]) => left - right)
      .map(([index, toolCall]) => ({
        id: toolCall.id || `streamed_tool_${index}`,
        type: 'function',
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments || '{}',
        },
      }));
  }

  private async readStreamedModelChoice(input: {
    response: Response;
    signal: AbortSignal;
    onToolCallDelta?: (toolCall: ToolCall) => Promise<void> | void;
    onAssistantTextDelta?: (deltaText: string, fullText: string) => Promise<void> | void;
  }) {
    const decoder = new TextDecoder();
    let buffer = '';
    let assistantContent = '';
    const toolCallsByIndex = new Map<number, StreamedToolCallState>();

    const flushBlock = async (rawBlock: string) => {
      const parsed = this.parseSseBlock(rawBlock);
      if (!parsed) return false;
      if (parsed.done) return true;

      const payload = parsed.payload;
      if (payload?.error && typeof payload.error === 'object') {
        throw new Error(JSON.stringify(payload));
      }

      const choice = payload?.choices?.[0];
      const delta = choice?.delta;

      if (typeof delta?.content === 'string' && delta.content) {
        assistantContent += delta.content;
        if (input.onAssistantTextDelta) {
          await input.onAssistantTextDelta(delta.content, assistantContent);
        }
      }

      if (Array.isArray(delta?.tool_calls)) {
        for (const toolCallDelta of delta.tool_calls as StreamedToolCallDelta[]) {
          const merged = this.mergeStreamToolCall(toolCallsByIndex, toolCallDelta);
          if (input.onToolCallDelta) {
            await input.onToolCallDelta({
              id: merged.id || `streamed_tool_${merged.index}`,
              type: 'function',
              function: {
                name: merged.function.name,
                arguments: merged.function.arguments,
              },
            });
          }
        }
      }

      return false;
    };

    for await (const chunk of input.response.body as any) {
      if (input.signal.aborted) {
        throw new Error('managed_run_aborted');
      }
      buffer += decoder.decode(chunk, { stream: true });
      while (true) {
        const separatorIndex = buffer.indexOf('\n\n');
        if (separatorIndex < 0) break;
        const rawBlock = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const done = await flushBlock(rawBlock);
        if (done) {
          return {
            content: assistantContent,
            tool_calls: this.toToolCalls(toolCallsByIndex),
          };
        }
      }
    }

    const tail = buffer.trim();
    if (tail) {
      await flushBlock(tail);
    }

    return {
      content: assistantContent,
      tool_calls: this.toToolCalls(toolCallsByIndex),
    };
  }

  private buildCompletionMessage(summary: string, verification?: string[]) {
    const normalizedSummary = truncate(asText(summary), 8000) || '任务已处理完成。';
    const checks = Array.isArray(verification)
      ? verification.map((item) => truncate(asText(item), 500)).filter(Boolean).slice(0, 8)
      : [];
    if (checks.length === 0) {
      return normalizedSummary;
    }
    return `${normalizedSummary}\n\n验证:\n${checks.map((item) => `- ${item}`).join('\n')}`;
  }

  private resolveFinalAssistantContent(assistantContent: string, completionMessage: string): string {
    const normalizedAssistantContent = truncate(asText(assistantContent), 24000).trim();
    const normalizedCompletionMessage = asText(completionMessage);
    if (!normalizedAssistantContent) {
      return normalizedCompletionMessage;
    }
    if (!normalizedCompletionMessage) {
      return normalizedAssistantContent;
    }
    if (normalizedAssistantContent.includes(normalizedCompletionMessage)) {
      return normalizedAssistantContent;
    }
    if (normalizedCompletionMessage.includes(normalizedAssistantContent)) {
      return normalizedCompletionMessage;
    }
    return normalizedAssistantContent.length >= normalizedCompletionMessage.length
      ? normalizedAssistantContent
      : normalizedCompletionMessage;
  }

  private async runModelLoop(state: AltusRunState, signal: AbortSignal) {
    if (!state.workspaceRoot || !state.sandboxId) {
      throw new Error('managed_run_missing_sandbox_context');
    }

    const runtime = new AltusManagedToolRuntime({
      sessionId: state.input.sessionId,
      userId: state.input.userId,
      sandboxId: state.sandboxId,
      workspaceRoot: state.workspaceRoot,
      userInput: state.input.userInput,
      taskIntentProfile: state.input.taskIntentProfile,
      availableSkills: state.input.skillCatalog,
      activeSkills: state.input.skills,
      mcpProviders: state.input.mcpProviders,
    });
    const toolExecutor = new AltusManagedToolExecutor({
      runId: state.input.runId,
      sessionId: state.input.sessionId,
      userId: state.input.userId,
      runtime,
      eventWriter: this.eventWriter,
      buildToolEventContent: (toolName, phase) => this.buildToolEventContent(toolName, phase),
      sanitizeToolEventError: (toolName, errorMessage) => this.sanitizeToolEventError(toolName, errorMessage),
    });
    const connectorGuideSections = await connectorGuideService.buildPromptSections(state.input.sessionId);
    const systemPrompt = altusManagedPromptService.buildSystemPrompt({
      sessionId: state.input.sessionId,
      sessionTitle: state.input.sessionTitle,
      workspaceRoot: state.workspaceRoot,
      connectors: state.input.connectors as any,
      taskIntentProfile: state.input.taskIntentProfile,
      connectorGuideSections,
    });
    writeConnectorDebugLog('[ALTUS_RUN_PROMPT_READY]', {
      taskSessionId: state.input.sessionId,
      runId: state.input.runId,
      hasConnectorGuideInstructions: Boolean(connectorGuideSections.instructionsSection),
      hasConnectorGuideReminders: Boolean(connectorGuideSections.reminderSection),
      connectorCount: Array.isArray(state.input.connectors) ? state.input.connectors.length : 0,
    });
    const skillCatalogPrompt = altusManagedPromptService.buildSkillCatalogPrompt(state.input.skillCatalog);
    const skillPrompt = altusManagedPromptService.buildSkillContextPrompt(state.input.skills);
    const compositeSystemPrompt = [
      systemPrompt,
      state.input.memoryContextPrompt || '',
      skillCatalogPrompt,
      skillPrompt,
    ]
      .filter(Boolean)
      .join('\n\n');
    const messages = await this.setupService.buildConversationMessages(
      state.input.sessionId,
      state.input.userInput,
      compositeSystemPrompt
    );
    let plainTextRecoveryUsed = false;
    const assistantStreamMessageKey = `managed:${state.input.runId}:assistant`;
    const finalAssistantMessageKey = `managed:${state.input.runId}:assistant:final`;
    const deploymentCompletionIntent = this.resolveDeploymentCompletionIntent(
      state.input.userInput,
      state.input.taskIntentProfile
    );
    let lastDeploymentEvidence: DeploymentCompletionEvidence | null = null;
    const maxToolRounds = this.getMaxToolRounds();
    let nextRoundStatusContent = '正在分析并执行任务';

    for (let round = 0; round < maxToolRounds; round += 1) {
      if (signal.aborted) {
        throw new Error('managed_run_aborted');
      }

      const currentRound = round + 1;
      const roundTransitionReason: AltusRunTransitionReason =
        round === 0 ? 'initial_execution' : 'tool_result_continue';
      await this.syncLoopSnapshot(state, {
        lastTransitionReason: roundTransitionReason,
        recoveryMode: 'none',
        currentRound,
        maxRounds: maxToolRounds,
        plainTextRecoveryUsed,
      });
      if (currentRound >= Math.max(1, maxToolRounds - 1)) {
        await this.syncLoopSnapshot(state, {
          lastTransitionReason: 'tool_round_limit_near',
          recoveryMode: 'context_pressure',
          currentRound,
          maxRounds: maxToolRounds,
          plainTextRecoveryUsed,
        });
      }

      await this.eventWriter.appendRunEvent(
        state.input.runId,
        state.input.sessionId,
        state.input.userId,
        'run_status',
        {
        status: round === 0 ? 'running' : 'waiting_tool',
        content: round === 0 ? '正在分析并执行任务' : nextRoundStatusContent,
        transitionReason: roundTransitionReason,
        currentRound,
        maxRounds: maxToolRounds,
        }
      );

      await this.setupService.refreshInlineImageUrls(messages);

      const toolProgressLengths = new Map<string, number>();
      const assistant = await this.callModelWithRetry({
        messages,
        signal,
        mcpProviders: state.input.mcpProviders,
        fallbackModel: state.input.model,
        onRetryableError: async (error, attempt, delayMs) => {
          const parsed = this.extractModelError(error);
          await this.syncLoopSnapshot(state, {
            lastTransitionReason: 'model_retryable_error',
            recoveryMode: 'model_retry',
            currentRound,
            maxRounds: maxToolRounds,
            plainTextRecoveryUsed,
          });
          await this.eventWriter.appendRunEvent(
            state.input.runId,
            state.input.sessionId,
            state.input.userId,
            'run_status',
            {
              status: 'running',
              content: '模型上游暂时不可用，正在自动重试',
              transitionReason: 'model_retryable_error',
              attempt,
              retryDelayMs: delayMs,
              error: parsed.message,
            }
          );
        },
        onAssistantTextDelta: async (deltaText, fullText) => {
          await this.eventWriter.appendRunEvent(
            state.input.runId,
            state.input.sessionId,
            state.input.userId,
            'assistant_delta',
            {
              content: deltaText,
              fullContent: fullText,
              messageKey: assistantStreamMessageKey,
            }
          );
        },
        onToolCallDelta: async (toolCall) => {
          const toolName = asText(toolCall?.function?.name);
          const toolCallId = asText(toolCall?.id);
          if (!toolName || !toolCallId) return;
          const rawArguments = typeof toolCall?.function?.arguments === 'string' ? toolCall.function.arguments : '';
          const previousLength = toolProgressLengths.get(toolCallId) || 0;
          const currentLength = rawArguments.length;
          const minDeltaLength = toolName === 'write_file' ? 64 : 48;
          if (previousLength > 0 && currentLength - previousLength < minDeltaLength) {
            return;
          }
          toolProgressLengths.set(toolCallId, currentLength);
          const parsedArguments = parseToolArguments(rawArguments);
          const writeFileProgress =
            toolName === 'write_file' ? buildWriteFileProgress(rawArguments) : null;
          const progressContent =
            toolName === 'write_file'
              ? `正在生成文件 ${writeFileProgress?.path || asText(parsedArguments.path) || '(待确认路径)'}（已生成 ${writeFileProgress?.generatedChars || 0} 字符）`
              : this.buildToolEventContent(toolName, 'progress');
          await this.eventWriter.appendRunEvent(
            state.input.runId,
            state.input.sessionId,
            state.input.userId,
            'tool_call_progress',
            {
            toolName,
            content: progressContent,
            arguments: parsedArguments,
            rawArguments,
            toolCallId,
            ...(writeFileProgress ? { writeFileProgress } : {}),
            }
          );
        },
      });
      const assistantContent = truncate(asText(assistant.content), 24000);
      const rawToolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
      const invalidToolCallIds = new Set<string>();
      const toolCalls = rawToolCalls.map((toolCall) => {
        const rawArguments = toolCall?.function?.arguments;
        const toolCallId = asText(toolCall?.id);
        if (!isValidOpenAiToolCallArguments(rawArguments) && toolCallId) {
          invalidToolCallIds.add(toolCallId);
        }
        return {
          ...toolCall,
          function: {
            ...toolCall.function,
            arguments: normalizeOpenAiToolCallArguments(rawArguments),
          },
        };
      });

      if (toolCalls.length === 0) {
        if (assistantContent && this.isClarificationResponse(assistantContent)) {
          await this.syncLoopSnapshot(state, {
            lastTransitionReason: 'clarification_requested',
            recoveryMode: 'awaiting_user',
            currentRound,
            maxRounds: maxToolRounds,
            plainTextRecoveryUsed,
          });
          return this.requestClarification(state, {
            question: assistantContent,
          });
        }
        if (
          assistantContent &&
          this.shouldAcceptPlainTextConversationCompletion(state.input.userInput, assistantContent)
        ) {
          await this.syncLoopSnapshot(state, {
            lastTransitionReason: 'plain_text_conversation_completed',
            recoveryMode: 'none',
            currentRound,
            maxRounds: maxToolRounds,
            plainTextRecoveryUsed,
          });
          await this.eventWriter.appendRunEvent(
            state.input.runId,
            state.input.sessionId,
            state.input.userId,
            'run_status',
            {
              status: 'running',
              content: '识别为纯会话型记忆问答，已直接回复',
              transitionReason: 'plain_text_conversation_completed',
              currentRound,
              maxRounds: maxToolRounds,
            }
          );
          return this.finalizePlainTextConversationCompletion(
            state,
            assistantContent,
            assistantStreamMessageKey,
          );
        }
        if (assistantContent) {
          messages.push({
            role: 'assistant',
            content: assistantContent,
          });
        }
        if (plainTextRecoveryUsed) {
          const plainTextExcerpt = assistantContent
            ? truncate(assistantContent, 1000)
            : 'empty assistant response';
          await this.syncLoopSnapshot(state, {
            lastTransitionReason: 'plain_text_continuation_failed',
            recoveryMode: 'model_retry',
            currentRound,
            maxRounds: maxToolRounds,
            plainTextRecoveryUsed: true,
          });
          await this.eventWriter.appendRunEvent(
            state.input.runId,
            state.input.sessionId,
            state.input.userId,
            'run_status',
            {
              status: 'running',
              content: '模型连续两次未调用工具，停止当前 managed run',
              transitionReason: 'plain_text_continuation_failed',
              currentRound,
              maxRounds: maxToolRounds,
            }
          );
          throw new Error(`managed_model_plain_text_without_tool_call:${plainTextExcerpt}`);
        }
        messages.push({
          role: 'user',
          content: this.buildContinuationReminder(assistantContent),
        });
        plainTextRecoveryUsed = true;
        await this.syncLoopSnapshot(state, {
          lastTransitionReason: 'plain_text_continuation_prompted',
          recoveryMode: 'model_retry',
          currentRound,
          maxRounds: maxToolRounds,
          plainTextRecoveryUsed,
        });
        await this.eventWriter.appendRunEvent(
          state.input.runId,
          state.input.sessionId,
          state.input.userId,
          'run_status',
          {
            status: 'running',
            content: '模型未调用工具，已注入继续执行提醒',
            transitionReason: 'plain_text_continuation_prompted',
            currentRound,
            maxRounds: maxToolRounds,
          }
        );
        continue;
      }

      plainTextRecoveryUsed = false;

      messages.push({
        role: 'assistant',
        content: assistantContent || '',
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        const toolName = asText(toolCall?.function?.name);
        if (!toolName) continue;
        const args = parseToolArguments(asText(toolCall?.function?.arguments));
        if (invalidToolCallIds.has(toolCall.id)) {
          const errorContent = '工具参数不是合法 JSON object，已要求模型重新生成工具调用。';
          await this.eventWriter.appendRunEvent(
            state.input.runId,
            state.input.sessionId,
            state.input.userId,
            'tool_call_failed',
            {
              toolName,
              content: this.buildToolEventContent(toolName, 'failed'),
              arguments: args,
              toolCallId: toolCall.id,
              error: errorContent,
              transitionReason: 'tool_failed_but_recoverable',
            }
          );
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify({
              error: 'invalid_tool_arguments_json',
              detail: 'Tool arguments must be a JSON object string. Retry the tool call with valid JSON object arguments.',
            }),
          });
          nextRoundStatusContent = '模型生成的工具参数格式不合法，已要求重新生成';
          await this.syncLoopSnapshot(state, {
            lastTransitionReason: 'tool_failed_but_recoverable',
            recoveryMode: 'tool_repair',
            currentRound,
            maxRounds: maxToolRounds,
            plainTextRecoveryUsed,
            lastToolName: toolName,
            lastToolCallId: toolCall.id,
          });
          continue;
        }
        const envelope = await toolExecutor.executeToolCall({
          toolCall,
          args,
          signal,
          onResult: (result) => {
            let postToolTransitionReason: AltusRunTransitionReason = 'tool_result_continue';
            let postToolRecoveryMode: AltusRunRecoveryMode = 'none';
            const eventPayload: Record<string, unknown> = {
              outputPreview: truncate(result.content, 4000),
            };

            if (this.isDeploymentTool(toolName)) {
              const evidence = this.parseDeploymentCompletionEvidence(result.content);
              if (evidence) {
                lastDeploymentEvidence = {
                  ...evidence,
                  toolName,
                };
                if (evidence.status === 'retryable_repair_required') {
                  postToolTransitionReason = 'deployment_repair_required';
                  postToolRecoveryMode = 'tool_repair';
                }
              }
              Object.assign(eventPayload, this.buildDeploymentToolViewProjection(toolName, result.content) || {});
            }

            return {
              transitionReason: postToolTransitionReason,
              recoveryMode: postToolRecoveryMode,
              eventPayload: {
                transitionReason: postToolTransitionReason,
                ...eventPayload,
              },
            };
          },
          onFailure: (rawError, sanitizedError) => {
            const failedTransitionReason: AltusRunTransitionReason = rawError.startsWith(DEPLOYMENT_COMPLETION_BLOCKED_PREFIX)
              ? 'deployment_completion_blocked'
              : 'tool_failed_but_recoverable';
            return {
              transitionReason: failedTransitionReason,
              recoveryMode: 'tool_repair',
              eventPayload: this.isDeploymentTool(toolName)
                ? {
                    userView: {
                      summary: sanitizedError,
                      preview: sanitizedError,
                      detail: sanitizedError,
                    },
                    internalView: {
                      detail: [`工具: ${toolName}`, `rawError: ${rawError}`].join('\n'),
                    },
                  }
                : undefined,
            };
          },
        });
        const executionResult = envelope.status === 'failed' ? null : envelope.result;
        if (executionResult && Array.isArray(executionResult.activatedSkills) && executionResult.activatedSkills.length > 0) {
          const autoAttachedPrompt = altusManagedPromptService.buildAutoAttachedSkillPrompt(
            executionResult.activatedSkills,
            toolName,
          );
          messages.push({
            role: 'system',
            content: autoAttachedPrompt,
          });
          await this.setupService.persistTimelineMessage({
            sessionId: state.input.sessionId,
            role: 'system',
            messageType: 'status_update',
            content: `已自动加载技能：${executionResult.activatedSkills.map((item) => item.name).join('、')}`,
            metadata: {
              eventType: 'managed_skill_auto_attached',
              toolName,
              runId: state.input.runId,
              sessionId: state.input.sessionId,
              skillIds: executionResult.activatedSkills.map((item) => item.skillId),
              skillRevisionIds: executionResult.activatedSkills.map((item) => item.revisionId),
              skillSlugs: executionResult.activatedSkills.map((item) => item.slug),
              promptMarkdown: autoAttachedPrompt,
            },
            messageKey: `managed:${state.input.runId}:auto_attached_skills:${toolName}:${toolCall.id}`,
          });
          await this.eventWriter.appendRunEvent(
            state.input.runId,
            state.input.sessionId,
            state.input.userId,
            'run_status',
            {
              status: 'running',
              content: `已自动加载技能：${executionResult.activatedSkills.map((item) => item.name).join('、')}`,
              toolName,
              skillIds: executionResult.activatedSkills.map((item) => item.skillId),
              skillRevisionIds: executionResult.activatedSkills.map((item) => item.revisionId),
              skillSlugs: executionResult.activatedSkills.map((item) => item.slug),
              promptMarkdown: autoAttachedPrompt,
            }
          );
        }

        if (envelope.status === 'ask_user') {
          const result = envelope.result;
            await this.syncLoopSnapshot(state, {
              lastTransitionReason: 'clarification_requested',
              recoveryMode: 'awaiting_user',
              currentRound,
              maxRounds: maxToolRounds,
              plainTextRecoveryUsed,
              lastToolName: toolName,
              lastToolCallId: toolCall.id,
            });
            return this.requestClarification(state, {
              question: result.question,
              options: result.options,
            });
        }

        if (envelope.status === 'complete') {
          const result = envelope.result;
          if (
            toolName === 'complete_task' &&
            deploymentCompletionIntent.requiresManagedSuccess &&
            !this.isManagedDeploymentEvidenceSuccessful(
              deploymentCompletionIntent,
              lastDeploymentEvidence
            )
          ) {
            const blockedMessage = this.buildDeploymentCompletionBlockedError(
              deploymentCompletionIntent,
              lastDeploymentEvidence
            );
            const blockedEventError = this.sanitizeToolEventError(toolName, blockedMessage);
            await this.eventWriter.appendRunEvent(
              state.input.runId,
              state.input.sessionId,
              state.input.userId,
              'tool_call_failed',
              {
                toolName,
                content: this.buildToolEventContent(toolName, 'failed'),
                arguments: args,
                toolCallId: toolCall.id,
                error: blockedEventError,
                transitionReason: 'deployment_completion_blocked',
                userView: {
                  summary: blockedEventError,
                  preview: blockedEventError,
                  detail: blockedEventError,
                },
                internalView: {
                  detail: [`工具: ${toolName}`, `rawError: ${blockedMessage}`].join('\n'),
                },
              }
            );
            await this.syncLoopSnapshot(state, {
              lastTransitionReason: 'deployment_completion_blocked',
              recoveryMode: 'tool_repair',
              currentRound,
              maxRounds: maxToolRounds,
              plainTextRecoveryUsed,
              lastToolName: toolName,
              lastToolCallId: toolCall.id,
            });
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolName,
              content: JSON.stringify({
                error: blockedMessage,
              }),
            });
            continue;
          }

            if (!state.sandboxId || !state.workspaceRoot) {
              throw new Error('managed_run_missing_sandbox_context');
            }
            const deliverables = await this.deliverableService.persistManagedRunDeliverables({
              sessionId: state.input.sessionId,
              runId: state.input.runId,
              sandboxId: state.sandboxId,
              workspaceRoot: state.workspaceRoot,
              attachments: result.attachments || [],
            });
            state.deliverables = deliverables;
            const completionMessage = this.buildCompletionMessage(result.summary, result.verification);
            const finalContent = this.resolveFinalAssistantContent(assistantContent, completionMessage);
            if (deliverables.length > 0) {
              await this.setupService.persistTimelineMessage({
                sessionId: state.input.sessionId,
                role: 'system',
                messageType: 'status_update',
                content: DELIVERABLES_READY_TEXT,
                metadata: {
                  stage: 'reviewing',
                  tone: 'review',
                  eventType: 'deliverables_ready',
                  runId: state.input.runId,
                  sessionId: state.input.sessionId,
                  executor: 'altus',
                  executionMode: 'managed',
                  deliverables,
                },
                messageKey: `managed:${state.input.runId}:deliverables_ready`,
              });
              await this.eventWriter.appendRunEvent(
                state.input.runId,
                state.input.sessionId,
                state.input.userId,
                'deliverables_ready',
                {
                  content: DELIVERABLES_READY_TEXT,
                  deliverables,
                }
              );
            }
            await this.eventWriter.appendRunEvent(
              state.input.runId,
              state.input.sessionId,
              state.input.userId,
              'tool_call_completed',
              {
              toolName,
              content: this.buildToolEventContent(toolName, 'completed'),
              arguments: args,
              toolCallId: toolCall.id,
              transitionReason: deliverables.length > 0 ? 'completed_with_deliverables' : 'completed_without_deliverables',
              outputPreview: truncate(
                JSON.stringify({
                  summary: result.summary,
                  verification: result.verification,
                  attachments: result.attachments,
                  deliverables,
                }),
                4000
              ),
              }
            );
            await this.setupService.persistTimelineMessage({
              sessionId: state.input.sessionId,
              role: 'agent',
              messageType: 'assistant_message',
              content: finalContent,
              metadata: {
                agent: 'altus',
                runId: state.input.runId,
                verification: result.verification,
                deliverables,
              },
              messageKey: finalAssistantMessageKey,
            });
            await this.eventWriter.appendRunEvent(
              state.input.runId,
              state.input.sessionId,
              state.input.userId,
              'assistant_message',
              {
              content: finalContent,
              messageKey: finalAssistantMessageKey,
              deliverables,
              }
            );
            return { outcome: 'completed' as const, content: finalContent, deliverables };
        }

        if (envelope.status === 'result') {
          const result = envelope.result;
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: result.content,
          });
          nextRoundStatusContent = this.buildPostToolRunStatusContent({
            toolName,
            args,
            outcome: 'completed',
            transitionReason: envelope.transitionReason,
          });
          await this.syncLoopSnapshot(state, {
            lastTransitionReason: envelope.transitionReason,
            recoveryMode: envelope.recoveryMode,
            currentRound,
            maxRounds: maxToolRounds,
            plainTextRecoveryUsed,
            lastToolName: toolName,
            lastToolCallId: toolCall.id,
          });
          continue;
        }

        if (envelope.status === 'failed') {
          nextRoundStatusContent = this.buildPostToolRunStatusContent({
            toolName,
            args,
            outcome: 'failed',
            transitionReason: envelope.transitionReason,
            error: envelope.error,
          });
          await this.syncLoopSnapshot(state, {
            lastTransitionReason: envelope.transitionReason,
            recoveryMode: envelope.recoveryMode,
            currentRound,
            maxRounds: maxToolRounds,
            plainTextRecoveryUsed,
            lastToolName: toolName,
            lastToolCallId: toolCall.id,
          });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify({
              error: envelope.rawError,
            }),
          });
        }
      }
    }

    await this.syncLoopSnapshot(state, {
      lastTransitionReason: 'tool_round_limit_exceeded',
      recoveryMode: 'context_pressure',
      currentRound: maxToolRounds,
      maxRounds: maxToolRounds,
      plainTextRecoveryUsed,
    });
    throw new Error('managed_run_tool_round_limit_exceeded');
  }

  async execute(state: AltusRunState, abortController: AbortController) {
    try {
      const preExecutionClarificationQuestion = this.resolvePreExecutionClarificationQuestion(state);
      if (preExecutionClarificationQuestion) {
        const preExecutionClarificationOptions = this.resolvePreExecutionClarificationOptions(state);
        const preExecutionClarificationType = this.resolvePreExecutionClarificationType(state);
        state.markWaitingUser();
        await this.syncLoopSnapshot(state, {
          lastTransitionReason: 'clarification_requested',
          recoveryMode: 'awaiting_user',
          currentRound: 0,
          maxRounds: this.getMaxToolRounds(),
          plainTextRecoveryUsed: false,
        });
        await this.requestClarification(state, {
          question: preExecutionClarificationQuestion,
          options: preExecutionClarificationOptions,
          clarificationType: preExecutionClarificationType,
        });
        await this.lifecycleService.markWaitingUser(state);
        return;
      }

      await this.eventWriter.appendRunEvent(
        state.input.runId,
        state.input.sessionId,
        state.input.userId,
        'run_status',
        {
          status: 'starting',
          content: '正在准备 sandbox 与运行环境',
        }
      );
      const sandbox = await this.setupService.ensureSandbox(
        state.input.sessionId,
        state.input.sessionTitle
      );
      const residentSkillSelections = Array.isArray(state.input.residentSkillSelections)
        ? state.input.residentSkillSelections
        : [];
      const residentSelectionsForSync =
        residentSkillSelections.length > 0
          ? residentSkillSelections
          : Array.isArray(state.input.skills)
            ? state.input.skills.map((item) => ({
                sourceType: item.sourceType,
                skillId: item.skillId,
                revisionId: item.revisionId,
              }))
            : [];
      if (residentSkillSelections.length > 0) {
        await sandboxSkillSyncService.syncSelectedSkills({
          taskSessionId: state.input.sessionId,
          orchestratorSessionId: sandbox.sandboxId,
          skills: residentSkillSelections,
        });
      } else if (Array.isArray(state.input.skills) && state.input.skills.length > 0) {
        await sandboxSkillSyncService.syncResolvedSkills({
          taskSessionId: state.input.sessionId,
          orchestratorSessionId: sandbox.sandboxId,
          skills: state.input.skills,
        });
      }
      if (residentSelectionsForSync.length > 0) {
        writeConnectorDebugLog('[ALTUS_RUN_SKILL_SYNC_READY]', {
          sessionId: state.input.sessionId,
          runId: state.input.runId,
          orchestratorSessionId: sandbox.sandboxId,
          resolvedSkillCount: residentSelectionsForSync.length,
        });
      }
      state.markRunning({
        sandboxId: sandbox.sandboxId,
        workspaceRoot: sandbox.workspaceRoot,
        reused: sandbox.reused,
      });
      try {
        await taskSessionSkillStateService.markResidentSkillsMaterialized({
          sessionId: state.input.sessionId,
          sandboxId: sandbox.sandboxId,
          workspaceRoot: sandbox.workspaceRoot,
          residentSelections: residentSelectionsForSync,
        });
        const nextAltusMemory = await taskSessionAltusMemoryService.markMaterialized({
          sessionId: state.input.sessionId,
          sandboxId: sandbox.sandboxId,
          workspaceRoot: sandbox.workspaceRoot,
          runId: state.input.runId,
        });
        state.input.sessionAltusMemory = nextAltusMemory;
      } catch (error) {
        console.warn('[ALTUS_RUN_SKILL_MEMORY_INIT_WARN]', {
          sessionId: state.input.sessionId,
          runId: state.input.runId,
          sandboxId: sandbox.sandboxId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await this.lifecycleService.markRunning(state);

      const result = await this.runModelLoop(state, abortController.signal);
      if (result.outcome === 'waiting_user') {
        state.markWaitingUser();
        await this.flushSandboxSkillMemory(state, 'waiting_user');
        await this.flushSandboxAltusMemory(state, 'waiting_user');
        await this.lifecycleService.markWaitingUser(state);
        return;
      }

      state.markCompleted({
        deliverables: state.deliverables,
      });
      await this.flushSandboxSkillMemory(state, 'completed');
      await this.flushSandboxAltusMemory(state, 'completed');
      await this.lifecycleService.markCompleted(state);
    } catch (error) {
      if (abortController.signal.aborted || asText((error as Error)?.message) === 'managed_run_aborted') {
        state.markStopped('user_interrupt');
        await this.flushSandboxSkillMemory(state, 'stopped');
        await this.flushSandboxAltusMemory(state, 'stopped');
        await this.lifecycleService.markStopped(state, 'user_interrupt');
        return;
      }

      const message = error instanceof Error ? error.message : String(error || 'managed run failed');
      state.markFailed(message);
      await this.flushSandboxSkillMemory(state, 'failed');
      await this.flushSandboxAltusMemory(state, 'failed');
      await this.lifecycleService.markFailed(state, message);
    }
  }
}

export const altusRunCoordinator = new AltusRunCoordinator();
