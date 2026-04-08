import { getApiBaseUrl } from "@/lib/runtime-config";
import { buildClientIdentityHeaders } from "@/lib/client-identity";

export type ConnectorKey =
  | "github"
  | "slack"
  | "notion"
  | "supabase"
  | "figma"
  | "vercel"
  | "postgres";

export type ConnectorCategory = "app" | "custom_api" | "custom_mcp";

export type ConnectorCatalogItem = {
  key: ConnectorKey;
  category: ConnectorCategory;
  name: string;
  description: string;
  icon: string;
  featured?: boolean;
  isNew?: boolean;
  sortOrder?: number;
  authMode: string;
  available: boolean;
  availabilityReason?: string;
  configFields: Array<{
    key: string;
    label: string;
    type: "text" | "password" | "url" | "textarea";
    required?: boolean;
    placeholder?: string;
    description?: string;
    secret?: boolean;
  }>;
  oauth?: {
    supported: boolean;
    provider?: string;
  };
  activityMatcherVerified: boolean;
  visibleInMenu?: boolean;
  deprecated?: boolean;
  runtime?: {
    type?: string;
    urlDefault?: string;
    headerTemplate?: string;
  };
};

export type ConnectorProfile = {
  profileId: string;
  connectorKey: ConnectorKey;
  profileName: string;
  authMode: string;
  authStatus: string;
  displayName?: string | null;
  config: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  secretSummary?: string | null;
  isDefault: boolean;
  lastAuthAt?: string | null;
  updatedAt?: string | null;
  lastError?: string | null;
};

export type UserConnectorAccount = {
  connectorKey: ConnectorKey;
  authMode: string;
  authStatus: string;
  displayName?: string | null;
  config: Record<string, unknown>;
  secretSummary?: string | null;
  lastAuthAt?: string | null;
  updatedAt?: string | null;
  lastError?: string | null;
  defaultProfileId?: string | null;
  defaultProfileName?: string | null;
  profilesCount?: number;
};

export type ConnectorOauthAccount = ConnectorProfile & {
  defaultProfileId?: string | null;
  defaultProfileName?: string | null;
};

export type SessionConnectorStatus = {
  connectorKey: ConnectorKey;
  name: string;
  icon: string;
  authMode: string;
  available: boolean;
  availabilityReason?: string;
  globalAuthStatus: string;
  attached: boolean;
  desiredState: string;
  runtimeStatus: string;
  usageStatus: "idle" | "active";
  displayName?: string | null;
  selectedProfileId?: string | null;
  selectedProfileName?: string | null;
  attachedProfileId?: string | null;
  attachedProfileName?: string | null;
  availableProfilesCount?: number;
  enabledTools?: string[];
  authorizedRepositories?: string[];
  lastUsedAt?: string | null;
  lastError?: string | null;
  serverName?: string | null;
};

export type GithubConnectorRepository = {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch?: string | null;
  permissions?: {
    admin?: boolean;
    maintain?: boolean;
    push?: boolean;
    triage?: boolean;
    pull?: boolean;
  };
};

export type SessionConnectorDraftEntry = {
  connectorKey: ConnectorKey;
  profileId?: string | null;
  desiredState?: "attached" | "detached";
  enabledTools?: string[];
  sessionConfig?: Record<string, unknown> | null;
  updatedAt?: string;
};

