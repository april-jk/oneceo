import { createHash, randomBytes } from 'node:crypto';
import {
  taskCreationSessionDAO,
  taskSessionMcpToolConfirmationDAO,
  taskSessionRunDAO,
} from '../db/dao';

type ConfirmationScope = {
  appUserId: string;
  taskSessionId: string;
  agentRunId?: string | null;
  connectorKey: string;
  toolName: string;
  argumentsJson: Record<string, unknown>;
};

type ConfirmationSummary = {
  connectorKey: string;
  toolName: string;
  action: string;
  target: string;
  impact: string;
  parameterSummary: Record<string, unknown>;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeToolName(toolName: string, args: Record<string, unknown>): string {
  const direct = asText(toolName);
  const nested = [
    args.tool_slug,
    args.toolSlug,
    args.tool_name,
    args.toolName,
    args.action,
    pickObject(args.tool).slug,
    pickObject(args.tool).name,
  ]
    .map(asText)
    .find(Boolean);
  return nested ? `${direct} ${nested}` : direct;
}

function isMetaTool(toolName: string) {
  return /COMPOSIO_(SEARCH_TOOLS|GET_TOOL_SCHEMAS)$/i.test(toolName);
}

function hasWriteVerb(text: string) {
  const normalized = text.replace(/[_-]+/g, ' ');
  return /\b(delete|remove|send|reply|forward|share|permission|invite|update|create|write|append|clear|move|copy|upload|insert|batch|archive|label|cancel|complete)\b/i.test(
    normalized
  );
}

const TARGET_FIELD_KEYS = new Set([
  'to',
  'cc',
  'bcc',
  'recipient',
  'recipients',
  'email',
  'emails',
  'recipientemail',
  'recipientemails',
  'toemail',
  'toemails',
  'emailaddress',
  'emailaddresses',
  'fileid',
  'drivefileid',
  'folderid',
  'parentid',
  'parentfolderid',
  'driveid',
  'permissionid',
  'documentid',
  'docid',
  'spreadsheetid',
  'sheetid',
  'worksheetid',
  'calendarid',
  'eventid',
  'messageid',
  'threadid',
  'taskid',
  'tasklistid',
  'commentid',
  'range',
  'cell',
  'cellrange',
  'domain',
  'user',
  'userid',
  'group',
  'groupemail',
  'id',
  'url',
  'name',
  'title',
  'summary',
]);

function normalizeTargetKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSemanticTargetKey(key: string) {
  const normalized = normalizeTargetKey(key);
  if (TARGET_FIELD_KEYS.has(normalized)) return true;
  if (normalized.includes('recipient') && normalized.includes('email')) return true;
  if (normalized.startsWith('to') && normalized.includes('email')) return true;
  if (normalized.includes('email') && normalized.includes('address')) return true;
  if (normalized.includes('attendee') && normalized.includes('email')) return true;
  if (normalized.includes('invitee') && normalized.includes('email')) return true;
  if (normalized.includes('owner') && normalized.includes('email')) return true;
  if (normalized.includes('writer') && normalized.includes('email')) return true;
  if (normalized.includes('reader') && normalized.includes('email')) return true;
  if (normalized.includes('user') && normalized.includes('email')) return true;
  if (normalized.includes('group') && normalized.includes('email')) return true;
  if (
    normalized.endsWith('id') &&
    /(file|folder|drive|permission|document|doc|spreadsheet|sheet|worksheet|calendar|event|message|thread|task|tasklist|comment)/i.test(normalized)
  ) {
    return true;
  }
  if (normalized.includes('spreadsheet') && normalized.includes('range')) return true;
  if (normalized.includes('sheet') && normalized.includes('range')) return true;
  if (normalized.includes('cell') && normalized.includes('range')) return true;
  return false;
}

function appendCandidateValue(result: string[], raw: unknown, seen: Set<unknown>) {
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string' || typeof item === 'number') {
        const text = asText(String(item));
        if (text) result.push(text);
      } else {
        result.push(...collectCandidateTexts(item, seen));
      }
    }
    return;
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    const text = asText(String(raw));
    if (text) result.push(text);
  }
}

function collectCandidateTexts(value: unknown, seen = new Set<unknown>()): string[] {
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((item) => collectCandidateTexts(item, seen));
  const record = pickObject(value);
  const result: string[] = [];
  for (const [key, raw] of Object.entries(record)) {
    if (isSemanticTargetKey(key)) {
      appendCandidateValue(result, raw, seen);
    }
  }
  for (const child of Object.values(record)) {
    result.push(...collectCandidateTexts(child, seen));
  }
  return Array.from(new Set(result)).slice(0, 8);
}

