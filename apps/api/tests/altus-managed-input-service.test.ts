import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { taskSessionRunDAO } from '../src/db/dao';
import { e2bConnector } from '../src/connectors/e2b-connector';
import { AltusManagedInputService } from '../src/services/altus-managed-input-service';
import { userSkillService } from '../src/services/user-skill-service';

afterEach(() => {
  mock.reset();
});

test('submit uploads attachments, persists context metadata, and starts managed run', async () => {
  mock.method(taskSessionRunDAO, 'findActiveRun', async () => null);
  mock.method(userSkillService, 'listAvailableSkills', async () => [
    {
      sourceType: 'platform',
      skillId: 'skill-1',
      revisionId: 'rev-1',
      slug: 'ppt-workflow',
      name: 'PPT 工作流',
      description: 'PPT 子任务编排',
      category: 'office',
      revisionNumber: 3,
      resourceSummary: {
        totalCount: 2,
        referenceCount: 1,
        templateCount: 1,
        paths: ['references/subtask-contracts.md', 'templates/render-instruction-draft.md'],
      },
    },
  ] as any);
  mock.method(userSkillService, 'resolveSelectionsForSession', async () => [
    {
      sourceType: 'platform',
      skillId: 'skill-1',
      revisionId: 'rev-1',
      slug: 'ppt-workflow',
      name: 'PPT 工作流',
      description: 'PPT 子任务编排',
      category: 'office',
      renderedMarkdown: '# ppt-workflow',
      revisionNumber: 3,
      resourceSummary: {
        totalCount: 2,
        referenceCount: 1,
        templateCount: 1,
        paths: ['references/subtask-contracts.md', 'templates/render-instruction-draft.md'],
      },
    },
  ] as any);
  const mkdirMock = mock.method(e2bConnector, 'runCommand', async () => ({
    stdout: '',
    stderr: '',
    exitCode: 0,
  }) as any);
  const writeFileMock = mock.method(e2bConnector, 'writeFile', async () => undefined);
  const touchMock = mock.fn(async () => undefined);

  const setupService = {
    ensureSessionOwnership: mock.fn(async () => undefined),
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      reused: false,
    })),
  };
  const runService = {
    startRun: mock.fn(async (_sessionId: string, _userId: string, input: any) => ({
      id: 'run-1',
      sessionId: 'session-1',
      status: 'queued',
      input,
    })),
  };

  const service = new AltusManagedInputService(setupService as any, runService as any, touchMock as any);
  const result = await service.submit('user-1', {
    sessionId: 'session-1',
    content: '请根据附件继续处理',
    messageKey: 'msg-1',
    metadata: {
      source: 'chat',
      skills: [{ sourceType: 'platform', skillId: 'skill-1', revisionId: 'rev-1' }],
    },
    files: [
      {
        name: 'spec.md',
        mimeType: 'text/markdown',
        size: 16,
        buffer: Buffer.from('# Hello attachment'),
      },
    ],
  });

  assert.equal(result.sessionId, 'session-1');
  assert.equal(setupService.ensureSessionOwnership.mock.callCount(), 1);
  assert.equal(setupService.ensureSandbox.mock.callCount(), 1);
  assert.equal(mkdirMock.mock.callCount(), 1);
  assert.equal(writeFileMock.mock.callCount(), 1);
  assert.equal(touchMock.mock.callCount(), 1);

  const writeCall = writeFileMock.mock.calls[0];
  assert.match(String(writeCall?.arguments[1]), /^\/workspace\/session-1\/uploads\//);

  const startRunCall = runService.startRun.mock.calls[0];
  assert.equal(startRunCall?.arguments[0], 'session-1');
  assert.equal(startRunCall?.arguments[1], 'user-1');
  assert.match(String(startRunCall?.arguments[2]?.content), /\[Attached: spec\.md -> uploads\//);
  assert.equal(startRunCall?.arguments[2]?.metadata?.source, 'chat');
  assert.equal(startRunCall?.arguments[2]?.metadata?.managedSkillCatalog?.length, 1);
  assert.equal(startRunCall?.arguments[2]?.metadata?.managedSkillContext?.length, 1);
  assert.equal(startRunCall?.arguments[2]?.metadata?.attachments?.length, 1);
  assert.equal(startRunCall?.arguments[2]?.metadata?.attachmentContext?.length, 1);
  assert.match(
    String(startRunCall?.arguments[2]?.metadata?.attachmentContext?.[0]?.excerpt),
    /# Hello attachment/
  );
});

test('submit uploads image attachments to managed image bucket and persists external object keys', async () => {
  mock.method(taskSessionRunDAO, 'findActiveRun', async () => null);
  mock.method(userSkillService, 'listAvailableSkills', async () => []);
  mock.method(userSkillService, 'resolveSelectionsForSession', async () => []);
  mock.method(e2bConnector, 'runCommand', async () => ({
    stdout: '',
    stderr: '',
    exitCode: 0,
  }) as any);
  mock.method(e2bConnector, 'writeFile', async () => undefined);
  const touchMock = mock.fn(async () => undefined);

  const setupService = {
    ensureSessionOwnership: mock.fn(async () => undefined),
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      reused: false,
    })),
  };
  const runService = {
    startRun: mock.fn(async (_sessionId: string, _userId: string, input: any) => ({
      id: 'run-1',
      sessionId: 'session-1',
      status: 'queued',
      input,
    })),
  };
  const imageObjectService = {
    buildObjectKey: mock.fn(() => 'managed-images/session-1/msg-1/1710000000-screenshot.png'),
    uploadImage: mock.fn(async () => undefined),
  };

  const service = new AltusManagedInputService(
    setupService as any,
    runService as any,
    touchMock as any,
    imageObjectService as any
  );
  await service.submit('user-1', {
    sessionId: 'session-1',
    content: '看看这个图讲了什么',
    messageKey: 'msg-1',
    files: [
      {
        name: 'screenshot.png',
        mimeType: 'image/png',
        size: 9,
        buffer: Buffer.from('png-bytes'),
      },
    ],
  });

  assert.equal(imageObjectService.buildObjectKey.mock.callCount(), 1);
  assert.equal(imageObjectService.uploadImage.mock.callCount(), 1);

  const startRunCall = runService.startRun.mock.calls[0];
  assert.equal(startRunCall?.arguments[2]?.messageKey, 'msg-1');
  assert.equal(
    startRunCall?.arguments[2]?.metadata?.attachments?.[0]?.externalObjectKey,
    'managed-images/session-1/msg-1/1710000000-screenshot.png'
  );
});

