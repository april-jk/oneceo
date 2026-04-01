import { userConnectorService } from './user-connector-service';

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
