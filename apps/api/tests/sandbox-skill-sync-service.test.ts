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
      resourcePath: 'references/subtask-contracts.md',
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
      slug: 'ppt-workflow',
      name: 'PPT 工作流',
      description: 'PPT 子任务编排',
      category: 'office',
      renderedMarkdown: '# Skill Brief',
      revisionNumber: 3,
      resourceSummary: {
        totalCount: 1,
        referenceCount: 1,
        templateCount: 0,
        paths: ['references/subtask-contracts.md'],
      },
    },
    resourcePath: 'references/subtask-contracts.md',
  });

  assert.equal(runCommandMock.mock.callCount(), 1);
  assert.equal(writeFileMock.mock.callCount(), 1);
  assert.match(
    String(writeFileMock.mock.calls[0]?.arguments[1]),
    /skills\/platform\/ppt-workflow\/references\/subtask-contracts\.md$/
  );
  assert.equal(result.resourceType, 'reference');
  assert.equal(result.contentMarkdown, '# Ref Body');
  assert.match(result.skillResourcePath, /skills\/platform\/ppt-workflow\/references\/subtask-contracts\.md$/);
});

test('syncResolvedSkillResource writes ppt workflow template resource into skill directory', async () => {
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
      id: 'res-ppt-workflow-template',
      resourcePath: 'templates/render-instruction-draft.md',
      resourceType: 'template',
      contentMarkdown: '# PptRenderInstructionDraft Template',
      createdAt: '2026-05-01T17:18:00.000Z',
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
      skillId: 'skill-ppt-workflow',
      revisionId: 'rev-ppt-workflow',
      slug: 'ppt-workflow',
      name: 'PPT 工作流',
      description: 'PPT 子任务编排',
      category: 'office',
      renderedMarkdown: '# Skill Brief: PPT 子任务编排工作流',
      revisionNumber: 1,
      resourceSummary: {
        totalCount: 4,
        referenceCount: 3,
        templateCount: 1,
        paths: [
          'references/subtask-contracts.md',
          'references/visual-plan-guide.md',
          'references/preflight-checklist.md',
          'templates/render-instruction-draft.md',
        ],
      },
    },
    resourcePath: 'templates/render-instruction-draft.md',
  });

  assert.equal(runCommandMock.mock.callCount(), 1);
  assert.equal(writeFileMock.mock.callCount(), 1);
  assert.match(
    String(writeFileMock.mock.calls[0]?.arguments[1]),
    /skills\/platform\/ppt-workflow\/templates\/render-instruction-draft\.md$/
  );
  assert.equal(result.resourceType, 'template');
  assert.equal(result.contentMarkdown, '# PptRenderInstructionDraft Template');
  assert.match(result.skillResourcePath, /skills\/platform\/ppt-workflow\/templates\/render-instruction-draft\.md$/);
});
