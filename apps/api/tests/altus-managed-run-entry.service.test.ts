import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { taskSessionRunDAO } from '../src/db/dao';
import { altusMemoryContextService } from '../src/services/altus-memory-context-service';
import { AltusManagedRunEntryService } from '../src/services/altus-managed-run-entry-service';
import { membershipService } from '../src/services/membership-service';
import { mcpToolConfirmationService } from '../src/services/mcp-tool-confirmation-service';
import { taskSessionAltusMemoryService } from '../src/services/task-session-altus-memory-service';
import { taskSessionSkillStateService } from '../src/services/task-session-skill-state-service';
import { userSkillService } from '../src/services/user-skill-service';

afterEach(() => {
  mock.reset();
});

function allowMembershipAgentLevels(levels: string[] = ['lite', 'pro', 'max']) {
  return mock.method(membershipService, 'assertUserCanUseAgentLevel', async (_userId: string, level: string) => {
    if (!levels.includes(level)) {
      throw new Error(`当前会员类型仅允许使用 ${levels.map((item) => `agent ${item}`).join('、')}`);
    }
    return {
      level,
      entitlement: {
        membership: { id: 'membership-test' },
        plan: { id: 'plan-test' },
        allowedAgentLevels: levels,
      },
    } as any;
  });
}

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
  const entitlementMock = mock.method(membershipService, 'assertUserCanUseAgentLevel', async () => ({
    level: 'lite',
    entitlement: {
      membership: { id: 'membership-1' },
      plan: { id: 'plan-1' },
      allowedAgentLevels: ['lite'],
    },
  }) as any);
  mock.method(userSkillService, 'listAvailableSkills', async () => [
    {
      sourceType: 'platform',
      skillId: 'skill-1',
      revisionId: 'rev-1',
      slug: 'ppt-workflow',
      name: 'PPT 工作流',
      description: 'PPT 子任务编排',
      category: 'office',
      revisionNumber: 2,
      resourceSummary: {
        totalCount: 2,
        referenceCount: 1,
        templateCount: 1,
        paths: ['references/subtask-contracts.md', 'templates/render-instruction-draft.md'],
      },
    },
  ] as any);
  mock.method(taskSessionSkillStateService, 'prepareRunState', async () => ({
    skillCatalog: [
      {
        sourceType: 'platform',
        skillId: 'skill-1',
        revisionId: 'rev-1',
        slug: 'ppt-workflow',
        name: 'PPT 工作流',
        description: 'PPT 子任务编排',
        category: 'office',
        revisionNumber: 2,
        resourceSummary: {
          totalCount: 2,
          referenceCount: 1,
          templateCount: 1,
          paths: ['references/subtask-contracts.md', 'templates/render-instruction-draft.md'],
        },
      },
    ],
    skills: [
      {
        sourceType: 'platform',
        skillId: 'skill-1',
        revisionId: 'rev-1',
        slug: 'ppt-workflow',
        name: 'PPT 工作流',
        description: 'PPT 子任务编排',
        category: 'office',
        renderedMarkdown: '# Skill Brief',
        revisionNumber: 2,
        resourceSummary: {
          totalCount: 2,
          referenceCount: 1,
          templateCount: 1,
          paths: ['references/subtask-contracts.md', 'templates/render-instruction-draft.md'],
        },
      },
    ],
    activeSkillsForTurn: [
      {
        sourceType: 'platform',
        skillId: 'skill-1',
        revisionId: 'rev-1',
        slug: 'ppt-workflow',
        name: 'PPT 工作流',
        description: 'PPT 子任务编排',
        category: 'office',
        renderedMarkdown: '# Skill Brief',
        revisionNumber: 2,
        resourceSummary: {
          totalCount: 2,
          referenceCount: 1,
          templateCount: 1,
          paths: ['references/subtask-contracts.md', 'templates/render-instruction-draft.md'],
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
          slug: 'ppt-workflow',
          name: 'PPT 工作流',
          description: 'PPT 子任务编排',
          category: 'office',
          revisionNumber: 2,
          resourceSummary: {
            totalCount: 2,
            referenceCount: 1,
            templateCount: 1,
            paths: ['references/subtask-contracts.md', 'templates/render-instruction-draft.md'],
          },
        },
      ],
      managedSkillContext: [
        {
          sourceType: 'platform',
          skillId: 'skill-1',
          revisionId: 'rev-1',
          slug: 'ppt-workflow',
          name: 'PPT 工作流',
          description: 'PPT 子任务编排',
          category: 'office',
          renderedMarkdown: '# Skill Brief',
          revisionNumber: 2,
          resourceSummary: {
            totalCount: 2,
            referenceCount: 1,
            templateCount: 1,
            paths: ['references/subtask-contracts.md', 'templates/render-instruction-draft.md'],
          },
        },
      ],
    },
  });

  assert.equal(summary?.id, 'run-1');
  assert.equal(entitlementMock.mock.callCount(), 1);
  assert.deepEqual(entitlementMock.mock.calls[0]?.arguments, ['user-1', 'lite']);
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
  assert.equal(capturedState?.input.skillCatalog?.[0]?.slug, 'ppt-workflow');
  assert.equal(capturedState?.input.skills?.[0]?.resourceSummary?.totalCount, 2);
  assert.match(capturedState?.input.memoryContextPrompt || '', /Altus Memory Context/);
  assert.equal(capturedState?.input.userMemory?.preferredName, 'Watson');
  assert.equal(capturedState?.input.projectMemory?.context, '这是一个 2048 游戏项目');
  assert.equal(capturedState?.input.sessionAltusMemory?.summary?.goal, '实现 2048 小游戏');
  assert.ok(capturedAbortController instanceof AbortController);
});

