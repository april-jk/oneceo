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
  pickObject,
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
import { altusManagedContextService } from './altus-managed-context-service';
import {
  AltusManagedToolExecutor,
  type AltusManagedToolExecutionEnvelope,
} from './altus-managed-tool-executor';
import {
  buildManagedToolResultEnvelope,
  classifyManagedToolErrorCode,
  stringifyManagedToolResultEnvelope,
} from './altus-managed-tool-result-envelope';
import { altusManagedDynamicContextBlockService } from './altus-managed-dynamic-context-blocks';
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
  traceLlmCallStart,
  traceLlmCallComplete,
} from './api-trace-service';
import {
  TaskSessionDeliverableService,
  taskSessionDeliverableService,
} from './task-session-deliverable-service';
import {
  buildPreviewSnapshotFromBrowserActionScreenshot,
  readBrowserActionScreenshot,
  taskSessionWebsitePreviewSnapshotService,
  type WebsitePreviewSnapshot,
  type BrowserActionScreenshot,
  type TaskSessionWebsitePreviewSnapshotService,
} from './task-session-website-preview-snapshot-service';
import {
  isValidOpenAiToolCallArguments,
  normalizeOpenAiToolCallArguments,
} from '../utils/openai-chat-sanitizer';
import { classifyPlatformCapabilityIntent } from './platform-capability-intent-service';
import { billingService } from './billing-service';
import { pricingService } from './pricing-service';
import type { AgentRuntimeSnapshot } from './agent-runtime-profile-service';
import {
  LLM_PROXY_INTERNAL_OVERRIDE_HEADER,
  getLlmProxyInternalOverrideToken,
} from './llm-proxy-internal-auth';
import { buildManagedMcpToolRejectionCompletionText } from './managed-mcp-tool-confirmation';
import {
  AltusRunUserVisibleStopError,
  normalizeAltusRunFailure,
} from './altus-run-failure-view';

const DELIVERABLES_READY_TEXT = '交付文件已生成';
const DEPLOYMENT_COMPLETION_BLOCKED_PREFIX = 'deployment_completion_blocked:';
const VISUAL_DETECTION_COMPLETION_BLOCKED_PREFIX = 'visual_detection_completion_blocked:';
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
const DEPLOYMENT_FAILED_STATUSES = new Set([
  'failed',
  'crashed',
  'removed',
]);

type DeploymentCompletionIntent = {
  mode: 'none' | 'deploy' | 'redeploy' | 'rollback';
  acceptedToolNames: string[];
  requiresManagedSuccess: boolean;
};

type DeploymentCompletionEvidence = {
  toolName: string;
  status: string;
  bindingState: string;
  deploymentStatus: string;
  deploymentFlowState: string;
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

type VisualDetectionEvidenceState = {
  capturedCount: number;
  passedCount: number;
  lastToolName: string;
  lastAction: string;
  lastUrl: string;
  lastCapturedAt: string;
  lastStatus: string;
  lastReasonCode: string;
  lastMessage: string;
  lastPassedBrowserScreenshot: BrowserActionScreenshot | null;
};

type DebugOpenPageFailureState = {
  lastKey: string;
  repeatCount: number;
  failureCounts: Record<string, number>;
};

type DebugOpenPageFailureDisposition = {
  errorCode: string;
  rawError: string;
  sanitizedError: string;
  repeatCount: number;
  blocked: boolean;
  userActionRequired: boolean;
};

function normalizeInlineBulletGlyphLine(line: string): string {
  const bulletCount = (line.match(/•/g) || []).length;
  const trimmed = line.trimStart();
  if (bulletCount < 2) {
    if (trimmed.startsWith('•')) {
      return `${line.slice(0, line.length - trimmed.length)}- ${trimmed.slice(1).trimStart()}`;
    }
    const bulletIndex = line.indexOf('•');
    const prefix = bulletIndex >= 0 ? line.slice(0, bulletIndex).trimEnd() : '';
    const item = bulletIndex >= 0 ? line.slice(bulletIndex + 1).trim() : '';
    if (prefix && /[:：]$/.test(prefix) && item) {
      return `${prefix}\n- ${item}`;
    }
    return line;
  }
  const firstBulletIndex = line.indexOf('•');
  const prefix = line.slice(0, firstBulletIndex).trimEnd();
  const items = line
    .slice(firstBulletIndex)
    .split(/\s*•\s*/g)
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length < 2) {
    return line;
  }
  const list = items.map((item) => `- ${item}`).join('\n');
  return prefix ? `${prefix}\n${list}` : list;
}

