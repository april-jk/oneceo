import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { e2bConnector } from '../src/connectors/e2b-connector';
import { AltusManagedToolRuntime } from '../src/services/altus-managed-tool-runtime';
import { sandboxSkillSyncService } from '../src/services/sandbox-skill-sync-service';
import { connectorGuideService } from '../src/services/connector-guide-service';
import { osacAgentService } from '../src/services/osac-agent-service';
import { altusManagedDeploymentToolService } from '../src/services/altus-managed-deployment-tool-service';
import { userSkillService } from '../src/services/user-skill-service';
import { buildManagedMcpToolName } from '../src/services/altus-managed-shared';

afterEach(() => {
  mock.reset();
});

test('load_skill_resource only allows active selected platform skills and returns synced path', async () => {
  const syncMock = mock.method(sandboxSkillSyncService, 'syncResolvedSkillResource', async () => ({
    taskSessionId: 'session-1',
    orchestratorSessionId: 'sandbox-1',
    skillId: 'skill-1',
    revisionId: 'rev-1',
    slug: 'office-ppt',
    resourcePath: 'references/slide-structure-guide.md',
    skillResourcePath: '/home/user/.config/opencode/skills/platform/office-ppt/references/slide-structure-guide.md',
    resourceType: 'reference',
  }));

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [
      {
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
          totalCount: 2,
          referenceCount: 1,
          templateCount: 1,
          paths: ['references/slide-structure-guide.md', 'templates/business-deck-outline.md'],
        },
      },
    ],
  });

  const result = await runtime.execute('load_skill_resource', {
    skillId: 'skill-1',
    revisionId: 'rev-1',
    resourcePath: 'references/slide-structure-guide.md',
  });

  assert.equal(syncMock.mock.callCount(), 1);
  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.skillId, 'skill-1');
  assert.equal(payload.resourceType, 'reference');
  assert.match(payload.skillResourcePath, /office-ppt\/references\/slide-structure-guide\.md$/);
});

test('load_skill_resource rejects inactive or non-selected skills', async () => {
  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [],
  });

  await assert.rejects(
    runtime.execute('load_skill_resource', {
      skillId: 'skill-1',
      revisionId: 'rev-1',
      resourcePath: 'references/slide-structure-guide.md',
    }),
    /load_skill_resource_skill_not_active/
  );
});

test('load_connector_guide returns the active connector guide and unlocks later mcp calls', async () => {
  const managedToolName = buildManagedMcpToolName('provider-1', 'create_repository');
  const guideMock = mock.method(connectorGuideService, 'getActiveGuideForConnector', async () => ({
    connectorKey: 'github',
    policyId: 'policy-1',
    revisionId: 'rev-9',
    triggerMode: 'on_attach',
    serverInstructionsMarkdown: 'Inspect repo scope first.',
    guideReminderMarkdown: 'GitHub guide active.',
    blockingRulesMarkdown: 'Verify target repo before writes.',
  }));
  const mcpMock = mock.method(osacAgentService, 'callSessionMcpTool', async () => ({
    providerId: 'provider-1',
    toolName: 'create_repository',
    result: { ok: true },
    isError: false,
  }));

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [],
    mcpProviders: [
      {
        connectorKey: 'github',
        providerId: 'provider-1',
        tools: [{ providerId: 'provider-1', toolName: 'create_repository' }],
      },
    ],
  });

  const guideResult = await runtime.execute('load_connector_guide', {
    connectorKey: 'github',
  });

  assert.equal(guideResult.type, 'result');
  const guidePayload = JSON.parse(guideResult.content);
  assert.equal(guidePayload.connectorKey, 'github');
  assert.equal(guidePayload.revisionId, 'rev-9');

  const toolResult = await runtime.execute(managedToolName, {
    name: 'demo-repo',
  });

  assert.equal(toolResult.type, 'result');
  const payload = JSON.parse(toolResult.content);
  assert.deepEqual(payload.result, { ok: true });
  assert.equal(mcpMock.mock.callCount(), 1);
  assert.equal(guideMock.mock.callCount(), 2);
});

test('mcp tool call is blocked until active connector guide is loaded', async () => {
  const managedToolName = buildManagedMcpToolName('provider-1', 'create_repository');
  const guideMock = mock.method(connectorGuideService, 'getActiveGuideForConnector', async () => ({
    connectorKey: 'github',
    policyId: 'policy-1',
    revisionId: 'rev-2',
    triggerMode: 'on_attach',
    serverInstructionsMarkdown: 'Inspect repo scope first.',
    guideReminderMarkdown: 'GitHub guide active.',
    blockingRulesMarkdown: 'Verify target repo before writes.',
  }));
  const mcpMock = mock.method(osacAgentService, 'callSessionMcpTool', async () => ({
    providerId: 'provider-1',
    toolName: 'create_repository',
    result: { ok: true },
    isError: false,
  }));

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [],
    mcpProviders: [
      {
        connectorKey: 'github',
        providerId: 'provider-1',
        tools: [{ providerId: 'provider-1', toolName: 'create_repository' }],
      },
    ],
  });

  await assert.rejects(
    runtime.execute(managedToolName, {
      name: 'demo-repo',
    }),
    /connector_guide_blocked:github/
  );

  assert.equal(mcpMock.mock.callCount(), 0);
  assert.equal(guideMock.mock.callCount(), 1);
});

