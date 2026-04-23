import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { taskSessionRunDAO } from '../src/db/dao';
import { altusMemoryContextService } from '../src/services/altus-memory-context-service';
import { AltusManagedRunEntryService } from '../src/services/altus-managed-run-entry-service';
import { taskSessionAltusMemoryService } from '../src/services/task-session-altus-memory-service';
import { taskSessionSkillStateService } from '../src/services/task-session-skill-state-service';
import { userSkillService } from '../src/services/user-skill-service';

afterEach(() => {
  mock.reset();
});

test('startRun persists timeline, creates run, and dispatches coordinator execution', async () => {
  const run = {
    id: 'run-1',
    sessionId: 'session-1',
    status: 'queued',
    model: 'altus-model',
    stopReason: null,
    startedAt: null,
    completedAt: null,
    updatedAt: new Date('2026-03-24T04:00:00.000Z'),
  };

  mock.method(taskCreationFileMemoryStore, 'getSession', async () => ({
    id: 'session-1',
    title: 'Build game',
    pendingQuestion: null,
  }) as any);
  mock.method(altusMemoryContextService, 'buildPromptSectionForRun', async () => ({
    promptSection: '## Altus Memory Context\n- 用户偏好：专业、冷静',
    userMemory: {
      preferredName: 'Watson',
      responsePreferences: '专业、冷静',
    },
    projectMemory: {
      context: '这是一个 2048 游戏项目',
      guidelines: '保持可直接运行',
    },
    sessionMemory: {
      version: 2,
      summary: {
        goal: '实现 2048 小游戏',
        latestOutcome: '尚未开始',
        openQuestions: [],
      },
      constraints: ['使用现有技术栈'],
      decisions: [],
      workingNotes: [],
      updatedAt: '2026-04-21T16:00:00.000Z',
    },
  }));
  mock.method(taskSessionAltusMemoryService, 'getSessionAltusMemory', async () => ({
    version: 2,
    summary: {
      goal: '实现 2048 小游戏',
      latestOutcome: '尚未开始',
      openQuestions: [],
    },
    constraints: ['使用现有技术栈'],
    decisions: [],
    workingNotes: [],
    updatedAt: '2026-04-21T16:00:00.000Z',
  }));
  mock.method(taskSessionRunDAO, 'findActiveRun', async () => null);
  mock.method(taskSessionRunDAO, 'getLatestRun', async () => null);
  mock.method(userSkillService, 'listAvailableSkills', async () => [
    {
      sourceType: 'platform',
      skillId: 'skill-1',
      revisionId: 'rev-1',
      slug: 'office-ppt',
      name: 'PPT 办公',
      description: '创建专业演示文稿',
      category: 'office',
      revisionNumber: 2,
      resourceSummary: {
        totalCount: 2,
        referenceCount: 1,
        templateCount: 1,
        paths: ['references/slide-structure-guide.md', 'templates/business-deck-outline.md'],
      },
    },
  ] as any);
  mock.method(taskSessionSkillStateService, 'prepareRunState', async () => ({
    skillCatalog: [
      {
        sourceType: 'platform',
        skillId: 'skill-1',
        revisionId: 'rev-1',
        slug: 'office-ppt',
        name: 'PPT 办公',
        description: '创建专业演示文稿',
        category: 'office',
        revisionNumber: 2,
        resourceSummary: {
          totalCount: 2,
          referenceCount: 1,
          templateCount: 1,
          paths: ['references/slide-structure-guide.md', 'templates/business-deck-outline.md'],
        },
      },
    ],
    skills: [
      {
        sourceType: 'platform',
        skillId: 'skill-1',
        revisionId: 'rev-1',
        slug: 'office-ppt',
        name: 'PPT 办公',
        description: '创建专业演示文稿',
        category: 'office',
        renderedMarkdown: '# Skill Brief',
        revisionNumber: 2,
        resourceSummary: {
          totalCount: 2,
          referenceCount: 1,
          templateCount: 1,
          paths: ['references/slide-structure-guide.md', 'templates/business-deck-outline.md'],
        },
      },
    ],
    activeSkillsForTurn: [
      {
        sourceType: 'platform',
        skillId: 'skill-1',
        revisionId: 'rev-1',
        slug: 'office-ppt',
        name: 'PPT 办公',
        description: '创建专业演示文稿',
        category: 'office',
        renderedMarkdown: '# Skill Brief',
        revisionNumber: 2,
        resourceSummary: {
          totalCount: 2,
          referenceCount: 1,
          templateCount: 1,
          paths: ['references/slide-structure-guide.md', 'templates/business-deck-outline.md'],
        },
      },
    ],
    residentSkillSelections: [],
    sessionSkillState: null,
    residentSelectionsForSync: [],
  }) as any);
  const createRunMock = mock.method(taskSessionRunDAO, 'createRun', async (input: any) => ({
    ...run,
    connectorSnapshotId: input.connectorSnapshotId,
    mcpToolSnapshotId: input.mcpToolSnapshotId,
    metadataJson: input.metadataJson,
  }));

  const setupCalls: Record<string, unknown>[] = [];
  const setupService = {
    ensureSessionOwnership: mock.fn(async () => {}),
    buildTaskIntentProfile: mock.fn(async () => ({
      mode: 'neutral',
      reason: 'unknown',
      recentUserMessages: [],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: false,
      deployRequested: false,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: false,
      needsClarification: false,
      clarificationQuestion: '',
    })),
    captureConnectorSnapshot: mock.fn(async () => ({
      snapshotId: 'snapshot-1',
      statuses: [{ connectorKey: 'github', authStatus: 'authorized' }],
    })),
    captureMcpToolSnapshot: mock.fn(async () => ({
      snapshotId: 'mcp-snapshot-1',
      providers: [
        {
          providerId: 'provider-1',
          tools: [{ providerId: 'provider-1', toolName: 'github_search' }],
        },
      ],
    })),
    buildTaskIntentProfile: mock.fn(async () => ({
      mode: 'neutral',
      reason: 'unknown',
      recentUserMessages: [],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: false,
      deployRequested: false,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: false,
      needsClarification: false,
      clarificationQuestion: '',
    })),
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      setupCalls.push({ type: 'timeline', input });
    }),
    updateSessionLifecycle: mock.fn(async (sessionId: string, input: Record<string, unknown>) => {
      setupCalls.push({ type: 'lifecycle', sessionId, input });
    }),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (...args: unknown[]) => {
      setupCalls.push({ type: 'event', args });
      return { sequence: 1, payload: {} };
    }),
    toSummary: mock.fn(async (value: any) => ({
      id: value.id,
      sessionId: value.sessionId,
      status: value.status,
      model: value.model,
      streamUrl: `/api/altus-managed/runs/${value.id}/stream`,
      sequence: 1,
    })),
  };

  let capturedState: any = null;
  let capturedAbortController: AbortController | null = null;
  const coordinator = {
    execute: mock.fn(async (state: any, abortController: AbortController) => {
      capturedState = state;
      capturedAbortController = abortController;
    }),
  };
  const recoveryService = {
    reconcileLatestRun: mock.fn(async () => null),
    buildRecoverySnapshot: mock.fn(async () => ({
      model: 'altus-model',
      status: 'queued',
      sequence: 1,
      sandbox: {
        sandboxId: null,
        workspaceRoot: null,
        reused: false,
        updatedAt: null,
      },
      connectorRuntime: {
        providerIds: [],
        updatedAt: null,
      },
      stream: {
        latestSequence: 1,
        latestEventType: null,
      },
    })),
  };
  const redisStateService = {
    registerRun: mock.fn(async () => {}),
    setRecoverySnapshot: mock.fn(async () => {}),
    touchHeartbeat: mock.fn(async () => {}),
  };

  const service = new AltusManagedRunEntryService(
    setupService as any,
    eventWriter as any,
    {} as any,
    coordinator as any,
    redisStateService as any,
    recoveryService as any
  );

  const summary = await service.startRun('session-1', 'user-1', {
    content: '帮我开发 2048 小游戏',
    messageKey: 'msg-1',
    metadata: {
      source: 'chat',
      managedSkillCatalog: [
        {
          sourceType: 'platform',
          skillId: 'skill-1',
          revisionId: 'rev-1',
          slug: 'office-ppt',
          name: 'PPT 办公',
          description: '创建专业演示文稿',
          category: 'office',
          revisionNumber: 2,
          resourceSummary: {
            totalCount: 2,
            referenceCount: 1,
            templateCount: 1,
            paths: ['references/slide-structure-guide.md', 'templates/business-deck-outline.md'],
          },
        },
      ],
      managedSkillContext: [
        {
          sourceType: 'platform',
          skillId: 'skill-1',
          revisionId: 'rev-1',
          slug: 'office-ppt',
          name: 'PPT 办公',
          description: '创建专业演示文稿',
          category: 'office',
          renderedMarkdown: '# Skill Brief',
          revisionNumber: 2,
          resourceSummary: {
            totalCount: 2,
            referenceCount: 1,
            templateCount: 1,
            paths: ['references/slide-structure-guide.md', 'templates/business-deck-outline.md'],
          },
        },
      ],
    },
  });

  assert.equal(summary?.id, 'run-1');
  assert.equal(createRunMock.mock.callCount(), 1);
  assert.equal((createRunMock.mock.calls[0]?.arguments[0] as any).connectorSnapshotId, 'snapshot-1');
  assert.equal((createRunMock.mock.calls[0]?.arguments[0] as any).mcpToolSnapshotId, 'mcp-snapshot-1');

  const timelineCall = setupCalls.find((entry) => entry.type === 'timeline') as any;
  assert.equal(timelineCall.input.messageType, 'user_input');
  assert.equal(timelineCall.input.content, '帮我开发 2048 小游戏');
  assert.equal(timelineCall.input.messageKey, 'msg-1');
  assert.equal(timelineCall.input.metadata.runId, 'run-1');

  const lifecycleCall = setupCalls.find((entry) => entry.type === 'lifecycle') as any;
  assert.equal(lifecycleCall.sessionId, 'session-1');
  assert.equal(lifecycleCall.input.stage, 'executing');
  assert.equal(lifecycleCall.input.phase, 'analysis');

  const eventCall = setupCalls.find((entry) => entry.type === 'event') as any;
  assert.equal(eventCall.args[0], 'run-1');
  assert.equal(eventCall.args[2], 'user-1');
  assert.equal(eventCall.args[3], 'run_ack');
  assert.equal(eventCall.args[4].sourceMessageKey, 'msg-1');
  assert.equal(eventCall.args[4].messageKey, 'managed:run-1:run_ack');
  assert.notEqual(eventCall.args[4].messageKey, 'msg-1');

  assert.equal(capturedState?.input.runId, 'run-1');
  assert.equal(capturedState?.input.sessionId, 'session-1');
  assert.equal(capturedState?.input.sessionTitle, 'Build game');
  assert.deepEqual(capturedState?.input.connectors, [{ connectorKey: 'github', authStatus: 'authorized' }]);
  assert.deepEqual(capturedState?.input.mcpProviders, [
    {
      providerId: 'provider-1',
      tools: [{ providerId: 'provider-1', toolName: 'github_search' }],
    },
  ]);
  assert.equal(capturedState?.input.skillCatalog?.length, 1);
  assert.equal(capturedState?.input.skills?.length, 1);
  assert.equal(capturedState?.input.skillCatalog?.[0]?.slug, 'office-ppt');
  assert.equal(capturedState?.input.skills?.[0]?.resourceSummary?.totalCount, 2);
  assert.match(capturedState?.input.memoryContextPrompt || '', /Altus Memory Context/);
  assert.equal(capturedState?.input.userMemory?.preferredName, 'Watson');
  assert.equal(capturedState?.input.projectMemory?.context, '这是一个 2048 游戏项目');
  assert.equal(capturedState?.input.sessionAltusMemory?.summary?.goal, '实现 2048 小游戏');
  assert.ok(capturedAbortController instanceof AbortController);
});

