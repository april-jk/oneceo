import { getApiBaseUrl } from "@/lib/runtime-config";
import { buildClientIdentityHeaders } from "@/lib/client-identity";
import type { ConnectorProfile } from "@/lib/connectors-client";

export type CustomMcpTransportType = "streamable_http" | "http" | "sse";

export type CustomMcpHeaderInput = {
  name: string;
  value: string;
};

export type CustomMcpProfileInput = {
  profileName: string;
  transportType: CustomMcpTransportType;
  serverUrl: string;
  iconUrl?: string;
  description?: string;
  headers?: CustomMcpHeaderInput[];
  enabled?: boolean;
};

export type CustomMcpImportResult = {
  created: Array<{ profileId: string; name: string }>;
  rejected: Array<{ name: string; reason: string }>;
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

export async function listCustomMcpProfiles(): Promise<ConnectorProfile[]> {
  const result = await requestJson<{ data?: ConnectorProfile[] }>(
    `${getApiBaseUrl()}/api/connectors/custom-mcp/profiles`
  );
  return Array.isArray(result.data) ? result.data : [];
}

export async function createCustomMcpProfile(input: CustomMcpProfileInput): Promise<ConnectorProfile> {
  const result = await requestJson<{ data?: ConnectorProfile }>(
    `${getApiBaseUrl()}/api/connectors/custom-mcp/profiles`,
    {
      method: "POST",
      body: input,
    }
  );
  if (!result.data) throw new Error("custom MCP response empty");
  return result.data;
}

export async function updateCustomMcpProfile(
  profileId: string,
  input: CustomMcpProfileInput
): Promise<ConnectorProfile> {
  const result = await requestJson<{ data?: ConnectorProfile }>(
    `${getApiBaseUrl()}/api/connectors/custom-mcp/profiles/${encodeURIComponent(profileId)}`,
    {
      method: "PATCH",
      body: input,
    }
  );
  if (!result.data) throw new Error("custom MCP response empty");
  return result.data;
}

export async function deleteCustomMcpProfile(profileId: string): Promise<{ deleted: boolean }> {
  const result = await requestJson<{ data?: { deleted?: boolean } }>(
    `${getApiBaseUrl()}/api/connectors/custom-mcp/profiles/${encodeURIComponent(profileId)}`,
    {
      method: "DELETE",
    }
  );
  return { deleted: Boolean(result.data?.deleted) };
}

export async function importCustomMcpJson(json: string): Promise<CustomMcpImportResult> {
  const result = await requestJson<{ data?: CustomMcpImportResult }>(
    `${getApiBaseUrl()}/api/connectors/custom-mcp/import-json`,
    {
      method: "POST",
      body: { json },
    }
  );
  return {
    created: Array.isArray(result.data?.created) ? result.data.created : [],
    rejected: Array.isArray(result.data?.rejected) ? result.data.rejected : [],
  };
}

export async function getCustomMcpEditableJson(profileId: string): Promise<Record<string, unknown>> {
  const result = await requestJson<{ data?: Record<string, unknown> }>(
    `${getApiBaseUrl()}/api/connectors/custom-mcp/profiles/${encodeURIComponent(profileId)}/json`
  );
  return result.data || {};
}

export async function updateCustomMcpJson(
  profileId: string,
  json: string
): Promise<ConnectorProfile> {
  const result = await requestJson<{ data?: ConnectorProfile }>(
    `${getApiBaseUrl()}/api/connectors/custom-mcp/profiles/${encodeURIComponent(profileId)}/json`,
    {
      method: "PUT",
      body: { json },
    }
  );
  if (!result.data) throw new Error("custom MCP response empty");
  return result.data;
}

export async function testCustomMcpProfile(profileId: string): Promise<{ tools: Array<Record<string, unknown>> }> {
  const result = await requestJson<{ data?: { tools?: Array<Record<string, unknown>> } }>(
    `${getApiBaseUrl()}/api/connectors/custom-mcp/profiles/${encodeURIComponent(profileId)}/test`,
    {
      method: "POST",
    }
  );
  return { tools: Array.isArray(result.data?.tools) ? result.data.tools : [] };
}
