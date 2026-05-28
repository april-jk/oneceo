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
  if (normalized.includes('write_file_binary_deliverable_requires_generator')) {
    return 'write_file_binary_deliverable_requires_generator';
  }
  if (normalized.includes('complete_task_pptx_requires_render_pptx_from_instructions')) {
    return 'complete_task_pptx_requires_render_pptx_from_instructions';
  }
  if (normalized.includes('complete_task_pptx_requires_render_pptx_from_html_deck')) {
    return 'complete_task_pptx_requires_render_pptx_from_html_deck';
  }
  if (normalized.includes('render_pptx_from_instructions_blocked_after_html_deck_source')) {
    return 'render_pptx_from_instructions_blocked_after_html_deck_source';
  }
  if (normalized.includes('ppt_workflow_render_completed_complete_task_required')) {
    return 'ppt_workflow_render_completed_complete_task_required';
  }
  if (normalized.startsWith('visual_detection_completion_blocked:')) {
    return 'visual_detection_completion_blocked';
  }
  if (normalized.includes('debug_open_page_repeat_blocked')) return 'debug_open_page_repeat_blocked';
  if (normalized.includes('debug_open_page_debug_not_ready')) return 'debug_service_not_ready';
  if (normalized.includes('playwright_module_not_found')) return 'sandbox_browser_capability_unavailable';
  if (normalized.includes('__oneceo_debug_target_unreachable__') || normalized.includes('target_unreachable')) {
    return 'debug_target_unreachable';
  }
  if (normalized.includes('__oneceo_debug_target_file_missing__') || normalized.includes('target_file_missing')) {
    return 'debug_target_file_missing';
  }
  if (normalized.includes('__oneceo_debug_target_bad_status__') || normalized.includes('target_bad_status')) {
    return 'debug_target_bad_status';
  }
  if (normalized.includes('__oneceo_debug_target_tab_not_ready__') || normalized.includes('tab_not_ready')) {
    return 'debug_target_tab_not_ready';
  }
  if (normalized.includes('debug_open_page_playwright_failed')) {
    return 'debug_open_page_cdp_open_failed';
  }
  if (normalized.includes('__oneceo_debug_open_page_failed__') || normalized.includes('open_failed')) {
    return 'debug_open_page_cdp_open_failed';
  }
  if (
    normalized.includes('__oneceo_debug_command_failed__') ||
    normalized.includes('__oneceo_debug_script_exit__') ||
    normalized.includes('script_internal_error')
  ) {
    return 'debug_open_page_command_failed';
  }
  if (
    normalized.includes('debug_open_page_missing_url') ||
    normalized.includes('debug_open_page_invalid_url') ||
    normalized.includes('debug_open_page_invalid_protocol') ||
    normalized.includes('debug_open_page_file_outside_workspace')
  ) {
    return 'debug_open_page_invalid_target';
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
    errorCode === 'write_file_binary_deliverable_requires_generator' ||
    errorCode === 'complete_task_pptx_requires_render_pptx_from_instructions' ||
    errorCode === 'complete_task_pptx_requires_render_pptx_from_html_deck' ||
    errorCode === 'visual_detection_completion_blocked' ||
    errorCode === 'debug_service_not_ready' ||
    errorCode === 'debug_target_unreachable' ||
    errorCode === 'debug_target_file_missing' ||
    errorCode === 'debug_target_bad_status' ||
    errorCode === 'debug_target_tab_not_ready' ||
    errorCode === 'debug_open_page_cdp_open_failed' ||
    errorCode === 'debug_open_page_command_failed' ||
    errorCode === 'debug_open_page_invalid_target' ||
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
    case 'write_file_binary_deliverable_requires_generator':
      return 'write_file only supports UTF-8 text files. Final docx/xlsx/pptx/pdf and archive deliverables must be generated through a real document generator or renderer.';
    case 'complete_task_pptx_requires_render_pptx_from_instructions':
      return 'PPTX attachments must come from a managed PPT renderer before complete_task can deliver them.';
    case 'complete_task_pptx_requires_render_pptx_from_html_deck':
      return 'This run created or attempted an HTML Deck, so the final PPTX must come from render_pptx_from_html_deck and remain tied to that HTML source.';
    case 'render_pptx_from_instructions_blocked_after_html_deck_source':
      return 'This run already created or attempted a ppt-html-deck source. Do not switch to the instruction renderer because it would produce a PPTX that no longer corresponds to the HTML deck.';
    case 'ppt_workflow_render_completed_complete_task_required':
      return 'The PPT renderer has already produced the final PPTX for this run. Further inspection or rendering would create a loop.';
    case 'visual_detection_completion_blocked':
      return 'Website and web app delivery requires successful n.eko + Playwright visual detection screenshot evidence before complete_task.';
    case 'debug_open_page_repeat_blocked':
      return 'The same preview target failed with the same debug_open_page reason more than once without a corrective shell_execute or write_file step.';
    case 'debug_service_not_ready':
      return 'The n.eko / Chromium remote debugging service is not ready. This is a sandbox browser capability problem, not a user project code problem.';
    case 'sandbox_browser_capability_unavailable':
      return 'The sandbox browser dependency is unavailable. Playwright, its browser cache, or the fixed MCP command path is missing.';
    case 'debug_target_unreachable':
      return 'The preview URL is not reachable from inside the sandbox browser environment.';
    case 'debug_target_file_missing':
      return 'The file URL target does not exist inside the workspace.';
    case 'debug_target_bad_status':
      return 'The preview URL returned a non-success HTTP status.';
    case 'debug_target_tab_not_ready':
      return 'Chromium accepted the open request but did not expose a tab for the requested target URL.';
    case 'debug_open_page_cdp_open_failed':
      return 'Chromium CDP did not open the requested target page.';
    case 'debug_open_page_command_failed':
      return 'The debug_open_page command failed before returning normal page-open diagnostics.';
    case 'debug_open_page_invalid_target':
      return 'debug_open_page needs a valid http(s) URL or a file URL inside the workspace.';
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
    case 'write_file_binary_deliverable_requires_generator':
      return 'Generate the final downloadable file through shell/python tooling or the managed renderer, verify it can be opened, then continue. Do not use write_file for docx/xlsx/pptx/pdf or archive outputs.';
    case 'complete_task_pptx_requires_render_pptx_from_instructions':
      return 'Call render_pptx_from_html_deck or render_pptx_from_instructions first, then attach the returned PPTX path in complete_task.attachments.';
    case 'complete_task_pptx_requires_render_pptx_from_html_deck':
      return 'Call render_pptx_from_html_deck successfully, then attach the returned PPTX path from ppt-html-deck/export in complete_task.attachments.';
    case 'render_pptx_from_instructions_blocked_after_html_deck_source':
      return 'Do not call the instruction renderer. Use the PPTX already returned by render_pptx_from_html_deck in complete_task.attachments.';
    case 'ppt_workflow_render_completed_complete_task_required':
      return 'Call complete_task now with the PPTX path returned by the renderer. Do not call shell_execute, read_file, debug_open_page, browser_interact, or another PPT renderer.';
    case 'visual_detection_completion_blocked':
      return 'Continue the website verification flow: verify the app can run or build, say 正在进行视觉检测, open the target with debug_open_page, perform Playwright/n.eko browser_interact steps for visible controls or page movement, then retry complete_task after a captured Action screenshot exists.';
    case 'debug_open_page_repeat_blocked':
      return 'Do not call debug_open_page again for the same target now. First make a concrete corrective change with shell_execute or write_file, or stop and report the exact platform-visible blocker.';
    case 'debug_service_not_ready':
      return 'Do not stop immediately. Inspect the structured diagnostics for the managed n.eko / Chromium debug service, repair or refresh the debug browser state if possible, then retry debug_open_page only after a concrete state-changing step.';
    case 'sandbox_browser_capability_unavailable':
      return 'Do not install Playwright or @playwright/mcp into the user project. Report the sandbox browser capability failure with the fixed paths and stop this verification loop.';
    case 'debug_target_unreachable':
      return 'Start or repair the local preview service with shell_execute, verify its URL/port, then call debug_open_page again only after the target is reachable.';
    case 'debug_target_file_missing':
      return 'Create or correct the workspace file path with write_file or shell_execute before retrying debug_open_page with a file:// URL.';
    case 'debug_target_bad_status':
      return 'Inspect the local server error, repair the app or server command, and retry debug_open_page only after the URL returns 2xx or 3xx.';
    case 'debug_target_tab_not_ready':
      return 'Check that the target URL is correct and the CDP browser is healthy. Retry only after changing the target or repairing the browser/service state.';
    case 'debug_open_page_cdp_open_failed':
      return 'Check the CDP endpoint and browser debug service. Retry only after the debug browser state has changed.';
    case 'debug_open_page_command_failed':
      return 'Report the structured __ONECEO_DEBUG_* diagnostics and inspect the platform debug command boundary before retrying the same target.';
    case 'debug_open_page_invalid_target':
      return 'Retry debug_open_page with a valid full URL, such as http://127.0.0.1:3000/, or a workspace file:// URL.';
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