test('startRun does not pre-mark session executing when the first turn must clarify', async () => {
  const run = {
    id: 'run-clarify-1',
    sessionId: 'session-clarify-1',
    status: 'queued',
    model: 'altus-model',
    stopReason: null,
    startedAt: null,
    completedAt: null,
    updatedAt: new Date('2026-03-24T04:00:00.000Z'),
  };

  mock.method(taskCreationFileMemoryStore, 'getSession', async () => ({
    id: 'session-clarify-1',
    title: 'Clarify first',
    pendingQuestion: null,
  }) as any);
  mock.method(altusMemoryContextService, 'buildPromptSectionForRun', async () => ({
    promptSection: '',
    userMemory: null,
    projectMemory: null,
    sessionMemory: await taskSessionAltusMemoryService.getSessionAltusMemory('session-clarify-1'),
  }));
  mock.method(taskSessionAltusMemoryService, 'getSessionAltusMemory', async () => ({
    version: 0,
    summary: {
      goal: '',
      latestOutcome: '',
      openQuestions: [],
    },
    constraints: [],
    decisions: [],
    workingNotes: [],
    updatedAt: '2026-04-21T16:00:00.000Z',
  }));
  mock.method(taskSessionRunDAO, 'findActiveRun', async () => null);
  mock.method(taskSessionRunDAO, 'getLatestRun', async () => null);
  mock.method(taskSessionRunDAO, 'createRun', async () => run as any);
  mock.method(userSkillService, 'listAvailableSkills', async () => [] as any);
  mock.method(taskSessionSkillStateService, 'prepareRunState', async () => ({
    skillCatalog: [],
    skills: [],
    activeSkillsForTurn: [],
    residentSkillSelections: [],
    sessionSkillState: null,
    residentSelectionsForSync: [],
  }) as any);

  const setupCalls: Record<string, unknown>[] = [];
  const setupService = {
    ensureSessionOwnership: mock.fn(async () => {}),
    buildTaskIntentProfile: mock.fn(async () => ({
      mode: 'neutral',
      reason: 'unknown',
      recentUserMessages: ['帮我做一个企业管理系统。'],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: false,
      deployRequested: false,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: false,
      needsClarification: true,
      clarificationQuestion: '请先确认这个系统的主要使用角色、必须包含的核心模块，以及本次是只要源码、本地运行，还是需要部署上线？',
    })),
    captureConnectorSnapshot: mock.fn(async () => ({
      snapshotId: 'snapshot-clarify-1',
      statuses: [],
    })),
    captureMcpToolSnapshot: mock.fn(async () => ({
      snapshotId: 'mcp-snapshot-clarify-1',
      providers: [],
    })),
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      setupCalls.push({ type: 'timeline', input });
    }),
    updateSessionLifecycle: mock.fn(async (sessionId: string, input: Record<string, unknown>) => {
      setupCalls.push({ type: 'lifecycle', sessionId, input });
    }),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (...args: unknown[]) => {
      setupCalls.push({ type: 'event', args });
      return { sequence: 1, payload: {} };
    }),
    toSummary: mock.fn(async (value: any) => ({
      id: value.id,
      sessionId: value.sessionId,
      status: value.status,
      model: value.model,
      streamUrl: `/api/altus-managed/runs/${value.id}/stream`,
      sequence: 1,
    })),
  };

  let capturedState: any = null;
  const coordinator = {
    execute: mock.fn(async (state: any) => {
      capturedState = state;
    }),
  };
  const recoveryService = {
    reconcileLatestRun: mock.fn(async () => null),
    buildRecoverySnapshot: mock.fn(async () => ({
      model: 'altus-model',
      status: 'queued',
      sequence: 1,
      sandbox: {
        sandboxId: null,
        workspaceRoot: null,
        reused: false,
        updatedAt: null,
      },
      connectorRuntime: {
        providerIds: [],
        updatedAt: null,
      },
      stream: {
        latestSequence: 1,
        latestEventType: null,
      },
    })),
  };
  const redisStateService = {
    registerRun: mock.fn(async () => {}),
    setRecoverySnapshot: mock.fn(async () => {}),
    touchHeartbeat: mock.fn(async () => {}),
  };

  const service = new AltusManagedRunEntryService(
    setupService as any,
    eventWriter as any,
    {} as any,
    coordinator as any,
    redisStateService as any,
    recoveryService as any
  );

  const summary = await service.startRun('session-clarify-1', 'user-clarify-1', {
    content: '帮我做一个企业管理系统。',
  });

  assert.equal(summary?.id, 'run-clarify-1');
  assert.equal(capturedState?.input.messageType, 'user_input');
  assert.equal(capturedState?.input.taskIntentProfile?.needsClarification, true);
  assert.equal(
    setupCalls.filter((entry) => entry.type === 'lifecycle').length,
    0,
  );
});