test('vercel mcp tool call is blocked until active vercel connector guide is loaded', async () => {
  const managedToolName = buildManagedMcpToolName('provider-vercel', 'list_projects');
  const guideMock = mock.method(connectorGuideService, 'getActiveGuideForConnector', async (_sessionId, connectorKey) => {
    if (connectorKey !== 'vercel') return null;
    return {
      connectorKey: 'vercel',
      policyId: 'policy-vercel',
      revisionId: 'rev-vercel-1',
      triggerMode: 'on_attach',
      serverInstructionsMarkdown: 'Inspect vercel project target first.',
      guideReminderMarkdown: 'Vercel guide active.',
      blockingRulesMarkdown: 'Do not touch production without explicit target.',
    };
  });
  const mcpMock = mock.method(osacAgentService, 'callSessionMcpTool', async () => ({
    providerId: 'provider-vercel',
    toolName: 'list_projects',
    result: { ok: true },
    isError: false,
  }));

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-vercel',
    userId: 'user-1',
    sandboxId: 'sandbox-vercel',
    workspaceRoot: '/workspace/session-vercel',
    activeSkills: [],
    mcpProviders: [
      {
        connectorKey: 'vercel',
        providerId: 'provider-vercel',
        tools: [{ providerId: 'provider-vercel', toolName: 'list_projects' }],
      },
    ],
  });

  await assert.rejects(
    runtime.execute(managedToolName, {
      teamId: 'team_123',
    }),
    /connector_guide_blocked:vercel/
  );

  const guideResult = await runtime.execute('load_connector_guide', {
    connectorKey: 'vercel',
  });
  assert.equal(guideResult.type, 'result');
  const guidePayload = JSON.parse(guideResult.content);
  assert.equal(guidePayload.connectorKey, 'vercel');

  const toolResult = await runtime.execute(managedToolName, {
    teamId: 'team_123',
  });
  assert.equal(toolResult.type, 'result');
  assert.equal(mcpMock.mock.callCount(), 1);
  assert.ok(guideMock.mock.callCount() >= 3);
});

test('raw vercel mcp tool name is accepted as an alias of the managed tool name', async () => {
  const guideMock = mock.method(
    connectorGuideService,
    'getActiveGuideForConnector',
    async (_sessionId, connectorKey) => {
      if (connectorKey !== 'vercel') return null;
      return {
        connectorKey: 'vercel',
        policyId: 'policy-vercel',
        revisionId: 'rev-vercel-raw-1',
        triggerMode: 'on_attach',
        serverInstructionsMarkdown: 'Inspect vercel project target first.',
        guideReminderMarkdown: 'Vercel guide active.',
        blockingRulesMarkdown: 'Do not touch production without explicit target.',
      };
    }
  );
  const mcpMock = mock.method(osacAgentService, 'callSessionMcpTool', async () => ({
    providerId: 'provider-vercel',
    toolName: 'vercel_list_projects',
    result: { projects: [{ name: 'huiduabs-projects' }] },
    isError: false,
  }));

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-vercel-raw',
    userId: 'user-1',
    sandboxId: 'sandbox-vercel-raw',
    workspaceRoot: '/workspace/session-vercel-raw',
    activeSkills: [],
    mcpProviders: [
      {
        connectorKey: 'vercel',
        providerId: 'provider-vercel',
        tools: [{ providerId: 'provider-vercel', toolName: 'vercel_list_projects' }],
      },
    ],
  });

  await runtime.execute('load_connector_guide', {
    connectorKey: 'vercel',
  });

  const result = await runtime.execute('vercel_list_projects', {
    limit: 5,
  });

  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.deepEqual(payload.result, { projects: [{ name: 'huiduabs-projects' }] });
  assert.equal(mcpMock.mock.callCount(), 1);
  assert.equal(mcpMock.mock.calls[0]?.arguments[1]?.toolName, 'vercel_list_projects');
  assert.ok(guideMock.mock.callCount() >= 2);
});

test('managed vercel mcp write tool auto-attaches governed skill by raw tool name', async () => {
  const managedToolName = buildManagedMcpToolName('provider-vercel', 'vercel_update_project');
  mock.method(connectorGuideService, 'getActiveGuideForConnector', async (_sessionId, connectorKey) => {
    if (connectorKey !== 'vercel') return null;
    return {
      connectorKey: 'vercel',
      policyId: 'policy-vercel',
      revisionId: 'rev-vercel-skill-1',
      triggerMode: 'on_attach',
      serverInstructionsMarkdown: 'Inspect Vercel project target first.',
      guideReminderMarkdown: 'Vercel guide active.',
      blockingRulesMarkdown: 'Do not treat project config updates as source deployment.',
    };
  });
  const resolveMock = mock.method(userSkillService, 'resolveSelectionsForSession', async () => [
    {
      sourceType: 'platform',
      skillId: 'vercel-project-skill-1',
      revisionId: 'vercel-project-rev-1',
      slug: 'vercel-mcp-project-config-operator',
      name: 'Vercel MCP Project Config',
      description: 'Project config safety guidance.',
      category: 'deployment',
      renderedMarkdown: '# Vercel MCP Project Config',
      revisionNumber: 1,
      governance: {
        systemRole: 'vercel_mcp_project_operator',
        adminManaged: true,
        required: false,
        autoActivation: {
          enabled: true,
          triggers: ['vercel', 'project-config'],
          toolNames: ['vercel_update_project'],
        },
      },
      resourceSummary: null,
    },
  ] as any);
  const syncMock = mock.method(sandboxSkillSyncService, 'syncResolvedSkills', async () => ({
    taskSessionId: 'session-vercel-skill',
    orchestratorSessionId: 'sandbox-vercel-skill',
    signature: 'sig-vercel-skill',
    restartTriggered: true,
    changed: true,
    items: [],
    syncedAt: new Date().toISOString(),
  }) as any);
  const mcpMock = mock.method(osacAgentService, 'callSessionMcpTool', async () => ({
    providerId: 'provider-vercel',
    toolName: 'vercel_update_project',
    result: { ok: true },
    isError: false,
  }));

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-vercel-skill',
    userId: 'user-1',
    sandboxId: 'sandbox-vercel-skill',
    workspaceRoot: '/workspace/session-vercel-skill',
    availableSkills: [
      {
        sourceType: 'platform',
        skillId: 'vercel-project-skill-1',
        revisionId: 'vercel-project-rev-1',
        slug: 'vercel-mcp-project-config-operator',
        name: 'Vercel MCP Project Config',
        description: 'Project config safety guidance.',
        category: 'deployment',
        revisionNumber: 1,
        governance: {
          systemRole: 'vercel_mcp_project_operator',
          adminManaged: true,
          required: false,
          autoActivation: {
            enabled: true,
            triggers: ['vercel', 'project-config'],
            toolNames: ['vercel_update_project'],
          },
        },
        resourceSummary: null,
      },
    ],
    activeSkills: [],
    mcpProviders: [
      {
        connectorKey: 'vercel',
        providerId: 'provider-vercel',
        tools: [{ providerId: 'provider-vercel', toolName: 'vercel_update_project' }],
      },
    ],
  });

  await runtime.execute('load_connector_guide', {
    connectorKey: 'vercel',
  });

  const result = await runtime.execute(managedToolName, {
    projectId: 'prj_123',
    framework: 'vite',
  });

  assert.equal(resolveMock.mock.callCount(), 1);
  assert.equal(syncMock.mock.callCount(), 1);
  assert.equal(mcpMock.mock.callCount(), 1);
  assert.equal(result.type, 'result');
  assert.deepEqual(result.activatedSkills?.map((item) => item.slug), ['vercel-mcp-project-config-operator']);
});