test('submit text-only managed input starts run without waiting for sandbox bootstrap', async () => {
  mock.method(taskSessionRunDAO, 'findActiveRun', async () => null);
  mock.method(userSkillService, 'listAvailableSkills', async () => [
    {
      sourceType: 'platform',
      skillId: 'skill-1',
      revisionId: 'rev-1',
      slug: 'ppt-workflow',
      name: 'PPT 工作流',
      description: 'PPT 子任务编排',
      category: 'office',
      revisionNumber: 3,
      resourceSummary: {
        totalCount: 1,
        referenceCount: 1,
        templateCount: 0,
        paths: ['references/subtask-contracts.md'],
      },
    },
  ] as any);
  mock.method(userSkillService, 'resolveSelectionsForSession', async () => [
    {
      sourceType: 'platform',
      skillId: 'skill-1',
      revisionId: 'rev-1',
      slug: 'ppt-workflow',
      name: 'PPT 工作流',
      description: 'PPT 子任务编排',
      category: 'office',
      renderedMarkdown: '# ppt-workflow',
      revisionNumber: 3,
      resourceSummary: {
        totalCount: 1,
        referenceCount: 1,
        templateCount: 0,
        paths: ['references/subtask-contracts.md'],
      },
    },
  ] as any);
  const touchMock = mock.fn(async () => undefined);

  const setupService = {
    ensureSessionOwnership: mock.fn(async () => undefined),
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      reused: false,
    })),
  };
  const runService = {
    startRun: mock.fn(async (_sessionId: string, _userId: string, input: any) => ({
      id: 'run-1',
      sessionId: 'session-1',
      status: 'queued',
      input,
    })),
  };

  const service = new AltusManagedInputService(setupService as any, runService as any, touchMock as any);
  const result = await service.submit('user-1', {
    sessionId: 'session-1',
    content: '你好',
    messageKey: 'msg-plain',
    metadata: {
      source: 'chat',
      skills: [{ sourceType: 'platform', skillId: 'skill-1', revisionId: 'rev-1' }],
    },
  });

  assert.equal(result.sessionId, 'session-1');
  assert.equal(setupService.ensureSandbox.mock.callCount(), 0);
  assert.equal(touchMock.mock.callCount(), 0);

  const startRunCall = runService.startRun.mock.calls[0];
  assert.equal(startRunCall?.arguments[2]?.content, '你好');
  assert.equal(startRunCall?.arguments[2]?.metadata?.managedSkillCatalog?.length, 1);
  assert.equal(startRunCall?.arguments[2]?.metadata?.managedSkillContext?.length, 1);
});

