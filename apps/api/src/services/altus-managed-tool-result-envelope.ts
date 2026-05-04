import { asText, truncate } from './altus-managed-shared';

export type ManagedToolResultEnvelopeStatus =
  | 'ok'
  | 'error'
  | 'ask_user'
  | 'complete'
  | 'cancelled'
  | 'deferred';

export type ManagedToolResultEnvelope = {
  status: ManagedToolResultEnvelopeStatus;
  toolUseId: string;
  toolName: string;
  runId: string;
  modelRoundId: string;
  args: Record<string, unknown>;
  contentForModel: string;
  contentForUser: string;
  retryable: boolean;
  sideEffects: string[];
  activatedSkills: Array<Record<string, unknown>>;
  errorCode?: string;
  errorMessage?: string;
  result?: unknown;
};

export function classifyManagedToolErrorCode(rawError: string) {
  const normalized = asText(rawError).toLowerCase();
  if (normalized.includes('invalid_tool_arguments_json')) return 'invalid_tool_arguments_json';
  if (normalized.startsWith('unsupported_tool:')) return 'unsupported_tool';
  if (normalized.includes('complete_task_attachments_invalid')) return 'complete_task_attachments_invalid';
  if (normalized.includes('complete_task_downloadable_requires_attachments')) {
    return 'complete_task_downloadable_requires_attachments';
  }
  if (normalized.includes('complete_task_attachment_path_invalid')) return 'complete_task_attachment_path_invalid';
  if (normalized.includes('complete_task_pptx_requires_render_pptx_from_instructions')) {
    return 'complete_task_pptx_requires_render_pptx_from_instructions';
  }
  if (normalized.includes('managed_run_missing_sandbox_context') || normalized.includes('sandbox_not_ready')) {
    return 'sandbox_not_ready';
  }
  if (normalized.includes('mcp provider not found') || normalized.includes('连接器运行态已丢失')) {
    return 'mcp_provider_not_found';
  }
  if (normalized.startsWith('connector_guide_blocked:')) return 'connector_guide_required';
  if (normalized.startsWith('deployment_tool_not_allowed_without_explicit_request')) return 'deployment_not_allowed';
  if (normalized.startsWith('deployment_completion_blocked:')) return 'completion_blocked';
  return 'tool_execution_failed';
}

export function isManagedToolErrorRetryable(errorCode: string) {
  return (
    errorCode === 'invalid_tool_arguments_json' ||
    errorCode === 'complete_task_attachments_invalid' ||
    errorCode === 'complete_task_downloadable_requires_attachments' ||
    errorCode === 'complete_task_attachment_path_invalid' ||
    errorCode === 'complete_task_pptx_requires_render_pptx_from_instructions' ||
    errorCode === 'sandbox_not_ready' ||
    errorCode === 'mcp_provider_not_found' ||
    errorCode === 'connector_guide_required' ||
    errorCode === 'completion_blocked' ||
    errorCode === 'tool_execution_failed'
  );
}

export function buildContentForModel(input: {
  status: ManagedToolResultEnvelopeStatus;
  toolName: string;
  content?: string;
  errorCode?: string;
  errorMessage?: string;
}) {
  if (input.status === 'ok') {
    return truncate(asText(input.content) || JSON.stringify({ ok: true }), 16000);
  }
  if (input.status === 'complete') {
    return truncate(asText(input.content) || JSON.stringify({ complete: true }), 16000);
  }
  if (input.status === 'ask_user') {
    return JSON.stringify({
      status: 'ask_user',
      instruction: 'Wait for the user answer before continuing.',
    });
  }
  if (input.status === 'deferred') {
    return JSON.stringify({
      status: 'deferred',
      reason: asText(input.content) || 'deferred_until_user_answer',
    });
  }
  if (input.status === 'cancelled') {
    return JSON.stringify({
      status: 'cancelled',
      reason: asText(input.content) || 'cancelled',
    });
  }
  const errorCode = input.errorCode || 'tool_execution_failed';
  return JSON.stringify({
    status: 'error',
    errorCode,
    error: buildErrorDetail(errorCode, input.errorMessage),
    instruction: buildErrorInstruction(errorCode, input.toolName),
  });
}