test('managed vercel mcp read tool does not auto-attach write-tool skill', async () => {
  const managedToolName = buildManagedMcpToolName('provider-vercel', 'vercel_get_project');
  mock.method(connectorGuideService, 'getActiveGuideForConnector', async (_sessionId, connectorKey) => {
    if (connectorKey !== 'vercel') return null;
    return {
      connectorKey: 'vercel',
      policyId: 'policy-vercel',
      revisionId: 'rev-vercel-read-1',
      triggerMode: 'on_attach',
      serverInstructionsMarkdown: 'Inspect Vercel project target first.',
      guideReminderMarkdown: 'Vercel guide active.',
      blockingRulesMarkdown: 'Do not touch production without explicit target.',
    };
  });
  const resolveMock = mock.method(userSkillService, 'resolveSelectionsForSession', async () => {
    throw new Error('should_not_auto_attach_for_read_tool');
  });
  const syncMock = mock.method(sandboxSkillSyncService, 'syncResolvedSkills', async () => {
    throw new Error('should_not_sync_for_read_tool');
  });
  const mcpMock = mock.method(osacAgentService, 'callSessionMcpTool', async () => ({
    providerId: 'provider-vercel',
    toolName: 'vercel_get_project',
    result: { id: 'prj_123', name: 'demo' },
    isError: false,
  }));

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-vercel-read',
    userId: 'user-1',
    sandboxId: 'sandbox-vercel-read',
    workspaceRoot: '/workspace/session-vercel-read',
    availableSkills: [
      {
        sourceType: 'platform',
        skillId: 'vercel-project-skill-1',
        revisionId: 'vercel-project-rev-1',
        slug: 'vercel-mcp-project-config-operator',
        name: 'Vercel MCP Project Config',
        description: 'Project config safety guidance.',
        category: 'deployment',
        revisionNumber: 1,
        governance: {
          systemRole: 'vercel_mcp_project_operator',
          adminManaged: true,
          required: false,
          autoActivation: {
            enabled: true,
            triggers: ['vercel', 'project-config'],
            toolNames: ['vercel_update_project'],
          },
        },
        resourceSummary: null,
      },
    ],
    activeSkills: [],
    mcpProviders: [
      {
        connectorKey: 'vercel',
        providerId: 'provider-vercel',
        tools: [{ providerId: 'provider-vercel', toolName: 'vercel_get_project' }],
      },
    ],
  });

  await runtime.execute('load_connector_guide', {
    connectorKey: 'vercel',
  });

  const result = await runtime.execute(managedToolName, {
    projectId: 'prj_123',
  });

  assert.equal(resolveMock.mock.callCount(), 0);
  assert.equal(syncMock.mock.callCount(), 0);
  assert.equal(mcpMock.mock.callCount(), 1);
  assert.equal(result.type, 'result');
  assert.deepEqual(result.activatedSkills, []);
});

test('managed vercel mcp git deployment tool auto-attaches release safety skill', async () => {
  const managedToolName = buildManagedMcpToolName('provider-vercel', 'vercel_create_deployment');
  mock.method(connectorGuideService, 'getActiveGuideForConnector', async (_sessionId, connectorKey) => {
    if (connectorKey !== 'vercel') return null;
    return {
      connectorKey: 'vercel',
      policyId: 'policy-vercel',
      revisionId: 'rev-vercel-deploy-1',
      triggerMode: 'on_attach',
      serverInstructionsMarkdown: 'Inspect Vercel deployment target first.',
      guideReminderMarkdown: 'Vercel guide active.',
      blockingRulesMarkdown: 'Do not upload workspace files through Git deployment tools.',
    };
  });
  const resolveMock = mock.method(userSkillService, 'resolveSelectionsForSession', async () => [
    {
      sourceType: 'platform',
      skillId: 'vercel-release-skill-1',
      revisionId: 'vercel-release-rev-1',
      slug: 'vercel-mcp-release-safety-operator',
      name: 'Vercel MCP Release Safety',
      description: 'Release safety guidance.',
      category: 'deployment',
      renderedMarkdown: '# Vercel MCP Release Safety',
      revisionNumber: 1,
      governance: {
        systemRole: 'vercel_mcp_release_operator',
        adminManaged: true,
        required: false,
        autoActivation: {
          enabled: true,
          triggers: ['vercel', 'deployment'],
          toolNames: ['vercel_create_deployment'],
        },
      },
      resourceSummary: null,
    },
  ] as any);
  const syncMock = mock.method(sandboxSkillSyncService, 'syncResolvedSkills', async () => ({
    taskSessionId: 'session-vercel-deploy-skill',
    orchestratorSessionId: 'sandbox-vercel-deploy-skill',
    signature: 'sig-vercel-deploy-skill',
    restartTriggered: true,
    changed: true,
    items: [],
    syncedAt: new Date().toISOString(),
  }) as any);
  const mcpMock = mock.method(osacAgentService, 'callSessionMcpTool', async () => ({
    providerId: 'provider-vercel',
    toolName: 'vercel_create_deployment',
    result: { id: 'dpl_123' },
    isError: false,
  }));

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-vercel-deploy-skill',
    userId: 'user-1',
    sandboxId: 'sandbox-vercel-deploy-skill',
    workspaceRoot: '/workspace/session-vercel-deploy-skill',
    availableSkills: [
      {
        sourceType: 'platform',
        skillId: 'vercel-release-skill-1',
        revisionId: 'vercel-release-rev-1',
        slug: 'vercel-mcp-release-safety-operator',
        name: 'Vercel MCP Release Safety',
        description: 'Release safety guidance.',
        category: 'deployment',
        revisionNumber: 1,
        governance: {
          systemRole: 'vercel_mcp_release_operator',
          adminManaged: true,
          required: false,
          autoActivation: {
            enabled: true,
            triggers: ['vercel', 'deployment'],
            toolNames: ['vercel_create_deployment'],
          },
        },
        resourceSummary: null,
      },
    ],
    activeSkills: [],
    mcpProviders: [
      {
        connectorKey: 'vercel',
        providerId: 'provider-vercel',
        tools: [{ providerId: 'provider-vercel', toolName: 'vercel_create_deployment' }],
      },
    ],
  });

  await runtime.execute('load_connector_guide', {
    connectorKey: 'vercel',
  });

  const result = await runtime.execute(managedToolName, {
    gitSource: {
      type: 'github',
      repoId: '123456',
      ref: 'main',
    },
  });

  assert.equal(resolveMock.mock.callCount(), 1);
  assert.equal(syncMock.mock.callCount(), 1);
  assert.equal(mcpMock.mock.callCount(), 1);
  assert.equal(result.type, 'result');
  assert.deepEqual(result.activatedSkills?.map((item) => item.slug), ['vercel-mcp-release-safety-operator']);
});

