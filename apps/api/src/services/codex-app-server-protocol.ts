type JsonRpcEnvelope = Record<string, unknown>;

export type CodexAppServerNotification = {
  method: string;
  params: Record<string, unknown>;
};

export type CodexAppServerResponse = {
  id: string | number;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function extractFileChanges(notification: CodexAppServerNotification): Array<Record<string, unknown>> {
  const item = asRecord(notification.params.item);
  const changes = asArray(item.changes);
  return changes
    .map((entry) => asRecord(entry))
    .filter((entry) => Object.keys(entry).length > 0);
}

function extractTurn(notification: CodexAppServerNotification): Record<string, unknown> {
  return asRecord(notification.params.turn);
}

function extractPlan(notification: CodexAppServerNotification): Record<string, unknown> {
  return asRecord(notification.params.plan) || asRecord(extractTurn(notification).plan);
}

function extractError(notification: CodexAppServerNotification): Record<string, unknown> {
  const turn = extractTurn(notification);
  return asRecord(notification.params.error) || asRecord(turn.error);
}

function planToMarkdown(plan: Record<string, unknown>): string | null {
  if (Object.keys(plan).length === 0) return null;
  const title =
    asString(plan.title) ||
    asString(plan.name) ||
    asString(plan.summary) ||
    asString(plan.goal);
  const steps = asArray(plan.steps)
    .map((entry) => asRecord(entry))
    .filter((entry) => Object.keys(entry).length > 0)
    .map((entry) => {
      const text =
        asString(entry.title) ||
        asString(entry.summary) ||
        asString(entry.description) ||
        asString(entry.text) ||
        asString(entry.goal);
      return text;
    })
    .filter(Boolean);

  const sections: string[] = ['**任务规划已更新**'];
  if (title) {
    sections.push(`\n\n${title}`);
  }
  if (steps.length > 0) {
    sections.push(`\n\n${steps.map((step) => `- ${step}`).join('\n')}`);
  }
  return sections.join('');
}

export function parseCodexAppServerEnvelope(line: string): CodexAppServerNotification | CodexAppServerResponse | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let payload: JsonRpcEnvelope;
  try {
    payload = JSON.parse(trimmed) as JsonRpcEnvelope;
  } catch {
    return null;
  }
  const method = asString(payload.method);
  if (method) {
    return {
      method,
      params: asRecord(payload.params),
    };
  }
  if (payload.id !== undefined) {
    return {
      id: payload.id as string | number,
      result: payload.result === undefined ? undefined : asRecord(payload.result),
      error: payload.error === undefined ? undefined : asRecord(payload.error),
    };
  }
  return null;
}

export function isCodexAppServerNotification(
  value: CodexAppServerNotification | CodexAppServerResponse | null
): value is CodexAppServerNotification {
  return Boolean(value && 'method' in value);
}

export function isCodexAppServerResponse(
  value: CodexAppServerNotification | CodexAppServerResponse | null
): value is CodexAppServerResponse {
  return Boolean(value && 'id' in value);
}

export function isTurnDiffUpdatedNotification(notification: CodexAppServerNotification): boolean {
  return notification.method === 'turn/diff/updated';
}

export function extractTurnDiff(notification: CodexAppServerNotification): string | null {
  if (!isTurnDiffUpdatedNotification(notification)) return null;
  return asString(notification.params.diff) || null;
}

export function extractNotificationThreadId(notification: CodexAppServerNotification): string | null {
  return asString(notification.params.threadId) || null;
}

export function extractNotificationTurnId(notification: CodexAppServerNotification): string | null {
  return asString(notification.params.turnId) || null;
}

export function extractNotificationItemId(notification: CodexAppServerNotification): string | null {
  const item = asRecord(notification.params.item);
  return asString(item.id) || asString(notification.params.itemId) || null;
}

export function extractNotificationItemType(notification: CodexAppServerNotification): string | null {
  const item = asRecord(notification.params.item);
  return asString(item.type) || asString(notification.params.itemType) || null;
}

export function extractAppServerTurnStatus(notification: CodexAppServerNotification): string | null {
  const turn = extractTurn(notification);
  return asString(turn.status) || asString(notification.params.status) || null;
}