test('startRun keeps user_response out of executing lifecycle when clarification remains unresolved', async () => {
  const run = {
    id: 'run-clarify-response-1',
    sessionId: 'session-clarify-response-1',
    status: 'queued',
    model: 'altus-model',
    stopReason: null,
    startedAt: null,
    completedAt: null,
    updatedAt: new Date('2026-03-24T04:00:00.000Z'),
  };

  mock.method(taskCreationFileMemoryStore, 'getSession', async () => ({
    id: 'session-clarify-response-1',
    title: 'Clarify response',
    pendingQuestion: '这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？',
    pendingOptions: ['网页应用', '后端 API', '本地脚本', '完整业务系统'],
    pendingClarificationType: 'artifact_type',
  }) as any);
  mock.method(altusMemoryContextService, 'buildPromptSectionForRun', async () => ({
    promptSection: '',
    userMemory: null,
    projectMemory: null,
    sessionMemory: await taskSessionAltusMemoryService.getSessionAltusMemory('session-clarify-response-1'),
  }));
  mock.method(taskSessionAltusMemoryService, 'getSessionAltusMemory', async () => ({
    version: 0,
    summary: {
      goal: '',
      latestOutcome: '',
      openQuestions: [],
    },
    constraints: [],
    decisions: [],
    workingNotes: [],
    updatedAt: '2026-04-21T16:00:00.000Z',
  }));
  mock.method(taskSessionRunDAO, 'findActiveRun', async () => null);
  mock.method(taskSessionRunDAO, 'getLatestRun', async () => null);
  mock.method(taskSessionRunDAO, 'createRun', async () => run as any);
  mock.method(userSkillService, 'listAvailableSkills', async () => [] as any);
  mock.method(taskSessionSkillStateService, 'prepareRunState', async () => ({
    skillCatalog: [],
    skills: [],
    activeSkillsForTurn: [],
    residentSkillSelections: [],
    sessionSkillState: null,
    residentSelectionsForSync: [],
  }) as any);

  const setupCalls: Record<string, unknown>[] = [];
  const setupService = {
    ensureSessionOwnership: mock.fn(async () => {}),
    buildTaskIntentProfile: mock.fn(async () => ({
      mode: 'neutral',
      reason: 'unknown',
      recentUserMessages: ['帮我做一个企业管理系统。', '先按你觉得合适的方式做'],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: false,
      deployRequested: false,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: false,
      needsClarification: true,
      clarificationQuestion: '我还需要先确认这一点：这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？',
      clarificationType: 'artifact_type',
      clarificationOptions: ['网页应用', '后端 API', '本地脚本', '完整业务系统'],
      todoRequired: false,
      todoReason: 'none',
    })),
    captureConnectorSnapshot: mock.fn(async () => ({
      snapshotId: 'snapshot-clarify-response-1',
      statuses: [],
    })),
    captureMcpToolSnapshot: mock.fn(async () => ({
      snapshotId: 'mcp-snapshot-clarify-response-1',
      providers: [],
    })),
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      setupCalls.push({ type: 'timeline', input });
    }),
    updateSessionLifecycle: mock.fn(async (sessionId: string, input: Record<string, unknown>) => {
      setupCalls.push({ type: 'lifecycle', sessionId, input });
    }),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (...args: unknown[]) => {
      setupCalls.push({ type: 'event', args });
      return { sequence: 1, payload: {} };
    }),
    toSummary: mock.fn(async (value: any) => ({
      id: value.id,
      sessionId: value.sessionId,
      status: value.status,
      model: value.model,
      streamUrl: `/api/altus-managed/runs/${value.id}/stream`,
      sequence: 1,
    })),
  };

  let capturedState: any = null;
  const coordinator = {
    execute: mock.fn(async (state: any) => {
      capturedState = state;
    }),
  };
  const recoveryService = {
    reconcileLatestRun: mock.fn(async () => null),
    buildRecoverySnapshot: mock.fn(async () => ({
      model: 'altus-model',
      status: 'queued',
      sequence: 1,
      sandbox: {
        sandboxId: null,
        workspaceRoot: null,
        reused: false,
        updatedAt: null,
      },
      connectorRuntime: {
        providerIds: [],
        updatedAt: null,
      },
      stream: {
        latestSequence: 1,
        latestEventType: null,
      },
    })),
  };
  const redisStateService = {
    registerRun: mock.fn(async () => {}),
    setRecoverySnapshot: mock.fn(async () => {}),
    touchHeartbeat: mock.fn(async () => {}),
  };

  const service = new AltusManagedRunEntryService(
    setupService as any,
    eventWriter as any,
    {} as any,
    coordinator as any,
    redisStateService as any,
    recoveryService as any
  );

  await service.startRun('session-clarify-response-1', 'user-clarify-response-1', {
    content: '先按你觉得合适的方式做',
  });

  assert.equal(capturedState?.input.messageType, 'user_response');
  assert.equal(capturedState?.input.taskIntentProfile?.clarificationType, 'artifact_type');
  assert.equal(
    setupCalls.filter((entry) => entry.type === 'lifecycle').length,
    0,
  );
});