test('startRun rejects agent tiers outside current membership entitlement', async () => {
  mock.method(taskCreationFileMemoryStore, 'getSession', async () => ({
    id: 'session-lite-only',
    title: 'Lite only task',
    pendingQuestion: null,
  }) as any);
  mock.method(taskSessionRunDAO, 'findActiveRun', async () => null);
  const entitlementMock = allowMembershipAgentLevels(['lite']);
  const setupService = {
    ensureSessionOwnership: mock.fn(async () => {}),
  };
  const askUserPairingService = {
    resolvePending: mock.fn(async () => null),
  };
  const service = new AltusManagedRunEntryService(
    setupService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {
      reconcileLatestRun: mock.fn(async () => null),
    } as any,
    askUserPairingService as any
  );

  await assert.rejects(
    () => service.startRun('session-lite-only', 'user-lite-only', {
      content: '帮我继续处理',
      metadata: {
        modelTier: 'pro',
      },
    }),
    /当前会员类型仅允许使用 agent lite/
  );

  assert.equal(entitlementMock.mock.callCount(), 1);
  assert.deepEqual(entitlementMock.mock.calls[0]?.arguments, ['user-lite-only', 'pro']);
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
  mock.method(membershipService, 'assertUserCanUseAgentLevel', async () => ({
    level: 'pro',
    entitlement: {
      membership: { id: 'membership-clarify-1' },
      plan: { id: 'plan-clarify-1' },
      allowedAgentLevels: ['pro'],
    },
  }) as any);
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
  allowMembershipAgentLevels();
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

test('startRun closes pending ask_user pairing before continuing from clarification answer', async () => {
  const run = {
    id: 'run-answer-close-1',
    sessionId: 'session-answer-close-1',
    status: 'queued',
    model: 'altus-model',
    stopReason: null,
    startedAt: null,
    completedAt: null,
    updatedAt: new Date('2026-04-26T03:00:00.000Z'),
  };
  const pendingAskUser = {
    runId: 'run-waiting-close-1',
    sessionId: 'session-answer-close-1',
    toolCallId: 'tool-ask-close-1',
    toolName: 'ask_user' as const,
    messageKey: 'managed:run-waiting-close-1:clarification',
    question: '这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？',
  };

  mock.method(taskCreationFileMemoryStore, 'getSession', async () => ({
    id: 'session-answer-close-1',
    title: 'Close pending ask_user',
    pendingQuestion: pendingAskUser.question,
    pendingOptions: ['网页应用', '后端 API', '本地脚本', '完整业务系统'],
    pendingClarificationType: 'artifact_type',
    pendingAskUser,
  }) as any);
  mock.method(altusMemoryContextService, 'buildPromptSectionForRun', async () => ({
    promptSection: '',
    userMemory: null,
    projectMemory: null,
    sessionMemory: await taskSessionAltusMemoryService.getSessionAltusMemory('session-answer-close-1'),
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
  allowMembershipAgentLevels();
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

  const timelineCalls: Record<string, unknown>[] = [];
  const taskIntentProfile = {
    mode: 'neutral',
    reason: 'unknown',
    recentUserMessages: ['帮我做一个管理后台系统', '网页应用'],
    explicitNoDeploy: false,
    explicitNoWeb: false,
    webArtifactRequested: true,
    deployRequested: false,
    scriptArtifactRequested: false,
    emailTemplateRequested: false,
    deploymentAllowed: false,
    needsClarification: false,
    clarificationQuestion: '',
    clarificationType: 'none',
    todoRequired: false,
    todoReason: 'none',
    clarificationTransition: {
      nextState: 'ready_to_execute',
      reason: 'answer_clarification',
      assumptions: ['网页应用'],
    },
  };
  const setupService = {
    ensureSessionOwnership: mock.fn(async () => {}),
    buildTaskIntentProfile: mock.fn(async () => taskIntentProfile),
    captureConnectorSnapshot: mock.fn(async () => ({
      snapshotId: 'snapshot-answer-close-1',
      statuses: [],
    })),
    captureMcpToolSnapshot: mock.fn(async () => ({
      snapshotId: 'mcp-snapshot-answer-close-1',
      providers: [],
    })),
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      timelineCalls.push(input);
    }),
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
      sandbox: { sandboxId: null, workspaceRoot: null, reused: false, updatedAt: null },
      connectorRuntime: { providerIds: [], updatedAt: null },
      stream: { latestSequence: 1, latestEventType: null },
    })),
  };
  const redisStateService = {
    registerRun: mock.fn(async () => {}),
    setRecoverySnapshot: mock.fn(async () => {}),
    touchHeartbeat: mock.fn(async () => {}),
  };
  const askUserPairingService = {
    resolvePending: mock.fn(async () => pendingAskUser),
    closePending: mock.fn(async () => ({
      closed: true,
      answerKind: 'direct_answer',
      pending: pendingAskUser,
    })),
  };

  const service = new AltusManagedRunEntryService(
    setupService as any,
    eventWriter as any,
    {} as any,
    coordinator as any,
    redisStateService as any,
    recoveryService as any,
    askUserPairingService as any
  );

  await service.startRun('session-answer-close-1', 'user-answer-close-1', {
    content: '网页应用',
  });

  assert.equal(askUserPairingService.resolvePending.mock.callCount(), 1);
  assert.equal(askUserPairingService.closePending.mock.callCount(), 1);
  const closeArgs = askUserPairingService.closePending.mock.calls[0]?.arguments[0] as any;
  assert.equal(closeArgs.pending.toolCallId, 'tool-ask-close-1');
  assert.equal(closeArgs.answerRunId, 'run-answer-close-1');
  assert.equal(closeArgs.answerMessageKey, 'managed:run-answer-close-1:user_response');
  assert.equal(closeArgs.taskIntentProfile, taskIntentProfile);
  assert.equal((timelineCalls[0]?.metadata as any)?.clarificationAnswer, true);
  assert.equal((timelineCalls[0]?.metadata as any)?.clarificationToolCallId, 'tool-ask-close-1');
  assert.equal(capturedState?.input.clarificationAnswerKind, 'direct_answer');
  assert.equal(capturedState?.input.closedClarificationToolCallId, 'tool-ask-close-1');
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
  allowMembershipAgentLevels();
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

test('startRun accepts metadata-only mcp confirmation response', async () => {
  const run = {
    id: 'run-mcp-1',
    sessionId: 'session-mcp-1',
    status: 'queued',
    model: 'altus-model',
    stopReason: null,
    startedAt: null,
    completedAt: null,
    updatedAt: new Date('2026-03-24T04:00:00.000Z'),
  };

  mock.method(taskCreationFileMemoryStore, 'getSession', async () => ({
    id: 'session-mcp-1',
    title: 'MCP confirm',
    pendingQuestion: null,
  }) as any);
  mock.method(altusMemoryContextService, 'buildPromptSectionForRun', async () => ({
    promptSection: '',
    userMemory: null,
    projectMemory: null,
    sessionMemory: null,
  }));
  mock.method(taskSessionRunDAO, 'findActiveRun', async () => null);
  allowMembershipAgentLevels();
  mock.method(taskSessionRunDAO, 'getLatestRun', async () => null);
  mock.method(taskSessionRunDAO, 'createRun', async () => run as any);
  mock.method(mcpToolConfirmationService, 'resolveApprovedReplay', async () => ({
    confirmationId: 'confirmation-1',
    agentRunId: 'run-origin-1',
    toolName: 'google_super__GMAIL_SEND_EMAIL',
    argumentsJson: {
      to: 'user@example.com',
      subject: 'hello',
    },
  }));
  mock.method(userSkillService, 'listAvailableSkills', async () => [] as any);
  mock.method(taskSessionSkillStateService, 'prepareRunState', async () => ({
    skillCatalog: [],
    skills: [],
    activeSkillsForTurn: [],
    residentSkillSelections: [],
    sessionSkillState: null,
    residentSelectionsForSync: [],
  }) as any);

  const timelineCalls: Record<string, unknown>[] = [];
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
      snapshotId: 'snapshot-mcp-1',
      statuses: [],
    })),
    captureMcpToolSnapshot: mock.fn(async () => ({
      snapshotId: 'mcp-snapshot-mcp-1',
      providers: [],
    })),
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      timelineCalls.push(input);
    }),
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
      sandbox: { sandboxId: null, workspaceRoot: null, reused: false, updatedAt: null },
      connectorRuntime: { providerIds: [], updatedAt: null },
      stream: { latestSequence: 1, latestEventType: null },
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

  await service.startRun('session-mcp-1', 'user-1', {
    content: '',
    messageKey: 'msg-mcp-1',
    metadata: {
      source: 'mcp_tool_confirmation_approved',
      mcpToolConfirmation: {
        action: 'approve',
        connectorKey: 'google_super',
        confirmationId: 'confirmation-1',
        toolName: 'google_super__GMAIL_SEND_EMAIL',
        confirmationToken: 'token-1',
        confirmationAgentRunId: 'run-origin-1',
        summary: {
          action: 'send_email',
          target: 'user@example.com',
          impact: 'Send one email.',
          parameterSummary: {
            to: 'user@example.com',
          },
        },
      },
    },
  });

  assert.equal((timelineCalls[0] as any)?.messageType, 'user_response');
  assert.equal((timelineCalls[0] as any)?.content, '');
  assert.equal(capturedState?.input.mcpToolConfirmationPrompt, null);
  assert.deepEqual(capturedState?.input.confirmedMcpToolReplay, {
    confirmationId: 'confirmation-1',
    confirmationToken: 'token-1',
    confirmationAgentRunId: 'run-origin-1',
    toolName: 'google_super__GMAIL_SEND_EMAIL',
    argumentsJson: {
      to: 'user@example.com',
      subject: 'hello',
    },
  });
});