function buildErrorDetail(errorCode: string, rawError?: string) {
  const normalizedRawError = asText(rawError);
  switch (errorCode) {
    case 'complete_task_attachments_invalid':
      return 'The complete_task.attachments field must be a JSON array. Do not pass a stringified array or any other non-array structure.';
    case 'complete_task_downloadable_requires_attachments':
      return 'This task is asking for a downloadable artifact, but complete_task was called without attachments.';
    case 'complete_task_attachment_path_invalid':
      return 'Each complete_task attachment must use a non-empty path that points to a file inside the workspace, not the workspace root.';
    case 'complete_task_pptx_requires_render_pptx_from_instructions':
      return 'PPTX attachments must come from render_pptx_from_instructions before complete_task can deliver them.';
    default:
      return normalizedRawError || 'Tool execution failed.';
  }
}

function buildErrorInstruction(errorCode: string, toolName: string) {
  switch (errorCode) {
    case 'invalid_tool_arguments_json':
      return 'Retry this tool call with valid JSON object arguments.';
    case 'unsupported_tool':
      return `Tool ${toolName} is not available. Choose a supported tool or a different path.`;
    case 'complete_task_attachments_invalid':
      return 'Re-run complete_task with attachments as a real JSON array. Each item should include the workspace-relative file path, and optional name or mimeType.';
    case 'complete_task_downloadable_requires_attachments':
      return 'Confirm the final downloadable file exists in the workspace, then re-run complete_task with that file path in complete_task.attachments.';
    case 'complete_task_attachment_path_invalid':
      return 'Fix the attachment paths to use non-empty workspace-relative file paths that point to the generated deliverable files.';
    case 'complete_task_pptx_requires_render_pptx_from_instructions':
      return 'Call render_pptx_from_instructions first, then attach the returned PPTX path in complete_task.attachments.';
    case 'sandbox_not_ready':
      return 'Sandbox is not ready. Recover or wait for the sandbox before retrying.';
    case 'mcp_provider_not_found':
      return 'The MCP provider runtime is missing. Recover the provider before retrying.';
    case 'connector_guide_required':
      return 'Call load_connector_guide for the connector before using this MCP tool.';
    case 'deployment_not_allowed':
      return 'Deployment is not allowed for this turn. Continue with local deliverables instead.';
    case 'completion_blocked':
      return 'Completion evidence is insufficient. Gather verification or deployment evidence before completing.';
    default:
      return 'Inspect the error and choose a safe recovery path.';
  }
}

export function buildManagedToolResultEnvelope(input: {
  status: ManagedToolResultEnvelopeStatus;
  runId: string;
  toolUseId: string;
  toolName: string;
  modelRoundId?: string | number | null;
  args?: Record<string, unknown>;
  content?: string;
  contentForUser?: string;
  retryable?: boolean;
  sideEffects?: string[];
  activatedSkills?: Array<Record<string, unknown>>;
  errorCode?: string;
  errorMessage?: string;
  result?: unknown;
}): ManagedToolResultEnvelope {
  const errorCode =
    input.errorCode || (input.status === 'error' ? classifyManagedToolErrorCode(input.errorMessage || '') : undefined);
  const retryable =
    typeof input.retryable === 'boolean'
      ? input.retryable
      : input.status === 'error'
        ? isManagedToolErrorRetryable(errorCode || 'tool_execution_failed')
        : false;
  const contentForModel = buildContentForModel({
    status: input.status,
    toolName: input.toolName,
    content: input.content,
    errorCode,
    errorMessage: input.errorMessage,
  });
  return {
    status: input.status,
    toolUseId: input.toolUseId,
    toolName: input.toolName,
    runId: input.runId,
    modelRoundId:
      typeof input.modelRoundId === 'number' && Number.isFinite(input.modelRoundId)
        ? String(Math.floor(input.modelRoundId))
        : asText(input.modelRoundId) || 'round-unknown',
    args: input.args || {},
    contentForModel,
    contentForUser: asText(input.contentForUser) || asText(input.content) || asText(input.errorMessage) || '',
    retryable,
    sideEffects: input.sideEffects || [],
    activatedSkills: input.activatedSkills || [],
    ...(errorCode ? { errorCode } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    ...(input.result !== undefined ? { result: input.result } : {}),
  };
}

export function stringifyManagedToolResultEnvelope(envelope: ManagedToolResultEnvelope) {
  return JSON.stringify(envelope);
}