function buildParameterSummary(args: Record<string, unknown>, prefix = '', depth = 0) {
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    const normalized = key.toLowerCase();
    const outputKey = prefix ? `${prefix}.${key}` : key;
    if (
      normalized.includes('body') ||
      normalized.includes('content') ||
      normalized.includes('html') ||
      normalized.includes('token') ||
      normalized.includes('secret') ||
      normalized.includes('authorization') ||
      normalized.includes('api_key')
    ) {
      if (asText(value)) summary[outputKey] = '[redacted]';
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      summary[outputKey] = value;
      continue;
    }
    if (depth < 2 && value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(summary, buildParameterSummary(pickObject(value), outputKey, depth + 1));
    }
  }
  return Object.fromEntries(Object.entries(summary).slice(0, 12));
}

function inferAction(toolName: string): string {
  const normalized = toolName.toLowerCase();
  if (normalized.includes('gmail') && normalized.includes('send')) return 'send_email';
  if (normalized.includes('email') && normalized.includes('send')) return 'send_email';
  if (normalized.includes('mail') && normalized.includes('send')) return 'send_email';
  if (normalized.includes('drive') && normalized.includes('share')) return 'share_drive_item';
  if (normalized.includes('drive') && normalized.includes('permission')) return 'change_drive_permission';
  if (normalized.includes('drive') && normalized.includes('delete')) return 'delete_drive_item';
  if (normalized.includes('document') && normalized.includes('batch')) return 'update_document';
  if (normalized.includes('doc') && normalized.includes('batch')) return 'update_document';
  if (normalized.includes('document') && normalized.includes('update')) return 'update_document';
  if (normalized.includes('doc') && normalized.includes('update')) return 'update_document';
  if (normalized.includes('spreadsheet') && normalized.includes('append')) return 'append_sheet_values';
  if (normalized.includes('sheet') && normalized.includes('append')) return 'append_sheet_values';
  if (normalized.includes('spreadsheet') && normalized.includes('update')) return 'update_sheet_values';
  if (normalized.includes('sheet') && normalized.includes('update')) return 'update_sheet_values';
  if (normalized.includes('task') && normalized.includes('complete')) return 'complete_task';
  if (normalized.includes('calendar') && normalized.includes('create')) return 'create_calendar_event';
  if (normalized.includes('calendar') && normalized.includes('update')) return 'update_calendar_event';
  if (normalized.includes('calendar') && normalized.includes('delete')) return 'delete_calendar_event';
  if (normalized.includes('drive') && normalized.includes('share')) return 'share_drive_item';
  if (normalized.includes('delete') || normalized.includes('remove')) return 'delete_or_remove';
  if (normalized.includes('update') || normalized.includes('write') || normalized.includes('append')) return 'update_resource';
  if (normalized.includes('create')) return 'create_resource';
  if (normalized.includes('send')) return 'send_message';
  return 'google_workspace_write';
}

function buildSummary(scope: ConfirmationScope): ConfirmationSummary {
  const effectiveToolName = normalizeToolName(scope.toolName, scope.argumentsJson);
  const targets = collectCandidateTexts(scope.argumentsJson);
  const target = targets[0] || '';
  return {
    connectorKey: scope.connectorKey,
    toolName: scope.toolName,
    action: inferAction(effectiveToolName),
    target,
    impact: `Execute one Google Workspace write operation through ${scope.toolName}.`,
    parameterSummary: buildParameterSummary(scope.argumentsJson),
  };
}

export class McpToolConfirmationService {
  hashArguments(args: Record<string, unknown>) {
    return sha256(args);
  }

  classifyRisk(connectorKey: string, toolName: string, args: Record<string, unknown>) {
    if (connectorKey !== 'google_super') return 'low';
    if (isMetaTool(toolName)) return 'low';
    const effectiveName = normalizeToolName(toolName, args);
    return hasWriteVerb(effectiveName) || hasWriteVerb(stableJson(args)) ? 'high' : 'low';
  }

  buildConfirmationSummary(scope: ConfirmationScope) {
    return buildSummary(scope);
  }

