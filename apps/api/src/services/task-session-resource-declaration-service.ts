import { taskCreationSessionDAO } from '../db/dao/task-creation-session.dao';

const RESOURCE_DECLARATIONS_KEY = 'resourceDeclarations';

export type TaskSessionResourceKind = 'database' | 'storage';
export type TaskSessionResourceDeclarationSource = 'tool';

export type TaskSessionResourceDeclarationEntry = {
  requested: boolean;
  provisioned: boolean;
  source: TaskSessionResourceDeclarationSource;
  toolName: string;
  reason?: string;
  updatedAt: string;
};

export type TaskSessionResourceDeclarations = {
  database: TaskSessionResourceDeclarationEntry | null;
  storage: TaskSessionResourceDeclarationEntry | null;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readEntry(value: unknown): TaskSessionResourceDeclarationEntry | null {
  const record = asRecord(value);
  if (!record) return null;
  const updatedAt = asText(record.updatedAt);
  const toolName = asText(record.toolName);
  const source = asText(record.source);
  if (!updatedAt || !toolName || source !== 'tool') {
    return null;
  }
  return {
    requested: Boolean(record.requested),
    provisioned: Boolean(record.provisioned),
    source: 'tool',
    toolName,
    reason: asText(record.reason) || undefined,
    updatedAt,
  };
}

function readDeclarations(value: unknown): TaskSessionResourceDeclarations {
  const record = asRecord(value);
  return {
    database: readEntry(record.database),
    storage: readEntry(record.storage),
  };
}

function serializeDeclarations(
  declarations: TaskSessionResourceDeclarations
): Record<string, TaskSessionResourceDeclarationEntry> {
  const serialized: Record<string, TaskSessionResourceDeclarationEntry> = {};
  if (declarations.database) {
    serialized.database = declarations.database;
  }
  if (declarations.storage) {
    serialized.storage = declarations.storage;
  }
  return serialized;
}

export class TaskSessionResourceDeclarationService {
  async getSessionResourceDeclarations(sessionId: string): Promise<TaskSessionResourceDeclarations> {
    const metadata = await taskCreationSessionDAO.getSessionMetadataJson(sessionId);
    return readDeclarations(metadata[RESOURCE_DECLARATIONS_KEY]);
  }

  async markProvisioned(input: {
    sessionId: string;
    resource: TaskSessionResourceKind;
    toolName: string;
    reason?: string;
  }): Promise<TaskSessionResourceDeclarations> {
    const current = await this.getSessionResourceDeclarations(input.sessionId);
    const next: TaskSessionResourceDeclarations = {
      ...current,
      [input.resource]: {
        requested: true,
        provisioned: true,
        source: 'tool',
        toolName: asText(input.toolName) || `ensure_project_${input.resource}`,
        reason: asText(input.reason) || undefined,
        updatedAt: new Date().toISOString(),
      },
    };
    const patched = await taskCreationSessionDAO.patchSessionMetadataJson(input.sessionId, {
      [RESOURCE_DECLARATIONS_KEY]: serializeDeclarations(next),
    });
    return readDeclarations(asRecord(patched?.metadataJson)[RESOURCE_DECLARATIONS_KEY]);
  }
}

export const taskSessionResourceDeclarationService = new TaskSessionResourceDeclarationService();