test('managed vercel mcp list teams tool does not auto-attach write-tool skill', async () => {
  const managedToolName = buildManagedMcpToolName('provider-vercel', 'vercel_list_teams');
  mock.method(connectorGuideService, 'getActiveGuideForConnector', async (_sessionId, connectorKey) => {
    if (connectorKey !== 'vercel') return null;
    return {
      connectorKey: 'vercel',
      policyId: 'policy-vercel',
      revisionId: 'rev-vercel-teams-1',
      triggerMode: 'on_attach',
      serverInstructionsMarkdown: 'Inspect Vercel team context first.',
      guideReminderMarkdown: 'Vercel guide active.',
      blockingRulesMarkdown: 'Do not touch production without explicit target.',
    };
  });
  const resolveMock = mock.method(userSkillService, 'resolveSelectionsForSession', async () => {
    throw new Error('should_not_auto_attach_for_list_teams');
  });
  const syncMock = mock.method(sandboxSkillSyncService, 'syncResolvedSkills', async () => {
    throw new Error('should_not_sync_for_list_teams');
  });
  const mcpMock = mock.method(osacAgentService, 'callSessionMcpTool', async () => ({
    providerId: 'provider-vercel',
    toolName: 'vercel_list_teams',
    result: { teams: [] },
    isError: false,
  }));

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-vercel-teams',
    userId: 'user-1',
    sandboxId: 'sandbox-vercel-teams',
    workspaceRoot: '/workspace/session-vercel-teams',
    availableSkills: [
      {
        sourceType: 'platform',
        skillId: 'vercel-project-skill-1',
        revisionId: 'vercel-project-rev-1',
        slug: 'vercel-mcp-project-config-operator',
        name: 'Vercel MCP Project Config',
        description: 'Project config safety guidance.',
        category: 'deployment',
        revisionNumber: 1,
        governance: {
          systemRole: 'vercel_mcp_project_operator',
          adminManaged: true,
          required: false,
          autoActivation: {
            enabled: true,
            triggers: ['vercel', 'project-config'],
            toolNames: ['vercel_create_project_from_git'],
          },
        },
        resourceSummary: null,
      },
    ],
    activeSkills: [],
    mcpProviders: [
      {
        connectorKey: 'vercel',
        providerId: 'provider-vercel',
        tools: [{ providerId: 'provider-vercel', toolName: 'vercel_list_teams' }],
      },
    ],
  });

  await runtime.execute('load_connector_guide', {
    connectorKey: 'vercel',
  });

  const result = await runtime.execute(managedToolName, {
    limit: 20,
  });

  assert.equal(resolveMock.mock.callCount(), 0);
  assert.equal(syncMock.mock.callCount(), 0);
  assert.equal(mcpMock.mock.callCount(), 1);
  assert.equal(result.type, 'result');
  assert.deepEqual(result.activatedSkills, []);
});

test('write_file marks sandbox dirty so archive job can persist latest workspace snapshot', async () => {
  mock.method(e2bConnector, 'runCommand', async () => ({
    stdout: '',
    stderr: '',
    exitCode: 0,
  }) as any);
  mock.method(e2bConnector, 'writeFile', async () => undefined);

  const touchSandboxMock = mock.fn(async () => undefined);
  const markSandboxDirtyMock = mock.fn(async () => undefined);

  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      activeSkills: [],
      mcpProviders: [],
    },
    {
      touchSandbox: touchSandboxMock as any,
      markSandboxDirty: markSandboxDirtyMock as any,
    }
  );

  const result = await runtime.execute('write_file', {
    path: 'snake-game/index.html',
    content: '<!doctype html><title>snake</title>',
  });

  assert.equal(result.type, 'result');
  assert.equal(markSandboxDirtyMock.mock.callCount(), 1);
  assert.deepEqual(markSandboxDirtyMock.mock.calls[0]?.arguments, ['sandbox-1', 'managed_write_file']);
});

