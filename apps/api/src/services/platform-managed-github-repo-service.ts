import { createHash, createSign } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import https from 'node:https';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export type ManagedDeploymentRepository = {
  owner: string;
  name: string;
  fullName: string;
  htmlUrl?: string;
  cloneUrl?: string;
  defaultBranch: string;
};

type GithubRepoResponse = {
  name?: string;
  full_name?: string;
  html_url?: string;
  clone_url?: string;
  default_branch?: string;
  owner?: {
    login?: string;
  } | null;
};

type GithubBranchResponse = {
  name?: string;
};

type GithubDeploymentAuth = {
  token: string;
  owner: string;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireEnv(name: string): string {
  const value = asText(process.env[name]);
  if (!value) {
    throw new Error(`${name} 未配置，平台托管仓库不可用`);
  }
  return value;
}

function sanitizeUserSegment(userId: string) {
  return userId.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'user';
}

function sanitizeProjectSegment(projectKey: string) {
  return projectKey.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

function buildRepoName(userId: string, projectKey = 'default') {
  const prefix = asText(process.env.GITHUB_DEPLOYMENT_REPO_PREFIX) || 'oneceo-deploy';
  if (projectKey === 'default') {
    const normalized = sanitizeUserSegment(userId).slice(0, 48);
    const hash = createHash('sha1').update(userId).digest('hex').slice(0, 8);
    return `${prefix}-${normalized}-${hash}`.slice(0, 96);
  }
  const normalized = sanitizeUserSegment(userId).slice(0, 48);
  const userHash = createHash('sha1').update(userId).digest('hex').slice(0, 6);
  const projectSegment = sanitizeProjectSegment(projectKey).slice(0, 24);
  const projectHash = createHash('sha1').update(projectKey).digest('hex').slice(0, 8);
  return `${prefix}-${normalized}-${userHash}-${projectSegment}-${projectHash}`.slice(0, 96);
}

function resolveDefaultBranch() {
  return asText(process.env.GITHUB_DEPLOYMENT_BRANCH) || 'main';
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function normalizeGithubAppPrivateKey(value: string) {
  const trimmed = asText(value);
  if (!trimmed) return '';
  return trimmed.replace(/\\n/g, '\n');
}

async function githubRequest<T>(
  token: string,
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; allowNotFound?: boolean }
): Promise<T | null> {
  const url = new URL(`https://api.github.com${path}`);
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'oneceo-platform-deployment',
    ...(init?.headers || {}),
  };
  const body =
    typeof init?.body === 'string'
      ? init.body
      : init?.body
        ? String(init.body)
        : undefined;

  const response = await new Promise<{
    statusCode: number;
    body: string;
  }>((resolve, reject) => {
    const request = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname}${url.search}`,
        method: init?.method || 'GET',
        headers: {
          ...headers,
          ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}),
        },
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: responseBody,
          });
        });
      }
    );

    request.on('error', reject);
    request.setTimeout(30_000, () => {
      request.destroy(new Error('GitHub API 请求超时'));
    });
    if (body) {
      request.write(body);
    }
    request.end();
  });

  if (init?.allowNotFound && response.statusCode === 404) {
    return null;
  }

  const text = response.body;
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const message =
      asText(payload?.message) ||
      (Array.isArray(payload?.errors) ? asText(payload.errors[0]?.message) : '') ||
      `GitHub API 请求失败: ${response.statusCode}`;
    throw new Error(message);
  }

  return (payload || null) as T | null;
}

function mapRepository(payload: GithubRepoResponse | null, fallbackOwner?: string, fallbackName?: string) {
  if (!payload) return null;
  const owner = asText(payload.owner?.login) || fallbackOwner || '';
  const name = asText(payload.name) || fallbackName || '';
  const fullName = asText(payload.full_name) || (owner && name ? `${owner}/${name}` : '');
  if (!owner || !name || !fullName) {
    return null;
  }
  return {
    owner,
    name,
    fullName,
    htmlUrl: asText(payload.html_url) || undefined,
    cloneUrl: asText(payload.clone_url) || undefined,
    defaultBranch: asText(payload.default_branch) || resolveDefaultBranch(),
  } satisfies ManagedDeploymentRepository;
}

async function getRepository(token: string, owner: string, name: string) {
  const payload = await githubRequest<GithubRepoResponse>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
    allowNotFound: true,
  });
  return mapRepository(payload, owner, name);
}

function parseRepositoryFullName(repositoryFullName: string) {
  const normalized = asText(repositoryFullName);
  const [owner, name] = normalized.split('/');
  if (!owner || !name) {
    throw new Error('GitHub 仓库标识无效');
  }
  return {
    owner,
    name,
  };
}

function hasGithubAppDeploymentConfig() {
  return Boolean(
    asText(process.env.GITHUB_DEPLOYMENT_APP_ID) &&
      asText(process.env.GITHUB_DEPLOYMENT_INSTALLATION_ID) &&
      asText(process.env.GITHUB_DEPLOYMENT_APP_PRIVATE_KEY)
  );
}

function createGithubAppJwt(appId: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId,
    })
  );
  const signingInput = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .end()
    .sign(privateKey, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${signingInput}.${signature}`;
}

async function createGithubInstallationToken() {
  const appId = requireEnv('GITHUB_DEPLOYMENT_APP_ID');
  const installationId = requireEnv('GITHUB_DEPLOYMENT_INSTALLATION_ID');
  const owner = requireEnv('GITHUB_DEPLOYMENT_OWNER');
  const privateKey = normalizeGithubAppPrivateKey(requireEnv('GITHUB_DEPLOYMENT_APP_PRIVATE_KEY'));
  const jwt = createGithubAppJwt(appId, privateKey);
  const payload = await githubRequest<{
    token?: string;
  }>(jwt, `/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
    method: 'POST',
    headers: {
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const token = asText(payload?.token);
  if (!token) {
    throw new Error('GitHub App installation token 获取失败');
  }
  return {
    token,
    owner,
  } satisfies GithubDeploymentAuth;
}

async function getGithubDeploymentAuth(): Promise<GithubDeploymentAuth> {
  if (!hasGithubAppDeploymentConfig()) {
    throw new Error('GitHub App 部署配置未完成，缺少 GITHUB_DEPLOYMENT_APP_* 环境变量');
  }
  return createGithubInstallationToken();
}

async function getRepositoryBranch(
  token: string,
  owner: string,
  name: string,
  branch: string
) {
  return githubRequest<GithubBranchResponse>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches/${encodeURIComponent(branch)}`,
    {
      allowNotFound: true,
    }
  );
}

async function initializeRepositoryBranch(
  token: string,
  owner: string,
  name: string,
  branch: string
) {
  await githubRequest(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/README.md`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message: 'chore: initialize managed deployment repository',
        branch,
        content: Buffer.from(
          '# OneCEO Managed Deployment Repository\n\nThis repository is managed by the OneCEO deployment pipeline.\n',
          'utf-8'
        ).toString('base64'),
      }),
    }
  );
}

async function ensureRepositoryBranchReady(token: string, repository: ManagedDeploymentRepository) {
  const branch = asText(repository.defaultBranch) || resolveDefaultBranch();
  const existingBranch = await getRepositoryBranch(token, repository.owner, repository.name, branch);
  if (asText(existingBranch?.name)) {
    return repository;
  }
  await initializeRepositoryBranch(token, repository.owner, repository.name, branch);
  return {
    ...repository,
    defaultBranch: branch,
  } satisfies ManagedDeploymentRepository;
}

async function createRepository(
  token: string,
  owner: string,
  userId: string,
  projectKey = 'default'
) {
  const name = buildRepoName(userId, projectKey);
  const branch = resolveDefaultBranch();
  const body = JSON.stringify({
    name,
    private: true,
    auto_init: false,
    description: `OneCEO managed deployment repository for ${userId}`,
  });

  try {
    const payload = await githubRequest<GithubRepoResponse>(token, `/orgs/${encodeURIComponent(owner)}/repos`, {
      method: 'POST',
      body,
    });
    const mapped = mapRepository(payload, owner, name);
    if (!mapped) {
      throw new Error('GitHub 仓库创建响应无效');
    }
    return {
      ...mapped,
      defaultBranch: mapped.defaultBranch || branch,
    } satisfies ManagedDeploymentRepository;
  } catch (error: any) {
    const message = asText(error?.message);
    if (!message.toLowerCase().includes('already exists')) {
      throw error;
    }
    const existing = await getRepository(token, owner, name);
    if (!existing) {
      throw error;
    }
    return existing;
  }
}

async function removeIgnoredEntries(root: string): Promise<void> {
  const ignoredNames = new Set([
    '.git',
    '.gitmodules',
    '.opencode',
    'node_modules',
    '.cache',
    '.pnpm-store',
    '.idea',
    '.vscode',
    '.DS_Store',
  ]);

  const entries = await readdir(root, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const targetPath = join(root, entry.name);
      if (ignoredNames.has(entry.name)) {
        await rm(targetPath, { recursive: true, force: true });
        return;
      }
      if (!entry.isDirectory()) {
        return;
      }
      await removeIgnoredEntries(targetPath);
    })
  );
}

async function ensureNonEmptyDirectory(root: string) {
  const entries = await readdir(root);
  const visible = entries.filter((item) => item !== '.DS_Store');
  if (visible.length === 0) {
    throw new Error('当前会话工作区为空，无法部署');
  }
}

async function runGit(args: string[], cwd: string) {
  try {
    await execFile('git', args, {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_HTTP_VERSION: 'HTTP/1.1',
      },
    });
  } catch (error: any) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
    throw new Error(stderr || stdout || `git ${args[0]} 执行失败`);
  }
}

export async function ensureManagedDeploymentRepository(
  userId: string,
  projectKey = 'default'
): Promise<ManagedDeploymentRepository> {
  const normalizedUserId = asText(userId);
  if (!normalizedUserId) {
    throw new Error('缺少用户信息，无法准备托管仓库');
  }

  const auth = await getGithubDeploymentAuth();
  const token = auth.token;
  const owner = auth.owner;
  const name = buildRepoName(normalizedUserId, projectKey);
  const existing = await getRepository(token, owner, name);
  if (existing) {
    return ensureRepositoryBranchReady(token, existing);
  }
  const created = await createRepository(
    token,
    owner,
    normalizedUserId,
    projectKey
  );
  return ensureRepositoryBranchReady(token, created);
}

export async function pushDirectoryToManagedRepository(
  repository: ManagedDeploymentRepository,
  sourceDir: string,
  options?: {
    commitMessage?: string;
  }
): Promise<{ branch: string }> {
  const { token } = await getGithubDeploymentAuth();
  const branch = asText(repository.defaultBranch) || resolveDefaultBranch();
  const gitUserName = asText(process.env.GITHUB_DEPLOYMENT_COMMIT_NAME) || 'OneCEO Deploy Bot';
  const gitUserEmail = asText(process.env.GITHUB_DEPLOYMENT_COMMIT_EMAIL) || 'deploy-bot@oneceo.ai';
  const remoteUrl = `https://x-access-token:${encodeURIComponent(token)}@github.com/${repository.fullName}.git`;
  const gitDir = sourceDir;

  try {
    await removeIgnoredEntries(gitDir);
    await ensureNonEmptyDirectory(gitDir);
    await runGit(['init'], gitDir);
    await runGit(['checkout', '-B', branch], gitDir);
    await runGit(['config', 'user.name', gitUserName], gitDir);
    await runGit(['config', 'user.email', gitUserEmail], gitDir);
    await runGit(['add', '-A'], gitDir);
    await runGit(['commit', '--allow-empty', '-m', options?.commitMessage || 'chore: sync deployment source'], gitDir);
    await runGit(['remote', 'add', 'origin', remoteUrl], gitDir);
    await runGit(['push', '--force', 'origin', `HEAD:${branch}`], gitDir);
    return { branch };
  } finally {
    await rm(join(gitDir, '.git'), { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function deleteManagedDeploymentRepository(repositoryFullName: string): Promise<boolean> {
  const normalized = asText(repositoryFullName);
  if (!normalized) {
    return false;
  }

  const { token } = await getGithubDeploymentAuth();
  const { owner, name } = parseRepositoryFullName(normalized);
  const existing = await getRepository(token, owner, name);
  if (!existing) {
    return false;
  }

  await githubRequest(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    {
      method: 'DELETE',
    }
  );
  return true;
}

export const __testing = {
  normalizeGithubAppPrivateKey,
  hasGithubAppDeploymentConfig,
};