test('startRun converts approved mcp confirmation into hidden replay state instead of visible prompt', async () => {
  const run = {
    id: 'run-confirmation-1',
    sessionId: 'session-confirmation-1',
    status: 'queued',
    model: 'altus-model',
  };

  mock.method(taskCreationFileMemoryStore, 'getSession', async () => ({
    id: 'session-confirmation-1',
    title: 'Google Docs task',
    pendingQuestion: null,
  }) as any);
  mock.method(taskSessionRunDAO, 'findActiveRun', async () => null);
  allowMembershipAgentLevels();
  mock.method(taskSessionRunDAO, 'getLatestRun', async () => null);
  mock.method(userSkillService, 'listAvailableSkills', async () => []);
  mock.method(taskSessionSkillStateService, 'prepareRunState', async () => ({
    skillCatalog: [],
    skills: [],
    activeSkillsForTurn: [],
    residentSkillSelections: [],
    sessionSkillState: null,
    residentSelectionsForSync: [],
  }) as any);
  mock.method(altusMemoryContextService, 'buildPromptSectionForRun', async () => ({
    promptSection: '',
    userMemory: {},
    projectMemory: null,
    sessionMemory: null,
  }) as any);
  mock.method(mcpToolConfirmationService, 'resolveApprovedReplay', async () => ({
    confirmationId: 'confirmation-1',
    agentRunId: 'run-origin-1',
    toolName: 'google_super__COMPOSIO_MULTI_EXECUTE_TOOL',
    argumentsJson: {
      tool_slug: 'GOOGLEDOCS_CREATE_DOCUMENT',
      arguments: {
        title: '项目周报',
      },
    },
  }));
  mock.method(taskSessionRunDAO, 'createRun', async () => run as any);

  const setupService = {
    ensureSessionOwnership: mock.fn(async () => {}),
    captureConnectorSnapshot: mock.fn(async () => ({
      snapshotId: 'snapshot-1',
      statuses: [],
    })),
    captureMcpToolSnapshot: mock.fn(async () => ({
      snapshotId: 'mcp-snapshot-1',
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
      needsClarification: false,
      clarificationQuestion: '',
      clarificationType: 'none',
      todoRequired: false,
      todoReason: 'none',
    })),
    persistTimelineMessage: mock.fn(async () => undefined),
    updateSessionLifecycle: mock.fn(async () => undefined),
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
    {
      appendRunEvent: mock.fn(async () => ({ sequence: 1, payload: {} })),
      toSummary: mock.fn(async (value: any) => value),
    } as any,
    {} as any,
    coordinator as any,
    redisStateService as any,
    recoveryService as any
  );

  await service.startRun('session-confirmation-1', 'user-1', {
    content: '',
    metadata: {
      mcpToolConfirmation: {
        action: 'approve',
        connectorKey: 'google_super',
        confirmationId: 'confirmation-1',
        toolName: 'google_super__COMPOSIO_MULTI_EXECUTE_TOOL',
        confirmationToken: 'token-1',
        confirmationAgentRunId: 'run-origin-1',
        summary: {
          action: 'create_resource',
          target: '项目周报',
          parameterSummary: {
            title: '项目周报',
          },
        },
      },
    },
  });

  assert.equal(capturedState?.input.userInput, '');
  assert.equal(capturedState?.input.mcpToolConfirmationPrompt, null);
  assert.deepEqual(capturedState?.input.confirmedMcpToolReplay, {
    confirmationId: 'confirmation-1',
    confirmationToken: 'token-1',
    confirmationAgentRunId: 'run-origin-1',
    toolName: 'google_super__COMPOSIO_MULTI_EXECUTE_TOOL',
    argumentsJson: {
      tool_slug: 'GOOGLEDOCS_CREATE_DOCUMENT',
      arguments: {
        title: '项目周报',
      },
    },
  });
});