export function extractAppServerErrorMessage(notification: CodexAppServerNotification): string | null {
  const error = extractError(notification);
  return (
    asString(error.message) ||
    asString(notification.params.message) ||
    null
  );
}

export function extractAppServerErrorCode(notification: CodexAppServerNotification): string | null {
  const error = extractError(notification);
  return asString(error.codexErrorInfo) || asString(error.code) || null;
}

export function extractFileChangePaths(notification: CodexAppServerNotification): string[] {
  const changes = extractFileChanges(notification);
  return changes
    .map((entry) => asString(entry.path))
    .filter(Boolean);
}

export function buildNotificationIdentity(notification: CodexAppServerNotification): string {
  const itemId = extractNotificationItemId(notification);
  const turnId = extractNotificationTurnId(notification);
  const itemType = extractNotificationItemType(notification);
  const summaryIndex = asString(notification.params.summaryIndex) || 'na';
  return [
    notification.method,
    turnId || 'na',
    itemId || 'na',
    itemType || 'na',
    summaryIndex,
  ].join(':');
}

export function summarizeCodexAppServerNotification(notification: CodexAppServerNotification): string {
  const method = notification.method;
  const itemType = (extractNotificationItemType(notification) || '').toLowerCase();
  const item = asRecord(notification.params.item);
  const turnStatus = (extractAppServerTurnStatus(notification) || '').toLowerCase();
  const errorMessage = extractAppServerErrorMessage(notification);
  const plan = extractPlan(notification);
  const text =
    asString(item.text) ||
    asString(item.content) ||
    asString(item.message) ||
    asString(notification.params.diff) ||
    asString(notification.params.status);

  if (method === 'error' && errorMessage) return errorMessage;
  if (method === 'turn/completed' && turnStatus === 'failed') {
    return errorMessage || 'Codex 执行失败';
  }
  if (method === 'turn/plan/updated') {
    return planToMarkdown(plan) || '任务规划已更新';
  }
  if (text) return text;
  if (method === 'turn/started') return 'Codex 开始执行';
  if (method === 'turn/completed') return 'Codex 执行完成';
  if (method === 'turn/diff/updated') return 'Codex 变更 diff 已更新';
  if (itemType === 'file_change' || itemType === 'filechange') {
    const paths = extractFileChangePaths(notification);
    return paths.length > 0 ? `文件变更：${paths.join(', ')}` : '文件变更';
  }
  return method;
}

export function buildCodexAppServerMetadata(notification: CodexAppServerNotification): Record<string, unknown> {
  const item = asRecord(notification.params.item);
  const rawFileChanges = extractFileChanges(notification);
  const filePaths = extractFileChangePaths(notification);
  const diff = extractTurnDiff(notification);
  const plan = extractPlan(notification);
  const turnStatus = extractAppServerTurnStatus(notification);
  const errorMessage = extractAppServerErrorMessage(notification);
  const errorCode = extractAppServerErrorCode(notification);
  const fileChanges = rawFileChanges
    .map((entry) => ({
      kind: asString(entry.kind) || undefined,
      path: asString(entry.path) || undefined,
      diff: asString(entry.diff) || undefined,
      status: asString(entry.status) || undefined,
    }))
    .filter((entry) => entry.kind || entry.path || entry.diff || entry.status);
  return {
    transport: 'app_server',
    appServerMethod: notification.method,
    threadId: extractNotificationThreadId(notification) || undefined,
    turnId: extractNotificationTurnId(notification) || undefined,
    itemId: extractNotificationItemId(notification) || undefined,
    itemType: extractNotificationItemType(notification) || undefined,
    turnStatus: turnStatus || undefined,
    errorMessage: errorMessage || undefined,
    errorCode: errorCode || undefined,
    diff: diff || undefined,
    plan: Object.keys(plan).length > 0 ? plan : undefined,
    fileChanges: fileChanges.length > 0 ? fileChanges : undefined,
    filePaths: filePaths.length > 0 ? filePaths : undefined,
    toolName: asString(item.tool) || asString(item.name) || undefined,
    command: asString(item.command) || undefined,
    approvalText: asString(item.prompt) || asString(item.question) || undefined,
  };
}