test('deployment tool usage auto-attaches governed skill linked by tool name', async () => {
  const resolveMock = mock.method(userSkillService, 'resolveSelectionsForSession', async () => [
    {
      sourceType: 'platform',
      skillId: 'deploy-skill-1',
      revisionId: 'deploy-rev-1',
      slug: 'deployment-orchestrator',
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
          triggers: ['deploy'],
          toolNames: ['deploy_application'],
        },
      },
      resourceSummary: null,
    },
  ] as any);
  const syncMock = mock.method(sandboxSkillSyncService, 'syncResolvedSkills', async () => ({
    taskSessionId: 'session-1',
    orchestratorSessionId: 'sandbox-1',
    signature: 'sig-1',
    restartTriggered: true,
    changed: true,
    items: [],
    syncedAt: new Date().toISOString(),
  }) as any);
  mock.method(altusManagedDeploymentToolService, 'execute', async () => ({
    action: 'deploy_application',
    status: 'success',
    summary: 'deployment ok',
  }) as any);

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    availableSkills: [
      {
        sourceType: 'platform',
        skillId: 'deploy-skill-1',
        revisionId: 'deploy-rev-1',
        slug: 'deployment-orchestrator',
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
            triggers: ['deploy'],
            toolNames: ['deploy_application'],
          },
        },
        resourceSummary: null,
      },
    ],
    activeSkills: [],
    mcpProviders: [],
  });

  const result = await runtime.execute('deploy_application', {
    notes: '帮我部署当前项目',
  });

  assert.equal(resolveMock.mock.callCount(), 1);
  assert.equal(syncMock.mock.callCount(), 1);
  assert.equal(result.type, 'result');
  assert.deepEqual(result.activatedSkills?.map((item) => item.slug), ['deployment-orchestrator']);
});

test('shell_execute marks sandbox dirty after command execution', async () => {
  mock.method(e2bConnector, 'runCommand', async () => ({
    stdout: 'ok',
    stderr: '',
    exitCode: 0,
  }) as any);

  const touchSandboxMock = mock.fn(async () => undefined);
  const markSandboxDirtyMock = mock.fn(async () => undefined);

  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      activeSkills: [],
      mcpProviders: [],
    },
    {
      touchSandbox: touchSandboxMock as any,
      markSandboxDirty: markSandboxDirtyMock as any,
    }
  );

  const result = await runtime.execute('shell_execute', {
    command: 'echo ok',
    cwd: '.',
  });

  assert.equal(result.type, 'result');
  assert.equal(markSandboxDirtyMock.mock.callCount(), 1);
  assert.deepEqual(markSandboxDirtyMock.mock.calls[0]?.arguments, ['sandbox-1', 'managed_shell_execute']);
});

test('shell_execute prepares vite build entry when only public index exists', async () => {
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async (_sandboxId: string, command: string) => {
    if (command.includes('package_json=1')) {
      return {
        stdout: ['package_json=1', 'root_index=0', 'public_index=1', 'client_index=0', 'vite_project=1'].join('\n'),
        stderr: '',
        exitCode: 0,
      } as any;
    }
    if (command.includes('cp ') && command.includes('index.html')) {
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as any;
    }
    return {
      stdout: 'vite build ok',
      stderr: '',
      exitCode: 0,
    } as any;
  });

  const markSandboxDirtyMock = mock.fn(async () => undefined);
  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-1',
      userId: 'user-1',
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      activeSkills: [],
      mcpProviders: [],
    },
    {
      touchSandbox: mock.fn(async () => undefined) as any,
      markSandboxDirty: markSandboxDirtyMock as any,
    }
  );

  const result = await runtime.execute('shell_execute', {
    command: 'npm run build',
    cwd: 'acrylic-export',
  });

  assert.equal(result.type, 'result');
  assert.equal(runCommandMock.mock.callCount(), 3);
  assert.match(String(runCommandMock.mock.calls[1]?.arguments[1]), /cp 'public\/index\.html' index\.html/);
  assert.match(String(runCommandMock.mock.calls[2]?.arguments[1]), /npm run build/);
  assert.deepEqual(markSandboxDirtyMock.mock.calls.map((call) => call.arguments[1]), [
    'managed_frontend_build_prepare',
    'managed_shell_execute',
  ]);
});

test('shell_execute prepares vite build entry for leading cd build commands', async () => {
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async (_sandboxId: string, command: string, options?: any) => {
    if (command.includes('package_json=1')) {
      return {
        stdout: ['package_json=1', 'root_index=0', 'public_index=1', 'client_index=0', 'vite_project=1'].join('\n'),
        stderr: '',
        exitCode: 0,
      } as any;
    }
    if (command.includes('cp ') && command.includes('index.html')) {
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as any;
    }
    return {
      stdout: 'vite build ok',
      stderr: '',
      exitCode: 0,
    } as any;
  });

  const markSandboxDirtyMock = mock.fn(async () => undefined);
  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-1',
      userId: 'user-1',
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      activeSkills: [],
      mcpProviders: [],
    },
    {
      touchSandbox: mock.fn(async () => undefined) as any,
      markSandboxDirty: markSandboxDirtyMock as any,
    }
  );

  const result = await runtime.execute('shell_execute', {
    command: 'cd acrylic-export && npm run build',
    cwd: '.',
  });

  assert.equal(result.type, 'result');
  assert.equal(runCommandMock.mock.callCount(), 3);
  assert.equal(runCommandMock.mock.calls[0]?.arguments[2]?.cwd, '/workspace/session-1/acrylic-export');
  assert.equal(runCommandMock.mock.calls[1]?.arguments[2]?.cwd, '/workspace/session-1/acrylic-export');
  assert.match(String(runCommandMock.mock.calls[1]?.arguments[1]), /cp 'public\/index\.html' index\.html/);
  assert.deepEqual(markSandboxDirtyMock.mock.calls.map((call) => call.arguments[1]), [
    'managed_frontend_build_prepare',
    'managed_shell_execute',
  ]);
});