export type ConnectorProfileInput = {
  profileName?: string;
  displayName?: string;
  config?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type JsonOptions = {
  method?: string;
  body?: unknown;
};

async function requestJson<T>(url: string, options: JsonOptions = {}): Promise<T> {
  const response = await fetch(url, {
    method: options.method || "GET",
    credentials: "include",
    headers: buildClientIdentityHeaders({
      "Content-Type": "application/json",
    }),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload?.error || `request failed: ${response.status}`);
  }
  return payload;
}

export async function getConnectorCatalog(): Promise<ConnectorCatalogItem[]> {
  const result = await requestJson<{ data?: ConnectorCatalogItem[] }>(
    `${getApiBaseUrl()}/api/connectors/catalog`
  );
  return Array.isArray(result.data) ? result.data : [];
}

export async function getMyConnectorProfiles(): Promise<{
  userId?: string;
  source?: string;
  catalog: ConnectorCatalogItem[];
  profiles: ConnectorProfile[];
}> {
  const result = await requestJson<{
    data?: {
      userId?: string;
      source?: string;
      catalog?: ConnectorCatalogItem[];
      profiles?: ConnectorProfile[];
    };
  }>(`${getApiBaseUrl()}/api/connectors/me`);
  return {
    userId: result.data?.userId,
    source: result.data?.source,
    catalog: Array.isArray(result.data?.catalog) ? result.data?.catalog : [],
    profiles: Array.isArray(result.data?.profiles) ? result.data?.profiles : [],
  };
}

export async function getMyConnectorAccounts(): Promise<{
  userId?: string;
  source?: string;
  catalog: ConnectorCatalogItem[];
  accounts: UserConnectorAccount[];
  profiles: ConnectorProfile[];
}> {
  const result = await getMyConnectorProfiles();
  const profilesByConnector = new Map<ConnectorKey, ConnectorProfile[]>();
  for (const profile of result.profiles) {
    const current = profilesByConnector.get(profile.connectorKey) || [];
    current.push(profile);
    profilesByConnector.set(profile.connectorKey, current);
  }

  const accounts = result.catalog.map((item) => {
    const connectorProfiles = profilesByConnector.get(item.key) || [];
    const defaultProfile =
      connectorProfiles.find((profile) => profile.isDefault) || connectorProfiles[0];

    return {
      connectorKey: item.key,
      authMode: defaultProfile?.authMode || item.authMode,
      authStatus:
        defaultProfile?.authStatus || (item.available ? "not_configured" : "unavailable"),
      displayName: defaultProfile?.displayName || null,
      config: defaultProfile?.config || {},
      secretSummary: defaultProfile?.secretSummary || null,
      lastAuthAt: defaultProfile?.lastAuthAt || null,
      updatedAt: defaultProfile?.updatedAt || null,
      lastError: defaultProfile?.lastError || null,
      defaultProfileId: defaultProfile?.profileId || null,
      defaultProfileName: defaultProfile?.profileName || null,
      profilesCount: connectorProfiles.length,
    };
  });

  return {
    userId: result.userId,
    source: result.source,
    catalog: result.catalog,
    accounts,
    profiles: result.profiles,
  };
}

export async function createConnectorProfile(
  connectorKey: ConnectorKey,
  input: ConnectorProfileInput
): Promise<ConnectorProfile> {
  const result = await requestJson<{ data?: ConnectorProfile }>(
    `${getApiBaseUrl()}/api/connectors/${encodeURIComponent(connectorKey)}/profiles`,
    {
      method: "POST",
      body: input,
    }
  );
  if (!result.data) {
    throw new Error("connector response empty");
  }
  return result.data;
}

export async function updateConnectorProfile(
  profileId: string,
  input: ConnectorProfileInput
): Promise<ConnectorProfile> {
  const result = await requestJson<{ data?: ConnectorProfile }>(
    `${getApiBaseUrl()}/api/connectors/profiles/${encodeURIComponent(profileId)}`,
    {
      method: "PUT",
      body: input,
    }
  );
  if (!result.data) {
    throw new Error("connector response empty");
  }
  return result.data;
}

export async function deleteConnectorProfile(profileId: string): Promise<{ deleted: boolean }> {
  const result = await requestJson<{ data?: { deleted?: boolean } }>(
    `${getApiBaseUrl()}/api/connectors/profiles/${encodeURIComponent(profileId)}`,
    {
      method: "DELETE",
    }
  );
  return {
    deleted: Boolean(result.data?.deleted),
  };
}

export async function setDefaultConnectorProfile(
  profileId: string
): Promise<ConnectorProfile> {
  const result = await requestJson<{ data?: ConnectorProfile }>(
    `${getApiBaseUrl()}/api/connectors/profiles/${encodeURIComponent(profileId)}/default`,
    {
      method: "PUT",
    }
  );
  if (!result.data) {
    throw new Error("connector response empty");
  }
  return result.data;
}

export async function startConnectorProfileOauth(
  profileId: string,
  input: {
    redirectUri: string;
    returnToSessionId?: string;
  }
): Promise<{ authUrl: string; requestId?: string; state?: string }> {
  const result = await requestJson<{
    data?: { authUrl?: string; requestId?: string; state?: string };
  }>(
    `${getApiBaseUrl()}/api/connectors/profiles/${encodeURIComponent(profileId)}/oauth/start`,
    {
      method: "POST",
      body: input,
    }
  );
  if (!result.data?.authUrl) {
    throw new Error("oauth url empty");
  }
  return {
    authUrl: result.data.authUrl,
    requestId: result.data.requestId,
    state: result.data.state,
  };
}

export async function completeConnectorProfileOauth(
  profileId: string,
  input: {
    state: string;
    code: string;
    redirectUri: string;
  }
): Promise<{
  profile?: ConnectorProfile;
  account?: ConnectorProfile;
  returnToSessionId?: string | null;
}> {
  const result = await requestJson<{
    data?: {
      profile?: ConnectorProfile;
      account?: ConnectorProfile;
      returnToSessionId?: string | null;
    };
  }>(
    `${getApiBaseUrl()}/api/connectors/profiles/${encodeURIComponent(profileId)}/oauth/callback`,
    {
      method: "POST",
      body: input,
    }
  );
  return result.data || {};
}

export async function clearConnectorProfileAuth(
  profileId: string
): Promise<ConnectorProfile & {
  remoteGrantRevoked?: boolean;
  remoteGrantError?: string | null;
  runtimeDetachQueued?: boolean;
}> {
  const result = await requestJson<{ data?: ConnectorProfile & {
    remoteGrantRevoked?: boolean;
    remoteGrantError?: string | null;
    runtimeDetachQueued?: boolean;
  } }>(
    `${getApiBaseUrl()}/api/connectors/profiles/${encodeURIComponent(profileId)}/auth`,
    {
      method: "DELETE",
    }
  );
  if (!result.data) {
    throw new Error("connector response empty");
  }
  return result.data;
}

// Backward-compatible helper for older callers while the UI migrates.
export async function saveConnectorConfig(
  connectorKey: ConnectorKey,
  input: ConnectorProfileInput
): Promise<ConnectorProfile> {
  return createConnectorProfile(connectorKey, input);
}

export async function startConnectorOauth(
  connectorKey: ConnectorKey,
  input: {
    redirectUri: string;
    returnToSessionId?: string;
  }
): Promise<{ authUrl: string; requestId?: string; state?: string }> {
  const result = await requestJson<{
    data?: { authUrl?: string; requestId?: string; state?: string };
  }>(`${getApiBaseUrl()}/api/connectors/${encodeURIComponent(connectorKey)}/oauth/start`, {
    method: "POST",
    body: input,
  });
  if (!result.data?.authUrl) {
    throw new Error("oauth url empty");
  }
  return {
    authUrl: result.data.authUrl,
    requestId: result.data.requestId,
    state: result.data.state,
  };
}

export async function completeConnectorOauth(
  connectorKey: ConnectorKey,
  input: {
    state: string;
    code: string;
    redirectUri: string;
  }
): Promise<{
  account?: ConnectorOauthAccount;
  returnToSessionId?: string | null;
}> {
  const result = await requestJson<{
    data?: {
      account?: ConnectorOauthAccount;
      profile?: ConnectorOauthAccount;
      returnToSessionId?: string | null;
    };
  }>(`${getApiBaseUrl()}/api/connectors/${encodeURIComponent(connectorKey)}/oauth/callback`, {
    method: "POST",
    body: input,
  });
  return {
    account: result.data?.account || result.data?.profile,
    returnToSessionId: result.data?.returnToSessionId,
  };
}

export async function clearConnectorAuth(
  connectorKey: ConnectorKey
): Promise<ConnectorProfile> {
  const result = await requestJson<{ data?: ConnectorProfile }>(
    `${getApiBaseUrl()}/api/connectors/${encodeURIComponent(connectorKey)}/auth`,
    {
      method: "DELETE",
    }
  );
  if (!result.data) {
    throw new Error("connector response empty");
  }
  return result.data;
}

export async function getSessionConnectors(sessionId: string): Promise<{
  items: SessionConnectorStatus[];
  summary?: Record<string, number>;
}> {
  const result = await requestJson<{
    data?: {
      items?: SessionConnectorStatus[];
      summary?: Record<string, number>;
    };
  }>(
    `${getApiBaseUrl()}/api/task-creation/sessions/${encodeURIComponent(sessionId)}/connectors`
  );
  return {
    items: Array.isArray(result.data?.items) ? result.data?.items : [],
    summary: result.data?.summary,
  };
}

export async function attachSessionConnector(
  sessionId: string,
  connectorKey: ConnectorKey,
  input: {
    profileId: string;
    enabledTools?: string[];
    sessionConfig?: Record<string, unknown>;
  }
): Promise<SessionConnectorStatus | null> {
  const result = await requestJson<{
    data?: {
      connector?: SessionConnectorStatus | null;
    };
  }>(
    `${getApiBaseUrl()}/api/task-creation/sessions/${encodeURIComponent(
      sessionId
    )}/connectors/${encodeURIComponent(connectorKey)}/attach`,
    {
      method: "POST",
      body: input,
    }
  );
  return result.data?.connector || null;
}

export async function getGithubProfileRepositories(
  profileId: string
): Promise<GithubConnectorRepository[]> {
  const result = await requestJson<{
    data?: {
      items?: GithubConnectorRepository[];
    };
  }>(
    `${getApiBaseUrl()}/api/connectors/github/profiles/${encodeURIComponent(profileId)}/repositories`
  );
  return Array.isArray(result.data?.items) ? result.data?.items : [];
}

export async function detachSessionConnector(
  sessionId: string,
  connectorKey: ConnectorKey
): Promise<SessionConnectorStatus | null> {
  const result = await requestJson<{
    data?: {
      connector?: SessionConnectorStatus | null;
    };
  }>(
    `${getApiBaseUrl()}/api/task-creation/sessions/${encodeURIComponent(
      sessionId
    )}/connectors/${encodeURIComponent(connectorKey)}/detach`,
    {
      method: "POST",
    }
  );
  return result.data?.connector || null;
}

export async function saveSessionConnectorDraft(
  draftId: string,
  entries: SessionConnectorDraftEntry[]
): Promise<{ draftId: string; entryCount: number; redisEnabled: boolean; updatedAt: string }> {
  const result = await requestJson<{
    data?: {
      draftId?: string;
      entryCount?: number;
      redisEnabled?: boolean;
      updatedAt?: string;
    };
  }>(`${getApiBaseUrl()}/api/task-creation/connector-drafts/${encodeURIComponent(draftId)}`, {
    method: "POST",
    body: { entries },
  });
  return {
    draftId: String(result.data?.draftId || draftId),
    entryCount: Number(result.data?.entryCount || 0),
    redisEnabled: Boolean(result.data?.redisEnabled),
    updatedAt: String(result.data?.updatedAt || new Date().toISOString()),
  };
}

export async function applySessionConnectorDraft(
  draftId: string,
  input: {
    sessionId: string;
    entries?: SessionConnectorDraftEntry[];
  }
): Promise<{ accepted: number; runtimeQueued: boolean }> {
  const result = await requestJson<{
    data?: {
      accepted?: number;
      runtimeQueued?: boolean;
    };
  }>(`${getApiBaseUrl()}/api/task-creation/connector-drafts/${encodeURIComponent(draftId)}/apply`, {
    method: "POST",
    body: input,
  });
  return {
    accepted: Number(result.data?.accepted || 0),
    runtimeQueued: Boolean(result.data?.runtimeQueued),
  };
}

export async function clearSessionConnectorDraft(draftId: string): Promise<void> {
  await requestJson(
    `${getApiBaseUrl()}/api/task-creation/connector-drafts/${encodeURIComponent(draftId)}`,
    { method: "DELETE" }
  );
}
