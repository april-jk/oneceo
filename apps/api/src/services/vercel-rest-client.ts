import { vercelTokenRefreshService } from './vercel-token-refresh-service';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function encodePathSegment(value: string) {
  return encodeURIComponent(value);
}

function appendQuery(url: URL, entries: Record<string, unknown>) {
  for (const [key, value] of Object.entries(entries)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        const normalized = asText(item);
        if (normalized) {
          url.searchParams.append(key, normalized);
        }
      }
      continue;
    }
    const normalized = typeof value === 'number' ? String(value) : asText(value);
    if (normalized) {
      url.searchParams.set(key, normalized);
    }
  }
}

export class VercelApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: Record<string, unknown>
  ) {
    super(message);
  }
}

type VercelRuntimeRequestContext = {
  userId: string;
  profileId: string;
  taskSessionId: string;
  teamId?: string | null;
};

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

export class VercelRestClient {
  private async send(
    context: VercelRuntimeRequestContext,
    accessToken: string,
    input: {
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      path: string;
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
    }
  ) {
    const url = new URL(`https://api.vercel.com${input.path}`);
    appendQuery(url, {
      teamId: asText(context.teamId),
      ...(input.query || {}),
    });

    const response = await fetch(url, {
      method: input.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': input.body ? 'application/json' : 'application/json',
        'User-Agent': 'oneceo-vercel-mcp',
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
    });

    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      const errorPayload = pickObject(payload.error);
      throw new VercelApiError(
        asText(errorPayload.message) ||
          asText(errorPayload.code) ||
          asText(payload.message) ||
          asText(payload.error) ||
          `Vercel API request failed: ${response.status}`,
        response.status,
        payload
      );
    }

    return payload;
  }

  private async request(
    context: VercelRuntimeRequestContext,
    input: {
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      path: string;
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
    }
  ) {
    const accessToken = await vercelTokenRefreshService.getActiveAccessToken({
      userId: context.userId,
      profileId: context.profileId,
    });
    try {
      return await this.send(context, accessToken, input);
    } catch (error) {
      if (!(error instanceof VercelApiError) || error.status !== 401) {
        throw error;
      }
      const refreshedAccessToken = await vercelTokenRefreshService.refreshAccessToken({
        userId: context.userId,
        profileId: context.profileId,
      });
      return this.send(context, refreshedAccessToken, input);
    }
  }

  listProjects(
    context: VercelRuntimeRequestContext,
    query?: Record<string, unknown>
  ) {
    return this.request(context, {
      method: 'GET',
      path: '/v10/projects',
      query,
    });
  }

  getProject(
    context: VercelRuntimeRequestContext,
    projectIdOrName: string
  ) {
    return this.request(context, {
      method: 'GET',
      path: `/v9/projects/${encodePathSegment(projectIdOrName)}`,
    });
  }

  listDeployments(
    context: VercelRuntimeRequestContext,
    query?: Record<string, unknown>
  ) {
    return this.request(context, {
      method: 'GET',
      path: '/v6/deployments',
      query,
    });
  }

  getDeployment(
    context: VercelRuntimeRequestContext,
    deploymentIdOrUrl: string
  ) {
    return this.request(context, {
      method: 'GET',
      path: `/v13/deployments/${encodePathSegment(deploymentIdOrUrl)}`,
    });
  }

  getDeploymentEvents(
    context: VercelRuntimeRequestContext,
    deploymentIdOrUrl: string,
    query?: Record<string, unknown>
  ) {
    return this.request(context, {
      method: 'GET',
      path: `/v3/deployments/${encodePathSegment(deploymentIdOrUrl)}/events`,
      query,
    });
  }

  listProjectDomains(
    context: VercelRuntimeRequestContext,
    projectIdOrName: string,
    query?: Record<string, unknown>
  ) {
    return this.request(context, {
      method: 'GET',
      path: `/v9/projects/${encodePathSegment(projectIdOrName)}/domains`,
      query,
    });
  }

  listEnvVars(
    context: VercelRuntimeRequestContext,
    projectIdOrName: string,
    query?: Record<string, unknown>
  ) {
    return this.request(context, {
      method: 'GET',
      path: `/v10/projects/${encodePathSegment(projectIdOrName)}/env`,
      query,
    });
  }

  addProjectDomain(
    context: VercelRuntimeRequestContext,
    projectIdOrName: string,
    body: Record<string, unknown>
  ) {
    return this.request(context, {
      method: 'POST',
      path: `/v10/projects/${encodePathSegment(projectIdOrName)}/domains`,
      body,
    });
  }

  upsertEnvVar(
    context: VercelRuntimeRequestContext,
    projectIdOrName: string,
    body: Record<string, unknown>
  ) {
    return this.request(context, {
      method: 'POST',
      path: `/v10/projects/${encodePathSegment(projectIdOrName)}/env`,
      query: {
        upsert: 'true',
      },
      body,
    });
  }

  removeEnvVar(
    context: VercelRuntimeRequestContext,
    projectIdOrName: string,
    envVarId: string,
    query?: Record<string, unknown>
  ) {
    return this.request(context, {
      method: 'DELETE',
      path: `/v9/projects/${encodePathSegment(projectIdOrName)}/env/${encodePathSegment(envVarId)}`,
      query,
    });
  }

  redeployDeployment(
    context: VercelRuntimeRequestContext,
    body: Record<string, unknown>
  ) {
    return this.request(context, {
      method: 'POST',
      path: '/v13/deployments',
      body,
    });
  }
}

export const vercelRestClient = new VercelRestClient();