test('shell_execute blocks preview/dev commands while deployment-orchestrator is active', async () => {
  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [
      {
        id: 'skill-1',
        slug: 'deployment-orchestrator',
        name: '部署编排',
        promptMarkdown: '# deployment',
      },
    ],
    mcpProviders: [],
  });

  await assert.rejects(
    runtime.execute('shell_execute', {
      command: 'PORT=3000 npm run preview > /dev/null 2>&1 &',
      cwd: '.',
    }),
    /deployment_shell_preview_blocked/
  );
});

test('shell_execute manages persistent local server commands as background services in auto mode', async () => {
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async () => ({
    stdout: [
      '__ONECEO_SERVICE_PID__=1234',
      '__ONECEO_SERVICE_URL__=http://127.0.0.1:8080/',
      '__ONECEO_SERVICE_ID__=managed-session-1-1',
      '__ONECEO_SERVICE_STATUS__=ready',
      '__ONECEO_SERVICE_PORT__=8080',
      '__ONECEO_SERVICE_LOG__=/tmp/oneceo-managed-services/session-1/managed-session-1-1.log',
      '__ONECEO_SERVICE_PID_FILE__=/tmp/oneceo-managed-services/session-1/managed-session-1-1.pid',
    ].join('\n'),
    stderr: '',
    exitCode: 0,
  }) as any);
  const markSandboxDirtyMock = mock.fn(async () => undefined);
  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-1',
      userId: 'user-1',
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      activeSkills: [],
      mcpProviders: [],
    },
    {
      touchSandbox: mock.fn(async () => undefined) as any,
      markSandboxDirty: markSandboxDirtyMock as any,
    }
  );

  const result = await runtime.execute('shell_execute', {
    command: 'python3 -m http.server 8080 &',
    cwd: '.',
  });

  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.runMode, 'background_service');
  assert.equal(payload.service.status, 'ready');
  assert.equal(payload.service.port, 8080);
  assert.equal(payload.service.url, 'http://127.0.0.1:8080/');
  assert.equal(payload.nextSuggestedTool, 'debug_open_page');
  assert.equal(runCommandMock.mock.callCount(), 1);
  assert.match(runCommandMock.mock.calls[0]?.arguments[1] || '', /setsid sh -lc/);
  assert.deepEqual(markSandboxDirtyMock.mock.calls[0]?.arguments, [
    'sandbox-1',
    'managed_shell_background_service',
  ]);
});

test('shell_execute rejects persistent local server commands in explicit foreground mode', async () => {
  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [],
    mcpProviders: [],
  });

  await assert.rejects(
    runtime.execute('shell_execute', {
      command: 'python3 -m http.server 8080',
      cwd: '.',
      runMode: 'foreground',
    }),
    /shell_execute_persistent_local_server_foreground_blocked/
  );
});

test('debug_open_page rejects non-http protocols', async () => {
  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [],
    mcpProviders: [],
  });

  await assert.rejects(
    runtime.execute('debug_open_page', {
      url: 'ftp://127.0.0.1/index.html',
    }),
    /debug_open_page_invalid_protocol/
  );
});

test('debug_open_page rejects file targets outside workspace', async () => {
  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [],
    mcpProviders: [],
  });

  await assert.rejects(
    runtime.execute('debug_open_page', {
      url: 'file:///tmp/index.html',
    }),
    /debug_open_page_file_outside_workspace/
  );
});

test('debug_open_page ensures debug and opens URL via CDP', async () => {
  const ensureDebugMock = mock.fn(
    async () =>
      ({
        ready: true,
        url: 'https://8081-sandbox-1.e2b.app?pwd=oneceo&usr=oneceo',
        status: 'running',
        updatedAt: new Date().toISOString(),
        sandboxId: 'sandbox-1',
        port: 8081,
        display: ':0',
        cdpPort: 9222,
      }) as any
  );
  mock.method(e2bConnector, 'runCommand', async () => ({
    stdout: '{"id":"page-1","url":"http://127.0.0.1:3000/folder1/"}\n__OPENED_BY__=PUT\n__ONECEO_DEBUG_TARGET_TAB_READY__=Folder 1\n__ONECEO_DEBUG_RESULT__=ok',
    stderr: '',
    exitCode: 0,
  }) as any);

  const touchSandboxMock = mock.fn(async () => undefined);
  const markSandboxDirtyMock = mock.fn(async () => undefined);

  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      activeSkills: [],
      mcpProviders: [],
    },
    {
      touchSandbox: touchSandboxMock as any,
      markSandboxDirty: markSandboxDirtyMock as any,
    },
    {
      ensureNekoDebug: ensureDebugMock as any,
      issueIceServersForUser: mock.fn(async () => null) as any,
    },
  );

  const result = await runtime.execute('debug_open_page', {
    url: 'http://127.0.0.1:3000/folder1/',
  });

  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.targetUrl, 'http://127.0.0.1:3000/folder1/');
  assert.equal(payload.debugUrl, 'https://8081-sandbox-1.e2b.app?pwd=oneceo&usr=oneceo');
  assert.equal(payload.ready, true);
  assert.equal(payload.status, 'running');
  assert.equal(payload.sandboxId, 'sandbox-1');
  assert.equal(markSandboxDirtyMock.mock.callCount(), 1);
  assert.deepEqual(markSandboxDirtyMock.mock.calls[0]?.arguments, ['sandbox-1', 'managed_debug_open_page']);
  assert.equal(ensureDebugMock.mock.callCount(), 1);
});

test('debug_open_page normalizes local target URL without scheme', async () => {
  const ensureDebugMock = mock.fn(
    async () =>
      ({
        ready: true,
        url: 'https://8081-sandbox-1.e2b.app?pwd=oneceo&usr=oneceo',
        status: 'running',
        updatedAt: new Date().toISOString(),
        sandboxId: 'sandbox-1',
        port: 8081,
        display: ':0',
        cdpPort: 9222,
      }) as any
  );
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async () => ({
    stdout: '{"id":"page-1","url":"http://127.0.0.1:8080/"}\n__ONECEO_DEBUG_TARGET_TAB_READY__=Local\n__ONECEO_DEBUG_RESULT__=ok',
    stderr: '',
    exitCode: 0,
  }) as any);
  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-1',
      userId: 'user-1',
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      activeSkills: [],
      mcpProviders: [],
    },
    {
      touchSandbox: mock.fn(async () => undefined) as any,
      markSandboxDirty: mock.fn(async () => undefined) as any,
    },
    {
      ensureNekoDebug: ensureDebugMock as any,
      issueIceServersForUser: mock.fn(async () => null) as any,
    },
  );

  const result = await runtime.execute('debug_open_page', {
    url: '127.0.0.1:8080',
  });

  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.targetUrl, 'http://127.0.0.1:8080/');
  assert.equal(runCommandMock.mock.callCount(), 1);
});