test('submit accepts empty content when managed mcp confirmation metadata is present', async () => {
  mock.method(taskSessionRunDAO, 'findActiveRun', async () => null);
  mock.method(userSkillService, 'listAvailableSkills', async () => []);
  mock.method(userSkillService, 'resolveSelectionsForSession', async () => []);
  const touchMock = mock.fn(async () => undefined);

  const setupService = {
    ensureSessionOwnership: mock.fn(async () => undefined),
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      reused: false,
    })),
  };
  const runService = {
    startRun: mock.fn(async (_sessionId: string, _userId: string, input: any) => ({
      id: 'run-1',
      sessionId: 'session-1',
      status: 'queued',
      input,
    })),
  };

  const service = new AltusManagedInputService(setupService as any, runService as any, touchMock as any);
  const result = await service.submit('user-1', {
    sessionId: 'session-1',
    content: '',
    messageKey: 'msg-mcp-approve',
    metadata: {
      source: 'mcp_tool_confirmation_approved',
      mcpToolConfirmation: {
        action: 'approve',
        connectorKey: 'google_super',
        confirmationId: 'confirmation-1',
        toolName: 'google_super__COMPOSIO_MULTI_EXECUTE_TOOL',
        confirmationToken: 'token-1',
      },
    },
  });

  assert.equal(result.sessionId, 'session-1');
  assert.equal(setupService.ensureSandbox.mock.callCount(), 0);
  const startRunCall = runService.startRun.mock.calls[0];
  assert.equal(startRunCall?.arguments[2]?.content, '');
  assert.equal(
    startRunCall?.arguments[2]?.metadata?.mcpToolConfirmation?.confirmationId,
    'confirmation-1'
  );
});

