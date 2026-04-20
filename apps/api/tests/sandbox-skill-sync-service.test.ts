import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { e2bConnector } from '../src/connectors/e2b-connector';
import { sandboxExecutionEnvironmentDAO, taskSessionRunDAO } from '../src/db/dao';
import { platformSkillService } from '../src/services/platform-skill-service';
import { sandboxSkillSyncService } from '../src/services/sandbox-skill-sync-service';

afterEach(() => {
  mock.reset();
});

test('syncResolvedSkillResource writes one markdown resource into the selected skill directory', async () => {
  mock.method(taskSessionRunDAO, 'getSandboxBindingBySession', async () => ({
    id: 'binding-1',
    sessionId: 'session-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    status: 'ready',
    metadataJson: {},
    updatedAt: new Date('2026-03-29T00:00:00.000Z'),
    lastActiveAt: new Date('2026-03-29T00:00:00.000Z'),
  }) as any);
  mock.method(sandboxExecutionEnvironmentDAO, 'getBySessionId', async () => ({
    sessionId: 'sandbox-1',
    metadata: {
      taskSessionId: 'session-1',
      opencodeBaseUrl: 'https://sandbox.example.com',
      opencodeWorkspaceRoot: '/workspace/session-1',
      opencodeStateRoot: '/state/session-1',
      osacEndpoint: 'http://sandbox.example.com/ws',
      osacAuthToken: 'token-1',
    },
  }) as any);
  mock.method(sandboxExecutionEnvironmentDAO, 'updateMetadata', async () => ({} as any));
  mock.method(platformSkillService, 'getRevisionResource', async () => ({
    resource: {
      id: 'res-1',
      resourcePath: 'references/slide-structure-guide.md',
      resourceType: 'reference',
      contentMarkdown: '# Ref Body',
      createdAt: '2026-03-29T00:00:00.000Z',
    },
  }) as any);
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async () => ({
    stdout: '',
    stderr: '',
    exitCode: 0,
  }) as any);
  const writeFileMock = mock.method(e2bConnector, 'writeFile', async () => undefined);

  const result = await sandboxSkillSyncService.syncResolvedSkillResource({
    taskSessionId: 'session-1',
    orchestratorSessionId: 'sandbox-1',
    skill: {
      sourceType: 'platform',
      skillId: 'skill-1',
      revisionId: 'rev-1',
      slug: 'office-ppt',
      name: 'PPT 办公',
      description: '创建专业演示文稿',
      category: 'office',
      renderedMarkdown: '# Skill Brief',
      revisionNumber: 3,
      resourceSummary: {
        totalCount: 1,
        referenceCount: 1,
        templateCount: 0,
        paths: ['references/slide-structure-guide.md'],
      },
    },
    resourcePath: 'references/slide-structure-guide.md',
  });

  assert.equal(runCommandMock.mock.callCount(), 1);
  assert.equal(writeFileMock.mock.callCount(), 1);
  assert.match(
    String(writeFileMock.mock.calls[0]?.arguments[1]),
    /skills\/platform\/office-ppt\/references\/slide-structure-guide\.md$/
  );
  assert.equal(result.resourceType, 'reference');
  assert.match(result.skillResourcePath, /skills\/platform\/office-ppt\/references\/slide-structure-guide\.md$/);
});