test('debug_open_page opens workspace file targets in debug browser', async () => {
  const ensureDebugMock = mock.fn(
    async () =>
      ({
        ready: true,
        url: 'https://8081-sandbox-1.e2b.app?pwd=oneceo&usr=oneceo',
        status: 'running',
        updatedAt: new Date().toISOString(),
        sandboxId: 'sandbox-1',
        port: 8081,
        display: ':0',
        cdpPort: 9222,
      }) as any
  );
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async () => ({
    stdout: '__ONECEO_DEBUG_TARGET_FILE_READY__=/workspace/session-1/index.html\n{\"id\":\"page-1\",\"url\":\"file:///workspace/session-1/index.html\"}\n__ONECEO_DEBUG_TARGET_TAB_READY__=2048\n__ONECEO_DEBUG_RESULT__=ok',
    stderr: '',
    exitCode: 0,
  }) as any);
  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-1',
      userId: 'user-1',
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      activeSkills: [],
      mcpProviders: [],
    },
    {
      touchSandbox: mock.fn(async () => undefined) as any,
      markSandboxDirty: mock.fn(async () => undefined) as any,
    },
    {
      ensureNekoDebug: ensureDebugMock as any,
      issueIceServersForUser: mock.fn(async () => null) as any,
    },
  );

  const result = await runtime.execute('debug_open_page', {
    url: 'file:///workspace/session-1/index.html',
  });

  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.targetUrl, 'file:///workspace/session-1/index.html');
  assert.equal(payload.protocol, 'file');
  assert.equal(payload.localFilePath, '/workspace/session-1/index.html');
  assert.equal(runCommandMock.mock.callCount(), 1);
});

test('browser_interact executes an explicit Playwright action against the debug browser', async () => {
  let capturedCommand = '';
  mock.method(e2bConnector, 'runCommand', async (_sandboxId, command) => {
    capturedCommand = String(command);
    return {
      stdout: '{"ok":true,"action":"keyboard_press","url":"file:///workspace/session-1/index.html","title":"2048"}',
      stderr: '',
      exitCode: 0,
    };
  });

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [],
    mcpProviders: [],
  });

  const result = await runtime.execute('browser_interact', {
    action: 'keyboard_press',
    key: 'ArrowUp',
    description: '按下 ArrowUp 键',
  });

  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.action, 'keyboard_press');
  assert.equal(payload.key, 'ArrowUp');
  assert.equal(payload.description, '按下 ArrowUp 键');
  assert.match(capturedCommand, /chromium\.connectOverCDP/);
  assert.match(capturedCommand, /ArrowUp/);
});

test('browser_interact rejects unknown browser actions', async () => {
  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [],
    mcpProviders: [],
  });

  await assert.rejects(
    runtime.execute('browser_interact', {
      action: 'hover',
    }),
    /browser_interact_invalid_action/
  );
});

test('debug_open_page rejects unreachable target page before reporting success', async () => {
  const ensureDebugMock = mock.fn(
    async () =>
      ({
        ready: true,
        url: 'https://8081-sandbox-1.e2b.app?pwd=oneceo&usr=oneceo',
        status: 'running',
        updatedAt: new Date().toISOString(),
        sandboxId: 'sandbox-1',
        port: 8081,
        display: ':0',
        cdpPort: 9222,
      }) as any
  );
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async () => ({
    stdout: '__ONECEO_DEBUG_TARGET_UNREACHABLE__\ncurl: (7) Failed to connect to 127.0.0.1 port 8080\n__ONECEO_DEBUG_RESULT__=target_unreachable',
    stderr: '',
    exitCode: 0,
  }) as any);
  const touchSandboxMock = mock.fn(async () => undefined);
  const markSandboxDirtyMock = mock.fn(async () => undefined);

  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-1',
      userId: 'user-1',
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      activeSkills: [],
      mcpProviders: [],
    },
    {
      touchSandbox: touchSandboxMock as any,
      markSandboxDirty: markSandboxDirtyMock as any,
    },
    {
      ensureNekoDebug: ensureDebugMock as any,
      issueIceServersForUser: mock.fn(async () => null) as any,
    },
  );

  await assert.rejects(
    runtime.execute('debug_open_page', {
      url: 'http://127.0.0.1:8080/',
    }),
    /debug_open_page_failed:__ONECEO_DEBUG_TARGET_UNREACHABLE__/
  );

  assert.equal(runCommandMock.mock.callCount(), 1);
  assert.equal(markSandboxDirtyMock.mock.callCount(), 0);
});

test('debug_open_page rejects target pages that return bad HTTP status', async () => {
  const ensureDebugMock = mock.fn(
    async () =>
      ({
        ready: true,
        url: 'https://8081-sandbox-1.e2b.app?pwd=oneceo&usr=oneceo',
        status: 'running',
        updatedAt: new Date().toISOString(),
        sandboxId: 'sandbox-1',
        port: 8081,
        display: ':0',
        cdpPort: 9222,
      }) as any
  );
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async () => ({
    stdout: '__ONECEO_DEBUG_TARGET_BAD_STATUS__=500\nInternal Server Error\n__ONECEO_DEBUG_RESULT__=target_bad_status',
    stderr: '',
    exitCode: 0,
  }) as any);
  const touchSandboxMock = mock.fn(async () => undefined);
  const markSandboxDirtyMock = mock.fn(async () => undefined);

  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-1',
      userId: 'user-1',
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      activeSkills: [],
      mcpProviders: [],
    },
    {
      touchSandbox: touchSandboxMock as any,
      markSandboxDirty: markSandboxDirtyMock as any,
    },
    {
      ensureNekoDebug: ensureDebugMock as any,
      issueIceServersForUser: mock.fn(async () => null) as any,
    },
  );

  await assert.rejects(
    runtime.execute('debug_open_page', {
      url: 'http://127.0.0.1:8080/',
    }),
    /debug_open_page_failed:__ONECEO_DEBUG_TARGET_BAD_STATUS__=500/
  );

  assert.equal(runCommandMock.mock.callCount(), 1);
  assert.equal(markSandboxDirtyMock.mock.callCount(), 0);
});

