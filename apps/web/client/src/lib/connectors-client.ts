import { getApiBaseUrl } from "@/lib/runtime-config";
import { buildClientIdentityHeaders } from "@/lib/client-identity";

export type ConnectorKey = "github" | "slack" | "notion" | "postgres";

export type ConnectorCatalogItem = {
  key: ConnectorKey;
  name: string;
  description: string;
  icon: string;
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
  lastUsedAt?: string | null;
  lastError?: string | null;
  serverName?: string | null;
};

type JsonOptions = {
  method?: string;
  body?: unknown;
};

async function requestJson<T>(url: string, options: JsonOptions = {}): Promise<T> {
  const response = await fetch(url, {
    method: options.method || "GET",
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

export async function getMyConnectorAccounts(): Promise<{
  userId?: string;
  source?: string;
  catalog: ConnectorCatalogItem[];
  accounts: UserConnectorAccount[];
}> {
  const result = await requestJson<{
    data?: {
      userId?: string;
      source?: string;
      catalog?: ConnectorCatalogItem[];
      accounts?: UserConnectorAccount[];
    };
  }>(`${getApiBaseUrl()}/api/connectors/me`);
  return {
    userId: result.data?.userId,
    source: result.data?.source,
    catalog: Array.isArray(result.data?.catalog) ? result.data?.catalog : [],
    accounts: Array.isArray(result.data?.accounts) ? result.data?.accounts : [],
  };
}

export async function saveConnectorConfig(
  connectorKey: ConnectorKey,
  input: {
    displayName?: string;
    config?: Record<string, unknown>;
    credentials?: Record<string, unknown>;
  }
): Promise<UserConnectorAccount> {
  const result = await requestJson<{ data?: UserConnectorAccount }>(
    `${getApiBaseUrl()}/api/connectors/${encodeURIComponent(connectorKey)}`,
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
  account?: UserConnectorAccount;
  returnToSessionId?: string | null;
}> {
  const result = await requestJson<{
    data?: {
      account?: UserConnectorAccount;
      returnToSessionId?: string | null;
    };
  }>(`${getApiBaseUrl()}/api/connectors/${encodeURIComponent(connectorKey)}/oauth/callback`, {
    method: "POST",
    body: input,
  });
  return result.data || {};
}

export async function clearConnectorAuth(
  connectorKey: ConnectorKey
): Promise<UserConnectorAccount> {
  const result = await requestJson<{ data?: UserConnectorAccount }>(
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
  connectorKey: ConnectorKey
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
    }
  );
  return result.data?.connector || null;
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
