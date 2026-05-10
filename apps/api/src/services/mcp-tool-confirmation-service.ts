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

type ConfirmationReplaySnapshot = {
  toolName: string;
  argumentsJson: Record<string, unknown>;
};

type StoredConfirmationSummary = ConfirmationSummary & {
  __internalReplay?: ConfirmationReplaySnapshot;
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
  const firstTool = Array.isArray(args.tools) ? pickObject(args.tools[0]) : {};
  const direct = asText(toolName);
  const nested = [
    args.tool_slug,
    args.toolSlug,
    args.tool_name,
    args.toolName,
    args.action,
    pickObject(args.tool).slug,
    pickObject(args.tool).name,
    firstTool.tool_slug,
    firstTool.toolSlug,
    firstTool.tool_name,
    firstTool.toolName,
    pickObject(firstTool.tool).slug,
    pickObject(firstTool.tool).name,
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

function humanizeTargetFallback(value: string): string {
  return value
    .replace(/^google_super__/i, '')
    .replace(/^googlesuper_/i, '')
    .replace(/^googledocs_/i, '')
    .replace(/^googledrive_/i, '')
    .replace(/^gmail_/i, '')
    .replace(/^calendar_/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function pickFallbackTargetFromSummary(summary: Record<string, unknown>): string {
  for (const [key, value] of Object.entries(summary)) {
    const normalized = normalizeTargetKey(key);
    if (
      /(title|name|subject|recipient|email|documentid|docid|fileid|folderid|calendarid|eventid|url|id)$/.test(
        normalized
      )
    ) {
      const text = asText(value);
      if (text && text !== '[redacted]') {
        return text;
      }
    }
  }
  return '';
}

function buildFallbackTarget(scope: ConfirmationScope, effectiveToolName: string): string {
  const parameterSummary = buildParameterSummary(scope.argumentsJson);
  const summaryTarget = pickFallbackTargetFromSummary(parameterSummary);
  if (summaryTarget) return summaryTarget;

  const nestedToolSlug = effectiveToolName.split(/\s+/).slice(1).join(' ').trim();
  const toolHint = humanizeTargetFallback(nestedToolSlug || effectiveToolName);
  if (toolHint) {
    if (/create document markdown|create document|document/.test(toolHint.toLowerCase())) {
      return 'new Google document';
    }
    if (/send email|gmail|email/.test(toolHint.toLowerCase())) {
      return 'Google email operation';
    }
    if (/calendar|event/.test(toolHint.toLowerCase())) {
      return 'Google Calendar event';
    }
    if (/drive|file|folder/.test(toolHint.toLowerCase())) {
      return 'Google Drive item';
    }
    return toolHint;
  }

  return 'Google Workspace write operation';
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
  const parameterSummary = buildParameterSummary(scope.argumentsJson);
  const target = targets[0] || buildFallbackTarget(scope, effectiveToolName);
  return {
    connectorKey: scope.connectorKey,
    toolName: scope.toolName,
    action: inferAction(effectiveToolName),
    target,
    impact: `Execute one Google Workspace write operation through ${scope.toolName}.`,
    parameterSummary,
  };
}

function buildStoredSummary(scope: ConfirmationScope): StoredConfirmationSummary {
  return {
    ...buildSummary(scope),
    __internalReplay: {
      toolName: scope.toolName,
      argumentsJson: scope.argumentsJson,
    },
  };
}

function sanitizeSummary(summary: unknown): ConfirmationSummary {
  const record = pickObject(summary);
  return {
    connectorKey: asText(record.connectorKey),
    toolName: asText(record.toolName),
    action: asText(record.action),
    target: asText(record.target),
    impact: asText(record.impact),
    parameterSummary: buildParameterSummary(pickObject(record.parameterSummary)),
  };
}

function readReplaySnapshot(summary: unknown): ConfirmationReplaySnapshot | null {
  const internalReplay = pickObject(pickObject(summary).__internalReplay);
  const toolName = asText(internalReplay.toolName);
  const argumentsJson = pickObject(internalReplay.argumentsJson);
  if (!toolName || Object.keys(argumentsJson).length === 0) {
    return null;
  }
  return {
    toolName,
    argumentsJson,
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

  getPublicSummary(summary: unknown) {
    return sanitizeSummary(summary);
  }

  private buildApprovalTokenPatch(nowMs: number) {
    const token = randomBytes(32).toString('base64url');
    const tokenTtlSeconds = Math.max(
      60,
      Number(process.env.GOOGLE_SUPER_CONFIRMATION_TOKEN_TTL_SECONDS || 600)
    );
    const tokenExpiresAt = new Date(nowMs + tokenTtlSeconds * 1000);
    return {
      token,
      patch: {
        status: 'approved' as const,
        confirmationTokenHash: tokenHash(token),
        approvedAt: new Date(nowMs),
        expiresAt: tokenExpiresAt,
      },
      expiresAt: tokenExpiresAt,
    };
  }

  async createPendingConfirmation(scope: ConfirmationScope) {
    const summary = this.buildConfirmationSummary(scope);
    const storedSummary = buildStoredSummary(scope);
    const ttlSeconds = Math.max(60, Number(process.env.GOOGLE_SUPER_CONFIRMATION_TOKEN_TTL_SECONDS || 600));
    const argumentsHash = sha256(scope.argumentsJson);
    const reusable = await taskSessionMcpToolConfirmationDAO.findReusablePending({
      appUserId: scope.appUserId,
      taskSessionId: scope.taskSessionId,
      agentRunId: asText(scope.agentRunId) || null,
      connectorKey: scope.connectorKey,
      toolName: scope.toolName,
      argumentsHash,
    });
    if (reusable) {
      return reusable;
    }
    const row = await taskSessionMcpToolConfirmationDAO.create({
      appUserId: scope.appUserId,
      taskSessionId: scope.taskSessionId,
      agentRunId: asText(scope.agentRunId) || null,
      connectorKey: scope.connectorKey,
      toolName: scope.toolName,
      argumentsHash,
      summaryJson: storedSummary,
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
    if (row.status === 'consumed') throw new Error('mcp_confirmation_already_consumed');
    if (row.status === 'rejected') throw new Error('mcp_confirmation_not_pending');
    if (row.status !== 'pending' && row.status !== 'approved') {
      throw new Error('mcp_confirmation_not_pending');
    }
    if (row.status === 'pending' && row.expiresAt.getTime() <= Date.now()) {
      throw new Error('mcp_confirmation_expired');
    }
    const approvalToken = this.buildApprovalTokenPatch(Date.now());
    const updated = await taskSessionMcpToolConfirmationDAO.updateStatus(row.id, approvalToken.patch);
    await this.writeAuditEvent(
      {
        appUserId: row.appUserId,
        taskSessionId: row.taskSessionId,
        agentRunId: row.agentRunId,
        connectorKey: row.connectorKey,
        toolName: row.toolName,
        argumentsJson: {},
      },
      row.status === 'approved' ? 'approval_reissued' : 'approved',
      { confirmationId: row.id }
    );
    return {
      confirmationId: row.id,
      connectorKey: row.connectorKey,
      toolName: row.toolName,
      confirmationAgentRunId: asText(row.agentRunId) || null,
      summary: this.getPublicSummary(row.summaryJson),
      confirmationToken: approvalToken.token,
      expiresAt: updated?.expiresAt || approvalToken.expiresAt,
    };
  }

  async resolveApprovedReplay(input: {
    appUserId: string;
    taskSessionId: string;
    confirmationId: string;
    connectorKey: string;
    toolName: string;
    confirmationAgentRunId?: string | null;
  }) {
    const row = await taskSessionMcpToolConfirmationDAO.getById(input.confirmationId);
    if (
      !row ||
      row.appUserId !== input.appUserId ||
      row.taskSessionId !== input.taskSessionId ||
      row.status !== 'approved' ||
      row.connectorKey !== input.connectorKey ||
      row.toolName !== input.toolName
    ) {
      return null;
    }
    if (
      asText(input.confirmationAgentRunId) &&
      asText(row.agentRunId) &&
      asText(input.confirmationAgentRunId) !== asText(row.agentRunId)
    ) {
      return null;
    }
    const replay = readReplaySnapshot(row.summaryJson);
    if (!replay) {
      return null;
    }
    return {
      confirmationId: row.id,
      agentRunId: asText(row.agentRunId) || null,
      toolName: replay.toolName,
      argumentsJson: replay.argumentsJson,
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
    const row = await taskSessionMcpToolConfirmationDAO.consumeApprovedToken({
      tokenHash: tokenHash(token),
      appUserId: scope.appUserId,
      taskSessionId: scope.taskSessionId,
      agentRunId: asText(scope.agentRunId) || null,
      connectorKey: scope.connectorKey,
      toolName: scope.toolName,
      argumentsHash: sha256(scope.argumentsJson),
    });
    if (!row) return false;
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