test('stopRun aborts active controller for in-flight run', async () => {
  const run = {
    id: 'run-2',
    sessionId: 'session-2',
    status: 'running',
    model: 'altus-model',
    stopReason: null,
    startedAt: new Date('2026-03-24T04:00:00.000Z'),
    completedAt: null,
    updatedAt: new Date('2026-03-24T04:00:00.000Z'),
  };

  mock.method(taskCreationFileMemoryStore, 'getSession', async () => ({
    id: 'session-2',
    title: 'Active task',
    pendingQuestion: null,
  }) as any);
  mock.method(taskSessionRunDAO, 'findActiveRun', async () => null);
  mock.method(taskSessionRunDAO, 'getLatestRun', async () => null);
  mock.method(userSkillService, 'listAvailableSkills', async () => [] as any);
  mock.method(altusMemoryContextService, 'buildPromptSectionForRun', async () => ({
    promptSection: '',
    userMemory: null,
    projectMemory: null,
    sessionMemory: await taskSessionAltusMemoryService.getSessionAltusMemory('session-2'),
  }));
  mock.method(taskSessionAltusMemoryService, 'getSessionAltusMemory', async () => ({
    version: 0,
    summary: {
      goal: '',
      latestOutcome: '',
      openQuestions: [],
    },
    constraints: [],
    decisions: [],
    workingNotes: [],
    updatedAt: '2026-04-21T16:00:00.000Z',
  }));
  mock.method(taskSessionSkillStateService, 'prepareRunState', async () => ({
    skillCatalog: [],
    skills: [],
    activeSkillsForTurn: [],
    residentSkillSelections: [],
    sessionSkillState: null,
    residentSelectionsForSync: [],
  }) as any);
  mock.method(taskSessionRunDAO, 'createRun', async () => run as any);
  mock.method(taskSessionRunDAO, 'getRun', async () => run as any);

  const setupService = {
    ensureSessionOwnership: mock.fn(async () => {}),
    buildTaskIntentProfile: mock.fn(async () => ({
      mode: 'neutral',
      reason: 'unknown',
      recentUserMessages: [],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: false,
      deployRequested: false,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: false,
    })),
    captureConnectorSnapshot: mock.fn(async () => ({
      snapshotId: 'snapshot-2',
      statuses: [],
    })),
    captureMcpToolSnapshot: mock.fn(async () => ({
      snapshotId: 'mcp-snapshot-2',
      providers: [],
    })),
    buildTaskIntentProfile: mock.fn(async () => ({
      mode: 'neutral',
      reason: 'unknown',
      recentUserMessages: [],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: false,
      deployRequested: false,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: false,
    })),
    persistTimelineMessage: mock.fn(async () => {}),
    updateSessionLifecycle: mock.fn(async () => {}),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async () => ({ sequence: 1, payload: {} })),
    toSummary: mock.fn(async (value: any) => ({
      id: value.id,
      sessionId: value.sessionId,
      status: value.status,
      model: value.model,
      streamUrl: `/api/altus-managed/runs/${value.id}/stream`,
      sequence: 1,
    })),
  };

  let capturedAbortController: AbortController | null = null;
  const coordinator = {
    execute: mock.fn((_: any, abortController: AbortController) => {
      capturedAbortController = abortController;
      return new Promise<void>((resolve) => {
        abortController.signal.addEventListener(
          'abort',
          () => {
            resolve();
          },
          { once: true }
        );
      });
    }),
  };
  const recoveryService = {
    reconcileLatestRun: mock.fn(async () => null),
    buildRecoverySnapshot: mock.fn(async () => ({
      model: 'altus-model',
      status: 'queued',
      sequence: 1,
      sandbox: {
        sandboxId: null,
        workspaceRoot: null,
        reused: false,
        updatedAt: null,
      },
      connectorRuntime: {
        providerIds: [],
        updatedAt: null,
      },
      stream: {
        latestSequence: 1,
        latestEventType: null,
      },
    })),
  };
  const redisStateService = {
    registerRun: mock.fn(async () => {}),
    setRecoverySnapshot: mock.fn(async () => {}),
    touchHeartbeat: mock.fn(async () => {}),
    requestStop: mock.fn(async () => {}),
  };

  const service = new AltusManagedRunEntryService(
    setupService as any,
    eventWriter as any,
    {} as any,
    coordinator as any,
    redisStateService as any,
    recoveryService as any
  );

  await service.startRun('session-2', 'user-2', {
    content: '继续处理当前仓库',
  });
  assert.equal(capturedAbortController?.signal.aborted, false);

  const summary = await service.stopRun('run-2', 'user-2', 'user_interrupt');

  assert.equal(summary?.id, 'run-2');
  assert.equal(capturedAbortController?.signal.aborted, true);
});