test('debug_open_page fails fast when debug runtime reports failed status', async () => {
  const ensureDebugMock = mock.fn(
    async () =>
      ({
        ready: false,
        status: 'failed',
        reasonCode: 'ice_failed',
        message: '远程调试 ICE 连接失败，请检查 TURN 配置后重试',
        sandboxId: 'sandbox-1',
      }) as any
  );
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async () => ({
    stdout: '',
    stderr: '',
    exitCode: 0,
  }) as any);
  const touchSandboxMock = mock.fn(async () => undefined);
  const markSandboxDirtyMock = mock.fn(async () => undefined);

  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      activeSkills: [],
      mcpProviders: [],
    },
    {
      touchSandbox: touchSandboxMock as any,
      markSandboxDirty: markSandboxDirtyMock as any,
    },
    {
      ensureNekoDebug: ensureDebugMock as any,
      issueIceServersForUser: mock.fn(async () => null) as any,
    },
  );

  await assert.rejects(
    runtime.execute('debug_open_page', {
      url: 'http://127.0.0.1:3000/folder1/',
    }),
    /debug_open_page_debug_not_ready:ice_failed/
  );

  assert.equal(ensureDebugMock.mock.callCount(), 1);
  assert.equal(runCommandMock.mock.callCount(), 0);
  assert.equal(markSandboxDirtyMock.mock.callCount(), 0);
});

test('deployment tools are blocked for non-deployable artifact sessions', async () => {
  const executeMock = mock.method(altusManagedDeploymentToolService, 'execute', async () => {
    throw new Error('should_not_be_called');
  });

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-non-deploy',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-non-deploy',
    activeSkills: [],
    mcpProviders: [],
    taskIntentProfile: {
      mode: 'non_deployable_artifact',
      reason: 'historical_explicit_no_deploy',
      recentUserMessages: [
        '请帮我写一个 HTML 邮件模板，用于报价通知邮件。只需要输出源码文件，不需要做网站，也不要部署。',
        '请按最佳方案直接继续，不需要再提问。',
      ],
      explicitNoDeploy: true,
      explicitNoWeb: true,
      webArtifactRequested: false,
      deployRequested: false,
      scriptArtifactRequested: false,
      emailTemplateRequested: true,
      deploymentAllowed: false,
      needsClarification: false,
      clarificationQuestion: '',
      clarificationType: 'none',
      todoRequired: false,
      todoReason: 'none',
    },
  });

  await assert.rejects(
    runtime.execute('deploy_application', {
      notes: 'publish current app',
    }),
    /deployment_tool_not_allowed_without_explicit_request/
  );

  assert.equal(executeMock.mock.callCount(), 0);
});

test('deployment tools are blocked for website source sessions without an explicit deploy request', async () => {
  const executeMock = mock.method(altusManagedDeploymentToolService, 'execute', async () => {
    throw new Error('should_not_be_called');
  });

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-web-source-only',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-web-source-only',
    activeSkills: [],
    mcpProviders: [],
    taskIntentProfile: {
      mode: 'deployable_web_app',
      reason: 'historical_deployable_request',
      recentUserMessages: ['做一个纯 HTML 企业官网，包含首页、关于我们和联系我们，先给我源码文件。'],
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
  });

  await assert.rejects(
    runtime.execute('deploy_application', {
      notes: 'publish current app',
    }),
    /deployment_tool_not_allowed_without_explicit_request/
  );

  await assert.rejects(
    runtime.execute('get_application_deployment_status', {
      notes: 'check deployment',
    }),
    /deployment_tool_not_allowed_without_explicit_request/
  );

  assert.equal(executeMock.mock.callCount(), 0);
});

test('todowrite accepts a valid in-progress todo snapshot', async () => {
  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-todo',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-todo',
    activeSkills: [],
    mcpProviders: [],
  });

  const result = await runtime.execute('todowrite', {
    todos: [
      { content: '梳理需求边界', status: 'completed' },
      { content: '修改后端主链', status: 'in_progress', activeForm: '正在修改后端主链' },
      { content: '补充回归测试', status: 'pending' },
    ],
  });

  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.todos.length, 3);
  assert.equal(payload.todos[1]?.status, 'in_progress');
});

test('todowrite rejects snapshots without exactly one in-progress item while work is ongoing', async () => {
  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-todo-invalid',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-todo-invalid',
    activeSkills: [],
    mcpProviders: [],
  });

  await assert.rejects(
    runtime.execute('todowrite', {
      todos: [
        { content: '修改后端主链', status: 'pending' },
        { content: '补充回归测试', status: 'pending' },
      ],
    }),
    /todowrite_requires_single_in_progress/
  );
});

test('ask_user preserves structured clarification type for pending state', async () => {
  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-ask-user-clarification-type',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-ask-user-clarification-type',
    activeSkills: [],
    mcpProviders: [],
  });

  const result = await runtime.execute('ask_user', {
    question: '这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？',
    options: ['网页应用', '后端 API'],
    clarificationType: 'artifact_type',
  });

  assert.equal(result.type, 'ask_user');
  if (result.type !== 'ask_user') {
    throw new Error('expected ask_user result');
  }
  assert.equal(result.clarificationType, 'artifact_type');
});
