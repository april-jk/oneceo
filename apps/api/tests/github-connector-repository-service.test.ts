import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { githubConnectorRepositoryService } from '../src/services/github-connector-repository-service';
import { userConnectorService } from '../src/services/user-connector-service';
import { composioConnectorService } from '../src/services/composio-connector-service';

afterEach(() => {
  mock.reset();
});

test('listRepositories reads GitHub repositories from Composio session metadata', async () => {
  mock.method(userConnectorService, 'getProfileMaterial', async () => ({
    profileId: 'profile-github',
    connectorKey: 'github',
    profileName: 'GitHub Default',
    authMode: 'oauth',
    authStatus: 'authorized',
    configJson: {},
    metadataJson: {
      provider: 'composio',
      composioSessionId: 'trs_github_1',
      composioConnectedAccountId: 'ca_github_1',
    },
    secret: {
      source: 'composio',
      composioMcpUrl: 'https://composio.example.com/github/mcp',
    },
  }) as any);
  mock.method(composioConnectorService, 'getToolkitConnectionSummary', async () => ({
    connected: true,
    repositoryNames: ['octocat/hello-world', 'acme/platform'],
  }) as any);

  const repositories = await githubConnectorRepositoryService.listRepositories(
    'user-1',
    'profile-github'
  );

  assert.deepEqual(
    repositories.map((item) => item.fullName),
    ['octocat/hello-world', 'acme/platform']
  );
  assert.equal(repositories[0]?.owner, 'octocat');
  assert.equal(repositories[0]?.name, 'hello-world');
});

test('listRepositories falls back to stored GitHub repository names when Composio lookup fails', async () => {
  mock.method(userConnectorService, 'getProfileMaterial', async () => ({
    profileId: 'profile-github',
    connectorKey: 'github',
    profileName: 'GitHub Default',
    authMode: 'oauth',
    authStatus: 'authorized',
    configJson: {
      repositories: ['fallback-org/fallback-repo'],
    },
    metadataJson: {
      provider: 'composio',
      composioSessionId: 'trs_github_2',
      composioRepositoryNames: ['octocat/hello-world'],
    },
    secret: {
      source: 'composio',
      composioMcpUrl: 'https://composio.example.com/github/mcp',
    },
  }) as any);
  mock.method(composioConnectorService, 'getToolkitConnectionSummary', async () => {
    throw new Error('session lookup failed');
  });

  const repositories = await githubConnectorRepositoryService.listRepositories(
    'user-1',
    'profile-github'
  );

  assert.deepEqual(repositories.map((item) => item.fullName), ['octocat/hello-world']);
});

test('listRepositories falls back to live Composio MCP repository listing when session metadata is empty', async () => {
  mock.method(userConnectorService, 'getProfileMaterial', async () => ({
    profileId: 'profile-github',
    connectorKey: 'github',
    profileName: 'GitHub Default',
    authMode: 'oauth',
    authStatus: 'authorized',
    configJson: {},
    metadataJson: {
      provider: 'composio',
      composioSessionId: 'trs_github_empty',
      composioConnectedAccountId: 'ca_github_1',
      composioRepositoryNames: [],
    },
    secret: {
      source: 'composio',
      composioMcpUrl: 'https://composio.example.com/github/mcp',
    },
  }) as any);
  mock.method(composioConnectorService, 'getToolkitConnectionSummary', async () => ({
    connected: true,
    repositoryNames: [],
  }) as any);
  const executeRpcMock = mock.method(composioConnectorService, 'executeRpc', async (input: any) => {
    if (input?.params?.name === 'github__COMPOSIO_SEARCH_TOOLS') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              data: {
                session: {
                  id: 'session-live-repos',
                },
              },
            }),
          },
        ],
      } as any;
    }
    if (input?.params?.name === 'github__COMPOSIO_MULTI_EXECUTE_TOOL') {
      const page = input?.params?.arguments?.tools?.[0]?.arguments?.page;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              data: {
                results: [
                  {
                    response: {
                      data: {
                        repositories:
                          page === 1
                            ? [
                                {
                                  id: 1,
                                  full_name: 'octocat/hello-world',
                                  name: 'hello-world',
                                  owner: { login: 'octocat' },
                                  private: false,
                                  default_branch: 'main',
                                  permissions: { pull: true },
                                },
                              ]
                            : [],
                      },
                    },
                  },
                ],
              },
            }),
          },
        ],
      } as any;
    }
    throw new Error(`unexpected tool call: ${input?.params?.name}`);
  });

  const repositories = await githubConnectorRepositoryService.listRepositories(
    'user-1',
    'profile-github'
  );

  assert.deepEqual(repositories.map((item) => item.fullName), ['octocat/hello-world']);
  assert.equal(executeRpcMock.mock.callCount(), 2);
});
