import { createHash } from 'node:crypto';
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

function buildRepoName(userId: string) {
  const prefix = asText(process.env.GITHUB_DEPLOYMENT_REPO_PREFIX) || 'oneceo-deploy';
  const normalized = sanitizeUserSegment(userId).slice(0, 48);
  const hash = createHash('sha1').update(userId).digest('hex').slice(0, 8);
  return `${prefix}-${normalized}-${hash}`.slice(0, 96);
}

function resolveDefaultBranch() {
  return asText(process.env.GITHUB_DEPLOYMENT_BRANCH) || 'main';
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

async function resolveGithubLogin(token: string) {
  const payload = await githubRequest<{ login?: string }>(token, '/user');
  const login = asText(payload?.login);
  if (!login) {
    throw new Error('无法获取 GitHub 账号信息');
  }
  return login;
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

async function createRepository(token: string, owner: string, actorLogin: string, userId: string) {
  const name = buildRepoName(userId);
  const branch = resolveDefaultBranch();
  const body = JSON.stringify({
    name,
    private: true,
    auto_init: false,
    description: `OneCEO managed deployment repository for ${userId}`,
  });

  try {
    const payload = owner && owner !== actorLogin
      ? await githubRequest<GithubRepoResponse>(token, `/orgs/${encodeURIComponent(owner)}/repos`, {
          method: 'POST',
          body,
        })
      : await githubRequest<GithubRepoResponse>(token, '/user/repos', {
          method: 'POST',
          body,
        });
    const mapped = mapRepository(payload, owner || actorLogin, name);
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
    const existing = await getRepository(token, owner || actorLogin, name);
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

export async function ensureManagedDeploymentRepository(userId: string): Promise<ManagedDeploymentRepository> {
  const normalizedUserId = asText(userId);
  if (!normalizedUserId) {
    throw new Error('缺少用户信息，无法准备托管仓库');
  }

  const token = requireEnv('GITHUB_DEPLOYMENT_TOKEN');
  const actorLogin = await resolveGithubLogin(token);
  const owner = asText(process.env.GITHUB_DEPLOYMENT_OWNER) || actorLogin;
  const name = buildRepoName(normalizedUserId);
  const existing = await getRepository(token, owner, name);
  if (existing) {
    return existing;
  }
  return createRepository(token, owner, actorLogin, normalizedUserId);
}

export async function pushDirectoryToManagedRepository(
  repository: ManagedDeploymentRepository,
  sourceDir: string,
  options?: {
    commitMessage?: string;
  }
): Promise<{ branch: string }> {
  const token = requireEnv('GITHUB_DEPLOYMENT_TOKEN');
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
