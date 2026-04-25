import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { taskSessionConnectorBindingDAO } from '../src/db/dao';
import { userConnectorService } from '../src/services/user-connector-service';
import { vercelMcpService } from '../src/services/vercel-mcp-service';
import { vercelRestClient, VercelApiError } from '../src/services/vercel-rest-client';
import { vercelTokenRefreshService } from '../src/services/vercel-token-refresh-service';

const originalFetch = global.fetch;

afterEach(() => {
  mock.reset();
  global.fetch = originalFetch;
});

test('vercel mcp service exposes v1 tool catalog', () => {
  const tools = vercelMcpService.listTools();
  assert.ok(tools.find((tool) => tool.name === 'vercel_get_auth_context'));
  assert.ok(tools.find((tool) => tool.name === 'vercel_list_teams'));
  assert.ok(tools.find((tool) => tool.name === 'vercel_list_projects'));
  assert.ok(tools.find((tool) => tool.name === 'vercel_create_project'));
  assert.ok(tools.find((tool) => tool.name === 'vercel_update_project'));
  assert.ok(tools.find((tool) => tool.name === 'vercel_delete_project'));
  assert.ok(tools.find((tool) => tool.name === 'vercel_create_deployment'));
  assert.ok(tools.find((tool) => tool.name === 'vercel_create_project_from_git'));
  assert.ok(tools.find((tool) => tool.name === 'vercel_update_project_git_repository'));
  assert.ok(tools.find((tool) => tool.name === 'vercel_get_project_git_repository'));
  assert.ok(tools.find((tool) => tool.name === 'vercel_upsert_env_var'));
  assert.equal(tools.filter((tool) => tool.name === 'vercel_get_project').length, 1);
});

test('vercel mcp service reports non-sensitive auth context', async () => {
  process.env.VERCEL_INTEGRATION_SLUG = 'oneceo';
  mock.method(taskSessionConnectorBindingDAO, 'getByTaskSessionAndConnectorKey', async () => ({
    desiredState: 'attached',
    profileId: 'profile-vercel',
  }) as any);
  mock.method(userConnectorService, 'getProfileMaterial', async () => ({
    profileId: 'profile-vercel',
    connectorKey: 'vercel',
    authStatus: 'authorized',
    configJson: {
      vercelAuthMode: 'integration',
      teamId: 'team_123',
      configurationId: 'icfg_123',
      installationSource: 'external',
    },
    secret: {
      source: 'vercel_integration',
      accessToken: 'token',
    },
  }) as any);

  const result = await vercelMcpService.callTool(
    {
      connectorKey: 'vercel',
      taskSessionId: 'task-1',
      userId: 'user-1',
      profileId: 'profile-vercel',
    },
    'vercel_get_auth_context',
    {}
  );

  assert.deepEqual(result, {
    authMode: 'integration',
    hasAccessToken: true,
    teamId: 'team_123',
    configurationId: 'icfg_123',
    installationSource: 'external',
    integrationSlug: 'oneceo',
  });
});

test('vercel mcp service uses profile default project context for reads', async () => {
  mock.method(taskSessionConnectorBindingDAO, 'getByTaskSessionAndConnectorKey', async () => ({
    desiredState: 'attached',
    profileId: 'profile-vercel',
  }) as any);
  mock.method(userConnectorService, 'getProfileMaterial', async () => ({
    profileId: 'profile-vercel',
    connectorKey: 'vercel',
    authStatus: 'authorized',
    configJson: {
      teamId: 'team_default',
      projectId: 'prj_default',
    },
    secret: {
      accessToken: 'token',
    },
  }) as any);

  let capturedProjectIdOrName = '';
  let capturedTeamId = '';
  mock.method(vercelRestClient, 'listEnvVars', async (context: any, projectIdOrName: string) => {
    capturedProjectIdOrName = projectIdOrName;
    capturedTeamId = context.teamId;
    return { envs: [] } as any;
  });

  const result = await vercelMcpService.callTool(
    {
      connectorKey: 'vercel',
      taskSessionId: 'task-1',
      userId: 'user-1',
      profileId: 'profile-vercel',
    },
    'vercel_list_env_vars',
    {}
  );

  assert.equal(capturedProjectIdOrName, 'prj_default');
  assert.equal(capturedTeamId, 'team_default');
  assert.deepEqual(result, { envs: [] });
});

