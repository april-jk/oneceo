import type { ConnectorKey, SessionConnectorDraftEntry } from "@/lib/connectors-client";

const STORAGE_KEY = "oneceo:task-connector-draft:v1";

type ConnectorDraftState = {
  draftId: string;
  updatedAt: string;
  entries: Record<string, SessionConnectorDraftEntry>;
};

function readState(): ConnectorDraftState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConnectorDraftState>;
    const draftId = typeof parsed?.draftId === "string" ? parsed.draftId.trim() : "";
    if (!draftId) return null;
    const entries = parsed?.entries && typeof parsed.entries === "object" ? parsed.entries : {};
    return {
      draftId,
      updatedAt:
        typeof parsed?.updatedAt === "string" && parsed.updatedAt.trim()
          ? parsed.updatedAt
          : new Date().toISOString(),
      entries: entries as Record<string, SessionConnectorDraftEntry>,
    };
  } catch {
    return null;
  }
}

function writeState(next: ConnectorDraftState | null) {
  if (typeof window === "undefined") return;
  if (!next) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function ensureSessionConnectorDraftId() {
  const existing = readState();
  if (existing?.draftId) return existing.draftId;
  const draftId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `draft_${Date.now()}`;
  writeState({
    draftId,
    updatedAt: new Date().toISOString(),
    entries: {},
  });
  return draftId;
}

export function listSessionConnectorDraftEntries(): SessionConnectorDraftEntry[] {
  const state = readState();
  if (!state) return [];
  return Object.values(state.entries).filter(Boolean);
}

export function upsertSessionConnectorDraftEntry(
  connectorKey: ConnectorKey,
  entry: Omit<SessionConnectorDraftEntry, "connectorKey" | "updatedAt">,
) {
  const state = readState() || {
    draftId: ensureSessionConnectorDraftId(),
    updatedAt: new Date().toISOString(),
    entries: {},
  };
  state.entries[connectorKey] = {
    connectorKey,
    ...entry,
    updatedAt: new Date().toISOString(),
  };
  state.updatedAt = new Date().toISOString();
  writeState(state);
  return state;
}

export function removeSessionConnectorDraftEntry(connectorKey: ConnectorKey) {
  const state = readState();
  if (!state) return null;
  delete state.entries[connectorKey];
  state.updatedAt = new Date().toISOString();
  if (Object.keys(state.entries).length === 0) {
    writeState(null);
    return null;
  }
  writeState(state);
  return state;
}

export function clearSessionConnectorDraftState() {
  writeState(null);
}

export function getSessionConnectorDraftState() {
  return readState();
}
