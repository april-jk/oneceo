import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { e2bConnector } from '../src/connectors/e2b-connector';
import { AltusManagedToolRuntime } from '../src/services/altus-managed-tool-runtime';
import { sandboxSkillSyncService } from '../src/services/sandbox-skill-sync-service';
import { connectorGuideService } from '../src/services/connector-guide-service';
import { osacAgentService } from '../src/services/osac-agent-service';
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
