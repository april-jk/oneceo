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
        required: true,
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
          required: true,
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
      url: 'file:///tmp/index.html',
    }),
    /debug_open_page_invalid_protocol/
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
    stdout: '{"id":"page-1","url":"http://127.0.0.1:3000/folder1/"}\n__OPENED_BY__=PUT',
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
