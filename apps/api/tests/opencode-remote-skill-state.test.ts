import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { sandboxExecutionEnvironmentDAO, taskCreationSessionDAO } from '../src/db/dao';
import { altusManagedSetupService } from '../src/services/altus-managed-setup-service';
import { OpencodeRemoteService } from '../src/services/opencode-remote-service';
import { osacAgentService } from '../src/services/osac-agent-service';
import { sandboxSkillSyncService } from '../src/services/sandbox-skill-sync-service';
import { taskSessionRedisCacheService } from '../src/services/task-session-redis-cache-service';
import { taskSessionSkillStateService } from '../src/services/task-session-skill-state-service';
import { userSkillService } from '../src/services/user-skill-service';

afterEach(() => {
  mock.reset();
});

test('prepareDirectResidentSkillSelections drops contextual resident skill when current direct intent no longer matches', async () => {
  const service = new OpencodeRemoteService();
  let metadataStore: Record<string, unknown> = {
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
          lastMatchedAt: '2026-04-21T00:00:00.000Z',
          lastUsedAt: '2026-04-21T00:00:00.000Z',
          lastMessageType: 'tool_runtime',
          lastIntentMode: 'deployable_web_app',
          lastToolName: 'deploy_application',
        },
      ],
    },
  };

  mock.method(taskSessionRedisCacheService, 'resolveScopeBySession', async () => null as any);
  mock.method(taskCreationSessionDAO, 'getSession', async () => ({
    id: 'session-direct-1',
    userId: 'user-1',
  }) as any);
  mock.method(taskCreationSessionDAO, 'getSessionMetadataJson', async () => metadataStore);
  mock.method(taskCreationSessionDAO, 'patchSessionMetadataJson', async (_sessionId, patch) => {
    metadataStore = {
      ...metadataStore,
      ...patch,
    };
    return null as any;
  });
  mock.method(userSkillService, 'listAvailableSkills', async () => [
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
  ] as any);
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

  mock.method(altusManagedSetupService, 'buildTaskIntentProfile', async () => ({
    mode: 'neutral',
    reason: 'unknown',
    recentUserMessages: ['just summarize'],
    explicitNoDeploy: false,
    explicitNoWeb: false,
    webArtifactRequested: false,
    deployRequested: false,
    scriptArtifactRequested: false,
    emailTemplateRequested: false,
    deploymentAllowed: true,
  }));

  const prepared = await (service as any).prepareDirectResidentSkillSelections({
    taskSessionId: 'session-direct-1',
    content: 'just summarize',
    source: 'user',
    pendingQuestion: null,
  });

  assert.deepEqual(prepared.residentSkillSelections, []);
});

test('sendUserInput syncs stored resident skills for direct mode even when metadata.skills is absent', async () => {
  const service = new OpencodeRemoteService();
  let metadataStore: Record<string, unknown> = {
    sessionSkillState: {
      explicitSelections: [
        {
          sourceType: 'platform',
          skillId: 'skill-pinned',
          revisionId: 'rev-pinned',
        },
      ],
      residentSelections: [
        {
          sourceType: 'platform',
          skillId: 'skill-pinned',
          revisionId: 'rev-pinned',
        },
      ],
      bindings: [
        {
          sourceType: 'platform',
          skillId: 'skill-pinned',
          revisionId: 'rev-pinned',
          activationSource: 'explicit',
          residentMode: 'pinned',
          retentionMode: 'session',
          status: 'active',
          lastMatchedAt: '2026-04-21T00:00:00.000Z',
          lastUsedAt: '2026-04-21T00:00:00.000Z',
          lastMessageType: 'user_input',
          lastIntentMode: 'neutral',
          lastToolName: null,
        },
      ],
    },
  };
  const syncCalls: unknown[] = [];

  mock.method(taskSessionRedisCacheService, 'resolveScopeBySession', async () => null as any);
  mock.method(taskCreationFileMemoryStore, 'getSession', async () => ({
    id: 'session-direct-2',
    runtime: {},
    pendingQuestion: null,
    phase: 'development',
  }) as any);
  mock.method(taskCreationFileMemoryStore, 'updateSessionState', async () => undefined);
  mock.method(taskCreationSessionDAO, 'getSession', async () => ({
    id: 'session-direct-2',
    userId: 'user-2',
  }) as any);
  mock.method(taskCreationSessionDAO, 'getSessionMetadataJson', async () => metadataStore);
  mock.method(taskCreationSessionDAO, 'patchSessionMetadataJson', async (_sessionId, patch) => {
    metadataStore = {
      ...metadataStore,
      ...patch,
    };
    return null as any;
  });
  mock.method(taskCreationSessionDAO, 'updateSessionStatus', async () => null as any);
  mock.method(userSkillService, 'listAvailableSkills', async () => [
    {
      sourceType: 'platform',
      skillId: 'skill-pinned',
      revisionId: 'rev-pinned',
      slug: 'skill-pinned',
      name: 'Pinned Skill',
      description: '',
      category: 'general',
      revisionNumber: 1,
      resourceSummary: null,
      governance: {
        systemRole: null,
        adminManaged: false,
        required: false,
        autoActivation: {
          enabled: false,
          triggers: [],
          toolNames: [],
        },
      },
    },
  ] as any);
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
  mock.method(altusManagedSetupService, 'buildTaskIntentProfile', async () => ({
    mode: 'neutral',
    reason: 'unknown',
    recentUserMessages: ['continue'],
    explicitNoDeploy: false,
    explicitNoWeb: false,
    webArtifactRequested: false,
    deployRequested: false,
    scriptArtifactRequested: false,
    emailTemplateRequested: false,
    deploymentAllowed: true,
  }));
  mock.method(sandboxExecutionEnvironmentDAO, 'getBySessionId', async () => ({
    sessionId: 'sandbox-direct-2',
    status: 'ready',
  }) as any);
  mock.method(sandboxSkillSyncService, 'syncSelectedSkills', async (input) => {
    syncCalls.push(input.skills);
    return {
      changed: true,
      items: [],
    } as any;
  });
  mock.method(taskSessionSkillStateService, 'markResidentSkillsMaterialized', async () => null as any);
  mock.method(osacAgentService, 'ensureOpencodeServer', async () => undefined);
  mock.method(osacAgentService, 'sendOpencodePrompt', async () => undefined);
  mock.method(service as any, 'withOpencodeLock', async (_key: string, fn: () => Promise<unknown>) => fn());
  mock.method(service as any, 'ensureWorkspaceGit', async () => undefined);
  mock.method(service as any, 'ensureWorkspaceBaseline', async () => undefined);
  mock.method(service as any, 'ensureUsableOpencodeSessionId', async () => 'opencode-direct-2');
  mock.method(service as any, 'replyPendingQuestionIfAny', async () => false);
  mock.method(service as any, 'persistMessage', async () => undefined);
  mock.method(service as any, 'initRunArtifactsForPrompt', async () => undefined);

  const accepted = await service.sendUserInput({
    taskSessionId: 'session-direct-2',
    content: 'continue',
    orchestratorSessionId: 'sandbox-direct-2',
    metadata: {},
  });

  assert.equal(accepted.orchestratorSessionId, 'sandbox-direct-2');
  assert.equal(accepted.opencodeSessionId, 'opencode-direct-2');
  assert.deepEqual(syncCalls[0], [
    {
      sourceType: 'platform',
      skillId: 'skill-pinned',
      revisionId: 'rev-pinned',
    },
  ]);
});