test('submit auto-attaches deployment orchestrator skill for deploy requests', async () => {
  mock.method(taskSessionRunDAO, 'findActiveRun', async () => null);
  mock.method(userSkillService, 'listAvailableSkills', async () => [
    {
      sourceType: 'platform',
      skillId: 'deploy-skill-1',
      revisionId: 'deploy-rev-1',
      slug: 'deploy-skill-governed',
      name: '部署编排',
      description: '自动处理部署工作流',
      category: 'deployment',
      revisionNumber: 1,
      governance: {
        systemRole: 'deployment_orchestrator',
        adminManaged: true,
        required: false,
        autoActivation: {
          enabled: true,
          triggers: ['deploy', 'redeploy', 'rollback', 'status'],
        },
      },
      resourceSummary: {
        totalCount: 2,
        referenceCount: 2,
        templateCount: 0,
        paths: ['references/runtime-classifier.md', 'references/deploy-repair-loop.md'],
      },
    },
  ] as any);
  const resolveSelectionsMock = mock.method(
    userSkillService,
    'resolveSelectionsForSession',
    async (_sessionId: string, selections: any) =>
      Array.isArray(selections) && selections.some((item) => item?.skillId === 'deploy-skill-1')
        ? [
            {
              sourceType: 'platform',
              skillId: 'deploy-skill-1',
              revisionId: 'deploy-rev-1',
              slug: 'deploy-skill-governed',
              name: '部署编排',
              description: '自动处理部署工作流',
              category: 'deployment',
              renderedMarkdown: '# deployment-orchestrator',
              revisionNumber: 1,
              governance: {
                systemRole: 'deployment_orchestrator',
                adminManaged: true,
                required: false,
                autoActivation: {
                  enabled: true,
                  triggers: ['deploy', 'redeploy', 'rollback', 'status'],
                },
              },
              resourceSummary: {
                totalCount: 2,
                referenceCount: 2,
                templateCount: 0,
                paths: ['references/runtime-classifier.md', 'references/deploy-repair-loop.md'],
              },
            },
          ]
        : []
  );
  const touchMock = mock.fn(async () => undefined);

  const setupService = {
    ensureSessionOwnership: mock.fn(async () => undefined),
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      reused: false,
    })),
  };
  const runService = {
    startRun: mock.fn(async (_sessionId: string, _userId: string, input: any) => ({
      id: 'run-1',
      sessionId: 'session-1',
      status: 'queued',
      input,
    })),
  };

  const service = new AltusManagedInputService(setupService as any, runService as any, touchMock as any);
  await service.submit('user-1', {
    sessionId: 'session-1',
    content: '帮我部署当前项目',
    messageKey: 'msg-deploy',
    metadata: {
      source: 'chat',
    },
  });

  assert.equal(setupService.ensureSandbox.mock.callCount(), 0);
  assert.equal(touchMock.mock.callCount(), 0);
  assert.equal(resolveSelectionsMock.mock.callCount(), 1);
  assert.deepEqual(resolveSelectionsMock.mock.calls[0]?.arguments[1], [
    {
      sourceType: 'platform',
      skillId: 'deploy-skill-1',
      revisionId: 'deploy-rev-1',
    },
  ]);

  const startRunCall = runService.startRun.mock.calls[0];
  assert.deepEqual(startRunCall?.arguments[2]?.metadata?.skills, [
    {
      sourceType: 'platform',
      skillId: 'deploy-skill-1',
      revisionId: 'deploy-rev-1',
    },
  ]);
  assert.equal(startRunCall?.arguments[2]?.metadata?.managedSkillContext?.[0]?.slug, 'deploy-skill-governed');
});

test('submit does not auto-attach deployment orchestrator skill for non-deploy requests', async () => {
  mock.method(taskSessionRunDAO, 'findActiveRun', async () => null);
  mock.method(userSkillService, 'listAvailableSkills', async () => [
    {
      sourceType: 'platform',
      skillId: 'deploy-skill-1',
      revisionId: 'deploy-rev-1',
      slug: 'deploy-skill-governed',
      name: '部署编排',
      description: '自动处理部署工作流',
      category: 'deployment',
      revisionNumber: 1,
      governance: {
        systemRole: 'deployment_orchestrator',
        adminManaged: true,
        required: false,
        autoActivation: {
          enabled: true,
          triggers: ['deploy', 'redeploy', 'rollback', 'status'],
        },
      },
      resourceSummary: null,
    },
  ] as any);
  const resolveSelectionsMock = mock.method(
    userSkillService,
    'resolveSelectionsForSession',
    async () => []
  );
  const touchMock = mock.fn(async () => undefined);

  const setupService = {
    ensureSessionOwnership: mock.fn(async () => undefined),
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      reused: false,
    })),
  };
  const runService = {
    startRun: mock.fn(async (_sessionId: string, _userId: string, input: any) => ({
      id: 'run-1',
      sessionId: 'session-1',
      status: 'queued',
      input,
    })),
  };

  const service = new AltusManagedInputService(setupService as any, runService as any, touchMock as any);
  await service.submit('user-1', {
    sessionId: 'session-1',
    content: '帮我写个网站',
    messageKey: 'msg-build',
    metadata: {
      source: 'chat',
    },
  });

  assert.deepEqual(resolveSelectionsMock.mock.calls[0]?.arguments[1], []);
  const startRunCall = runService.startRun.mock.calls[0];
  assert.equal(startRunCall?.arguments[2]?.metadata?.skills, undefined);
  assert.equal(startRunCall?.arguments[2]?.metadata?.managedSkillContext, undefined);
});

