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
  assert.ok(tools.find((tool) => tool.name === 'vercel_list_projects'));
  assert.ok(tools.find((tool) => tool.name === 'vercel_upsert_env_var'));
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
