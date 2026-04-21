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
import { AltusRunState } from './altus-run-state';
import { sandboxSkillSyncService } from './sandbox-skill-sync-service';
import { taskSessionSkillStateService } from './task-session-skill-state-service';
import { writeConnectorDebugLog } from '../utils/connector-debug-log';
import {
  TaskSessionDeliverableService,
  taskSessionDeliverableService,
} from './task-session-deliverable-service';

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
    if (!Array.isArray(message.content)) {
      return message;
    }
    return {
      ...message,
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
    private readonly deliverableService: TaskSessionDeliverableService = taskSessionDeliverableService
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
      '请说明',
      '请确认',
      '请告诉我',
      '请问',
      '请补充',
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

  private resolveDeploymentCompletionIntent(
    userInput: string,
    taskIntentProfile?: AltusManagedTaskIntentProfile
  ): DeploymentCompletionIntent {
    if (taskIntentProfile?.mode === 'non_deployable_artifact') {
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

  private sanitizeToolEventError(toolName: string, errorMessage: string) {
    if (errorMessage.startsWith(DEPLOYMENT_COMPLETION_BLOCKED_PREFIX)) {
      return '线上部署尚未完成，Altus 将继续修复并重试发布。';
    }
    if (errorMessage.startsWith('deployment_tool_not_allowed_non_web_task')) {
      return '当前任务是非网站类交付，Altus 已阻止误部署并将继续按源码交付处理。';
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

  private async requestClarification(state: AltusRunState, input: { question: string; options?: string[] }) {
    const clarificationMessageKey = `managed:${state.input.runId}:clarification`;
    await taskCreationFileMemoryStore.setPendingClarification(
      state.input.sessionId,
      input.question,
      input.options
    );
    await this.setupService.persistTimelineMessage({
      sessionId: state.input.sessionId,
      role: 'agent',
      messageType: 'clarification_request',
      content: input.question,
      metadata: {
        question: input.question,
        options: input.options,
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
      content: input.question,
      messageKey: clarificationMessageKey,
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
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.getModelName(input.messages, input.fallbackModel),
        messages: sanitizeMessagesForModel(input.messages),
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
        await this.delay(this.getModelRetryDelayMs(attempt));
      }
    }
    throw (lastError instanceof Error ? lastError : new Error(String(lastError || 'managed_model_error')));
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
    const compositeSystemPrompt = [systemPrompt, skillCatalogPrompt, skillPrompt].filter(Boolean).join('\n\n');
    const messages = await this.setupService.buildConversationMessages(
      state.input.sessionId,
      state.input.userInput,
      compositeSystemPrompt
    );
    let plainTextRecoveryUsed = false;
    const assistantStreamMessageKey = `managed:${state.input.runId}:assistant`;
    const deploymentCompletionIntent = this.resolveDeploymentCompletionIntent(
      state.input.userInput,
      state.input.taskIntentProfile
    );
    let deploymentCompletionUnlocked = !deploymentCompletionIntent.requiresManagedSuccess;
    let lastDeploymentEvidence: DeploymentCompletionEvidence | null = null;

    for (let round = 0; round < this.getMaxToolRounds(); round += 1) {
      if (signal.aborted) {
        throw new Error('managed_run_aborted');
      }

      await this.eventWriter.appendRunEvent(
        state.input.runId,
        state.input.sessionId,
        state.input.userId,
        'run_status',
        {
        status: round === 0 ? 'running' : 'waiting_tool',
        content: round === 0 ? '正在分析并执行任务' : '继续处理工具结果',
        }
      );

      await this.setupService.refreshInlineImageUrls(messages);

      const toolProgressLengths = new Map<string, number>();
      const assistant = await this.callModelWithRetry({
        messages,
        signal,
        mcpProviders: state.input.mcpProviders,
        fallbackModel: state.input.model,
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
      const toolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];

      if (toolCalls.length === 0) {
        if (assistantContent && this.isClarificationResponse(assistantContent)) {
          return this.requestClarification(state, {
            question: assistantContent,
          });
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
          throw new Error(`managed_model_plain_text_without_tool_call:${plainTextExcerpt}`);
        }
        messages.push({
          role: 'user',
          content: this.buildContinuationReminder(assistantContent),
        });
        plainTextRecoveryUsed = true;
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
        await this.eventWriter.appendRunEvent(
          state.input.runId,
          state.input.sessionId,
          state.input.userId,
          'tool_call_started',
          {
          toolName,
          content: this.buildToolEventContent(toolName, 'started'),
          arguments: args,
          toolCallId: toolCall.id,
          }
        );

        try {
          const result = await runtime.execute(toolName, args, signal);
          if (Array.isArray(result.activatedSkills) && result.activatedSkills.length > 0) {
            const autoAttachedPrompt = altusManagedPromptService.buildAutoAttachedSkillPrompt(
              result.activatedSkills,
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
              content: `已自动加载技能：${result.activatedSkills.map((item) => item.name).join('、')}`,
              metadata: {
                eventType: 'managed_skill_auto_attached',
                toolName,
                runId: state.input.runId,
                sessionId: state.input.sessionId,
                skillIds: result.activatedSkills.map((item) => item.skillId),
                skillRevisionIds: result.activatedSkills.map((item) => item.revisionId),
                skillSlugs: result.activatedSkills.map((item) => item.slug),
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
                content: `已自动加载技能：${result.activatedSkills.map((item) => item.name).join('、')}`,
                toolName,
                skillIds: result.activatedSkills.map((item) => item.skillId),
                skillRevisionIds: result.activatedSkills.map((item) => item.revisionId),
                skillSlugs: result.activatedSkills.map((item) => item.slug),
                promptMarkdown: autoAttachedPrompt,
              }
            );
          }
          if (result.type === 'ask_user') {
            return this.requestClarification(state, {
              question: result.question,
              options: result.options,
            });
          }

          if (
            result.type === 'complete' &&
            toolName === 'complete_task' &&
            deploymentCompletionIntent.requiresManagedSuccess &&
            !this.isManagedDeploymentEvidenceSuccessful(
              deploymentCompletionIntent,
              lastDeploymentEvidence
            )
          ) {
            throw new Error(
              this.buildDeploymentCompletionBlockedError(
                deploymentCompletionIntent,
                lastDeploymentEvidence
              )
            );
          }

          if (result.type === 'complete') {
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
            await this.setupService.persistTimelineMessage({
              sessionId: state.input.sessionId,
              role: 'agent',
              messageType: 'assistant_message',
              content: finalContent,
              metadata: {
                agent: 'assistant',
                runId: state.input.runId,
                verification: result.verification,
                deliverables,
              },
              messageKey: assistantStreamMessageKey,
            });
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
            await this.eventWriter.appendRunEvent(
              state.input.runId,
              state.input.sessionId,
              state.input.userId,
              'assistant_message',
              {
              content: finalContent,
              messageKey: assistantStreamMessageKey,
              deliverables,
              }
            );
            return { outcome: 'completed' as const, content: finalContent, deliverables };
          }

          if (this.isDeploymentTool(toolName)) {
            const evidence = this.parseDeploymentCompletionEvidence(result.content);
            if (evidence) {
              lastDeploymentEvidence = {
                ...evidence,
                toolName,
              };
              if (
                this.isManagedDeploymentEvidenceSuccessful(
                  deploymentCompletionIntent,
                  lastDeploymentEvidence
                )
              ) {
                deploymentCompletionUnlocked = true;
              }
            }
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: result.content,
          });
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
            outputPreview: truncate(result.content, 4000),
            ...(this.isDeploymentTool(toolName)
              ? this.buildDeploymentToolViewProjection(toolName, result.content) || {}
              : {}),
            }
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || 'tool_failed');
          const eventError = this.sanitizeToolEventError(toolName, message);
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
            error: eventError,
            ...(this.isDeploymentTool(toolName)
              ? {
                  userView: {
                    summary: eventError,
                    preview: eventError,
                    detail: eventError,
                  },
                  internalView: {
                    detail: [`工具: ${toolName}`, `rawError: ${message}`].join('\n'),
                  },
                }
              : {}),
            }
          );
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify({
              error: message,
            }),
          });
        }
      }
    }

    throw new Error('managed_run_tool_round_limit_exceeded');
  }

  async execute(state: AltusRunState, abortController: AbortController) {
    try {
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
        await this.lifecycleService.markWaitingUser(state);
        return;
      }

      state.markCompleted({
        deliverables: state.deliverables,
      });
      await this.flushSandboxSkillMemory(state, 'completed');
      await this.lifecycleService.markCompleted(state);
    } catch (error) {
      if (abortController.signal.aborted || asText((error as Error)?.message) === 'managed_run_aborted') {
        state.markStopped('user_interrupt');
        await this.flushSandboxSkillMemory(state, 'stopped');
        await this.lifecycleService.markStopped(state, 'user_interrupt');
        return;
      }

      const message = error instanceof Error ? error.message : String(error || 'managed run failed');
      state.markFailed(message);
      await this.flushSandboxSkillMemory(state, 'failed');
      await this.lifecycleService.markFailed(state, message);
    }
  }
}

export const altusRunCoordinator = new AltusRunCoordinator();