test('vercel rest client refreshes token and retries once after 401', async () => {
  mock.method(vercelTokenRefreshService, 'getActiveAccessToken', async () => 'expired-token');
  let refreshCalls = 0;
  mock.method(vercelTokenRefreshService, 'refreshAccessToken', async () => {
    refreshCalls += 1;
    return 'fresh-token';
  });

  let fetchCount = 0;
  global.fetch = mock.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    fetchCount += 1;
    if (fetchCount === 1) {
      assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, 'Bearer expired-token');
      return new Response(JSON.stringify({ error: { message: 'token expired' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, 'Bearer fresh-token');
    return new Response(JSON.stringify({ projects: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const result = await vercelRestClient.listProjects({
    userId: 'user-1',
    profileId: 'profile-1',
    taskSessionId: 'task-1',
    teamId: 'team-1',
  });

  assert.equal(refreshCalls, 1);
  assert.equal(fetchCount, 2);
  assert.deepEqual(result, { projects: [] });
});

test('vercel mcp service creates projects through rest client', async () => {
  mock.method(taskSessionConnectorBindingDAO, 'getByTaskSessionAndConnectorKey', async () => ({
    desiredState: 'attached',
    profileId: 'profile-vercel',
  }) as any);
  mock.method(userConnectorService, 'getProfileMaterial', async () => ({
    profileId: 'profile-vercel',
    connectorKey: 'vercel',
    authStatus: 'authorized',
    configJson: {
      teamId: 'team_default',
    },
    secret: {
      accessToken: 'token',
    },
  }) as any);

  let capturedTeamId = '';
  let capturedBody: Record<string, unknown> = {};
  mock.method(vercelRestClient, 'createProject', async (context: any, body: Record<string, unknown>) => {
    capturedTeamId = context.teamId;
    capturedBody = body;
    return { id: 'prj_created', name: body.name } as any;
  });

  const result = await vercelMcpService.callTool(
    {
      connectorKey: 'vercel',
      taskSessionId: 'task-1',
      userId: 'user-1',
      profileId: 'profile-vercel',
    },
    'vercel_create_project',
    {
      name: 'oneceo-vercel-mcp-smoke-test',
      framework: 'vite',
      outputDirectory: 'dist',
      directoryListing: false,
    }
  );

  assert.equal(capturedTeamId, 'team_default');
  assert.deepEqual(capturedBody, {
    name: 'oneceo-vercel-mcp-smoke-test',
    framework: 'vite',
    outputDirectory: 'dist',
    directoryListing: false,
  });
  assert.deepEqual(result, {
    id: 'prj_created',
    name: 'oneceo-vercel-mcp-smoke-test',
  });
});

test('vercel mcp service creates projects from explicit git repositories', async () => {
  mock.method(taskSessionConnectorBindingDAO, 'getByTaskSessionAndConnectorKey', async () => ({
    desiredState: 'attached',
    profileId: 'profile-vercel',
  }) as any);
  mock.method(userConnectorService, 'getProfileMaterial', async () => ({
    profileId: 'profile-vercel',
    connectorKey: 'vercel',
    authStatus: 'authorized',
    configJson: {
      teamId: 'team_default',
    },
    secret: {
      accessToken: 'token',
    },
  }) as any);

  let capturedBody: Record<string, unknown> = {};
  mock.method(vercelRestClient, 'createProject', async (_context: any, body: Record<string, unknown>) => {
    capturedBody = body;
    return { id: 'prj_git', name: body.name } as any;
  });

  const result = await vercelMcpService.callTool(
    {
      connectorKey: 'vercel',
      taskSessionId: 'task-1',
      userId: 'user-1',
      profileId: 'profile-vercel',
    },
    'vercel_create_project_from_git',
    {
      name: 'oneceo-git-project',
      gitRepository: {
        type: 'github',
        repo: 'oneceo/app',
        repoId: '123456',
      },
      framework: 'vite',
      outputDirectory: 'dist',
    }
  );

  assert.deepEqual(capturedBody, {
    name: 'oneceo-git-project',
    framework: 'vite',
    outputDirectory: 'dist',
    gitRepository: {
      type: 'github',
      repo: 'oneceo/app',
      repoId: '123456',
    },
  });
  assert.deepEqual(result, { id: 'prj_git', name: 'oneceo-git-project' });
});

test('vercel mcp service blocks git project creation without repository', async () => {
  mock.method(taskSessionConnectorBindingDAO, 'getByTaskSessionAndConnectorKey', async () => ({
    desiredState: 'attached',
    profileId: 'profile-vercel',
  }) as any);
  mock.method(userConnectorService, 'getProfileMaterial', async () => ({
    profileId: 'profile-vercel',
    connectorKey: 'vercel',
    authStatus: 'authorized',
    configJson: {},
    secret: {
      accessToken: 'token',
    },
  }) as any);
  mock.method(vercelRestClient, 'createProject', async () => {
    throw new VercelApiError('should not reach rest client', 500, {});
  });

  await assert.rejects(
    () =>
      vercelMcpService.callTool(
        {
          connectorKey: 'vercel',
          taskSessionId: 'task-1',
          userId: 'user-1',
          profileId: 'profile-vercel',
        },
        'vercel_create_project_from_git',
        {
          name: 'oneceo-git-project',
        }
      ),
    /gitRepository/
  );
});

test('vercel mcp service blocks project deletes without explicit confirmation', async () => {
  mock.method(taskSessionConnectorBindingDAO, 'getByTaskSessionAndConnectorKey', async () => ({
    desiredState: 'attached',
    profileId: 'profile-vercel',
  }) as any);
  mock.method(userConnectorService, 'getProfileMaterial', async () => ({
    profileId: 'profile-vercel',
    connectorKey: 'vercel',
    authStatus: 'authorized',
    configJson: {
      projectId: 'prj_default',
    },
    secret: {
      accessToken: 'token',
    },
  }) as any);
  mock.method(vercelRestClient, 'deleteProject', async () => {
    throw new VercelApiError('should not reach rest client', 500, {});
  });

  await assert.rejects(
    () =>
      vercelMcpService.callTool(
        {
          connectorKey: 'vercel',
          taskSessionId: 'task-1',
          userId: 'user-1',
          profileId: 'profile-vercel',
        },
        'vercel_delete_project',
        {
          projectIdOrName: 'oneceo-vercel-mcp-smoke-test',
        }
      ),
    /confirm/
  );

  await assert.rejects(
    () =>
      vercelMcpService.callTool(
        {
          connectorKey: 'vercel',
          taskSessionId: 'task-1',
          userId: 'user-1',
          profileId: 'profile-vercel',
        },
        'vercel_delete_project',
        {
          confirm: true,
        }
      ),
    /projectId/
  );
});

test('vercel rest client maps project lifecycle methods to official endpoints', async () => {
  mock.method(vercelTokenRefreshService, 'getActiveAccessToken', async () => 'access-token');

  const requests: Array<{
    method?: string;
    url: string;
    body?: string | null;
  }> = [];

  global.fetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      method: init?.method,
      url: String(input),
      body: typeof init?.body === 'string' ? init.body : null,
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const context = {
    userId: 'user-1',
    profileId: 'profile-1',
    taskSessionId: 'task-1',
    teamId: 'team-1',
  };

  await vercelRestClient.createProject(context, {
    name: 'oneceo-vercel-mcp-smoke-test',
  });
  await vercelRestClient.listTeams(context, {
    limit: 20,
  });
  await vercelRestClient.createDeployment(context, {
    name: 'oneceo-vercel-mcp-smoke-test',
    gitSource: {
      type: 'github',
      repoId: '123456',
      ref: 'main',
    },
  }, {
    forceNew: '1',
  });
  await vercelRestClient.updateProject(context, 'oneceo-vercel-mcp-smoke-test', {
    framework: 'vite',
  });
  await vercelRestClient.deleteProject(context, 'oneceo-vercel-mcp-smoke-test');

  assert.equal(requests[0]?.method, 'POST');
  assert.equal(requests[0]?.url, 'https://api.vercel.com/v11/projects?teamId=team-1');
  assert.deepEqual(JSON.parse(requests[0]?.body || '{}'), {
    name: 'oneceo-vercel-mcp-smoke-test',
  });

  assert.equal(requests[1]?.method, 'GET');
  assert.equal(requests[1]?.url, 'https://api.vercel.com/v2/teams?limit=20');
  assert.equal(requests[1]?.body, null);

  assert.equal(requests[2]?.method, 'POST');
  assert.equal(requests[2]?.url, 'https://api.vercel.com/v13/deployments?teamId=team-1&forceNew=1');
  assert.deepEqual(JSON.parse(requests[2]?.body || '{}'), {
    name: 'oneceo-vercel-mcp-smoke-test',
    gitSource: {
      type: 'github',
      repoId: '123456',
      ref: 'main',
    },
  });

  assert.equal(requests[3]?.method, 'PATCH');
  assert.equal(
    requests[3]?.url,
    'https://api.vercel.com/v9/projects/oneceo-vercel-mcp-smoke-test?teamId=team-1'
  );
  assert.deepEqual(JSON.parse(requests[3]?.body || '{}'), {
    framework: 'vite',
  });

  assert.equal(requests[4]?.method, 'DELETE');
  assert.equal(
    requests[4]?.url,
    'https://api.vercel.com/v9/projects/oneceo-vercel-mcp-smoke-test?teamId=team-1'
  );
  assert.equal(requests[4]?.body, null);
});

test('vercel mcp service creates git deployments and blocks files uploads', async () => {
  mock.method(taskSessionConnectorBindingDAO, 'getByTaskSessionAndConnectorKey', async () => ({
    desiredState: 'attached',
    profileId: 'profile-vercel',
  }) as any);
  mock.method(userConnectorService, 'getProfileMaterial', async () => ({
    profileId: 'profile-vercel',
    connectorKey: 'vercel',
    authStatus: 'authorized',
    configJson: {
      teamId: 'team_default',
    },
    secret: {
      accessToken: 'token',
    },
  }) as any);

  let capturedBody: Record<string, unknown> = {};
  let capturedQuery: Record<string, unknown> = {};
  mock.method(
    vercelRestClient,
    'createDeployment',
    async (_context: any, body: Record<string, unknown>, query: Record<string, unknown>) => {
      capturedBody = body;
      capturedQuery = query;
      return { id: 'dpl_123' } as any;
    }
  );

  await assert.rejects(
    () =>
      vercelMcpService.callTool(
        {
          connectorKey: 'vercel',
          taskSessionId: 'task-1',
          userId: 'user-1',
          profileId: 'profile-vercel',
        },
        'vercel_create_deployment',
        {
          files: [],
        }
      ),
    /files/
  );

  const result = await vercelMcpService.callTool(
    {
      connectorKey: 'vercel',
      taskSessionId: 'task-1',
      userId: 'user-1',
      profileId: 'profile-vercel',
    },
    'vercel_create_deployment',
    {
      name: 'oneceo-git-deploy',
      project: 'oneceo-git-project',
      target: 'preview',
      gitSource: {
        type: 'github',
        repoId: '123456',
        ref: 'main',
      },
      projectSettings: {
        framework: 'vite',
        outputDirectory: 'dist',
      },
      forceNew: true,
    }
  );

  assert.deepEqual(capturedBody, {
    gitSource: {
      type: 'github',
      repoId: '123456',
      ref: 'main',
    },
    name: 'oneceo-git-deploy',
    project: 'oneceo-git-project',
    target: 'preview',
    projectSettings: {
      framework: 'vite',
      outputDirectory: 'dist',
    },
  });
  assert.deepEqual(capturedQuery, { forceNew: '1' });
  assert.deepEqual(result, { id: 'dpl_123' });
});

test('vercel mcp service updates only git repository fields with explicit project', async () => {
  mock.method(taskSessionConnectorBindingDAO, 'getByTaskSessionAndConnectorKey', async () => ({
    desiredState: 'attached',
    profileId: 'profile-vercel',
  }) as any);
  mock.method(userConnectorService, 'getProfileMaterial', async () => ({
    profileId: 'profile-vercel',
    connectorKey: 'vercel',
    authStatus: 'authorized',
    configJson: {
      projectId: 'prj_default',
    },
    secret: {
      accessToken: 'token',
    },
  }) as any);

  let capturedProjectIdOrName = '';
  let capturedBody: Record<string, unknown> = {};
  mock.method(
    vercelRestClient,
    'updateProject',
    async (_context: any, projectIdOrName: string, body: Record<string, unknown>) => {
      capturedProjectIdOrName = projectIdOrName;
      capturedBody = body;
      return { id: projectIdOrName } as any;
    }
  );

  await assert.rejects(
    () =>
      vercelMcpService.callTool(
        {
          connectorKey: 'vercel',
          taskSessionId: 'task-1',
          userId: 'user-1',
          profileId: 'profile-vercel',
        },
        'vercel_update_project_git_repository',
        {
          gitRepository: {
            type: 'github',
            repo: 'oneceo/app',
          },
        }
      ),
    /projectId/
  );

  const result = await vercelMcpService.callTool(
    {
      connectorKey: 'vercel',
      taskSessionId: 'task-1',
      userId: 'user-1',
      profileId: 'profile-vercel',
    },
    'vercel_update_project_git_repository',
    {
      projectIdOrName: 'prj_explicit',
      gitRepository: {
        type: 'github',
        repo: 'oneceo/app',
      },
      gitLFS: false,
      gitForkProtection: true,
      framework: 'vite',
    }
  );

  assert.equal(capturedProjectIdOrName, 'prj_explicit');
  assert.deepEqual(capturedBody, {
    gitRepository: {
      type: 'github',
      repo: 'oneceo/app',
    },
    gitLFS: false,
    gitForkProtection: true,
  });
  assert.deepEqual(result, { id: 'prj_explicit' });
});

test('vercel mcp service extracts git repository context from project details', async () => {
  mock.method(taskSessionConnectorBindingDAO, 'getByTaskSessionAndConnectorKey', async () => ({
    desiredState: 'attached',
    profileId: 'profile-vercel',
  }) as any);
  mock.method(userConnectorService, 'getProfileMaterial', async () => ({
    profileId: 'profile-vercel',
    connectorKey: 'vercel',
    authStatus: 'authorized',
    configJson: {},
    secret: {
      accessToken: 'token',
    },
  }) as any);
  mock.method(vercelRestClient, 'getProject', async () => ({
    id: 'prj_123',
    name: 'oneceo-app',
    link: {
      type: 'github',
      repo: 'oneceo/app',
    },
    gitRepository: {
      type: 'github',
      repo: 'oneceo/app',
    },
    gitProviderOptions: {
      createDeployments: 'enabled',
    },
    gitLFS: false,
    gitForkProtection: true,
    framework: 'vite',
  }) as any);

  const result = await vercelMcpService.callTool(
    {
      connectorKey: 'vercel',
      taskSessionId: 'task-1',
      userId: 'user-1',
      profileId: 'profile-vercel',
    },
    'vercel_get_project_git_repository',
    {
      projectIdOrName: 'prj_123',
    }
  );

  assert.deepEqual(result, {
    id: 'prj_123',
    name: 'oneceo-app',
    link: {
      type: 'github',
      repo: 'oneceo/app',
    },
    gitRepository: {
      type: 'github',
      repo: 'oneceo/app',
    },
    gitProviderOptions: {
      createDeployments: 'enabled',
    },
    gitLFS: false,
    gitForkProtection: true,
  });
});

test('vercel mcp service blocks env var writes without explicit target', async () => {
  mock.method(taskSessionConnectorBindingDAO, 'getByTaskSessionAndConnectorKey', async () => ({
    desiredState: 'attached',
    profileId: 'profile-vercel',
  }) as any);
  mock.method(userConnectorService, 'getProfileMaterial', async () => ({
    profileId: 'profile-vercel',
    connectorKey: 'vercel',
    authStatus: 'authorized',
    configJson: {
      projectId: 'prj_default',
    },
    secret: {
      accessToken: 'token',
    },
  }) as any);
  mock.method(vercelRestClient, 'upsertEnvVar', async () => {
    throw new VercelApiError('should not reach rest client', 500, {});
  });

  await assert.rejects(
    () =>
      vercelMcpService.callTool(
        {
          connectorKey: 'vercel',
          taskSessionId: 'task-1',
          userId: 'user-1',
          profileId: 'profile-vercel',
        },
        'vercel_upsert_env_var',
        {
          key: 'API_URL',
          value: 'https://example.com',
        }
      ),
    /target/
  );
});