test('submit does not auto-attach deployment orchestrator skill for negated deploy language', async () => {
  mock.method(taskSessionRunDAO, 'findActiveRun', async () => null);
  mock.method(userSkillService, 'listAvailableSkills', async () => [
    {
      sourceType: 'platform',
      skillId: 'deploy-skill-1',
      revisionId: 'deploy-rev-1',
      slug: 'deploy-skill-governed',
      name: '部署编排',
      description: '自动处理部署工作流',
      category: 'deployment',
      revisionNumber: 1,
      governance: {
        systemRole: 'deployment_orchestrator',
        adminManaged: true,
        required: false,
        autoActivation: {
          enabled: true,
          triggers: ['deploy', 'redeploy', 'rollback', 'status'],
        },
      },
      resourceSummary: null,
    },
  ] as any);
  const resolveSelectionsMock = mock.method(
    userSkillService,
    'resolveSelectionsForSession',
    async () => []
  );
  const touchMock = mock.fn(async () => undefined);

  const setupService = {
    ensureSessionOwnership: mock.fn(async () => undefined),
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      reused: false,
    })),
  };
  const runService = {
    startRun: mock.fn(async (_sessionId: string, _userId: string, input: any) => ({
      id: 'run-1',
      sessionId: 'session-1',
      status: 'queued',
      input,
    })),
  };

  const service = new AltusManagedInputService(setupService as any, runService as any, touchMock as any);
  await service.submit('user-1', {
    sessionId: 'session-1',
    content: '帮我生成一份产品需求文档，不要部署，不要发布，也不要检查部署状态。',
    messageKey: 'msg-doc-no-deploy',
    metadata: {
      source: 'chat',
    },
  });

  assert.deepEqual(resolveSelectionsMock.mock.calls[0]?.arguments[1], []);
  const startRunCall = runService.startRun.mock.calls[0];
  assert.equal(startRunCall?.arguments[2]?.metadata?.skills, undefined);
  assert.equal(startRunCall?.arguments[2]?.metadata?.managedSkillContext, undefined);
});

test('submit does not duplicate deployment orchestrator skill when already explicitly selected', async () => {
  mock.method(taskSessionRunDAO, 'findActiveRun', async () => null);
  mock.method(userSkillService, 'listAvailableSkills', async () => [
    {
      sourceType: 'platform',
      skillId: 'deploy-skill-1',
      revisionId: 'deploy-rev-1',
      slug: 'deploy-skill-governed',
      name: '部署编排',
      description: '自动处理部署工作流',
      category: 'deployment',
      revisionNumber: 1,
      governance: {
        systemRole: 'deployment_orchestrator',
        adminManaged: true,
        required: false,
        autoActivation: {
          enabled: true,
          triggers: ['deploy', 'redeploy', 'rollback', 'status'],
        },
      },
      resourceSummary: null,
    },
  ] as any);
  const resolveSelectionsMock = mock.method(
    userSkillService,
    'resolveSelectionsForSession',
    async (_sessionId: string, selections: any) => selections as any
  );
  const touchMock = mock.fn(async () => undefined);

  const setupService = {
    ensureSessionOwnership: mock.fn(async () => undefined),
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      reused: false,
    })),
  };
  const runService = {
    startRun: mock.fn(async (_sessionId: string, _userId: string, input: any) => ({
      id: 'run-1',
      sessionId: 'session-1',
      status: 'queued',
      input,
    })),
  };

  const service = new AltusManagedInputService(setupService as any, runService as any, touchMock as any);
  await service.submit('user-1', {
    sessionId: 'session-1',
    content: '帮我部署当前项目',
    messageKey: 'msg-deploy-explicit',
    metadata: {
      source: 'chat',
      skills: [
        {
          sourceType: 'platform',
          skillId: 'deploy-skill-1',
          revisionId: 'deploy-rev-1',
        },
      ],
    },
  });

  assert.deepEqual(resolveSelectionsMock.mock.calls[0]?.arguments[1], [
    {
      sourceType: 'platform',
      skillId: 'deploy-skill-1',
      revisionId: 'deploy-rev-1',
    },
  ]);
});
