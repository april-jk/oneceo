import { asText, truncate } from './altus-managed-shared';
import { classifyManagedToolErrorCode } from './altus-managed-tool-result-envelope';

export type AltusRunFailureDescriptor = {
  reasonCode: string;
  rawMessage: string;
  userMessage: string;
  stopReason: string;
};

const DEFAULT_USER_MESSAGE =
  '这次任务没有顺利完成。平台已停止继续尝试并保留了过程记录，避免继续消耗积分；你可以调整要求后重新发起。';

function hasInternalDiagnosticText(value: string) {
  return (
    /(?:^|\s)[a-z][a-z0-9_]+:[^\s]/i.test(value) ||
    /\b(?:rawError|same_target|same_reason|repeat_count|last_error|stack trace|exit status)\b/i.test(value) ||
    /(?:__ONECEO_|127\.0\.0\.1|0\.0\.0\.0|localhost:\d+|\/workspace\/|\/tmp\/|playwright_module_not_found)/i.test(value)
  );
}

function publicMessageForReason(reasonCode: string) {
  switch (reasonCode) {
    case 'debug_open_page_repeat_blocked':
      return '视觉检测暂时无法继续：同一个预览地址连续未能打开。平台已停止重复尝试以避免继续消耗积分，并保留了已完成的检查记录；请先确认预览服务、端口或文件路径后重新运行。';
    case 'debug_service_not_ready':
    case 'sandbox_browser_capability_unavailable':
      return '视觉检测浏览器环境暂时不可用。平台已停止本次检测并保留诊断记录，避免继续消耗积分；远程浏览器能力恢复后可以重新运行。';
    case 'debug_target_unreachable':
    case 'debug_target_file_missing':
    case 'debug_target_bad_status':
    case 'debug_target_tab_not_ready':
    case 'debug_open_page_cdp_open_failed':
    case 'debug_open_page_invalid_target':
      return '视觉检测暂时无法打开预览页面。平台已停止重复尝试并保留检查记录；请确认预览服务、访问地址和交付文件路径后重新运行。';
    case 'sandbox_not_ready':
      return '运行环境暂时没有准备好。平台已停止当前任务并保留诊断记录；环境恢复后可以重新运行。';
    case 'mcp_provider_not_found':
    case 'connector_guide_required':
      return '连接器运行状态暂时不可用。平台已停止当前任务并保留诊断记录；连接器恢复后可以继续。';
    case 'insufficient_credits':
      return '积分余额不足，当前任务已停止以避免继续排队。充值后可以重新发起。';
    case 'managed_run_tool_round_limit_exceeded':
      return '我已经停止继续尝试，避免重复消耗积分。当前任务还没有形成稳定交付结果，平台已保留已完成的步骤记录。';
    default:
      return '';
  }
}

function classifyRunFailureReason(rawMessage: string, explicitReasonCode?: string) {
  const explicit = asText(explicitReasonCode);
  if (explicit) return explicit;
  const normalized = rawMessage.toLowerCase();
  if (normalized.includes('insufficient_credits')) return 'insufficient_credits';
  if (normalized.includes('managed_run_tool_round_limit_exceeded')) return 'managed_run_tool_round_limit_exceeded';
  return classifyManagedToolErrorCode(rawMessage);
}

export function buildAltusRunFailureDescriptor(input: {
  rawMessage?: unknown;
  userMessage?: unknown;
  reasonCode?: string;
}): AltusRunFailureDescriptor {
  const rawMessage = asText(input.rawMessage);
  const reasonCode = classifyRunFailureReason(rawMessage, input.reasonCode);
  const mappedMessage = publicMessageForReason(reasonCode);
  const providedUserMessage = asText(input.userMessage);
  const userMessage =
    mappedMessage ||
    (providedUserMessage && !hasInternalDiagnosticText(providedUserMessage)
      ? truncate(providedUserMessage, 800)
      : DEFAULT_USER_MESSAGE);
  return {
    reasonCode,
    rawMessage,
    userMessage,
    stopReason: userMessage,
  };
}

export class AltusRunUserVisibleStopError extends Error {
  readonly reasonCode: string;
  readonly rawMessage: string;
  readonly userMessage: string;
  readonly stopReason: string;

  constructor(input: { rawMessage?: unknown; userMessage?: unknown; reasonCode?: string }) {
    const descriptor = buildAltusRunFailureDescriptor(input);
    super(descriptor.userMessage);
    this.name = 'AltusRunUserVisibleStopError';
    this.reasonCode = descriptor.reasonCode;
    this.rawMessage = descriptor.rawMessage;
    this.userMessage = descriptor.userMessage;
    this.stopReason = descriptor.stopReason;
  }
}

export function normalizeAltusRunFailure(error: unknown): AltusRunFailureDescriptor {
  if (error instanceof AltusRunUserVisibleStopError) {
    return buildAltusRunFailureDescriptor({
      rawMessage: error.rawMessage,
      userMessage: error.userMessage,
      reasonCode: error.reasonCode,
    });
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (asText(record.userMessage) || asText(record.rawMessage) || asText(record.reasonCode)) {
      return buildAltusRunFailureDescriptor({
        rawMessage: record.rawMessage || (error instanceof Error ? error.message : ''),
        userMessage: record.userMessage,
        reasonCode: asText(record.reasonCode),
      });
    }
  }
  return buildAltusRunFailureDescriptor({
    rawMessage: error instanceof Error ? error.message : String(error || 'managed run failed'),
  });
}
