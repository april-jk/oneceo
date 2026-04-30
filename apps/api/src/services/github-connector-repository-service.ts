import { userConnectorService } from './user-connector-service';
import { connectorRegistry } from './connector-registry';
import { composioConnectorService } from './composio-connector-service';

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

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function repositoryKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeRepositoryFullName(value: unknown): string {
  const text = asText(value);
  if (!text) return '';
  const parts = text
    .split('/')
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length !== 2) return '';
  return `${parts[0]}/${parts[1]}`;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const normalized = normalizeRepositoryFullName(item);
    if (!normalized) continue;
    const key = repositoryKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function parseLinkHeader(value: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (value || '').split(',')) {
    const section = part.trim();
    if (!section) continue;
    const match = section.match(/^<([^>]+)>;\s*rel="([^"]+)"$/);
    if (!match) continue;
    result[match[2]] = match[1];
  }
  return result;
}

class GithubUnauthorizedError extends Error {
  constructor(message = 'GitHub 授权已失效，请前往设置重新授权') {
    super(message);
    this.name = 'GithubUnauthorizedError';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseJsonText(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed);
  } catch {
    return {};
  }
}

function isComposioGithubProfile(profile: {
  metadataJson?: Record<string, unknown>;
  secret?: { source?: string; composioMcpUrl?: string } | null;
}): boolean {
  return (
    asText(profile.metadataJson?.provider) === 'composio' &&
    asText(profile.secret?.source) === 'composio' &&
    Boolean(asText(profile.secret?.composioMcpUrl))
  );
}

function buildRepositoryFromFullName(fullName: string, index: number): GithubConnectorRepository | null {
  const normalized = normalizeRepositoryFullName(fullName);
  if (!normalized) return null;
  const [owner, name] = normalized.split('/');
  return {
    id: index + 1,
    owner,
    name,
    fullName: normalized,
    private: false,
    defaultBranch: null,
    permissions: {
      admin: false,
      maintain: false,
      push: false,
      triage: false,
      pull: true,
    },
  };
}

function parseComposioPayload(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return {};
  if (record.data && typeof record.data === 'object') {
    return record;
  }
  const content = Array.isArray(record.content) ? record.content : [];
  for (const item of content) {
    const text = asText(asRecord(item).text);
    if (!text) continue;
    const parsed = parseJsonText(text);
    if (Object.keys(parsed).length > 0) {
      return parsed;
    }
  }
  return record;
}

function extractComposioSessionId(value: unknown): string | null {
  const payload = parseComposioPayload(value);
  const data = asRecord(payload.data);
  const session = asRecord(data.session);
  return asText(session.id) || null;
}

function extractComposioRepositories(value: unknown): GithubConnectorRepository[] {
  const payload = parseComposioPayload(value);
  const data = asRecord(payload.data);
  const results = Array.isArray(data.results) ? data.results : [];
  const seen = new Set<string>();
  const repositories: GithubConnectorRepository[] = [];
  for (const result of results) {
    const response = asRecord(asRecord(result).response);
    const container = asRecord(response.data);
    const batch = Array.isArray(container.repositories) ? container.repositories : [];
    for (const item of batch) {
      const mapped =
        item && typeof item === 'object' && !Array.isArray(item)
          ? mapRepository(item as Record<string, unknown>)
          : null;
      if (!mapped) continue;
      const key = repositoryKey(mapped.fullName);
      if (seen.has(key)) continue;
      seen.add(key);
      repositories.push(mapped);
    }
  }
  return repositories;
}

function isBadCredentialsResponse(response: Response, payload: unknown): boolean {
  if (response.status !== 401) return false;
  const message = asText(asRecord(payload).message);
  return message.toLowerCase() === 'bad credentials';
}

async function fetchGithubJson(url: string, accessToken: string): Promise<{
  response: Response;
  payload: unknown;
}> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'oneceo-connectors',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const payload = (await response.json()) as unknown;
  return {
    response,
    payload,
  };
}