export function normalizeManagedCompletionMarkdown(value: string): string {
  return asText(value)
    .replace(/\r\n?/g, '\n')
    .trim()
    .split('\n')
    .map((line) => normalizeInlineBulletGlyphLine(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeManagedCompletionCheck(value: string): string {
  return normalizeManagedCompletionMarkdown(value)
    .split('\n')
    .map((line) => line.trim().replace(/^[-*•]\s+/, '').trim())
    .filter(Boolean)
    .join('；');
}

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

type ManagedLlmContextHint = {
  contextId?: string | null;
  turnIndex?: number | null;
  sessionId?: string | null;
  runId?: string | null;
};

function basenameLike(value: unknown) {
  const text = asText(value).replace(/\\/g, '/');
  if (!text) return '';
  const normalized = text.replace(/\/+$/, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

function buildBrowserInteractionSummary(args: Record<string, unknown>) {
  const action = asText(args.action).toLowerCase();
  const description = asText(args.description);
  if (description) return description;
  const selector = asText(args.selector);
  const text = asText(args.text);
  const key = asText(args.key);
  const direction = asText(args.direction).toLowerCase() || 'down';
  const loadState = asText(args.loadState) || 'domcontentloaded';
  const pixels = Number(args.pixels);
  const target = text || selector;

  if (action === 'locator_click') {
    if (selector) return `点击 ${selector}`;
    return '点击页面元素';
  }
  if (action === 'text_click') {
    if (text) return `点击 ${text}`;
    return '点击指定文本';
  }
  if (action === 'coordinate_click') {
    return '点击页面指定位置';
  }
  if (action === 'locator_fill') {
    if (selector && text) return `在 ${selector} 输入“${text}”`;
    return selector ? `填写 ${selector}` : '填写表单输入框';
  }
  if (action === 'keyboard_type') {
    return text ? `键盘输入“${text}”` : '键盘输入文本';
  }
  if (action === 'keyboard_press') {
    return key ? `按下 ${key} 键` : '按下键盘按键';
  }
  if (action === 'mouse_wheel') {
    const directionLabel =
      direction === 'up'
        ? '向上滚动'
        : direction === 'left'
          ? '向左滚动'
          : direction === 'right'
            ? '向右滚动'
            : '向下滚动';
    return Number.isFinite(pixels) && pixels > 0 ? `${directionLabel} ${Math.floor(pixels)} 像素` : directionLabel;
  }
  if (action === 'wait_for_locator') {
    return selector ? `等待 ${selector} 可见` : '等待页面元素可见';
  }
  if (action === 'wait_for_text') {
    return text ? `等待页面出现“${text}”` : '等待页面出现指定内容';
  }
  if (action === 'wait_for_load_state') {
    return `等待页面进入 ${loadState} 状态`;
  }
  if (action === 'wait_for_timeout') {
    return '等待页面稳定';
  }
  return target ? `执行 Playwright 操作：${target}` : '执行 Playwright 视觉检测';
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

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export class AltusRunCoordinator {
  constructor(
    private readonly setupService: AltusManagedSetupService = altusManagedSetupService,
    private readonly eventWriter: AltusRunEventWriter = altusRunEventWriter,
    private readonly lifecycleService: AltusRunLifecycleService = altusRunLifecycleService,
    private readonly deliverableService: TaskSessionDeliverableService = taskSessionDeliverableService,
    private readonly budgetService: AltusManagedContextBudgetService = altusManagedContextBudgetService,
    private readonly websitePreviewSnapshotService: TaskSessionWebsitePreviewSnapshotService = taskSessionWebsitePreviewSnapshotService
  ) {}

  private getModelName(messages: ChatMessage[], fallbackModel?: string | null) {
    const explicitModel = asText(fallbackModel);
    if (explicitModel) return explicitModel;
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

  private readUsageNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  /**
   * 计费：根据模型调用估算并扣减积分
   */
private async chargeForModelCall(state: AltusRunState, input: {
    messages: ChatMessage[];
    assistant: { content?: string | null; tool_calls?: ToolCall[]; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_tokens_details?: { cached_tokens?: number; cache_creation_input_tokens?: number }; cached_tokens?: number; cache_creation_input_tokens?: number } };
    model: string;
  }) {
    const userId = state.input.userId;
    const sessionId = state.input.sessionId;
    const runId = state.input.runId;
    let promptTokens: number;
    let completionTokens: number;
    let cachedPromptTokens = 0;
    let cacheCreationTokens = 0;
    let billingTargetKey = '';
    let creditsConsumed = 0;
    let pricingSnapshot: Record<string, unknown> | undefined;

    try {

      const usage = input.assistant?.usage;
      if (usage && typeof usage.prompt_tokens === 'number' && typeof usage.completion_tokens === 'number') {
        promptTokens = usage.prompt_tokens;
        completionTokens = usage.completion_tokens;
        cachedPromptTokens = this.readUsageNumber(usage.prompt_tokens_details?.cached_tokens) || this.readUsageNumber(usage.cached_tokens) || 0;
        cacheCreationTokens = this.readUsageNumber(usage.prompt_tokens_details?.cache_creation_input_tokens) || this.readUsageNumber(usage.cache_creation_input_tokens) || 0;

        // 负数归零保护
        cachedPromptTokens = Math.max(0, cachedPromptTokens);
        cacheCreationTokens = Math.max(0, cacheCreationTokens);

        // 缓存 token 总和不超过 promptTokens
        if (cachedPromptTokens + cacheCreationTokens > promptTokens) {
          const ratio = promptTokens / (cachedPromptTokens + cacheCreationTokens);
          cachedPromptTokens = Math.floor(cachedPromptTokens * ratio);
          cacheCreationTokens = Math.floor(cacheCreationTokens * ratio);
        }
      } else {
        // 无真实 usage 时回退到字符估算（每 4 字符 ≈ 1 token）
        const promptText = JSON.stringify(input.messages);
        promptTokens = Math.ceil(promptText.length / 4);
        const completionText = JSON.stringify(input.assistant);
        completionTokens = Math.ceil(completionText.length / 4);
      }

      const nonCachedPromptTokens = Math.max(0, promptTokens - cachedPromptTokens - cacheCreationTokens);

      billingTargetKey = state.input.billingTargetKey || input.model;
      // 获取定价：Agent managed run 按业务 SKU 查价，token 日志保留实际模型。
      const pricing = await pricingService.getActivePricing(billingTargetKey);
      if (!pricing) {
        throw new Error(`billing_pricing_missing:${billingTargetKey}`);
      }
      const cacheRatio = await pricingService.getCacheRatiosForPricing(pricing);
      pricingSnapshot = {
        ...pricing,
        billingTarget: billingTargetKey,
        actualModel: input.model,
        cacheRatio,
      };

      // 计算积分消耗（含缓存）
      creditsConsumed = pricingService.calculateCredits(
        {
          promptTokens,
          cachedPromptTokens,
          nonCachedPromptTokens,
          cacheCreationTokens,
          completionTokens,
        },
        pricing,
        cacheRatio || undefined
      );

      // 扣减积分
      const result = await billingService.deductCredits(userId, creditsConsumed, {
        sessionId,
        runId,
        model: billingTargetKey,
        description: `Managed Run 调用: ${billingTargetKey}`,
        metadataJson: {
          billingTarget: billingTargetKey,
          actualModel: input.model,
          runtimeSnapshot: state.input.runtimeSnapshot || null,
          pricingSnapshot,
        },
      });

      const isBilled = result.success;
      if (isBilled) {
        console.log(`[Billing] 扣费成功: ${creditsConsumed} 积分, 余额: ${result.balanceAfter}, run: ${runId}`);
      } else {
        console.error(`[Billing] 扣费失败（余额不足），仍记录 token 使用日志: ${creditsConsumed} 积分, run: ${runId}`);
      }

      // 无论扣费成功与否，都记录 token 使用日志（止血：避免漏费无记录）
      await billingService.logTokenUsage({
        userId,
        sessionId,
        runId,
        model: input.model,
        promptTokens,
        cachedPromptTokens,
        nonCachedPromptTokens,
        cacheCreationTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        creditsConsumed,
        pricingSnapshot,
        metadataJson: {
          billingTarget: billingTargetKey,
          runtimeSnapshot: state.input.runtimeSnapshot || null,
          billed: isBilled,
          ...(isBilled ? {} : { unbilledReason: 'insufficient_credits' }),
        },
      });

      if (!isBilled) {
        throw new Error(`insufficient_credits: 用户 ${userId} 余额不足，无法继续运行`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('insufficient_credits:')) {
        throw error;
      }
      if (error instanceof Error && error.message.startsWith('billing_pricing_missing:')) {
        throw error;
      }
      console.error('[Billing] 计费失败，准备重试:', error);
      // 非余额不足的计费失败——尝试重试一次（可能是临时 DB 连接问题）
      // 仅在已计算出扣费金额时才重试（变量在 try 块内声明，可能尚未赋值）
      if (typeof creditsConsumed === 'number' && billingTargetKey) {
        try {
          const retryResult = await billingService.deductCredits(userId, creditsConsumed, {
            sessionId,
            runId,
            model: billingTargetKey,
            description: `Managed Run 调用(重试): ${billingTargetKey}`,
            metadataJson: {
              billingTarget: billingTargetKey,
              actualModel: input.model,
              runtimeSnapshot: state.input.runtimeSnapshot || null,
              retryReason: error instanceof Error ? error.message : String(error),
            },
          });
          if (retryResult.success) {
            console.info('[Billing] 计费重试成功');
            // 重试成功，记录 token 使用日志
            await billingService.logTokenUsage({
              userId,
              sessionId,
              runId,
              model: input.model,
              promptTokens: promptTokens!,
              cachedPromptTokens,
              nonCachedPromptTokens: Math.max(0, promptTokens! - cachedPromptTokens - cacheCreationTokens),
              cacheCreationTokens,
              completionTokens: completionTokens!,
              totalTokens: promptTokens! + completionTokens!,
              creditsConsumed,
              pricingSnapshot,
              metadataJson: {
                billingTarget: billingTargetKey,
                runtimeSnapshot: state.input.runtimeSnapshot || null,
                billed: true,
                retry: true,
              },
            });
          } else {
            console.error('[Billing] 计费重试返回余额不足，用户可能漏费:', {
              userId,
              creditsConsumed,
              model: billingTargetKey,
              sessionId: state.input.sessionId,
            });
            // 重试也余额不足，仍记录 token 使用日志（止血）
            await billingService.logTokenUsage({
              userId,
              sessionId,
              runId,
              model: input.model,
              promptTokens: promptTokens!,
              cachedPromptTokens,
              nonCachedPromptTokens: Math.max(0, promptTokens! - cachedPromptTokens - cacheCreationTokens),
              cacheCreationTokens,
              completionTokens: completionTokens!,
              totalTokens: promptTokens! + completionTokens!,
              creditsConsumed,
              pricingSnapshot,
              metadataJson: {
                billingTarget: billingTargetKey,
                runtimeSnapshot: state.input.runtimeSnapshot || null,
                billed: false,
                unbilledReason: 'insufficient_credits',
                retryFailed: true,
              },
            });
          }
        } catch (retryError) {
          // 重试也失败，记录到异常日志但不终止主流程
          console.error('[Billing] 计费重试也失败，用户可能漏费:', {
            userId,
            creditsConsumed,
            model: billingTargetKey,
            sessionId: state.input.sessionId,
            originalError: error instanceof Error ? error.message : String(error),
            retryError: retryError instanceof Error ? retryError.message : String(retryError),
          });
          // 重试异常，仍记录 token 使用日志（止血）
          await billingService.logTokenUsage({
            userId,
            sessionId,
            runId,
            model: input.model,
            promptTokens: promptTokens!,
            cachedPromptTokens,
            nonCachedPromptTokens: Math.max(0, promptTokens! - cachedPromptTokens - cacheCreationTokens),
            cacheCreationTokens,
            completionTokens: completionTokens!,
            totalTokens: promptTokens! + completionTokens!,
            creditsConsumed,
            pricingSnapshot,
            metadataJson: {
              billingTarget: billingTargetKey,
              runtimeSnapshot: state.input.runtimeSnapshot || null,
              billed: false,
              unbilledReason: 'deduct_retry_error',
              retryFailed: true,
              retryError: retryError instanceof Error ? retryError.message : String(retryError),
            },
          }).catch(logErr => {
            console.error('[Billing] 重试路径 token 日志写入失败:', logErr instanceof Error ? logErr.message : String(logErr));
          });
        }
      } else {
        console.error('[Billing] 计费失败且无法重试（扣费参数尚未计算完成）:', {
          userId,
          originalError: error instanceof Error ? error.message : String(error),
        });
      }
    }
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
    if (this.looksLikeCompletedTaskSummary(normalized)) return false;
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

  private looksLikeCompletedTaskSummary(content: string) {
    const normalized = asText(content);
    if (!normalized) return false;
    const lower = normalized.toLowerCase();
    const completionSignals = [
      '已为您',
      '已为你',
      '已完成',
      '已经完成',
      '已成功',
      '成功启动',
      '交付文件已生成',
      '任务完成',
      '可通过调试',
      '调试浏览器访问',
      'completed',
      'successfully',
    ];
    const artifactSignals = [
      '系统',
      '应用',
      '页面',
      '文件',
      '项目',
      '功能',
      '部署',
      '健康检查',
      'artifact',
      'app',
      'project',
      'file',
    ];
    return (
      completionSignals.some((signal) => lower.includes(signal.toLowerCase())) &&
      artifactSignals.some((signal) => lower.includes(signal.toLowerCase()))
    );
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

  private buildContinuationReminder(
    assistantContent: string,
    deploymentIntent?: DeploymentCompletionIntent
  ) {
    const reminder = deploymentIntent?.requiresManagedSuccess
      ? [
          'System reminder: continue from the latest tool result.',
          'The current request has an explicit deployment goal.',
          'Do not finish with plain text or complete_task until the managed deployment is actually ready online.',
          'Choose the next required deployment tool call immediately: deploy_application, redeploy_application, or get_application_deployment_status.',
        ]
      : [
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
    if (profile?.structuredClarification) {
      return '';
    }
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

  private resolvePreExecutionStructuredClarification(state: AltusRunState) {
    const profile = state.input.taskIntentProfile;
    return profile?.needsClarification ? profile.structuredClarification : undefined;
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

    const capabilityIntent =
      taskIntentProfile?.deploymentAllowed && taskIntentProfile.platformCapabilityIntent?.mode === 'execute'
        ? taskIntentProfile.platformCapabilityIntent
        : classifyPlatformCapabilityIntent(userInput);
    if (capabilityIntent.mode !== 'execute') {
      return {
        mode: 'none',
        acceptedToolNames: [],
        requiresManagedSuccess: false,
      };
    }

    if (capabilityIntent.capabilityKind === 'rollback') {
      return {
        mode: 'rollback',
        acceptedToolNames: ['rollback_application_deployment', 'get_application_deployment_status'],
        requiresManagedSuccess: true,
      };
    }

    if (capabilityIntent.capabilityKind === 'redeploy') {
      return {
        mode: 'redeploy',
        acceptedToolNames: ['redeploy_application', 'deploy_application', 'get_application_deployment_status'],
        requiresManagedSuccess: true,
      };
    }

    if (capabilityIntent.capabilityKind === 'deploy' || capabilityIntent.capabilityKind === 'deployment_status') {
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
        bindingState: asText(parsed.bindingState).toLowerCase(),
        deploymentStatus: asText(parsed.deploymentStatus).toLowerCase(),
        deploymentFlowState: asText((parsed.deploymentFlow as Record<string, unknown> | undefined)?.state).toLowerCase(),
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
    if (evidence.bindingState === 'public_settling' || evidence.bindingState === 'provisioning') {
      return false;
    }
    if (evidence.deploymentFlowState && evidence.deploymentFlowState !== 'succeeded') {
      return false;
    }
    if (DEPLOYMENT_FAILED_STATUSES.has(evidence.deploymentStatus)) {
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
    const lastBindingState = evidence?.bindingState || 'unknown';
    const lastDeploymentStatus = evidence?.deploymentStatus || 'unknown';
    const lastDeploymentFlowState = evidence?.deploymentFlowState || 'unknown';
    const mode = intent.mode || 'deploy';
    return [
      DEPLOYMENT_COMPLETION_BLOCKED_PREFIX,
      `current request is ${mode}`,
      'managed deployment is not successful yet',
      `last_tool=${lastTool}`,
      `last_status=${lastStatus}`,
      `last_binding_state=${lastBindingState}`,
      `last_deployment_status=${lastDeploymentStatus}`,
      `last_deployment_flow_state=${lastDeploymentFlowState}`,
      'do_not_treat_debug_open_page_or_local_server_as_deploy_success',
      'repair_and_call_the_managed_deployment_tool_again',
    ].join(' ');
  }

  private requiresVisualDetectionBeforeCompletion(
    taskIntentProfile?: AltusManagedTaskIntentProfile
  ) {
    if (!taskIntentProfile) return false;
    if (taskIntentProfile.needsClarification) return false;
    if (taskIntentProfile.explicitNoWeb || taskIntentProfile.scriptArtifactRequested || taskIntentProfile.emailTemplateRequested) {
      return false;
    }
    if (taskIntentProfile.webArtifactRequested) return true;
    return taskIntentProfile.mode === 'deployable_web_app' && !taskIntentProfile.deployRequested;
  }

  private isVisualDetectionEvidenceSuccessful(evidence: VisualDetectionEvidenceState) {
    return evidence.passedCount > 0;
  }

  private resolveWebsitePreviewSnapshot(input: {
    capturedSnapshot: WebsitePreviewSnapshot | null;
    visualDetectionEvidence: VisualDetectionEvidenceState;
  }): WebsitePreviewSnapshot | null {
    if (input.capturedSnapshot?.status === 'captured') {
      return input.capturedSnapshot;
    }
    const visualEvidenceSnapshot = buildPreviewSnapshotFromBrowserActionScreenshot(
      input.visualDetectionEvidence.lastPassedBrowserScreenshot
    );
    return visualEvidenceSnapshot || input.capturedSnapshot;
  }

  private readVisualDetectionEvidence(
    toolName: string,
    result: Extract<Awaited<ReturnType<AltusManagedToolRuntime['execute']>>, { type: 'result' }>
  ) {
    if (toolName !== 'debug_open_page' && toolName !== 'browser_interact') {
      return null;
    }
    const evidenceItems = Array.isArray(result.evidence) ? result.evidence : [];
    const browserScreenshot =
      evidenceItems.map((item) => readBrowserActionScreenshot(item)).find(Boolean) ||
      (() => {
        try {
          return readBrowserActionScreenshot(JSON.parse(asText(result.content)).browserScreenshot);
        } catch {
          return null;
        }
      })();
    if (!browserScreenshot) {
      return null;
    }
    const source = readRecord(browserScreenshot.source);
    const screenshotStatus = asText(browserScreenshot.status);
    if (screenshotStatus !== 'captured') {
      return {
        toolName,
        action: asText(source.action),
        url: asText(source.url),
        capturedAt: '',
        visualStatus: screenshotStatus || 'capture_failed',
        reasonCode: asText(browserScreenshot.reasonCode),
        message: asText(browserScreenshot.message),
        captured: false,
        passed: false,
        browserScreenshot: null,
      };
    }
    const visualCheck = readRecord(browserScreenshot.visualCheck);
    const visualStatus = asText(visualCheck.status);
    return {
      toolName,
      action: asText(source.action),
      url: asText(source.url),
      capturedAt: asText(browserScreenshot.capturedAt),
      visualStatus,
      reasonCode: asText(visualCheck.reasonCode),
      message: asText(visualCheck.message),
      captured: true,
      passed: visualStatus === 'passed',
      browserScreenshot,
    };
  }

  private buildVisualDetectionCompletionBlockedError(evidence: VisualDetectionEvidenceState) {
    return [
      VISUAL_DETECTION_COMPLETION_BLOCKED_PREFIX,
      'website_or_web_app_delivery_requires_visual_detection',
      `captured_count=${evidence.capturedCount}`,
      `passed_count=${evidence.passedCount}`,
      `last_tool=${evidence.lastToolName || 'none'}`,
      `last_action=${evidence.lastAction || 'none'}`,
      `last_visual_status=${evidence.lastStatus || 'none'}`,
      `last_reason_code=${evidence.lastReasonCode || 'none'}`,
      `last_message=${evidence.lastMessage || 'none'}`,
      'run_or_build_the_app_first',
      'say_正在进行视觉检测',
      'call_debug_open_page_against_the_running_or_file_target',
      'use_browser_interact_for_click_key_scroll_pagination_or_state_checks_when_relevant',
      'retry_complete_task_only_after_browserScreenshot_visualCheck_status_passed',
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
      const deploymentFlow = parsed.deploymentFlow && typeof parsed.deploymentFlow === 'object'
        ? (parsed.deploymentFlow as Record<string, unknown>)
        : {};
      const projectProfile = parsed.projectProfile && typeof parsed.projectProfile === 'object'
        ? (parsed.projectProfile as Record<string, unknown>)
        : {};
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
          repairCategory === 'deployment_failed'
            ? '线上部署尚未成功，Altus 正在根据部署状态和公网访问结果修复后重试。'
            : repairCategory === 'resource_binding'
            ? 'Altus 正在优先修复平台部署资源绑定，并将在资源恢复后重试发布。'
            : repairCategory === 'deployment_pending'
            ? '发布完成，正在等待公网生效。'
            : 'Altus 正在按平台部署基线自动修复后重试。'
        );
      } else if (deploymentStatus) {
        publicLines.push(`当前状态：${deploymentStatus}`);
      }
      if (url) {
        publicLines.push(`访问地址：${url}`);
      }
      const publicDetail = publicLines.filter(Boolean).join('\n');
      const publicPreview = status === 'retryable_repair_required'
        ? repairCategory === 'deployment_failed'
          ? '线上部署未成功，Altus 正在修复后重试。'
          : repairCategory === 'resource_binding'
          ? '已识别到平台部署资源问题，Altus 正在修复绑定后重试。'
          : repairCategory === 'deployment_pending'
          ? '发布完成，正在等待公网生效。'
          : '已识别到发布配置问题，Altus 正在自动修复后重试。'
        : url
          ? `访问地址 ${url}`
          : summary || this.buildToolEventContent(toolName, 'completed');

      const internalLines: string[] = [];
      internalLines.push(`工具: ${toolName}`);
      if (phase) internalLines.push(`phase: ${phase}`);
      if (status) internalLines.push(`status: ${status}`);
      if (deploymentStatus) internalLines.push(`deploymentStatus: ${deploymentStatus}`);
      if (url) internalLines.push(`url: ${url}`);
      if (deploymentId) internalLines.push(`deploymentId: ${deploymentId}`);
      if (asText(deploymentFlow.state)) internalLines.push(`deploymentFlowState: ${asText(deploymentFlow.state)}`);
      if (asText(projectProfile.runtimeFamily)) internalLines.push(`runtimeFamily: ${asText(projectProfile.runtimeFamily)}`);
      if (asText(projectProfile.deployability)) internalLines.push(`deployability: ${asText(projectProfile.deployability)}`);
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
    if (toolName === 'browser_interact') {
      if (status === 'started' || status === 'progress') return '正在进行视觉检测';
      if (status === 'completed') return '视觉检测步骤已完成';
      return '视觉检测步骤失败';
    }
    if (toolName === 'debug_open_page') {
      if (status === 'started' || status === 'progress') return '正在进行视觉检测';
      if (status === 'completed') return '视觉检测页面已打开';
      return '视觉检测页面打开失败';
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
      if (input.transitionReason === 'tool_failed_user_action_required') {
        if (toolName === 'debug_open_page') {
          return '视觉检测无法继续重复打开同一目标，已记录阻断原因';
        }
        return '这一步需要外部处理，已停止继续重试';
      }
      if (toolName === 'browser_interact') {
        return `${buildBrowserInteractionSummary(args)} 没成功，我会检查页面状态后继续`;
      }
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
        return '文件我已经核对过了；如果交付文件已就绪，我会直接提交最终交付';
      }
      return '这一步已经跑完了，我继续处理后面的内容';
    }
    if (toolName === 'debug_open_page') {
      return '页面已经打开，正在进行视觉检测';
    }
    if (toolName === 'browser_interact') {
      return `${buildBrowserInteractionSummary(args)}，页面已响应`;
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

  private normalizeDebugOpenPageTarget(args?: Record<string, unknown>) {
    const raw = asText(args?.url).trim();
    if (!raw) return '';
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
    try {
      const parsed = new URL(withProtocol);
      parsed.hash = '';
      parsed.search = '';
      if (parsed.hostname === 'localhost' || parsed.hostname === '0.0.0.0') {
        parsed.hostname = '127.0.0.1';
      }
      const normalized = parsed.toString().replace(/\/+$/, '').toLowerCase();
      return normalized;
    } catch {
      return raw.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
    }
  }

  private isDebugOpenPageCorrectiveTool(toolName: string) {
    return toolName === 'shell_execute' || toolName === 'write_file';
  }

  private isDebugOpenPagePlatformError(errorCode: string) {
    return errorCode === 'sandbox_browser_capability_unavailable';
  }

  private isDebugOpenPageRepeatBlockableError(errorCode: string) {
    return errorCode !== 'tool_execution_failed';
  }

  private buildDebugOpenPageRepeatBlockedError(input: {
    errorCode: string;
    target: string;
    repeatCount: number;
    rawError: string;
  }) {
    return [
      'debug_open_page_repeat_blocked:',
      `same_target=${input.target || 'unknown'}`,
      `same_reason=${input.errorCode || 'unknown'}`,
      `repeat_count=${input.repeatCount}`,
      'do_not_call_debug_open_page_again_until_shell_execute_or_write_file_changes_the_target',
      `last_error=${truncate(asText(input.rawError), 1200)}`,
    ].join(' ');
  }

  private recordDebugOpenPageFailure(input: {
    args: Record<string, unknown>;
    rawError: string;
    sanitizedError: string;
    state: DebugOpenPageFailureState;
  }): DebugOpenPageFailureDisposition {
    const initialErrorCode = classifyManagedToolErrorCode(input.rawError);
    const target = this.normalizeDebugOpenPageTarget(input.args);
    const key = `${target || '(missing-target)'}:${initialErrorCode}`;
    const consecutiveRepeatCount = input.state.lastKey === key ? input.state.repeatCount + 1 : 1;
    const repeatCount = (input.state.failureCounts[key] || 0) + 1;
    input.state.failureCounts[key] = repeatCount;
    input.state.lastKey = key;
    input.state.repeatCount = consecutiveRepeatCount;
    const userActionRequired =
      this.isDebugOpenPagePlatformError(initialErrorCode) || initialErrorCode === 'debug_open_page_repeat_blocked';
    const blocked =
      userActionRequired || (this.isDebugOpenPageRepeatBlockableError(initialErrorCode) && repeatCount >= 2);
    if (!blocked) {
      return {
        errorCode: initialErrorCode,
        rawError: input.rawError,
        sanitizedError: input.sanitizedError,
        repeatCount,
        blocked: false,
        userActionRequired: false,
      };
    }
    const rawError = this.isDebugOpenPagePlatformError(initialErrorCode)
      ? input.rawError
      : this.buildDebugOpenPageRepeatBlockedError({
          errorCode: initialErrorCode,
          target,
          repeatCount,
          rawError: input.rawError,
        });
    const errorCode = classifyManagedToolErrorCode(rawError);
    return {
      errorCode,
      rawError,
      sanitizedError: this.sanitizeToolEventError('debug_open_page', rawError),
      repeatCount,
      blocked: true,
      userActionRequired,
    };
  }

  testRecordDebugOpenPageFailure(input: {
    args: Record<string, unknown>;
    rawError: string;
    sanitizedError: string;
    state: DebugOpenPageFailureState;
  }): DebugOpenPageFailureDisposition {
    return this.recordDebugOpenPageFailure(input);
  }

  private sanitizeToolEventError(toolName: string, errorMessage: string) {
    if (errorMessage.startsWith(DEPLOYMENT_COMPLETION_BLOCKED_PREFIX)) {
      return '线上部署尚未完成，Altus 将继续修复并重试发布。';
    }
    if (errorMessage.startsWith(VISUAL_DETECTION_COMPLETION_BLOCKED_PREFIX)) {
      if (
        errorMessage.includes('captured_count=') &&
        !errorMessage.includes('captured_count=0') &&
        errorMessage.includes('passed_count=0')
      ) {
        return '页面已打开但没有通过视觉检测，Altus 将继续修复白屏、空内容或错误页问题后重新截图。';
      }
      return '交付前视觉检测还没完成，Altus 将继续通过 n.eko 和 Playwright 补齐截图证据。';
    }
    if (errorMessage.startsWith('deployment_tool_not_allowed_without_explicit_request')) {
      return '这次只是部署相关咨询，我不会在没有明确指令时触发部署工具。';
    }
    if (toolName === 'complete_task') {
      if (errorMessage.includes('complete_task_attachments_invalid')) {
        return '交付附件参数格式不正确，Altus 将改为真实 JSON 数组并重新提交交付。';
      }
      if (errorMessage.includes('complete_task_downloadable_requires_attachments')) {
        return '这是下载型交付任务，Altus 会先确认最终文件已生成，再把文件路径放入附件后重新交付。';
      }
      if (errorMessage.includes('complete_task_attachment_path_invalid')) {
        return '交付附件路径不合法，Altus 将改为工作区内的真实文件相对路径后重新交付。';
      }
      if (errorMessage.includes('complete_task_pptx_requires_render_pptx_from_instructions')) {
        return 'PPT 交付还没有走正式渲染链路，Altus 将先完成渲染，再重新附带文件交付。';
      }
    }
    if (toolName === 'write_file' && errorMessage.includes('write_file_binary_deliverable_requires_generator')) {
      return '这类最终交付文件不能直接按文本写入，Altus 将改用真实文档生成链路后重新交付。';
    }
    if (toolName === 'debug_open_page') {
      if (errorMessage.includes('debug_open_page_repeat_blocked')) {
        return '同一个预览目标连续打开失败，平台已阻止继续重复截图；Altus 需要先调查并修复服务、端口或文件路径后再重新打开。';
      }
      if (errorMessage.includes('playwright_module_not_found')) {
        return 'sandbox 浏览器依赖不可用，平台已阻止继续重复截图；需要先恢复预置 Playwright / MCP 能力。';
      }
      if (errorMessage.includes('__ONECEO_DEBUG_TARGET_UNREACHABLE__')) {
        return '调试页面目标地址暂不可访问，Altus 需要先启动或修复本地预览服务，再重新打开页面。';
      }
      if (errorMessage.includes('__ONECEO_DEBUG_TARGET_FILE_MISSING__')) {
        return '调试页面目标文件不存在，Altus 需要先修正交付文件路径或生成文件，再重新打开页面。';
      }
      if (errorMessage.includes('__ONECEO_DEBUG_TARGET_BAD_STATUS__')) {
        return '调试页面目标地址返回异常状态，Altus 需要先修复页面服务错误，再重新打开页面。';
      }
      if (errorMessage.includes('__ONECEO_DEBUG_TARGET_TAB_NOT_READY__')) {
        return '调试浏览器还没有打开正确页面，Altus 需要先确认目标地址或浏览器状态变化，再重新打开。';
      }
      if (errorMessage.includes('__ONECEO_DEBUG_OPEN_PAGE_FAILED__')) {
        return '调试浏览器打开页面失败，Altus 需要先检查远程调试服务状态，再重新打开。';
      }
      if (errorMessage.includes('debug_open_page_debug_not_ready')) {
        return '远程调试服务尚未就绪，平台已阻止继续重复截图；需要先恢复 n.eko / Chromium 调试环境。';
      }
      if (/exit status\s+\d+/i.test(errorMessage)) {
        return '调试页面校验未返回具体状态，Altus 需要先检查目标页面和调试服务，再重新打开。';
      }
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
      structuredClarification?: AltusManagedTaskIntentProfile['structuredClarification'];
      toolCallId?: string;
    }
  ) {
    const clarificationMessageKey = `managed:${state.input.runId}:clarification`;
    await taskCreationFileMemoryStore.setPendingClarification(
      state.input.sessionId,
      input.question,
      input.options,
      input.clarificationType,
      input.toolCallId
        ? {
            runId: state.input.runId,
            toolCallId: input.toolCallId,
            messageKey: clarificationMessageKey,
          }
        : undefined
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
        structuredClarification: input.structuredClarification,
        runId: state.input.runId,
        toolCallId: input.toolCallId,
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
      structuredClarification: input.structuredClarification,
      content: input.question,
      messageKey: clarificationMessageKey,
      toolName: input.toolCallId ? 'ask_user' : undefined,
      toolCallId: input.toolCallId,
      transitionReason: 'clarification_requested',
      }
    );
    return {
      outcome: 'waiting_user' as const,
      question: input.question,
      options: input.options,
    };
  }

  private async completeDeferredSiblingToolCalls(input: {
    state: AltusRunState;
    toolCalls: ToolCall[];
    currentToolCallId: string;
    completedToolCallIds: Set<string>;
  }) {
    for (const sibling of input.toolCalls) {
      const toolCallId = asText(sibling?.id);
      const toolName = asText(sibling?.function?.name);
      if (!toolCallId || toolCallId === input.currentToolCallId || input.completedToolCallIds.has(toolCallId)) {
        continue;
      }
      const args = parseToolArguments(asText(sibling?.function?.arguments));
      const toolResultEnvelope = buildManagedToolResultEnvelope({
        status: 'deferred',
        runId: input.state.input.runId,
        toolUseId: toolCallId,
        toolName,
        modelRoundId: 'clarification_deferred',
        args,
        content: 'deferred_until_user_answer',
        contentForUser: '补充信息确认前暂缓执行同批次工具',
        result: {
          status: 'deferred_until_user_answer',
          reason: 'ask_user_in_same_tool_batch',
          askUserToolCallId: input.currentToolCallId,
        },
      });
      await this.eventWriter.appendRunEvent(
        input.state.input.runId,
        input.state.input.sessionId,
        input.state.input.userId,
        'tool_call_completed',
        {
          toolName,
          content: '补充信息确认前暂缓执行同批次工具',
          arguments: args,
          toolCallId,
          toolResultEnvelope,
          result: {
            status: 'deferred_until_user_answer',
            reason: 'ask_user_in_same_tool_batch',
            askUserToolCallId: input.currentToolCallId,
          },
          outputPreview: 'deferred_until_user_answer',
          transitionReason: 'clarification_requested',
        }
      );
      input.completedToolCallIds.add(toolCallId);
    }
  }

  private async callModel(input: {
    messages: ChatMessage[];
    signal: AbortSignal;
    mcpProviders?: any[];
    onToolCallDelta?: (toolCall: ToolCall) => Promise<void> | void;
    onAssistantTextDelta?: (deltaText: string, fullText: string) => Promise<void> | void;
    fallbackModel?: string | null;
    runtimeSnapshot?: AgentRuntimeSnapshot | null;
    runtimeTokenSource?: string | null;
    llmContext?: ManagedLlmContextHint;
  }): Promise<{
    content?: string | null;
    tool_calls?: ToolCall[];
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_tokens_details?: { cached_tokens?: number; cache_creation_input_tokens?: number }; cached_tokens?: number; cache_creation_input_tokens?: number };
  }> {
    const runtime = input.runtimeSnapshot;
    const baseUrl = `http://127.0.0.1:${process.env.PORT || '4000'}/api/llm-proxy/v1/chat/completions`;
    const projectedMessages = this.budgetService.projectMessagesForModel(input.messages);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (runtime?.baseUrl) {
      headers[LLM_PROXY_INTERNAL_OVERRIDE_HEADER] = getLlmProxyInternalOverrideToken();
      headers['x-oneceo-internal-llm-upstream-base-url'] = runtime.baseUrl;
    }
    if (runtime?.apiType) {
      headers['x-oneceo-internal-llm-upstream-api-type'] = runtime.apiType;
    }
    if (input.runtimeTokenSource) {
      headers[LLM_PROXY_INTERNAL_OVERRIDE_HEADER] = getLlmProxyInternalOverrideToken();
      headers['x-oneceo-internal-llm-upstream-token-source'] = input.runtimeTokenSource;
    }
    const llmContextId = asText(input.llmContext?.contextId);
    if (llmContextId) {
      headers['x-oneceo-internal-llm-context-id'] = llmContextId;
      headers['x-oneceo-llm-context-id'] = llmContextId;
    }
    const llmContextTurn = Number(input.llmContext?.turnIndex);
    if (Number.isFinite(llmContextTurn) && llmContextTurn > 0) {
      headers['x-oneceo-internal-llm-context-turn'] = String(Math.floor(llmContextTurn));
    }
    const llmContextSessionId = asText(input.llmContext?.sessionId);
    if (llmContextSessionId) {
      headers['x-oneceo-internal-llm-session-id'] = llmContextSessionId;
    }
    const llmContextRunId = asText(input.llmContext?.runId);
    if (llmContextRunId) {
      headers['x-oneceo-internal-llm-run-id'] = llmContextRunId;
    }
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers,
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
    return {
      content: choice.content,
      tool_calls: choice.tool_calls,
      usage: payload?.usage,
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
    runtimeSnapshot?: AgentRuntimeSnapshot | null;
    runtimeTokenSource?: string | null;
    llmContext?: ManagedLlmContextHint;
  }): Promise<{
    content?: string | null;
    tool_calls?: ToolCall[];
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_tokens_details?: { cached_tokens?: number; cache_creation_input_tokens?: number }; cached_tokens?: number; cache_creation_input_tokens?: number };
  }> {
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
  }): Promise<{
    content?: string | null;
    tool_calls?: ToolCall[];
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_tokens_details?: { cached_tokens?: number; cache_creation_input_tokens?: number }; cached_tokens?: number; cache_creation_input_tokens?: number };
  }> {
    const decoder = new TextDecoder();
    let buffer = '';
    let assistantContent = '';
    const toolCallsByIndex = new Map<number, StreamedToolCallState>();
    let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_tokens_details?: { cached_tokens?: number; cache_creation_input_tokens?: number }; cached_tokens?: number; cache_creation_input_tokens?: number } | undefined;

    const flushBlock = async (rawBlock: string) => {
      const parsed = this.parseSseBlock(rawBlock);
      if (!parsed) return false;
      if (parsed.done) return true;

      const payload = parsed.payload;
      if (payload?.error && typeof payload.error === 'object') {
        throw new Error(JSON.stringify(payload));
      }

      // 捕获流式响应中的 usage（部分 provider 在最后一个 chunk 返回）
      if (payload?.usage && typeof payload.usage === 'object') {
        const u = payload.usage as any;
        if (typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number') {
          usage = {
            prompt_tokens: u.prompt_tokens,
            completion_tokens: u.completion_tokens,
            total_tokens: u.total_tokens ?? u.prompt_tokens + u.completion_tokens,
          };
          const cachedTokens = this.readUsageNumber(u.prompt_tokens_details?.cached_tokens) || this.readUsageNumber(u.cached_tokens) || 0;
          const cacheCreationTokens = this.readUsageNumber(u.prompt_tokens_details?.cache_creation_input_tokens) || this.readUsageNumber(u.cache_creation_input_tokens) || 0;
          if (cachedTokens > 0 || cacheCreationTokens > 0) {
            usage.prompt_tokens_details = {
              ...(cachedTokens > 0 ? { cached_tokens: cachedTokens } : {}),
              ...(cacheCreationTokens > 0 ? { cache_creation_input_tokens: cacheCreationTokens } : {}),
            };
          }
          if (cacheCreationTokens > 0) {
            usage.cache_creation_input_tokens = cacheCreationTokens;
          }
        }
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
            usage,
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
      usage,
    };
  }

  private buildCompletionMessage(summary: string, verification?: string[]) {
    const normalizedSummary =
      normalizeManagedCompletionMarkdown(truncate(asText(summary), 8000)) || '任务已处理完成。';
    const checks = Array.isArray(verification)
      ? verification
          .map((item) => truncate(asText(item), 500))
          .filter(Boolean)
          .slice(0, 8)
          .map((item) => normalizeManagedCompletionCheck(item))
          .filter(Boolean)
      : [];
    if (checks.length === 0) {
      return normalizedSummary;
    }
    return `${normalizedSummary}\n\n验证:\n\n${checks.map((item) => `- ${item}`).join('\n')}`;
  }

  private resolveFinalAssistantContent(assistantContent: string, completionMessage: string): string {
    const normalizedAssistantContent = normalizeManagedCompletionMarkdown(
      truncate(asText(assistantContent), 24000)
    );
    const normalizedCompletionMessage = normalizeManagedCompletionMarkdown(asText(completionMessage));
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

  private tryParseJson(value: string): unknown | null {
    const trimmed = asText(value).trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }

  private extractConfirmationRequiredPayload(
    value: unknown,
    depth = 0
  ): Record<string, unknown> | null {
    if (depth > 8 || value == null) {
      return null;
    }
    if (typeof value === 'string') {
      const parsed = this.tryParseJson(value);
      return parsed == null ? null : this.extractConfirmationRequiredPayload(parsed, depth + 1);
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = this.extractConfirmationRequiredPayload(item, depth + 1);
        if (nested) {
          return nested;
        }
      }
      return null;
    }

    const record = pickObject(value);
    if (asText(record.type) === 'confirmation_required') {
      return record;
    }

    for (const candidate of [record.structuredContent, record.result, record.content, record.payload]) {
      const nested = this.extractConfirmationRequiredPayload(candidate, depth + 1);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  private readConfirmationRequiredPayload(rawContent: string): Record<string, unknown> | null {
    const parsed = this.tryParseJson(rawContent);
    return parsed == null ? null : this.extractConfirmationRequiredPayload(parsed);
  }

  private async replayApprovedMcpToolCall(input: {
    state: AltusRunState;
    signal: AbortSignal;
    toolExecutor: AltusManagedToolExecutor;
    messages: ChatMessage[];
  }): Promise<AltusManagedToolExecutionEnvelope | null> {
    const replay = input.state.input.confirmedMcpToolReplay;
    if (!replay) return null;
    const sanitizedArgs = { ...replay.argumentsJson };
    const executionArgs = {
      ...sanitizedArgs,
      confirmationToken: replay.confirmationToken,
      confirmationAgentRunId: replay.confirmationAgentRunId || undefined,
    };
    const syntheticToolCallId = `confirmed:${replay.confirmationId}`;
    const toolCall: ToolCall = {
      id: syntheticToolCallId,
      type: 'function',
      function: {
        name: replay.toolName,
        arguments: JSON.stringify(sanitizedArgs),
      },
    };
    input.messages.push({
      role: 'assistant',
      content: '',
      tool_calls: [toolCall],
    });
    const envelope = await input.toolExecutor.executeToolCall({
      toolCall,
      args: executionArgs,
      eventArgs: sanitizedArgs,
      signal: input.signal,
    });
    if (envelope.status === 'ask_user') {
      throw new Error('managed_mcp_confirmation_replay_ask_user_unsupported');
    }
    input.messages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      name: replay.toolName,
      content: stringifyManagedToolResultEnvelope(envelope.toolResultEnvelope),
    });
    return envelope;
  }

  private async runModelLoop(state: AltusRunState, signal: AbortSignal) {
    if (!state.workspaceRoot || !state.sandboxId) {
      throw new Error('managed_run_missing_sandbox_context');
    }
    if (state.input.rejectedMcpToolConfirmation) {
      const finalContent = buildManagedMcpToolRejectionCompletionText(
        state.input.rejectedMcpToolConfirmation
      );
      await this.syncLoopSnapshot(state, {
        lastTransitionReason: 'plain_text_conversation_completed',
        recoveryMode: 'none',
        currentRound: 0,
        maxRounds: this.getMaxToolRounds(),
        plainTextRecoveryUsed: false,
        lastToolName: state.input.rejectedMcpToolConfirmation.toolName,
        lastToolCallId: null,
      });
      await this.eventWriter.appendRunEvent(
        state.input.runId,
        state.input.sessionId,
        state.input.userId,
        'run_status',
        {
          status: 'running',
          content: 'MCP 高风险操作已按用户拒绝结果取消',
          transitionReason: 'plain_text_conversation_completed',
        }
      );
      return this.finalizePlainTextConversationCompletion(
        state,
        finalContent,
        `managed:${state.input.runId}:assistant:final`,
      );
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
      includeRuntimeState: false,
    });
    writeConnectorDebugLog('[ALTUS_RUN_PROMPT_READY]', {
      taskSessionId: state.input.sessionId,
      runId: state.input.runId,
      hasConnectorGuideInstructions: Boolean(connectorGuideSections.instructionsSection),
      hasConnectorGuideReminders: Boolean(connectorGuideSections.reminderSection),
      connectorCount: Array.isArray(state.input.connectors) ? state.input.connectors.length : 0,
    });
    const skillCatalogPrompt = altusManagedPromptService.buildSkillCatalogPrompt(state.input.skillCatalog, {
      includeBlockIndex: false,
    });
    const skillPrompt = altusManagedPromptService.buildSkillContextPrompt(state.input.skills, {
      includeBlockIndex: false,
    });
    const dynamicContextPrompt = altusManagedDynamicContextBlockService.renderBlockIndex([
      ...altusManagedDynamicContextBlockService.buildSkillBlocks({
        activeSkills: state.input.skills,
        catalog: state.input.skillCatalog,
      }),
      ...altusManagedDynamicContextBlockService.buildMcpBlocks({
        providers: state.input.mcpProviders,
      }),
      ...altusManagedDynamicContextBlockService.buildMemoryBlocks({
        userMemory: state.input.userMemory,
        projectMemory: state.input.projectMemory,
        sessionMemory: state.input.sessionAltusMemory,
        runtimeMemoryPrompt: state.input.memoryContextPrompt,
        skillMemory: state.input.sessionSkillState?.fileMemorySnapshot,
      }),
    ]);
    const runtimeContextPrompt = altusManagedPromptService.buildRuntimeContextPrompt({
      sessionId: state.input.sessionId,
      sessionTitle: state.input.sessionTitle,
      workspaceRoot: state.workspaceRoot,
      connectors: state.input.connectors as any,
      taskIntentProfile: state.input.taskIntentProfile,
      connectorGuideSections,
      turnStatePrompt: altusManagedContextService.buildTurnStatePrompt({
        currentMessageType: state.input.messageType || 'user_input',
        taskIntentProfile: state.input.taskIntentProfile,
      }),
    });
    const turnStatePrompt = [
      runtimeContextPrompt,
      state.input.mcpToolConfirmationPrompt || '',
      dynamicContextPrompt,
      state.input.memoryContextPrompt || '',
      skillCatalogPrompt,
      skillPrompt,
    ]
      .filter(Boolean)
      .join('\n\n');
    const messages = await this.setupService.buildConversationMessages(
      state.input.sessionId,
      state.input.userInput,
      systemPrompt,
      {
        turnStatePrompt,
      }
    );
    let plainTextRecoveryUsed = false;
    const replayEnvelope = await this.replayApprovedMcpToolCall({
      state,
      signal,
      toolExecutor,
      messages,
    });
    if (replayEnvelope?.status === 'failed') {
      await this.syncLoopSnapshot(state, {
        lastTransitionReason: replayEnvelope.transitionReason,
        recoveryMode: replayEnvelope.recoveryMode,
        currentRound: 0,
        maxRounds: this.getMaxToolRounds(),
        plainTextRecoveryUsed,
        lastToolName: replayEnvelope.toolName,
        lastToolCallId: replayEnvelope.toolCallId,
      });
      throw new Error(replayEnvelope.error);
    }
    const assistantStreamMessageKey = `managed:${state.input.runId}:assistant`;
    const finalAssistantMessageKey = `managed:${state.input.runId}:assistant:final`;
    const deploymentCompletionIntent = this.resolveDeploymentCompletionIntent(
      state.input.userInput,
      state.input.taskIntentProfile
    );
    let lastDeploymentEvidence: DeploymentCompletionEvidence | null = null;
    const visualDetectionEvidence: VisualDetectionEvidenceState = {
      capturedCount: 0,
      passedCount: 0,
      lastToolName: '',
      lastAction: '',
      lastUrl: '',
      lastCapturedAt: '',
      lastStatus: '',
      lastReasonCode: '',
      lastMessage: '',
      lastPassedBrowserScreenshot: null,
    };
    let debugOpenPageSucceeded = false;
    const debugOpenPageFailureState: DebugOpenPageFailureState = {
      lastKey: '',
      repeatCount: 0,
      failureCounts: {},
    };
    const maxToolRounds = this.getMaxToolRounds();
    let nextRoundStatusContent = '正在分析并执行任务';

    for (let round = 0; round < maxToolRounds; round += 1) {
      if (signal.aborted) {
        throw new Error('managed_run_aborted');
      }

      // 每轮循环前余额预检（止损：避免余额耗尽后白调 LLM）
      const loopUserId = state.input.userId;
      if (loopUserId) {
        const hasEnough = await billingService.hasEnoughCredits(loopUserId, 0);
        if (!hasEnough) {
          const credits = await billingService.getUserCredits(loopUserId);
          await this.eventWriter.appendRunEvent(
            state.input.runId,
            state.input.sessionId,
            loopUserId,
            'run_status',
            {
              status: 'failed',
              content: `积分不足，无法继续运行。当前余额: ${credits?.balance || 0} 积分`,
            }
          );
          throw new Error(`insufficient_credits: 积分不足，无法继续运行`);
        }
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
      const llmContextId = asText(state.input.sessionAltusMemory?.llmContext?.contextId);

      const toolProgressLengths = new Map<string, number>();
      const modelName = this.getModelName(messages, state.input.model);
      const billingTargetKey = state.input.billingTargetKey || modelName;
      const activePricing = await pricingService.getActivePricing(billingTargetKey);
      if (!activePricing) {
        throw new Error(`billing_pricing_missing:${billingTargetKey}`);
      }

      const llmTraceStartedAt = new Date();
      const llmTrace = await traceLlmCallStart({
        sessionId: state.input.sessionId,
        runId: state.input.runId,
        model: modelName,
        provider: state.input.runtimeSnapshot?.apiType || 'openai',
        endpoint: '/v1/chat/completions',
        requestBody: {
          model: modelName,
          messages: sanitizeMessagesForModel(messages),
          tools: buildManagedToolDefinitionsWithMcp({
            mcpProviders: Array.isArray(state.input.mcpProviders) ? state.input.mcpProviders : [],
          }),
          tool_choice: 'auto',
          temperature: 0.2,
          stream: true,
        },
        startedAt: llmTraceStartedAt,
      });

      let assistant;
      try {
        assistant = await this.callModelWithRetry({
          messages,
          signal,
          mcpProviders: state.input.mcpProviders,
          fallbackModel: state.input.model,
          runtimeSnapshot: state.input.runtimeSnapshot || null,
          runtimeTokenSource: state.input.runtimeTokenSource || null,
          llmContext: {
            contextId: llmContextId || null,
            turnIndex: currentRound,
            sessionId: state.input.sessionId,
            runId: state.input.runId,
          },
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

      traceLlmCallComplete(llmTrace, {
        responseStatus: 200,
        responseBody: assistant,
        usage: assistant?.usage,
        completedAt: new Date(),
      });
      } catch (error) {
        traceLlmCallComplete(llmTrace, {
          responseStatus: 500,
          errorMessage: error instanceof Error ? error.message : String(error),
          completedAt: new Date(),
        });
        throw error;
      }

      // 计费
      await this.chargeForModelCall(state, {
        messages,
        assistant,
        model: modelName,
      });
      try {
        const promptTokens = this.readUsageNumber(assistant?.usage?.prompt_tokens) || 0;
        const cachedTokens =
          this.readUsageNumber(assistant?.usage?.prompt_tokens_details?.cached_tokens) ||
          this.readUsageNumber(assistant?.usage?.cached_tokens) ||
          0;
        const cacheCreationTokens =
          this.readUsageNumber(assistant?.usage?.prompt_tokens_details?.cache_creation_input_tokens) ||
          this.readUsageNumber(assistant?.usage?.cache_creation_input_tokens) ||
          0;
        state.input.sessionAltusMemory = await taskSessionAltusMemoryService.recordLlmContextUsage({
          sessionId: state.input.sessionId,
          runId: state.input.runId,
          model: modelName,
          provider: state.input.runtimeSnapshot?.apiType || 'openai',
          promptTokens,
          cachedTokens,
          cacheCreationTokens,
        });
      } catch (error) {
        console.warn('[ALTUS_RUN_CONTEXT_USAGE_WARN]', {
          sessionId: state.input.sessionId,
          runId: state.input.runId,
          model: modelName,
          error: error instanceof Error ? error.message : String(error),
        });
      }

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
          !deploymentCompletionIntent.requiresManagedSuccess &&
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
        if (
          assistantContent &&
          currentRound > 1 &&
          !deploymentCompletionIntent.requiresManagedSuccess &&
          this.looksLikeCompletedTaskSummary(assistantContent)
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
              content: '识别为纯文本完成总结，已完成当前任务',
              transitionReason: 'plain_text_conversation_completed',
              currentRound,
              maxRounds: maxToolRounds,
            }
          );
          return this.finalizePlainTextConversationCompletion(
            state,
            assistantContent,
            finalAssistantMessageKey,
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
          content: this.buildContinuationReminder(assistantContent, deploymentCompletionIntent),
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

      const completedToolCallIds = new Set<string>();
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
              toolResultEnvelope: buildManagedToolResultEnvelope({
                status: 'error',
                runId: state.input.runId,
                toolUseId: toolCall.id,
                toolName,
                modelRoundId: currentRound,
                args,
                errorCode: 'invalid_tool_arguments_json',
                errorMessage: 'Tool arguments must be a JSON object string.',
                content: errorContent,
                contentForUser: errorContent,
              }),
              error: errorContent,
              transitionReason: 'tool_failed_but_recoverable',
            }
          );
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: stringifyManagedToolResultEnvelope(
              buildManagedToolResultEnvelope({
                status: 'error',
                runId: state.input.runId,
                toolUseId: toolCall.id,
                toolName,
                modelRoundId: currentRound,
                args,
                errorCode: 'invalid_tool_arguments_json',
                errorMessage: 'Tool arguments must be a JSON object string.',
                content: errorContent,
                contentForUser: errorContent,
              })
            ),
          });
          completedToolCallIds.add(toolCall.id);
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
          modelRoundId: currentRound,
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
            if (toolName === 'debug_open_page') {
              debugOpenPageSucceeded = true;
            }
            const visualEvidence = this.readVisualDetectionEvidence(toolName, result);
            if (visualEvidence) {
              if (visualEvidence.captured) {
                visualDetectionEvidence.capturedCount += 1;
              }
              if (visualEvidence.passed) {
                visualDetectionEvidence.passedCount += 1;
                visualDetectionEvidence.lastPassedBrowserScreenshot = visualEvidence.browserScreenshot;
              }
              visualDetectionEvidence.lastToolName = visualEvidence.toolName;
              visualDetectionEvidence.lastAction = visualEvidence.action;
              visualDetectionEvidence.lastUrl = visualEvidence.url;
              visualDetectionEvidence.lastCapturedAt = visualEvidence.capturedAt;
              visualDetectionEvidence.lastStatus = visualEvidence.visualStatus;
              visualDetectionEvidence.lastReasonCode = visualEvidence.reasonCode;
              visualDetectionEvidence.lastMessage = visualEvidence.message;
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
            const debugFailure =
              toolName === 'debug_open_page'
                ? this.recordDebugOpenPageFailure({
                    args,
                    rawError,
                    sanitizedError,
                    state: debugOpenPageFailureState,
                  })
                : null;
            const effectiveRawError = debugFailure?.rawError || rawError;
            const effectiveSanitizedError = debugFailure?.sanitizedError || sanitizedError;
            const failedTransitionReason: AltusRunTransitionReason = effectiveRawError.startsWith(DEPLOYMENT_COMPLETION_BLOCKED_PREFIX)
              ? 'deployment_completion_blocked'
              : debugFailure?.userActionRequired
                ? 'tool_failed_user_action_required'
                : 'tool_failed_but_recoverable';
            return {
              transitionReason: failedTransitionReason,
              recoveryMode: debugFailure?.userActionRequired ? 'awaiting_user' : 'tool_repair',
              errorCode: debugFailure?.errorCode,
              retryable: debugFailure ? !debugFailure.userActionRequired : undefined,
              sanitizedError: effectiveSanitizedError,
              rawError: effectiveRawError,
              eventPayload: this.isDeploymentTool(toolName)
                ? {
                    userView: {
                      summary: effectiveSanitizedError,
                      preview: effectiveSanitizedError,
                      detail: effectiveSanitizedError,
                    },
                    internalView: {
                      detail: [`工具: ${toolName}`, `rawError: ${effectiveRawError}`].join('\n'),
                    },
                  }
                : debugFailure
                  ? {
                      debugOpenPageFailure: {
                        errorCode: debugFailure.errorCode,
                        repeatCount: debugFailure.repeatCount,
                        blocked: debugFailure.blocked,
                        target: this.normalizeDebugOpenPageTarget(args),
                      },
                      internalView: {
                        detail: [`工具: ${toolName}`, `rawError: ${effectiveRawError}`].join('\n'),
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
          const autoAttachedDeltaBlocks = altusManagedDynamicContextBlockService.buildIncludedContextManifest(
            altusManagedDynamicContextBlockService.buildSkillBlocks({
              autoAttachedSkills: executionResult.activatedSkills,
              toolName,
            })
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
              contextBlocks: autoAttachedDeltaBlocks.blocks,
              contextBlocksHash: autoAttachedDeltaBlocks.hash,
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
              contextBlocks: autoAttachedDeltaBlocks.blocks,
              contextBlocksHash: autoAttachedDeltaBlocks.hash,
            }
          );
        }

        if (envelope.status === 'ask_user') {
          const result = envelope.result;
            await this.completeDeferredSiblingToolCalls({
              state,
              toolCalls,
              currentToolCallId: toolCall.id,
              completedToolCallIds,
            });
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
              clarificationType: result.clarificationType,
              structuredClarification: result.structuredClarification,
              toolCallId: toolCall.id,
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
                toolResultEnvelope: buildManagedToolResultEnvelope({
                  status: 'error',
                  runId: state.input.runId,
                  toolUseId: toolCall.id,
                  toolName,
                  modelRoundId: currentRound,
                  args,
                  errorCode: 'completion_blocked',
                  errorMessage: blockedMessage,
                  content: blockedEventError,
                  contentForUser: blockedEventError,
                }),
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
              content: stringifyManagedToolResultEnvelope(
                buildManagedToolResultEnvelope({
                  status: 'error',
                  runId: state.input.runId,
                  toolUseId: toolCall.id,
                  toolName,
                  modelRoundId: currentRound,
                  args,
                  errorCode: 'completion_blocked',
                  errorMessage: blockedMessage,
                  content: blockedEventError,
                  contentForUser: blockedEventError,
                })
              ),
            });
            completedToolCallIds.add(toolCall.id);
            continue;
          }
          if (
            toolName === 'complete_task' &&
            this.requiresVisualDetectionBeforeCompletion(state.input.taskIntentProfile) &&
            !this.isVisualDetectionEvidenceSuccessful(visualDetectionEvidence)
          ) {
            const blockedMessage = this.buildVisualDetectionCompletionBlockedError(visualDetectionEvidence);
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
                toolResultEnvelope: buildManagedToolResultEnvelope({
                  status: 'error',
                  runId: state.input.runId,
                  toolUseId: toolCall.id,
                  toolName,
                  modelRoundId: currentRound,
                  args,
                  errorCode: 'visual_detection_completion_blocked',
                  errorMessage: blockedMessage,
                  content: blockedEventError,
                  contentForUser: blockedEventError,
                }),
                error: blockedEventError,
                transitionReason: 'visual_detection_completion_blocked',
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
              lastTransitionReason: 'visual_detection_completion_blocked',
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
              content: stringifyManagedToolResultEnvelope(
                buildManagedToolResultEnvelope({
                  status: 'error',
                  runId: state.input.runId,
                  toolUseId: toolCall.id,
                  toolName,
                  modelRoundId: currentRound,
                  args,
                  errorCode: 'visual_detection_completion_blocked',
                  errorMessage: blockedMessage,
                  content: blockedEventError,
                  contentForUser: blockedEventError,
                })
              ),
            });
            completedToolCallIds.add(toolCall.id);
            continue;
          }

            if (!state.sandboxId || !state.workspaceRoot) {
              throw new Error('managed_run_missing_sandbox_context');
            }
            let deliverables;
            try {
              deliverables = await this.deliverableService.persistManagedRunDeliverables({
                sessionId: state.input.sessionId,
                runId: state.input.runId,
                sandboxId: state.sandboxId,
                workspaceRoot: state.workspaceRoot,
                attachments: result.attachments || [],
              });
            } catch (firstPersistError) {
              console.warn('[DELIVERABLE_PERSIST_RETRY]', {
                runId: state.input.runId,
                sessionId: state.input.sessionId,
                attempt: 1,
                error:
                  firstPersistError instanceof Error
                    ? firstPersistError.message
                    : String(firstPersistError),
              });
              try {
                deliverables = await this.deliverableService.persistManagedRunDeliverables({
                  sessionId: state.input.sessionId,
                  runId: state.input.runId,
                  sandboxId: state.sandboxId,
                  workspaceRoot: state.workspaceRoot,
                  attachments: result.attachments || [],
                });
              } catch (secondPersistError) {
                const persistErrorMessage =
                  secondPersistError instanceof Error
                    ? secondPersistError.message
                    : String(secondPersistError);
                const userFacingError =
                  '交付文件暂存失败，平台已自动重试。请检查输出文件后再次调用 complete_task 提交交付物。';
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
                    toolResultEnvelope: buildManagedToolResultEnvelope({
                      status: 'error',
                      runId: state.input.runId,
                      toolUseId: toolCall.id,
                      toolName,
                      modelRoundId: currentRound,
                      args,
                      errorCode: 'deliverable_persistence_failed',
                      errorMessage: userFacingError,
                      content: userFacingError,
                      contentForUser: userFacingError,
                    }),
                    error: userFacingError,
                    transitionReason: 'deliverable_persistence_failed',
                    userView: {
                      summary: userFacingError,
                      preview: userFacingError,
                      detail: userFacingError,
                    },
                    internalView: {
                      detail: [`工具: ${toolName}`, `rawError: ${persistErrorMessage}`].join('\n'),
                    },
                  },
                );
                await this.syncLoopSnapshot(state, {
                  lastTransitionReason: 'deliverable_persistence_failed',
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
                  content: stringifyManagedToolResultEnvelope(
                    buildManagedToolResultEnvelope({
                      status: 'error',
                      runId: state.input.runId,
                      toolUseId: toolCall.id,
                      toolName,
                      modelRoundId: currentRound,
                      args,
                      errorCode: 'deliverable_persistence_failed',
                      errorMessage: userFacingError,
                      content: userFacingError,
                      contentForUser: userFacingError,
                    }),
                  ),
                });
                completedToolCallIds.add(toolCall.id);
                continue;
              }
            }
            if (!deliverables) {
              throw new Error('deliverables_persist_unexpected_empty');
            }
            state.deliverables = deliverables;
            const capturedPreviewSnapshot: WebsitePreviewSnapshot | null =
              await this.websitePreviewSnapshotService.captureManagedRunPreview({
                sessionId: state.input.sessionId,
                runId: state.input.runId,
                sandboxId: state.sandboxId,
                workspaceRoot: state.workspaceRoot,
                taskIntentProfile: state.input.taskIntentProfile,
                attachments: result.attachments || [],
                deliverables,
                debugOpenPageSucceeded,
              });
            const previewSnapshot: WebsitePreviewSnapshot | null = this.resolveWebsitePreviewSnapshot({
              capturedSnapshot: capturedPreviewSnapshot,
              visualDetectionEvidence,
            });
            const completionMessage = this.buildCompletionMessage(result.summary, result.verification);
            const finalContent = this.resolveFinalAssistantContent(assistantContent, completionMessage);
            if (deliverables.length > 0 || previewSnapshot) {
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
                  previewSnapshot,
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
                  previewSnapshot,
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
              toolResultEnvelope: buildManagedToolResultEnvelope({
                status: 'complete',
                runId: state.input.runId,
                toolUseId: toolCall.id,
                toolName,
                modelRoundId: currentRound,
                args,
                content: JSON.stringify({
                  summary: result.summary,
                  verification: result.verification,
                  attachments: result.attachments,
                  deliverables,
                  previewSnapshot,
                }),
                contentForUser: completionMessage,
                result: {
                  summary: result.summary,
                  verification: result.verification,
                  attachments: result.attachments,
                  deliverables,
                  previewSnapshot,
                },
              }),
              transitionReason: deliverables.length > 0 ? 'completed_with_deliverables' : 'completed_without_deliverables',
              outputPreview: truncate(
                JSON.stringify({
                  summary: result.summary,
                  verification: result.verification,
                  attachments: result.attachments,
                  deliverables,
                  previewSnapshot,
                }),
                4000
              ),
              previewSnapshot,
              }
            );
            await this.setupService.persistTimelineMessage({
              sessionId: state.input.sessionId,
              role: 'agent',
              messageType: 'assistant_message',
              content: finalContent,
              metadata: {
                agent: 'altus',
                executor: 'altus',
                executionMode: 'managed',
                eventType: 'assistant_message',
                runId: state.input.runId,
                verification: result.verification,
                deliverables,
                previewSnapshot,
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
              previewSnapshot,
              }
            );
            return { outcome: 'completed' as const, content: finalContent, deliverables };
        }

        if (envelope.status === 'result') {
          const result = envelope.result;
          if (this.isDebugOpenPageCorrectiveTool(toolName)) {
            debugOpenPageFailureState.lastKey = '';
            debugOpenPageFailureState.repeatCount = 0;
          }
          const confirmationRequired = this.readConfirmationRequiredPayload(result.content);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: stringifyManagedToolResultEnvelope(envelope.toolResultEnvelope),
          });
          completedToolCallIds.add(toolCall.id);
          if (confirmationRequired) {
            await this.syncLoopSnapshot(state, {
              lastTransitionReason: 'tool_confirmation_requested',
              recoveryMode: 'awaiting_user',
              currentRound,
              maxRounds: maxToolRounds,
              plainTextRecoveryUsed,
              lastToolName: toolName,
              lastToolCallId: toolCall.id,
            });
            return { outcome: 'waiting_user' as const };
          }
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
            content: stringifyManagedToolResultEnvelope(envelope.toolResultEnvelope),
          });
          completedToolCallIds.add(toolCall.id);
          if (envelope.transitionReason === 'tool_failed_user_action_required') {
            throw new AltusRunUserVisibleStopError({
              rawMessage: envelope.rawError || envelope.error,
              userMessage: envelope.error,
              reasonCode: envelope.toolResultEnvelope.errorCode,
            });
          }
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
        const preExecutionStructuredClarification = this.resolvePreExecutionStructuredClarification(state);
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
          structuredClarification: preExecutionStructuredClarification,
        });
        await this.lifecycleService.markWaitingUser(state);
        return;
      }

      // 余额检查
      const userId = state.input.userId;
      if (userId) {
        const hasEnough = await billingService.hasEnoughCredits(userId, 0);
        if (!hasEnough) {
          const credits = await billingService.getUserCredits(userId);
          await this.eventWriter.appendRunEvent(
            state.input.runId,
            state.input.sessionId,
            userId,
            'run_status',
            {
              status: 'failed',
              content: `积分不足，无法启动运行。当前余额: ${credits?.balance || 0} 积分`,
            }
          );
          throw new Error(`insufficient_credits: 积分不足，无法启动运行`);
        }
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
        state.input.sessionTitle,
        {
          taskIntentProfile: state.input.taskIntentProfile,
        }
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
      try {
        const anchoredMemory = await taskSessionAltusMemoryService.ensureLlmContextAnchor({
          sessionId: state.input.sessionId,
          runId: state.input.runId,
          model: state.input.model,
          provider: state.input.runtimeSnapshot?.apiType || 'openai',
        });
        state.input.sessionAltusMemory = anchoredMemory;
      } catch (error) {
        console.warn('[ALTUS_RUN_CONTEXT_ANCHOR_WARN]', {
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

      const failure = normalizeAltusRunFailure(error);
      state.markFailed(failure.stopReason);
      await this.flushSandboxSkillMemory(state, 'failed');
      await this.flushSandboxAltusMemory(state, 'failed');
      await this.lifecycleService.markFailed(state, failure.rawMessage || failure.stopReason, {
        userMessage: failure.userMessage,
        reasonCode: failure.reasonCode,
      });
    }
  }
}

export const altusRunCoordinator = new AltusRunCoordinator();
