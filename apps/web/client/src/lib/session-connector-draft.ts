import type { ConnectorKey, SessionConnectorDraftEntry } from "@/lib/connectors-client";

const STORAGE_KEY = "oneceo:task-connector-draft:v1";

type ConnectorDraftState = {
  draftId: string;
  updatedAt: string;
  entries: Record<string, SessionConnectorDraftEntry>;
  source?: "manual" | "project_default";
  sourceProjectId?: string;
  userTouched?: boolean;
};

export function buildConnectorDraftKey(connectorKey: ConnectorKey, profileId?: string | null) {
  const normalizedProfileId = typeof profileId === "string" ? profileId.trim() : "";
  if (connectorKey === "custom_mcp") {
    return normalizedProfileId ? `custom_mcp:${normalizedProfileId}` : "";
  }
  return connectorKey;
}

function normalizeEntries(entries: Record<string, SessionConnectorDraftEntry>) {
  const next: Record<string, SessionConnectorDraftEntry> = {};
  for (const [key, entry] of Object.entries(entries)) {
    if (!entry?.connectorKey) continue;
    const draftKey = buildConnectorDraftKey(entry.connectorKey, entry.profileId);
    if (!draftKey) continue;
    next[draftKey] = {
      ...entry,
      connectorInstanceKey: draftKey,
    };
  }
  const legacyCustomMcp = entries.custom_mcp;
  if (legacyCustomMcp?.connectorKey === "custom_mcp") {
    const draftKey = buildConnectorDraftKey("custom_mcp", legacyCustomMcp.profileId);
    if (draftKey) {
      next[draftKey] = {
        ...legacyCustomMcp,
        connectorInstanceKey: draftKey,
      };
    }
  }
  return next;
}

function readState(): ConnectorDraftState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConnectorDraftState>;
    const draftId = typeof parsed?.draftId === "string" ? parsed.draftId.trim() : "";
    if (!draftId) return null;
    const rawEntries = parsed?.entries && typeof parsed.entries === "object" ? parsed.entries : {};
    const entries = normalizeEntries(rawEntries as Record<string, SessionConnectorDraftEntry>);
    return {
      draftId,
      updatedAt:
        typeof parsed?.updatedAt === "string" && parsed.updatedAt.trim()
          ? parsed.updatedAt
          : new Date().toISOString(),
      entries,
      source: parsed?.source === "project_default" ? "project_default" : "manual",
      sourceProjectId:
        typeof parsed?.sourceProjectId === "string" && parsed.sourceProjectId.trim()
          ? parsed.sourceProjectId.trim()
          : undefined,
      userTouched: parsed?.userTouched === true,
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
    source: "manual",
    userTouched: false,
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
  options?: {
    source?: "manual" | "project_default";
    sourceProjectId?: string;
    userTouched?: boolean;
  },
) {
  const state = readState() || {
    draftId: ensureSessionConnectorDraftId(),
    updatedAt: new Date().toISOString(),
    entries: {},
    source: "manual" as const,
    userTouched: false,
  };
  const draftKey = buildConnectorDraftKey(connectorKey, entry.profileId);
  if (!draftKey) {
    return state;
  }
  state.entries[draftKey] = {
    connectorKey,
    connectorInstanceKey: draftKey,
    ...entry,
    updatedAt: new Date().toISOString(),
  };
  state.updatedAt = new Date().toISOString();
  if (options?.source) {
    state.source = options.source;
  }
  if (options?.sourceProjectId !== undefined) {
    state.sourceProjectId = options.sourceProjectId || undefined;
  }
  if (typeof options?.userTouched === "boolean") {
    state.userTouched = options.userTouched;
  }
  writeState(state);
  return state;
}

export function removeSessionConnectorDraftEntry(connectorKey: ConnectorKey, profileId?: string | null) {
  const state = readState();
  if (!state) return null;
  const draftKey = buildConnectorDraftKey(connectorKey, profileId);
  if (draftKey) {
    delete state.entries[draftKey];
  }
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

export function replaceSessionConnectorDraftEntries(
  entries: SessionConnectorDraftEntry[],
  options?: {
    source?: "manual" | "project_default";
    sourceProjectId?: string;
    userTouched?: boolean;
  },
) {
  const nextEntries = Object.fromEntries(
    entries
      .map((entry) => {
        const draftKey = buildConnectorDraftKey(entry.connectorKey, entry.profileId);
        return [
          draftKey,
          {
            ...entry,
            connectorInstanceKey: draftKey,
            updatedAt: new Date().toISOString(),
          },
        ] as const;
      })
      .filter(([key]) => key)
  );
  const nextState: ConnectorDraftState = {
    draftId: readState()?.draftId || ensureSessionConnectorDraftId(),
    updatedAt: new Date().toISOString(),
    entries: nextEntries,
    source: options?.source || "manual",
    sourceProjectId: options?.sourceProjectId || undefined,
    userTouched: options?.userTouched === true,
  };
  writeState(Object.keys(nextEntries).length > 0 ? nextState : null);
  return nextState;
}

export function updateSessionConnectorDraftMetadata(input: {
  source?: "manual" | "project_default";
  sourceProjectId?: string;
  userTouched?: boolean;
}) {
  const state = readState();
  if (!state) return null;
  const nextState: ConnectorDraftState = {
    ...state,
    updatedAt: new Date().toISOString(),
    source: input.source ?? state.source ?? "manual",
    sourceProjectId:
      input.sourceProjectId !== undefined ? input.sourceProjectId || undefined : state.sourceProjectId,
    userTouched: input.userTouched ?? state.userTouched ?? false,
  };
  writeState(nextState);
  return nextState;
}