async function fetchGithubInstallations(accessToken: string): Promise<{
  response: Response;
  payload: unknown;
}> {
  const response = await fetch('https://api.github.com/user/installations', {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'oneceo-connectors',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const payload = (await response.json()) as unknown;
  return {
    response,
    payload,
  };
}

function mapRepository(payload: Record<string, unknown>): GithubConnectorRepository | null {
  const ownerRecord =
    payload.owner && typeof payload.owner === 'object' && !Array.isArray(payload.owner)
      ? (payload.owner as Record<string, unknown>)
      : {};
  const permissionsRecord =
    payload.permissions &&
    typeof payload.permissions === 'object' &&
    !Array.isArray(payload.permissions)
      ? (payload.permissions as Record<string, unknown>)
      : {};
  const fullName = asText(payload.full_name);
  const name = asText(payload.name);
  const owner = asText(ownerRecord.login);
  if (!fullName || !name || !owner) return null;
  return {
    id: Number(payload.id || 0),
    owner,
    name,
    fullName,
    private: Boolean(payload.private),
    defaultBranch: asText(payload.default_branch) || null,
    permissions: {
      admin: Boolean(permissionsRecord.admin),
      maintain: Boolean(permissionsRecord.maintain),
      push: Boolean(permissionsRecord.push),
      triage: Boolean(permissionsRecord.triage),
      pull: Boolean(permissionsRecord.pull),
    },
  };
}

async function fetchRepositoriesPage(url: string, accessToken: string) {
  const { response, payload } = await fetchGithubJson(url, accessToken);
  if (!response.ok) {
    const record = asRecord(payload);
    if (isBadCredentialsResponse(response, payload)) {
      throw new GithubUnauthorizedError();
    }
    throw new Error(
      asText(record.message) || `获取 GitHub 仓库列表失败: ${response.status}`
    );
  }
  if (!Array.isArray(payload)) {
    throw new Error('GitHub 仓库列表返回格式无效');
  }
  return {
    items: payload
      .map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? mapRepository(item as Record<string, unknown>)
          : null
      )
      .filter(Boolean) as GithubConnectorRepository[],
    links: parseLinkHeader(response.headers.get('link')),
  };
}

export class GithubConnectorRepositoryService {
  private async listRepositoriesFromComposioMcp(input: {
    userId: string;
    profileId: string;
    metadataJson?: Record<string, unknown>;
    secret?: { source?: string; composioMcpUrl?: string } | null;
  }): Promise<GithubConnectorRepository[]> {
    const catalogItem = connectorRegistry.getCatalogItem('github');
    const runtimeContext = {
      connectorKey: 'github' as const,
      taskSessionId: `github-profile-${input.profileId}`,
      userId: input.userId,
      profileId: input.profileId,
      profileSecret: input.secret || null,
      profileMetadata: asRecord(input.metadataJson),
      catalogItem,
    };
    const searchResult = await composioConnectorService.executeRpc({
      method: 'tools/call',
      params: {
        name: 'github__COMPOSIO_SEARCH_TOOLS',
        arguments: {
          queries: [
            {
              use_case:
                'list all accessible GitHub repositories for the connected account and return repository full names',
            },
          ],
          session: {
            generate_id: true,
          },
          model: 'gpt-5.2',
        },
      },
      runtimeContext,
    });
    const sessionId = extractComposioSessionId(searchResult);
    const repositories: GithubConnectorRepository[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= 10; page += 1) {
      const pageResult = await composioConnectorService.executeRpc({
        method: 'tools/call',
        params: {
          name: 'github__COMPOSIO_MULTI_EXECUTE_TOOL',
          arguments: {
            tools: [
              {
                tool_slug: 'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER',
                arguments: {
                  per_page: 100,
                  page,
                  type: 'all',
                  sort: 'full_name',
                },
              },
            ],
            sync_response_to_workbench: false,
            session_id: sessionId || undefined,
            current_step: 'LISTING_REPOSITORIES',
            current_step_metric: `${page}/10 pages`,
          },
        },
        runtimeContext,
      });
      const batch = extractComposioRepositories(pageResult);
      if (batch.length === 0) {
        break;
      }
      for (const repository of batch) {
        const key = repositoryKey(repository.fullName);
        if (seen.has(key)) continue;
        seen.add(key);
        repositories.push(repository);
      }
      if (batch.length < 100) {
        break;
      }
    }
    return repositories;
  }

  private async listRepositoriesFromComposio(profile: {
    profileId?: string;
    userId?: string;
    configJson?: Record<string, unknown>;
    metadataJson?: Record<string, unknown>;
    secret?: { source?: string; composioMcpUrl?: string } | null;
  }): Promise<GithubConnectorRepository[]> {
    const metadata = asRecord(profile.metadataJson);
    const catalogItem = connectorRegistry.getCatalogItem('github');
    const toolkitSlug = catalogItem.composio?.toolkitSlugs?.[0] || 'github';
    const sessionId = asText(metadata.composioSessionId);
    let names: string[] = [];

    if (sessionId) {
      try {
        const summary = await composioConnectorService.getToolkitConnectionSummary({
          sessionId,
          toolkitSlug,
          connectedAccountId: asText(metadata.composioConnectedAccountId) || null,
        });
        if (summary.connected) {
          names = summary.repositoryNames;
        }
      } catch (error) {
        console.warn('[github_composio_repository_list_failed]', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (names.length === 0 && profile.profileId && profile.userId) {
      try {
        const repositories = await this.listRepositoriesFromComposioMcp({
          userId: profile.userId,
          profileId: profile.profileId,
          metadataJson: metadata,
          secret: profile.secret || null,
        });
        if (repositories.length > 0) {
          return repositories;
        }
      } catch (error) {
        console.warn('[github_composio_runtime_repository_list_failed]', {
          profileId: profile.profileId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (names.length === 0) {
      names = asStringArray(metadata.composioRepositoryNames);
    }
    if (names.length === 0) {
      names = asStringArray(asRecord(profile.configJson).repositories);
    }

    return names
      .map((fullName, index) => buildRepositoryFromFullName(fullName, index))
      .filter(Boolean) as GithubConnectorRepository[];
  }

  private async markProfileUnauthorized(userId: string, profileId: string) {
    await userConnectorService.markProfileNeedsAuth(userId, profileId, {
      lastError: 'GitHub 授权已失效，请重新授权',
      clearSecret: true,
    });
  }

  private async markProfileInstallationMissing(userId: string, profileId: string) {
    await userConnectorService.markProfileNeedsAuth(userId, profileId, {
      lastError:
        'GitHub App 已授权，但当前账号下没有任何可用安装。请先在 GitHub 安装该 App 或批准安装更新后，再重新连接。',
      clearSecret: true,
    });
  }

  async getInstallationReadiness(accessToken: string): Promise<{
    installationCount: number;
  }> {
    const { response, payload } = await fetchGithubInstallations(accessToken);
    if (!response.ok) {
      if (isBadCredentialsResponse(response, payload)) {
        throw new GithubUnauthorizedError();
      }
      const record = asRecord(payload);
      throw new Error(
        asText(record.message) || `校验 GitHub 安装状态失败: ${response.status}`
      );
    }
    const record = asRecord(payload);
    const installationCount = Number(record.total_count || 0);
    if (!Number.isFinite(installationCount)) {
      throw new Error('GitHub 安装状态返回格式无效');
    }
    return {
      installationCount,
    };
  }

  async assertProfileAuthorized(userId: string, profileId: string): Promise<void> {
    const profile = await userConnectorService.getProfileMaterial(userId, profileId);
    if (!profile || profile.connectorKey !== 'github') {
      throw new Error('GitHub 连接器 profile 不存在');
    }
    if (profile.authStatus !== 'authorized') {
      throw new Error('GitHub 连接器尚未完成授权，请先重新授权');
    }
    if (isComposioGithubProfile(profile)) {
      const repositories = await this.listRepositoriesFromComposio({
        ...profile,
        userId,
        profileId,
      });
      if (repositories.length === 0) {
        throw new Error('GitHub Composio 连接未返回可读仓库，请重新授权或检查仓库安装范围');
      }
      return;
    }
    const accessToken = asText(profile.secret?.accessToken);
    if (!accessToken) {
      await this.markProfileUnauthorized(userId, profileId);
      throw new Error('GitHub 授权已失效，请前往设置重新授权');
    }
    const { response, payload } = await fetchGithubJson('https://api.github.com/user', accessToken);
    if (response.ok) {
      const installationState = await this.getInstallationReadiness(accessToken);
      if (installationState.installationCount <= 0) {
        await this.markProfileInstallationMissing(userId, profileId);
        throw new Error(
          'GitHub App 已授权，但当前账号下没有任何可用安装。请先在 GitHub 安装该 App 或批准安装更新后，再重新连接。'
        );
      }
      return;
    }
    if (isBadCredentialsResponse(response, payload)) {
      await this.markProfileUnauthorized(userId, profileId);
      throw new Error('GitHub 授权已失效，请前往设置重新授权');
    }
    const record = asRecord(payload);
    throw new Error(asText(record.message) || `校验 GitHub 授权失败: ${response.status}`);
  }

  async listRepositories(userId: string, profileId: string): Promise<GithubConnectorRepository[]> {
    const profile = await userConnectorService.getProfileMaterial(userId, profileId);
    if (!profile || profile.connectorKey !== 'github') {
      throw new Error('GitHub 连接器 profile 不存在');
    }
    if (profile.authStatus !== 'authorized') {
      throw new Error('GitHub 连接器尚未完成授权，请先重新授权');
    }
    if (isComposioGithubProfile(profile)) {
      return this.listRepositoriesFromComposio({
        ...profile,
        userId,
        profileId,
      });
    }
    const accessToken = asText(profile.secret?.accessToken);
    if (!accessToken) {
      await this.markProfileUnauthorized(userId, profileId);
      throw new Error('GitHub 授权已失效，请前往设置重新授权');
    }

    const repositories: GithubConnectorRepository[] = [];
    const seen = new Set<string>();
    let nextUrl =
      'https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member';
    let pageCount = 0;

    try {
      while (nextUrl && pageCount < 10) {
        const page = await fetchRepositoriesPage(nextUrl, accessToken);
        for (const item of page.items) {
          const key = repositoryKey(item.fullName);
          if (seen.has(key)) continue;
          seen.add(key);
          repositories.push(item);
        }
        nextUrl = page.links.next || '';
        pageCount += 1;
      }
    } catch (error) {
      if (error instanceof GithubUnauthorizedError) {
        await this.markProfileUnauthorized(userId, profileId);
        throw new Error(error.message);
      }
      throw error;
    }

    return repositories;
  }

  async assertRepositoriesAccessible(
    userId: string,
    profileId: string,
    repositories: string[]
  ): Promise<void> {
    const available = await this.listRepositories(userId, profileId);
    const availableKeys = new Set(available.map((item) => repositoryKey(item.fullName)));
    const invalid = repositories.filter((item) => !availableKeys.has(repositoryKey(item)));
    if (invalid.length > 0) {
      throw new Error(`以下 GitHub 仓库当前账号不可访问: ${invalid.join(', ')}`);
    }
  }
}

export const githubConnectorRepositoryService = new GithubConnectorRepositoryService();
