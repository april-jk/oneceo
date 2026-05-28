import { asText, pickObject } from './altus-managed-shared';

export type ManagedMcpToolConfirmationAction = 'approve' | 'reject';

export type ManagedMcpToolConfirmationPayload = {
  action: ManagedMcpToolConfirmationAction;
  connectorKey: string;
  confirmationId: string;
  toolName: string;
  confirmationToken?: string;
  confirmationAgentRunId?: string;
  summary?: {
    action?: string;
    target?: string;
    impact?: string;
    parameterSummary?: Record<string, unknown>;
  };
};

function normalizeAction(value: unknown): ManagedMcpToolConfirmationAction | null {
  const normalized = asText(value).toLowerCase();
  if (normalized === 'approve') return 'approve';
  if (normalized === 'reject') return 'reject';
  return null;
}

export function readManagedMcpToolConfirmationPayload(
  metadataRaw: unknown
): ManagedMcpToolConfirmationPayload | null {
  const metadata = pickObject(metadataRaw);
  const payload = pickObject(metadata.mcpToolConfirmation);
  const action = normalizeAction(payload.action);
  const connectorKey = asText(payload.connectorKey);
  const confirmationId = asText(payload.confirmationId);
  const toolName = asText(payload.toolName);
  if (!action || !connectorKey || !confirmationId || !toolName) {
    return null;
  }

  return {
    action,
    connectorKey,
    confirmationId,
    toolName,
    confirmationToken: asText(payload.confirmationToken) || undefined,
    confirmationAgentRunId: asText(payload.confirmationAgentRunId) || undefined,
    summary: {
      action: asText(pickObject(payload.summary).action) || undefined,
      target: asText(pickObject(payload.summary).target) || undefined,
      impact: asText(pickObject(payload.summary).impact) || undefined,
      parameterSummary: pickObject(pickObject(payload.summary).parameterSummary),
    },
  };
}

export function buildManagedMcpToolConfirmationMetadata(
  payload: ManagedMcpToolConfirmationPayload
) {
  return {
    source:
      payload.action === 'approve'
        ? 'mcp_tool_confirmation_approved'
        : 'mcp_tool_confirmation_rejected',
    confirmationId: payload.confirmationId,
    mcpToolConfirmation: {
      action: payload.action,
      connectorKey: payload.connectorKey,
      confirmationId: payload.confirmationId,
      toolName: payload.toolName,
      ...(payload.confirmationToken ? { confirmationToken: payload.confirmationToken } : {}),
      ...(payload.confirmationAgentRunId
        ? { confirmationAgentRunId: payload.confirmationAgentRunId }
        : {}),
      ...(payload.summary ? { summary: payload.summary } : {}),
    },
  };
}

function renderParameterSummary(summary?: Record<string, unknown>) {
  const entries = Object.entries(summary || {}).slice(0, 6);
  if (entries.length === 0) {
    return '未提供';
  }
  return entries
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('; ');
}

export function buildManagedMcpToolConfirmationPrompt(
  payload: ManagedMcpToolConfirmationPayload
) {
  const summary = payload.summary || {};
  const base = [
    '以下是 MCP 高风险工具调用的统一确认结果，请严格按要求执行。',
    `connectorKey: ${payload.connectorKey}`,
    `toolName: ${payload.toolName}`,
    `confirmationId: ${payload.confirmationId}`,
    summary.action ? `action: ${summary.action}` : '',
    summary.target ? `target: ${summary.target}` : '',
    summary.impact ? `impact: ${summary.impact}` : '',
    `parameterSummary: ${renderParameterSummary(summary.parameterSummary)}`,
  ].filter(Boolean);

  if (payload.action === 'approve') {
    return [
      ...base,
      '用户已明确确认本次高风险操作。',
      payload.confirmationAgentRunId
        ? `confirmationAgentRunId: ${payload.confirmationAgentRunId}`
        : 'confirmationAgentRunId: 未提供',
      payload.confirmationToken
        ? `confirmationToken: ${payload.confirmationToken}`
        : 'confirmationToken: 未提供',
      '你必须继续刚才被确认拦截的同一个 MCP tool call。',
      '要求：',
      '1. 保持同一个 toolName 和同一份业务参数，不要修改目标对象，不要另起新方案。',
      '2. 仅为这次重试补充 confirmationToken 与 confirmationAgentRunId。',
      '3. 立即继续执行，不要先征求二次确认，也不要把 confirmationToken 暴露给用户。',
      '4. 如果找不到上一轮待确认的同一 tool call，就明确说明无法继续，不要猜测参数。',
    ].join('\n');
  }

  return [
    ...base,
    '用户已拒绝本次高风险操作。',
    '你不得重试这个 MCP tool call，也不得继续同一写操作。',
    '请向用户说明该操作已取消，并等待新的明确指令。',
  ].join('\n');
}

function getConnectorLabel(connectorKey: string) {
  if (connectorKey === 'google_super') return 'Google Workspace';
  return connectorKey || 'MCP';
}

export function buildManagedMcpToolRejectionCompletionText(
  payload: ManagedMcpToolConfirmationPayload
) {
  const summary = payload.summary || {};
  const connectorLabel = getConnectorLabel(payload.connectorKey);
  const action = asText(summary.action) || asText(payload.toolName) || '高风险操作';
  const target = asText(summary.target);
  const targetText = target ? `，目标：${target}` : '';
  return [
    `已取消本次 ${connectorLabel} 高风险操作（${action}${targetText}）。`,
    '该 MCP 工具调用不会重试，也不会继续执行同一写操作。',
    '如需执行其他 Google MCP 工具测试，请提供新的明确指令。',
  ].join('\n\n');
}