test('getLatestRun falls back to db summary when recovery reconciliation throws', async () => {
  const run = {
    id: 'run-latest-1',
    sessionId: 'session-latest-1',
    status: 'running',
    model: 'altus-model',
    stopReason: null,
    startedAt: new Date('2026-03-24T04:00:00.000Z'),
    completedAt: null,
    updatedAt: new Date('2026-03-24T04:00:00.000Z'),
  };

  mock.method(taskSessionRunDAO, 'getLatestRun', async () => run as any);

  const setupService = {
    ensureSessionOwnership: mock.fn(async () => {}),
    buildTaskIntentProfile: mock.fn(async () => ({
      mode: 'neutral',
      reason: 'unknown',
      recentUserMessages: [],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: false,
      deployRequested: false,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: false,
    })),
  };

  const eventWriter = {
    toSummary: mock.fn((value: any) => ({
      id: value?.id || null,
      sessionId: value?.sessionId || null,
      status: value?.status || null,
    })),
  };

  const recoveryService = {
    reconcileLatestRun: mock.fn(async () => {
      throw new Error('redis temporarily unavailable');
    }),
  };

  const service = new AltusManagedRunEntryService(
    setupService as any,
    eventWriter as any,
    {} as any,
    {} as any,
    {} as any,
    recoveryService as any
  );

  const summary = await service.getLatestRun('session-latest-1', 'user-latest-1');

  assert.deepEqual(summary, {
    id: 'run-latest-1',
    sessionId: 'session-latest-1',
    status: 'running',
  });
  assert.equal(setupService.ensureSessionOwnership.mock.callCount(), 1);
  assert.equal(recoveryService.reconcileLatestRun.mock.callCount(), 1);
  assert.equal(eventWriter.toSummary.mock.callCount(), 1);
});