  async createPendingConfirmation(scope: ConfirmationScope) {
    const summary = this.buildConfirmationSummary(scope);
    if (!summary.target) {
      throw new Error('google_super_confirmation_target_missing');
    }
    const ttlSeconds = Math.max(60, Number(process.env.GOOGLE_SUPER_CONFIRMATION_TOKEN_TTL_SECONDS || 600));
    const row = await taskSessionMcpToolConfirmationDAO.create({
      appUserId: scope.appUserId,
      taskSessionId: scope.taskSessionId,
      agentRunId: asText(scope.agentRunId) || null,
      connectorKey: scope.connectorKey,
      toolName: scope.toolName,
      argumentsHash: sha256(scope.argumentsJson),
      summaryJson: summary,
      status: 'pending',
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    } as any);
    await this.writeAuditEvent(scope, 'requires_confirmation', {
      confirmationId: row.id,
      summary,
    });
    return row;
  }

  async approveConfirmation(input: {
    appUserId: string;
    taskSessionId: string;
    confirmationId: string;
  }) {
    const session = await taskCreationSessionDAO.getSession(input.taskSessionId);
    if (asText(session?.userId) !== input.appUserId) {
      throw new Error('mcp_confirmation_session_owner_mismatch');
    }
    const row = await taskSessionMcpToolConfirmationDAO.getById(input.confirmationId);
    if (
      !row ||
      row.appUserId !== input.appUserId ||
      row.taskSessionId !== input.taskSessionId ||
      row.connectorKey !== 'google_super'
    ) {
      throw new Error('mcp_confirmation_not_found');
    }
    if (row.status !== 'pending') throw new Error('mcp_confirmation_not_pending');
    if (row.expiresAt.getTime() <= Date.now()) throw new Error('mcp_confirmation_expired');
    const token = randomBytes(32).toString('base64url');
    const updated = await taskSessionMcpToolConfirmationDAO.updateStatus(row.id, {
      status: 'approved',
      confirmationTokenHash: tokenHash(token),
      approvedAt: new Date(),
    });
    await this.writeAuditEvent(
      {
        appUserId: row.appUserId,
        taskSessionId: row.taskSessionId,
        agentRunId: row.agentRunId,
        connectorKey: row.connectorKey,
        toolName: row.toolName,
        argumentsJson: {},
      },
      'approved',
      { confirmationId: row.id }
    );
    return {
      confirmationToken: token,
      expiresAt: updated?.expiresAt || row.expiresAt,
    };
  }

  async rejectConfirmation(input: {
    appUserId: string;
    taskSessionId: string;
    confirmationId: string;
  }) {
    const row = await taskSessionMcpToolConfirmationDAO.markRejected(
      input.confirmationId,
      input.appUserId,
      input.taskSessionId
    );
    if (!row) throw new Error('mcp_confirmation_not_found');
    await this.writeAuditEvent(
      {
        appUserId: row.appUserId,
        taskSessionId: row.taskSessionId,
        agentRunId: row.agentRunId,
        connectorKey: row.connectorKey,
        toolName: row.toolName,
        argumentsJson: {},
      },
      'rejected',
      { confirmationId: row.id }
    );
    return row;
  }

  async verifyAndConsumeConfirmation(scope: ConfirmationScope & { confirmationToken?: string | null }) {
    const token = asText(scope.confirmationToken);
    if (!token) return false;
    const row = await taskSessionMcpToolConfirmationDAO.getByTokenHash(tokenHash(token));
    const valid =
      row &&
      row.status === 'approved' &&
      row.appUserId === scope.appUserId &&
      row.taskSessionId === scope.taskSessionId &&
      asText(row.agentRunId) === asText(scope.agentRunId) &&
      row.connectorKey === scope.connectorKey &&
      row.toolName === scope.toolName &&
      row.argumentsHash === sha256(scope.argumentsJson) &&
      row.expiresAt.getTime() > Date.now();
    if (!valid || !row) return false;
    await taskSessionMcpToolConfirmationDAO.updateStatus(row.id, {
      status: 'consumed',
      consumedAt: new Date(),
      confirmationTokenHash: null,
    });
    await this.writeAuditEvent(scope, 'consumed', { confirmationId: row.id });
    return true;
  }

  async writeAuditEvent(scope: ConfirmationScope, status: string, payload: Record<string, unknown>) {
    const runId = asText(scope.agentRunId);
    if (!runId) return;
    await taskSessionRunDAO.appendRunEvent({
      runId,
      sessionId: scope.taskSessionId,
      eventType: 'mcp_tool_confirmation',
      payloadJson: {
        connectorKey: scope.connectorKey,
        toolName: scope.toolName,
        status,
        ...payload,
      },
    }).catch(() => null);
  }
}

export const mcpToolConfirmationService = new McpToolConfirmationService();
