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
