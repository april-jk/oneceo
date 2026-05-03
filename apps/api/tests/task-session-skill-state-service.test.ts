import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { e2bConnector } from '../src/connectors/e2b-connector';
import { taskCreationSessionDAO } from '../src/db/dao/task-creation-session.dao';
import { taskSessionRedisCacheService } from '../src/services/task-session-redis-cache-service';
import {
  TaskSessionSkillStateService,
  readSessionSkillState,
} from '../src/services/task-session-skill-state-service';
import { userSkillService } from '../src/services/user-skill-service';

afterEach(() => {
  mock.reset();
});

test('prepareRunState keeps contextual resident skill only when current intent still matches', async () => {
  const service = new TaskSessionSkillStateService();
  const persistedStates: Record<string, unknown>[] = [];

  mock.method(taskSessionRedisCacheService, 'resolveScopeBySession', async () => null as any);
  mock.method(taskCreationSessionDAO, 'getSessionMetadataJson', async () => ({
    sessionSkillState: {
      explicitSelections: [],
      residentSelections: [
        {
          sourceType: 'platform',
          skillId: 'deploy-skill',
          revisionId: 'rev-deploy',
        },
      ],
      bindings: [
        {
          sourceType: 'platform',
          skillId: 'deploy-skill',
          revisionId: 'rev-deploy',
          activationSource: 'auto_tool',
          residentMode: 'contextual',
          retentionMode: 'session',
          status: 'active',
          lastMatchedAt: '2026-04-20T10:00:00.000Z',
          lastUsedAt: '2026-04-20T10:00:00.000Z',
          lastMessageType: 'tool_runtime',
          lastIntentMode: 'deployable_web_app',
          lastToolName: 'deploy_application',
        },
      ],
    },
  }));
  mock.method(taskCreationSessionDAO, 'patchSessionMetadataJson', async (_sessionId, patch) => {
    persistedStates.push(patch);
    return null as any;
  });
  mock.method(userSkillService, 'resolveSelectionsForSession', async (_sessionId, selections) => {
    return (Array.isArray(selections) ? selections : []).map((item: any) => ({
      sourceType: item.sourceType,
      skillId: item.skillId,
      revisionId: item.revisionId,
      slug: item.skillId,
      name: item.skillId,
      description: '',
      category: 'general',
      renderedMarkdown: `# ${item.skillId}`,
      revisionNumber: 1,
      resourceSummary: null,
      governance: null,
    })) as any;
  });

  const skillCatalog = [
    {
      sourceType: 'platform',
      skillId: 'deploy-skill',
      revisionId: 'rev-deploy',
      slug: 'deploy-skill',
      name: 'Deploy Skill',
      description: '',
      category: 'general',
      revisionNumber: 1,
      resourceSummary: null,
      governance: {
        systemRole: null,
        adminManaged: false,
        required: false,
        autoActivation: {
          enabled: true,
          triggers: ['deployment'],
          toolNames: [],
        },
      },
    },
  ] as any;

  const deployRun = await service.prepareRunState({
    sessionId: 'session-1',
    skillCatalog,
    taskIntentProfile: {
      mode: 'deployable_web_app',
      reason: 'latest_deployable_request',
      recentUserMessages: ['deploy this app'],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: true,
      deployRequested: true,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: true,
      needsClarification: false,
      clarificationQuestion: '',
      clarificationType: 'none',
      todoRequired: false,
      todoReason: 'none',
    },
    messageType: 'user_input',
  });
  assert.deepEqual(
    deployRun.activeSkillsForTurn.map((item) => item.skillId),
    ['deploy-skill']
  );

  const neutralRun = await service.prepareRunState({
    sessionId: 'session-1',
    skillCatalog,
    taskIntentProfile: {
      mode: 'neutral',
      reason: 'unknown',
      recentUserMessages: ['summarize the current plan'],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: false,
      deployRequested: false,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: true,
      needsClarification: false,
      clarificationQuestion: '',
      clarificationType: 'none',
      todoRequired: false,
      todoReason: 'none',
    },
    messageType: 'user_input',
  });

  assert.equal(neutralRun.activeSkillsForTurn.length, 0);
  assert.ok(persistedStates.length >= 2);
});

test('prepareRunState auto-attaches ppt workflow skill for presentation requests', async () => {
  const service = new TaskSessionSkillStateService();
  let savedPatch: Record<string, unknown> | null = null;

  mock.method(taskSessionRedisCacheService, 'resolveScopeBySession', async () => null as any);
  mock.method(taskCreationSessionDAO, 'getSessionMetadataJson', async () => ({
    sessionSkillState: {
      explicitSelections: [],
      residentSelections: [],
      bindings: [],
    },
  }));
  mock.method(taskCreationSessionDAO, 'patchSessionMetadataJson', async (_sessionId, patch) => {
    savedPatch = patch;
    return null as any;
  });
  mock.method(userSkillService, 'resolveSelectionsForSession', async (_sessionId, selections) => {
    return (Array.isArray(selections) ? selections : []).map((item: any) => ({
      sourceType: item.sourceType,
      skillId: item.skillId,
      revisionId: item.revisionId,
      slug: 'ppt-workflow',
      name: 'PPT 工作流',
      description: 'PPT 子任务编排',
      category: 'office',
      renderedMarkdown: '# Skill Brief: PPT 子任务编排工作流',
      revisionNumber: 1,
      resourceSummary: null,
      governance: {
        systemRole: null,
        adminManaged: true,
        required: false,
        autoActivation: {
          enabled: true,
          triggers: ['ppt', 'presentation'],
          toolNames: [],
        },
      },
    })) as any;
  });

  const result = await service.prepareRunState({
    sessionId: 'session-ppt',
    skillCatalog: [
      {
        sourceType: 'platform',
        skillId: 'ppt-workflow-skill',
        revisionId: 'rev-ppt-workflow',
        slug: 'ppt-workflow',
        name: 'PPT 工作流',
        description: 'PPT 子任务编排',
        category: 'office',
        revisionNumber: 1,
        resourceSummary: null,
        governance: {
          systemRole: null,
          adminManaged: true,
          required: false,
          autoActivation: {
            enabled: true,
            triggers: ['ppt', 'presentation'],
            toolNames: [],
          },
        },
      },
    ] as any,
    taskIntentProfile: {
      mode: 'neutral',
      reason: 'unknown',
      recentUserMessages: ['生成一个介绍 Codex 的 PPT，篇幅详细'],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: false,
      deployRequested: false,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: true,
      needsClarification: false,
      clarificationQuestion: '',
      clarificationType: 'none',
      todoRequired: false,
      todoReason: 'none',
    },
    messageType: 'user_input',
  });

  assert.deepEqual(
    result.activeSkillsForTurn.map((item) => item.slug),
    ['ppt-workflow']
  );
  assert.ok(savedPatch);
  const normalized = readSessionSkillState((savedPatch || {}).sessionSkillState);
  assert.equal(normalized.bindings[0]?.activationSource, 'intent');
  assert.equal(normalized.bindings[0]?.skillId, 'ppt-workflow-skill');
});

test('prepareRunState auto-attaches deployment orchestrator for action triggers only on deploy requests', async () => {
  const service = new TaskSessionSkillStateService();
  const resolvedSelections: any[][] = [];

  mock.method(taskSessionRedisCacheService, 'resolveScopeBySession', async () => null as any);
  mock.method(taskCreationSessionDAO, 'getSessionMetadataJson', async () => ({
    sessionSkillState: {
      explicitSelections: [],
      residentSelections: [],
      bindings: [],
    },
  }));
  mock.method(taskCreationSessionDAO, 'patchSessionMetadataJson', async () => null as any);
  mock.method(userSkillService, 'resolveSelectionsForSession', async (_sessionId, selections) => {
    resolvedSelections.push(Array.isArray(selections) ? selections : []);
    return (Array.isArray(selections) ? selections : []).map((item: any) => ({
      sourceType: item.sourceType,
      skillId: item.skillId,
      revisionId: item.revisionId,
      slug: 'deployment-orchestrator',
      name: '部署编排',
      description: '',
      category: 'deployment',
      renderedMarkdown: '# deployment-orchestrator',
      revisionNumber: 1,
      resourceSummary: null,
      governance: null,
    })) as any;
  });

  const skillCatalog = [
    {
      sourceType: 'platform',
      skillId: 'deploy-skill',
      revisionId: 'rev-deploy',
      slug: 'deployment-orchestrator',
      name: '部署编排',
      description: '',
      category: 'deployment',
      revisionNumber: 1,
      resourceSummary: null,
      governance: {
        systemRole: 'deployment_orchestrator',
        adminManaged: true,
        required: false,
        autoActivation: {
          enabled: true,
          triggers: ['deploy', 'redeploy', 'rollback', 'status'],
          toolNames: ['deploy_application'],
        },
      },
    },
  ] as any;

  const deployRun = await service.prepareRunState({
    sessionId: 'session-deploy-action-trigger',
    skillCatalog,
    taskIntentProfile: {
      mode: 'deployable_web_app',
      reason: 'latest_deployable_request',
      recentUserMessages: ['帮我部署当前项目'],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: true,
      deployRequested: true,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: true,
      needsClarification: false,
      clarificationQuestion: '',
      clarificationType: 'none',
      todoRequired: false,
      todoReason: 'none',
    },
    messageType: 'user_input',
  });

  assert.deepEqual(
    deployRun.activeSkillsForTurn.map((item) => item.skillId),
    ['deploy-skill']
  );

  const sourceOnlyRun = await service.prepareRunState({
    sessionId: 'session-web-source-only',
    skillCatalog,
    taskIntentProfile: {
      mode: 'deployable_web_app',
      reason: 'latest_deployable_request',
      recentUserMessages: ['帮我做一个网页应用'],
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
    },
    messageType: 'user_input',
  });

  assert.equal(sourceOnlyRun.activeSkillsForTurn.length, 0);
  assert.ok(resolvedSelections.some((items) => items.some((item) => item.skillId === 'deploy-skill')));
});

test('prepareRunState preserves submitted managed skill context when fresh catalog misses it', async () => {
  const service = new TaskSessionSkillStateService();
  let savedPatch: Record<string, unknown> | null = null;

  mock.method(taskSessionRedisCacheService, 'resolveScopeBySession', async () => null as any);
  mock.method(taskCreationSessionDAO, 'getSessionMetadataJson', async () => ({
    sessionSkillState: {
      explicitSelections: [],
      residentSelections: [],
      bindings: [],
    },
  }));
  mock.method(taskCreationSessionDAO, 'patchSessionMetadataJson', async (_sessionId, patch) => {
    savedPatch = patch;
    return null as any;
  });
  mock.method(userSkillService, 'resolveSelectionsForSession', async () => [] as any);

  const result = await service.prepareRunState({
    sessionId: 'session-metadata-skill-fallback',
    skillCatalog: [],
    submittedSelections: [
      {
        sourceType: 'platform',
        skillId: 'deploy-skill',
        revisionId: 'rev-deploy',
      },
    ],
    submittedSkillContexts: [
      {
        sourceType: 'platform',
        skillId: 'deploy-skill',
        revisionId: 'rev-deploy',
        slug: 'deployment-orchestrator',
        name: '部署编排',
        description: '多运行时部署编排',
        category: 'deployment',
        renderedMarkdown: '# Skill Brief: 部署编排\n\n先识别项目形态，再决定修复路径。',
        revisionNumber: 3,
        resourceSummary: null,
        governance: {
          systemRole: 'deployment_orchestrator',
          adminManaged: true,
          required: false,
          autoActivation: {
            enabled: true,
            triggers: ['deploy', 'redeploy', 'rollback', 'status'],
            toolNames: ['deploy_application', 'redeploy_application', 'get_application_deployment_status'],
          },
        },
      },
    ],
    taskIntentProfile: {
      mode: 'deployable_web_app',
      reason: 'latest_deployable_request',
      recentUserMessages: ['帮我部署'],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: true,
      deployRequested: true,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: true,
      needsClarification: false,
      clarificationQuestion: '',
      clarificationType: 'none',
      todoRequired: false,
      todoReason: 'none',
    },
    messageType: 'user_input',
  });

  assert.deepEqual(
    result.skillCatalog.map((item) => item.slug),
    ['deployment-orchestrator']
  );
  assert.deepEqual(
    result.activeSkillsForTurn.map((item) => item.slug),
    ['deployment-orchestrator']
  );
  assert.match(result.activeSkillsForTurn[0]?.renderedMarkdown || '', /先识别项目形态/);
  assert.ok(savedPatch);
});

test('prepareRunState drops stale required resident binding after governance no longer requires it', async () => {
  const service = new TaskSessionSkillStateService();
  let savedPatch: Record<string, unknown> | null = null;

  mock.method(taskSessionRedisCacheService, 'resolveScopeBySession', async () => null as any);
  mock.method(taskCreationSessionDAO, 'getSessionMetadataJson', async () => ({
    sessionSkillState: {
      explicitSelections: [],
      residentSelections: [
        {
          sourceType: 'platform',
          skillId: 'deploy-skill',
          revisionId: 'rev-deploy',
        },
      ],
      bindings: [
        {
          sourceType: 'platform',
          skillId: 'deploy-skill',
          revisionId: 'rev-deploy',
          activationSource: 'required',
          residentMode: 'pinned',
          retentionMode: 'session',
          status: 'active',
          lastMatchedAt: '2026-04-20T10:00:00.000Z',
          lastUsedAt: '2026-04-20T10:00:00.000Z',
          lastMessageType: 'user_input',
          lastIntentMode: 'deployable_web_app',
          lastToolName: null,
        },
      ],
    },
  }));
  mock.method(taskCreationSessionDAO, 'patchSessionMetadataJson', async (_sessionId, patch) => {
    savedPatch = patch;
    return null as any;
  });
  mock.method(userSkillService, 'resolveSelectionsForSession', async () => []);

  const result = await service.prepareRunState({
    sessionId: 'session-1',
    skillCatalog: [
      {
        sourceType: 'platform',
        skillId: 'deploy-skill',
        revisionId: 'rev-deploy',
        slug: 'deploy-skill',
        name: 'Deploy Skill',
        description: '',
        category: 'deployment',
        revisionNumber: 1,
        resourceSummary: null,
        governance: {
          systemRole: 'deployment_orchestrator',
          adminManaged: true,
          required: false,
          autoActivation: {
            enabled: true,
            triggers: ['deploy'],
            toolNames: ['deploy_application'],
          },
        },
      },
    ] as any,
    taskIntentProfile: {
      mode: 'neutral',
      reason: 'plain_chat',
      recentUserMessages: ['你好'],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: false,
      deployRequested: false,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: true,
      needsClarification: false,
      clarificationQuestion: '',
      clarificationType: 'none',
      todoRequired: false,
      todoReason: 'none',
    },
    messageType: 'user_input',
  });

  assert.equal(result.activeSkillsForTurn.length, 0);
  const normalized = readSessionSkillState((savedPatch || {}).sessionSkillState);
  assert.equal(normalized.bindings.length, 0);
  assert.equal(normalized.residentSelections.length, 0);
});

test('saveSandboxFileMemoryToDb merges sandbox memory snapshot back into session metadata', async () => {
  const service = new TaskSessionSkillStateService();
  let savedPatch: Record<string, unknown> | null = null;

  mock.method(taskSessionRedisCacheService, 'resolveScopeBySession', async () => null as any);
  mock.method(taskCreationSessionDAO, 'getSessionMetadataJson', async () => ({
    sessionSkillState: {
      explicitSelections: [],
      residentSelections: [],
      bindings: [],
    },
  }));
  mock.method(taskCreationSessionDAO, 'patchSessionMetadataJson', async (_sessionId, patch) => {
    savedPatch = patch;
    return null as any;
  });
  mock.method(e2bConnector, 'readFile', async () =>
    Buffer.from(
      JSON.stringify({
        version: 1,
        sessionId: 'session-2',
        snapshotVersion: 7,
        updatedAt: '2026-04-20T10:30:00.000Z',
        explicitSelections: [
          {
            sourceType: 'platform',
            skillId: 'skill-a',
            revisionId: 'rev-a',
          },
        ],
        residentSelections: [
          {
            sourceType: 'platform',
            skillId: 'skill-a',
            revisionId: 'rev-a',
          },
        ],
        bindings: [
          {
            sourceType: 'platform',
            skillId: 'skill-a',
            revisionId: 'rev-a',
            activationSource: 'explicit',
            residentMode: 'pinned',
            retentionMode: 'session',
            status: 'active',
            lastMatchedAt: '2026-04-20T10:30:00.000Z',
            lastUsedAt: '2026-04-20T10:30:00.000Z',
            lastMessageType: 'user_input',
            lastIntentMode: 'deployable_web_app',
            lastToolName: null,
          },
        ],
        sandboxMaterialization: {
          residentVersion: 3,
          lastSandboxId: 'sandbox-2',
          lastSyncedAt: '2026-04-20T10:30:00.000Z',
        },
        lastToolActivations: ['deploy_application:platform:skill-a:rev-a'],
      }),
      'utf8'
    )
  );

  const state = await service.saveSandboxFileMemoryToDb({
    sessionId: 'session-2',
    sandboxId: 'sandbox-2',
    workspaceRoot: '/workspace/session-2',
    archiveId: 'snapshot-1',
    reason: 'completed',
  });

  const normalized = readSessionSkillState((savedPatch || {}).sessionSkillState);
  assert.equal(state.fileMemorySnapshot.snapshotVersion, 7);
  assert.equal(normalized.residentSelections.length, 1);
  assert.equal(normalized.fileMemorySnapshot.archiveId, 'snapshot-1');
  assert.deepEqual(normalized.fileMemorySnapshot.memorySummary.lastToolActivations, [
    'deploy_application:platform:skill-a:rev-a',
  ]);
});
