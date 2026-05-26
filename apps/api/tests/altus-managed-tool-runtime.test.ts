import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { e2bConnector } from '../src/connectors/e2b-connector';
import {
  AltusManagedToolRuntime,
  __altusManagedToolRuntimeTestHooks,
} from '../src/services/altus-managed-tool-runtime';
import { sandboxSkillSyncService } from '../src/services/sandbox-skill-sync-service';
import { connectorGuideService } from '../src/services/connector-guide-service';
import { osacAgentService } from '../src/services/osac-agent-service';
import { altusManagedDeploymentToolService } from '../src/services/altus-managed-deployment-tool-service';
import { pptRenderToolService } from '../src/services/ppt-render-tool-service';
import { userSkillService } from '../src/services/user-skill-service';
import { buildManagedMcpToolName } from '../src/services/altus-managed-shared';
import { buildManagedToolResultEnvelope } from '../src/services/altus-managed-tool-result-envelope';

afterEach(() => {
  mock.reset();
});

test('load_skill_resource only allows active selected platform skills and returns synced path', async () => {
  const syncMock = mock.method(sandboxSkillSyncService, 'syncResolvedSkillResource', async () => ({
    taskSessionId: 'session-1',
    orchestratorSessionId: 'sandbox-1',
    skillId: 'skill-1',
    revisionId: 'rev-1',
    slug: 'ppt-workflow',
    resourcePath: 'references/subtask-contracts.md',
    skillResourcePath: '/home/user/.config/opencode/skills/platform/ppt-workflow/references/subtask-contracts.md',
    resourceType: 'reference',
    contentMarkdown: '# Ref Body',
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
        slug: 'ppt-workflow',
        name: 'PPT 工作流',
        description: 'PPT 子任务编排',
        category: 'office',
        renderedMarkdown: '# Skill Brief',
        revisionNumber: 3,
        resourceSummary: {
          totalCount: 2,
          referenceCount: 1,
          templateCount: 1,
          paths: ['references/subtask-contracts.md', 'templates/render-instruction-draft.md'],
        },
      },
    ],
  });

  const result = await runtime.execute('load_skill_resource', {
    skillId: 'skill-1',
    revisionId: 'rev-1',
    resourcePath: 'references/subtask-contracts.md',
  });

  assert.equal(syncMock.mock.callCount(), 1);
  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.skillId, 'skill-1');
  assert.equal(payload.resourceType, 'reference');
  assert.equal(payload.contentMarkdown, '# Ref Body');
  assert.match(payload.usageHint, /Use contentMarkdown directly/);
  assert.match(payload.skillResourcePath, /ppt-workflow\/references\/subtask-contracts\.md$/);
});

test('load_skill_resource accepts active skill slug and revisionNumber as a narrow fallback', async () => {
  const syncMock = mock.method(sandboxSkillSyncService, 'syncResolvedSkillResource', async (input: any) => ({
    taskSessionId: 'session-1',
    orchestratorSessionId: 'sandbox-1',
    skillId: input.skill.skillId,
    revisionId: input.skill.revisionId,
    slug: input.skill.slug,
    resourcePath: input.resourcePath,
    skillResourcePath: '/home/user/.config/opencode/skills/platform/wide-research/references/routing.md',
    resourceType: 'reference',
    contentMarkdown: '# Routing',
  }));

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [
      {
        sourceType: 'platform',
        skillId: 'skill-wide-research',
        revisionId: 'rev-wide-research-15',
        slug: 'wide-research',
        name: '广度调研',
        description: '广度调研 Skill',
        category: 'research',
        renderedMarkdown: '# Skill Brief',
        revisionNumber: 15,
        resourceSummary: {
          totalCount: 1,
          referenceCount: 1,
          templateCount: 0,
          paths: ['references/routing.md'],
        },
      },
    ],
  });

  const result = await runtime.execute('load_skill_resource', {
    skillId: 'wide-research',
    revisionId: '15',
    resourcePath: 'references/routing.md',
  });

  assert.equal(syncMock.mock.callCount(), 1);
  const syncInput = syncMock.mock.calls[0]?.arguments[0] as any;
  assert.equal(syncInput.skill.skillId, 'skill-wide-research');
  assert.equal(syncInput.skill.revisionId, 'rev-wide-research-15');
  const payload = JSON.parse(result.content);
  assert.equal(payload.skillId, 'skill-wide-research');
  assert.equal(payload.revisionId, 'rev-wide-research-15');
  assert.equal(payload.contentMarkdown, '# Routing');
});

test('load_skill_resource accepts platform display skill ids from prompt context', async () => {
  const syncMock = mock.method(sandboxSkillSyncService, 'syncResolvedSkillResource', async (input: any) => ({
    taskSessionId: 'session-1',
    orchestratorSessionId: 'sandbox-1',
    skillId: input.skill.skillId,
    revisionId: input.skill.revisionId,
    slug: input.skill.slug,
    resourcePath: input.resourcePath,
    skillResourcePath: '/home/user/.config/opencode/skills/platform/ppt-workflow/templates/render-instruction-draft.md',
    resourceType: 'template',
    contentMarkdown: '# Render Draft',
  }));

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [
      {
        sourceType: 'platform',
        skillId: '569150cf-820e-48df-8966-e24abe47aae8',
        revisionId: 'c954276e-1cae-495f-bdf6-4af11c8221dc',
        slug: 'ppt-workflow',
        name: 'PPT 工作流',
        description: 'PPT 子任务编排',
        category: 'office',
        renderedMarkdown: '# Skill Brief',
        revisionNumber: 6,
        resourceSummary: {
          totalCount: 1,
          referenceCount: 0,
          templateCount: 1,
          paths: ['templates/render-instruction-draft.md'],
        },
      },
    ],
  });

  const result = await runtime.execute('load_skill_resource', {
    skillId: 'skill:platform:569150cf-820e-48df-8966-e24abe47aae8',
    revisionId: 'c954276e-1cae-495f-bdf6-4af11c8221dc',
    resourcePath: 'templates/render-instruction-draft.md',
  });

  assert.equal(syncMock.mock.callCount(), 1);
  const syncInput = syncMock.mock.calls[0]?.arguments[0] as any;
  assert.equal(syncInput.skill.skillId, '569150cf-820e-48df-8966-e24abe47aae8');
  assert.equal(syncInput.skill.revisionId, 'c954276e-1cae-495f-bdf6-4af11c8221dc');
  const payload = JSON.parse(result.content);
  assert.equal(payload.resourcePath, 'templates/render-instruction-draft.md');
  assert.equal(payload.contentMarkdown, '# Render Draft');
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
      resourcePath: 'references/subtask-contracts.md',
    }),
    /load_skill_resource_skill_not_active/
  );
});

test('render_pptx_from_instructions requires active ppt-workflow skill', async () => {
  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [],
  });

  await assert.rejects(
    runtime.execute('render_pptx_from_instructions', {
      instructions: {},
    }),
    /render_pptx_from_instructions_ppt_workflow_not_active/
  );
});

test('render_pptx_from_instructions returns renderer result for active ppt workflow', async () => {
  const renderMock = mock.method(pptRenderToolService, 'render', async () => ({
    status: 'completed',
    pptxPath: 'deliverables/career-plan.pptx',
    reportPath: 'deliverables/career-plan.render-report.json',
    slideCount: 5,
    warnings: [],
    repairHints: [],
  }) as any);
  const markDirtyMock = mock.fn(async () => undefined);
  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-1',
      userId: 'user-1',
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      activeSkills: [
        {
          sourceType: 'platform',
          skillId: 'skill-ppt-workflow',
          revisionId: 'rev-ppt-workflow',
          slug: 'ppt-workflow',
          name: 'PPT 工作流',
          description: 'PPT 子任务编排',
          category: 'office',
          renderedMarkdown: '# Skill Brief',
          revisionNumber: 2,
          resourceSummary: null,
        },
      ],
    },
    {
      touchSandbox: async () => undefined,
      markSandboxDirty: markDirtyMock,
    }
  );

  const result = await runtime.execute('render_pptx_from_instructions', {
    instructions: {
      deck: { title: '职业规划', slideCount: 1, fileName: 'career-plan.pptx' },
      theme: { colorTokens: { background: '#ffffff', primary: '#0969da', text: '#1f2328' } },
      slides: [{ index: 1, pageType: 'cover', title: '职业规划', coreMessage: '从探索到落地' }],
      sources: [],
      openQuestions: [],
    },
  });

  assert.equal(renderMock.mock.callCount(), 1);
  assert.equal(markDirtyMock.mock.callCount(), 1);
  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.pptxPath, 'deliverables/career-plan.pptx');
  assert.equal(payload.slideCount, 5);
});

test('complete_task rejects pptx attachments that bypass ppt workflow renderer', async () => {
  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [
      {
        sourceType: 'platform',
        skillId: 'skill-ppt-workflow',
        revisionId: 'rev-ppt-workflow',
        slug: 'ppt-workflow',
        name: 'PPT 工作流',
        description: 'PPT 子任务编排',
        category: 'office',
        renderedMarkdown: '# Skill Brief',
        revisionNumber: 2,
        resourceSummary: null,
      },
    ],
  });

  await assert.rejects(
    runtime.execute('complete_task', {
      summary: '已生成 PPT',
      attachments: [{ path: 'openai-codex-introduction.pptx' }],
    }),
    /complete_task_pptx_requires_render_pptx_from_instructions/
  );
});

test('complete_task rejects malformed downloadable attachments payloads', async () => {
  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    userInput: '请生成一份 docx 正式方案并交付给我下载',
    activeSkills: [],
    mcpProviders: [],
  });

  await assert.rejects(
    runtime.execute('complete_task', {
      summary: '已生成文档',
      attachments: '[{\"path\":\"deliverables/final.docx\"}]',
    }),
    /complete_task_attachments_invalid/
  );
});

test('write_file rejects binary deliverable targets that require a real generator', async () => {
  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [],
    mcpProviders: [],
  });

  await assert.rejects(
    runtime.execute('write_file', {
      path: 'deliverables/final.docx',
      content: '# 这其实只是 markdown',
    }),
    /write_file_binary_deliverable_requires_generator/
  );
});

test('complete_task rejects downloadable tasks without attachments', async () => {
  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    userInput: '请生成一份 pdf 报告并交付给我下载',
    activeSkills: [],
    mcpProviders: [],
  });

  await assert.rejects(
    runtime.execute('complete_task', {
      summary: '报告已完成',
    }),
    /complete_task_downloadable_requires_attachments/
  );
});

test('complete_task does not require attachments for later non-delivery follow-up turns', async () => {
  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    userInput: '为什么这个 xlsx 打不开，帮我分析原因就行',
    activeSkills: [],
    mcpProviders: [],
    taskIntentProfile: {
      mode: 'non_deployable_artifact',
      reason: 'follow_up_debug_only',
      recentUserMessages: ['请生成一份 xlsx 报表并交付给我下载'],
      explicitNoDeploy: true,
      explicitNoWeb: true,
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
    },
  });

  const result = await runtime.execute('complete_task', {
    summary: '已分析 xlsx 无法打开的原因',
  });

  assert.equal(result.type, 'complete');
});

test('tool result envelope gives repair guidance for malformed attachments payloads', () => {
  const envelope = buildManagedToolResultEnvelope({
    status: 'error',
    runId: 'run-1',
    toolUseId: 'tool-1',
    toolName: 'complete_task',
    modelRoundId: 'round-1',
    args: {
      summary: '已生成文档',
      attachments: '[{"path":"deliverables/final.docx"}]',
    },
    errorMessage: 'complete_task_attachments_invalid',
  });

  assert.equal(envelope.errorCode, 'complete_task_attachments_invalid');
  assert.equal(envelope.retryable, true);
  const payload = JSON.parse(envelope.contentForModel);
  assert.equal(payload.status, 'error');
  assert.match(payload.error, /must be a JSON array/i);
  assert.match(payload.instruction, /Re-run complete_task with attachments as a real JSON array/i);
});

test('tool result envelope gives repair guidance for missing downloadable attachments', () => {
  const envelope = buildManagedToolResultEnvelope({
    status: 'error',
    runId: 'run-1',
    toolUseId: 'tool-2',
    toolName: 'complete_task',
    modelRoundId: 'round-1',
    args: {
      summary: '报告已完成',
    },
    errorMessage: 'complete_task_downloadable_requires_attachments',
  });

  assert.equal(envelope.errorCode, 'complete_task_downloadable_requires_attachments');
  assert.equal(envelope.retryable, true);
  const payload = JSON.parse(envelope.contentForModel);
  assert.equal(payload.status, 'error');
  assert.match(payload.error, /downloadable artifact/i);
  assert.match(payload.instruction, /Confirm the final downloadable file exists in the workspace/i);
});

test('tool result envelope steers binary deliverables away from write_file', () => {
  const envelope = buildManagedToolResultEnvelope({
    status: 'error',
    runId: 'run-1',
    toolUseId: 'tool-3',
    toolName: 'write_file',
    modelRoundId: 'round-1',
    args: {
      path: 'deliverables/final.docx',
      content: '# fake docx',
    },
    errorMessage: 'write_file_binary_deliverable_requires_generator',
  });

  assert.equal(envelope.errorCode, 'write_file_binary_deliverable_requires_generator');
  assert.equal(envelope.retryable, true);
  const payload = JSON.parse(envelope.contentForModel);
  assert.equal(payload.status, 'error');
  assert.match(payload.error, /write_file only supports UTF-8 text files/i);
  assert.match(payload.instruction, /Do not use write_file/i);
});

test('tool result envelope classifies Playwright CDP open failures as debug browser failures', () => {
  const envelope = buildManagedToolResultEnvelope({
    status: 'error',
    runId: 'run-1',
    toolUseId: 'tool-debug-open',
    toolName: 'debug_open_page',
    modelRoundId: 'round-1',
    args: {
      url: 'http://127.0.0.1:8080/',
    },
    errorMessage:
      'debug_open_page_failed:__ONECEO_DEBUG_OPEN_PAGE_STRUCTURED_FAILURE__=debug_open_page_playwright_failed: page.goto failed: diagnostics=page_goto | http://127.0.0.1:9222',
  });

  assert.equal(envelope.errorCode, 'debug_open_page_cdp_open_failed');
  assert.equal(envelope.retryable, true);
  const payload = JSON.parse(envelope.contentForModel);
  assert.equal(payload.status, 'error');
  assert.match(payload.error, /Chromium CDP did not open/i);
  assert.match(payload.instruction, /debug browser state has changed/i);
});

test('complete_task accepts pptx attachment returned by ppt workflow renderer', async () => {
  mock.method(pptRenderToolService, 'render', async () => ({
    status: 'completed',
    pptxPath: 'deliverables/career-plan.pptx',
    reportPath: 'deliverables/career-plan.render-report.json',
    slideCount: 5,
    warnings: [],
    repairHints: [],
  }) as any);
  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-1',
      userId: 'user-1',
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      activeSkills: [
        {
          sourceType: 'platform',
          skillId: 'skill-ppt-workflow',
          revisionId: 'rev-ppt-workflow',
          slug: 'ppt-workflow',
          name: 'PPT 工作流',
          description: 'PPT 子任务编排',
          category: 'office',
          renderedMarkdown: '# Skill Brief',
          revisionNumber: 2,
          resourceSummary: null,
        },
      ],
    },
    {
      touchSandbox: async () => undefined,
      markSandboxDirty: async () => undefined,
    }
  );

  await runtime.execute('render_pptx_from_instructions', {
    instructions: {
      deck: { title: '职业规划', slideCount: 1, fileName: 'career-plan.pptx' },
      theme: { colorTokens: { background: '#ffffff', primary: '#0969da', text: '#1f2328' } },
      slides: [{ index: 1, pageType: 'cover', title: '职业规划', coreMessage: '从探索到落地' }],
      sources: [],
      openQuestions: [],
    },
  });
  const result = await runtime.execute('complete_task', {
    summary: '已生成 PPT',
    attachments: [{ path: 'deliverables/career-plan.pptx' }],
  });

  assert.equal(result.type, 'complete');
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

test('approved google_super replay bypasses connector guide blocking even when confirmationAgentRunId is missing', async () => {
  const managedToolName = buildManagedMcpToolName('provider-google', 'COMPOSIO_MULTI_EXECUTE_TOOL');
  const guideMock = mock.method(connectorGuideService, 'getActiveGuideForConnector', async (_sessionId, connectorKey) => {
    if (connectorKey !== 'google_super') return null;
    return {
      connectorKey: 'google_super',
      policyId: 'policy-google-1',
      revisionId: 'rev-google-1',
      triggerMode: 'on_attach',
      serverInstructionsMarkdown: 'Search tools first for normal planning.',
      guideReminderMarkdown: 'Google guide active.',
      blockingRulesMarkdown: 'Load the guide before normal Google router usage.',
    };
  });
  const mcpMock = mock.method(osacAgentService, 'callSessionMcpTool', async () => ({
    providerId: 'provider-google',
    toolName: 'COMPOSIO_MULTI_EXECUTE_TOOL',
    result: { ok: true, messageId: 'msg-1' },
    isError: false,
  }));

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-google-replay',
    userId: 'user-1',
    sandboxId: 'sandbox-google-replay',
    workspaceRoot: '/workspace/session-google-replay',
    activeSkills: [],
    mcpProviders: [
      {
        connectorKey: 'google_super',
        providerId: 'provider-google',
        tools: [{ providerId: 'provider-google', toolName: 'COMPOSIO_MULTI_EXECUTE_TOOL' }],
      },
    ],
  });

  const toolResult = await runtime.execute(managedToolName, {
    tools: [
      {
        tool_slug: 'GOOGLESUPER_SEND_EMAIL',
        arguments: {
          recipient_email: '3065025109@qq.com',
          subject: '测试',
        },
      },
    ],
    confirmationToken: 'token-1',
  });

  assert.equal(toolResult.type, 'result');
  const payload = JSON.parse(toolResult.content);
  assert.deepEqual(payload.result, { ok: true, messageId: 'msg-1' });
  assert.equal(mcpMock.mock.callCount(), 1);
  assert.ok(guideMock.mock.callCount() >= 1);
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

test('composio search tool call is blocked until active connector guide is loaded', async () => {
  const managedToolName = buildManagedMcpToolName('provider-google', 'google_super__COMPOSIO_SEARCH_TOOLS');
  const guideMock = mock.method(connectorGuideService, 'getActiveGuideForConnector', async (_sessionId, connectorKey) => {
    if (connectorKey !== 'google_super') return null;
    return {
      connectorKey: 'google_super',
      policyId: 'policy-google',
      revisionId: 'rev-google-2',
      triggerMode: 'on_attach',
      serverInstructionsMarkdown: 'Use search only after loading this guide.',
      guideReminderMarkdown: 'Google guide active.',
      blockingRulesMarkdown: 'Load the guide before Google router usage.',
    };
  });
  const mcpMock = mock.method(osacAgentService, 'callSessionMcpTool', async () => ({
    providerId: 'provider-google',
    toolName: 'google_super__COMPOSIO_SEARCH_TOOLS',
    result: { ok: true },
    isError: false,
  }));

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-google-search-block',
    userId: 'user-1',
    sandboxId: 'sandbox-google-search-block',
    workspaceRoot: '/workspace/session-google-search-block',
    activeSkills: [],
    mcpProviders: [
      {
        connectorKey: 'google_super',
        providerId: 'provider-google',
        tools: [{ providerId: 'provider-google', toolName: 'google_super__COMPOSIO_SEARCH_TOOLS' }],
      },
    ],
  });

  await assert.rejects(
    runtime.execute(managedToolName, {
      queries: [{ use_case: 'search Gmail messages by sender' }],
      session: { generate_id: true },
    }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /connector_guide_blocked:google_super/);
      assert.match(message, /Search is also a connector MCP tool/);
      return true;
    }
  );

  await runtime.execute('load_connector_guide', {
    connectorKey: 'google_super',
  });
  const result = await runtime.execute(managedToolName, {
    queries: [{ use_case: 'search Gmail messages by sender' }],
    session: { generate_id: true },
  });

  assert.equal(result.type, 'result');
  assert.equal(mcpMock.mock.callCount(), 1);
  assert.ok(guideMock.mock.callCount() >= 2);
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

test('shell_execute manages fixed OneCEO shell node start command as background service', async () => {
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async (_sandboxId: string, command: string) => {
    assert.match(command, /service_health_url='http:\/\/127\.0\.0\.1:8080\/api\/system\/health'/);
    assert.match(command, /setsid sh -lc/);
    return {
      stdout: [
        '__ONECEO_SERVICE_PID__=1234',
        '__ONECEO_SERVICE_URL__=http://127.0.0.1:8080/',
        '__ONECEO_SERVICE_HEALTH_URL__=http://127.0.0.1:8080/api/system/health',
        '__ONECEO_SERVICE_ID__=managed-session-1-1',
        '__ONECEO_SERVICE_STATUS__=ready',
        '__ONECEO_SERVICE_PORT__=8080',
        '__ONECEO_SERVICE_LOG__=/tmp/oneceo-managed-services/session-1/managed-session-1-1.log',
        '__ONECEO_SERVICE_PID_FILE__=/tmp/oneceo-managed-services/session-1/managed-session-1-1.pid',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    } as any;
  });
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
    }
  );

  const result = await runtime.execute('shell_execute', {
    command: 'node dist/index.js',
    cwd: '.',
  });

  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.runMode, 'background_service');
  assert.equal(payload.service.port, 8080);
  assert.equal(payload.service.url, 'http://127.0.0.1:8080/');
  assert.equal(payload.service.healthUrl, 'http://127.0.0.1:8080/api/system/health');
  assert.equal(runCommandMock.mock.callCount(), 1);
});

test('shell_execute treats exited wrapper pid as ready when background service health is reachable', async () => {
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async (_sandboxId: string, command: string) => {
    assert.match(command, /__ONECEO_SERVICE_PID_EXITED__/);
    assert.match(command, /__ONECEO_SERVICE_START_FAILED__/);
    return {
      stdout: [
        '__ONECEO_SERVICE_PID__=1234',
        '__ONECEO_SERVICE_PID_EXITED__=1',
        'Server started with PID 1238',
        '[oneceo-official-web-shell] listening on port 8080',
        '__ONECEO_SERVICE_URL__=http://127.0.0.1:8080/',
        '__ONECEO_SERVICE_HEALTH_URL__=http://127.0.0.1:8080/api/system/health',
        '__ONECEO_SERVICE_ID__=managed-session-1-1',
        '__ONECEO_SERVICE_STATUS__=ready',
        '__ONECEO_SERVICE_PORT__=8080',
        '__ONECEO_SERVICE_LOG__=/tmp/oneceo-managed-services/session-1/managed-session-1-1.log',
        '__ONECEO_SERVICE_PID_FILE__=/tmp/oneceo-managed-services/session-1/managed-session-1-1.pid',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    } as any;
  });
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
    }
  );

  const result = await runtime.execute('shell_execute', {
    command: 'node dist/index.js &\necho "Server started with PID $!"',
    cwd: '.',
    runMode: 'background_service',
  });

  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.runMode, 'background_service');
  assert.equal(payload.service.status, 'ready');
  assert.equal(payload.service.url, 'http://127.0.0.1:8080/');
  assert.equal(payload.service.healthUrl, 'http://127.0.0.1:8080/api/system/health');
  assert.equal(payload.nextSuggestedTool, 'debug_open_page');
  assert.equal(runCommandMock.mock.callCount(), 1);
});

test('shell_execute resolves fixed OneCEO shell npm start from workspace package metadata', async () => {
  const packageJson = Buffer.from(JSON.stringify({
    scripts: {
      start: 'node dist/index.js',
    },
  })).toString('base64');
  const manifestJson = Buffer.from(JSON.stringify({
    start: {
      command: 'node dist/index.js',
      portEnv: 'PORT',
    },
    healthcheck: {
      path: '/api/system/health',
    },
  })).toString('base64');
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async (_sandboxId: string, command: string) => {
    if (command.includes('__ONECEO_PACKAGE_JSON__')) {
      return {
        stdout: [
          `__ONECEO_MANIFEST_JSON__=${manifestJson}`,
          `__ONECEO_PACKAGE_JSON__=${packageJson}`,
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      } as any;
    }
    assert.match(command, /service_command='npm run start'/);
    assert.match(command, /service_launch_command='PORT=8080; export PORT; npm run start'/);
    assert.match(command, /service_health_url='http:\/\/127\.0\.0\.1:8080\/api\/system\/health'/);
    return {
      stdout: [
        '__ONECEO_SERVICE_URL__=http://127.0.0.1:8080/',
        '__ONECEO_SERVICE_HEALTH_URL__=http://127.0.0.1:8080/api/system/health',
        '__ONECEO_SERVICE_ID__=managed-session-1-2',
        '__ONECEO_SERVICE_STATUS__=ready',
        '__ONECEO_SERVICE_PORT__=8080',
        '__ONECEO_SERVICE_LOG__=/tmp/oneceo-managed-services/session-1/managed-session-1-2.log',
        '__ONECEO_SERVICE_PID_FILE__=/tmp/oneceo-managed-services/session-1/managed-session-1-2.pid',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    } as any;
  });
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
    }
  );

  const result = await runtime.execute('shell_execute', {
    command: 'npm run start',
    cwd: '.',
  });

  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.runMode, 'background_service');
  assert.equal(payload.service.port, 8080);
  assert.equal(payload.service.healthUrl, 'http://127.0.0.1:8080/api/system/health');
  assert.equal(runCommandMock.mock.callCount(), 2);
});

test('shell_execute injects manifest preview port into fixed OneCEO shell package start', async () => {
  const packageJson = Buffer.from(JSON.stringify({
    scripts: {
      start: 'node dist/index.js',
    },
  })).toString('base64');
  const manifestJson = Buffer.from(JSON.stringify({
    start: {
      command: 'node dist/index.js',
      port: 8091,
    },
    healthcheck: {
      path: '/api/system/health',
    },
  })).toString('base64');
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async (_sandboxId: string, command: string) => {
    if (command.includes('__ONECEO_PACKAGE_JSON__')) {
      return {
        stdout: [
          `__ONECEO_MANIFEST_JSON__=${manifestJson}`,
          `__ONECEO_PACKAGE_JSON__=${packageJson}`,
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      } as any;
    }
    assert.match(command, /service_launch_command='PORT=8091; export PORT; npm run start'/);
    assert.match(command, /service_health_url='http:\/\/127\.0\.0\.1:8091\/api\/system\/health'/);
    return {
      stdout: [
        '__ONECEO_SERVICE_URL__=http://127.0.0.1:8091/',
        '__ONECEO_SERVICE_HEALTH_URL__=http://127.0.0.1:8091/api/system/health',
        '__ONECEO_SERVICE_ID__=managed-session-1-3',
        '__ONECEO_SERVICE_STATUS__=ready',
        '__ONECEO_SERVICE_PORT__=8091',
        '__ONECEO_SERVICE_LOG__=/tmp/oneceo-managed-services/session-1/managed-session-1-3.log',
        '__ONECEO_SERVICE_PID_FILE__=/tmp/oneceo-managed-services/session-1/managed-session-1-3.pid',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    } as any;
  });
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
    }
  );

  const result = await runtime.execute('shell_execute', {
    command: 'npm run start',
    cwd: '.',
  });

  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.service.port, 8091);
  assert.equal(payload.service.healthUrl, 'http://127.0.0.1:8091/api/system/health');
  assert.equal(runCommandMock.mock.callCount(), 2);
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

test('shell_execute rejects fixed OneCEO shell start command in explicit foreground mode', async () => {
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
      command: 'PORT=8090 node dist/index.js',
      cwd: '.',
      runMode: 'foreground',
    }),
    /shell_execute_persistent_local_server_foreground_blocked/
  );
});

test('shell_execute blocks managed debug browser lifecycle commands', async () => {
  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [],
    mcpProviders: [],
  });

  for (const command of [
    'curl -s http://127.0.0.1:9222/json/version 2>&1',
    'curl -s http://127.0.0.1:9222/ 2>&1',
    'curl -s http://127.0.0.1:9222/json/new?http%3A%2F%2F127.0.0.1%3A3000',
    '/opt/ms-playwright/chromium-1217/chrome-linux64/chrome --remote-debugging-port=9222 --no-sandbox',
    'Xvfb :0 -screen 0 1280x1008x24',
    'chromium --version',
    'neko serve --config /tmp/oneceo/debug-browser/neko.yml',
    'pkill -9 -f chrome 2>/dev/null; sleep 2; echo done',
    'pgrep -f remote-debugging | while read pid; do kill -9 $pid; done',
    'pkill -f neko || true',
    'pkill -f Xvfb || true',
    'rm -rf /tmp/.X0-lock /tmp/.X11-unix',
    'rm -rf /tmp/oneceo/debug-browser',
  ]) {
    await assert.rejects(
      runtime.execute('shell_execute', {
        command,
        cwd: '.',
      }),
      /shell_execute_managed_debug_browser_blocked/
    );
  }
});

test('shell_execute managed debug browser guard does not block ordinary preview commands', async () => {
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async (_sandboxId, command) => ({
    stdout: `ran ${command}`,
    stderr: '',
    exitCode: 0,
  }) as any);

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [],
    mcpProviders: [],
  });

  const result = await runtime.execute('shell_execute', {
    command: 'echo "preview server can use a normal high port like 9223"',
    cwd: '.',
  });

  assert.equal(result.type, 'result');
  assert.equal(runCommandMock.mock.callCount(), 1);
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
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async (_sandboxId, command) => {
    if (String(command).includes('ONECEO_BROWSER_SCREENSHOT=')) {
      return {
        stdout: '{"ok":true,"url":"http://127.0.0.1:3000/folder1/","title":"Folder 1","outputPath":"/tmp/shot.png"}',
        stderr: '',
        exitCode: 0,
      } as any;
    }
    return {
      stdout:
        '__ONECEO_DEBUG_OPEN_PAGE_RESULT__={"ok":true,"url":"http://127.0.0.1:3000/folder1/","title":"Folder 1"}\n__ONECEO_DEBUG_RESULT__=ok',
      stderr: '',
      exitCode: 0,
    } as any;
  });
  mock.method(e2bConnector, 'readFile', async () => Buffer.from('png-bytes'));

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
    {
      uploadToR2: mock.fn(async () => undefined) as any,
    }
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
  assert.equal(payload.browserScreenshot.status, 'captured');
  assert.equal(payload.browserScreenshot.source.url, 'http://127.0.0.1:3000/folder1/');
  assert.equal(markSandboxDirtyMock.mock.callCount(), 1);
  assert.deepEqual(markSandboxDirtyMock.mock.calls[0]?.arguments, ['sandbox-1', 'managed_debug_open_page']);
  assert.equal(ensureDebugMock.mock.callCount(), 1);
  const openCommand = String(runCommandMock.mock.calls[0]?.arguments[1] || '');
  assert.match(openCommand, /chromium\.connectOverCDP/);
  assert.match(openCommand, /page\.goto/);
  assert.doesNotMatch(openCommand, /\/json\/new/);
  assert.doesNotMatch(openCommand, /\/json\/list/);
});

test('debug_open_page includes visual health diagnostics with screenshot evidence', async () => {
  const ensureDebugMock = mock.fn(
    async () =>
      ({
        ready: true,
        url: 'https://8081-sandbox-visual.e2b.app',
        status: 'running',
        updatedAt: new Date().toISOString(),
        sandboxId: 'sandbox-visual',
        port: 8081,
        display: ':0',
        cdpPort: 9222,
      }) as any
  );
  mock.method(e2bConnector, 'runCommand', async (_sandboxId, command) => {
    if (String(command).includes('ONECEO_BROWSER_SCREENSHOT=')) {
      return {
        stdout: JSON.stringify({
          ok: true,
          url: 'http://127.0.0.1:3000/',
          title: 'Blank',
          outputPath: '/tmp/shot.png',
          visualCheck: {
            status: 'failed',
            reasonCode: 'screenshot_low_entropy',
            message: '截图几乎是单一颜色，疑似白屏或纯色空页面。',
            diagnostics: {
              visibleTextLength: 0,
              uniqueColorCount: 1,
              dominantColorRatio: 1,
            },
          },
        }),
        stderr: '',
        exitCode: 0,
      } as any;
    }
    return {
      stdout: '__ONECEO_DEBUG_OPEN_PAGE_RESULT__={"ok":true,"url":"http://127.0.0.1:3000/","title":"Blank"}\n__ONECEO_DEBUG_RESULT__=ok',
      stderr: '',
      exitCode: 0,
    } as any;
  });
  mock.method(e2bConnector, 'readFile', async () => Buffer.from('png-bytes'));

  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-visual',
      userId: 'user-visual',
      sandboxId: 'sandbox-visual',
      workspaceRoot: '/workspace/session-visual',
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
    {
      uploadToR2: mock.fn(async () => undefined) as any,
    }
  );

  const result = await runtime.execute('debug_open_page', {
    url: 'http://127.0.0.1:3000/',
  });

  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.browserScreenshot.status, 'captured');
  assert.equal(payload.browserScreenshot.visualCheck.status, 'failed');
  assert.equal(payload.browserScreenshot.visualCheck.reasonCode, 'screenshot_low_entropy');
  assert.equal(result.evidence?.[0]?.visualCheck?.status, 'failed');
});

test('debug_open_page reports OneCEO app runtime errors as failed visual checks', async () => {
  const ensureDebugMock = mock.fn(
    async () =>
      ({
        ready: true,
        url: 'https://8081-sandbox-runtime-error.e2b.app',
        status: 'running',
        updatedAt: new Date().toISOString(),
        sandboxId: 'sandbox-runtime-error',
        port: 8081,
        display: ':0',
        cdpPort: 9222,
      }) as any
  );
  mock.method(e2bConnector, 'runCommand', async (_sandboxId, command) => {
    if (String(command).includes('ONECEO_BROWSER_SCREENSHOT=')) {
      return {
        stdout: JSON.stringify({
          ok: true,
          url: 'http://127.0.0.1:3000/',
          title: 'Runtime Error',
          outputPath: '/tmp/shot-runtime-error.png',
          visualCheck: {
            status: 'failed',
            reasonCode: 'app_runtime_error',
            message: '页面浏览器运行时报错：React is not defined',
            diagnostics: {
              oneCeoAppStatus: 'error',
              oneCeoRootStatus: 'error',
              oneCeoAppErrors: ['React is not defined'],
              visibleTextLength: 46,
              rootElementCount: 4,
            },
          },
        }),
        stderr: '',
        exitCode: 0,
      } as any;
    }
    return {
      stdout:
        '__ONECEO_DEBUG_OPEN_PAGE_RESULT__={"ok":true,"url":"http://127.0.0.1:3000/","title":"Runtime Error"}\n__ONECEO_DEBUG_RESULT__=ok',
      stderr: '',
      exitCode: 0,
    } as any;
  });
  mock.method(e2bConnector, 'readFile', async () => Buffer.from('png-bytes'));

  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-runtime-error',
      userId: 'user-runtime-error',
      sandboxId: 'sandbox-runtime-error',
      workspaceRoot: '/workspace/session-runtime-error',
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
    {
      uploadToR2: mock.fn(async () => undefined) as any,
    }
  );

  const result = await runtime.execute('debug_open_page', {
    url: 'http://127.0.0.1:3000/',
  });

  const payload = JSON.parse(result.content);
  assert.equal(payload.browserScreenshot.status, 'captured');
  assert.equal(payload.browserScreenshot.visualCheck.status, 'failed');
  assert.equal(payload.browserScreenshot.visualCheck.reasonCode, 'app_runtime_error');
  assert.match(payload.browserScreenshot.visualCheck.message, /React is not defined/);
});

test('debug_open_page reports structured screenshot capture failure instead of opaque exit status', async () => {
  const ensureDebugMock = mock.fn(
    async () =>
      ({
        ready: true,
        url: 'https://8081-sandbox-screenshot-fail.e2b.app',
        status: 'running',
        updatedAt: new Date().toISOString(),
        sandboxId: 'sandbox-screenshot-fail',
        port: 8081,
        display: ':0',
        cdpPort: 9222,
      }) as any
  );
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async (_sandboxId, command) => {
    if (String(command).includes('ONECEO_BROWSER_SCREENSHOT=')) {
      return {
        stdout: `__ONECEO_BROWSER_SCREENSHOT_RESULT__=${JSON.stringify({
          ok: false,
          reasonCode: 'playwright_module_not_found',
          message: "Cannot find module 'playwright'",
          diagnostics: {
            stage: 'require_playwright',
            cdpEndpoint: 'http://127.0.0.1:9222',
            nodePath: '/usr/local/lib/node_modules',
            playwrightBrowsersPath: '/opt/ms-playwright',
          },
        })}`,
        stderr: '',
        exitCode: 0,
      } as any;
    }
    return {
      stdout: '__ONECEO_DEBUG_OPEN_PAGE_RESULT__={"ok":true,"url":"http://127.0.0.1:3000/","title":"Home"}\n__ONECEO_DEBUG_RESULT__=ok',
      stderr: '',
      exitCode: 0,
    } as any;
  });

  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-screenshot-fail',
      userId: 'user-screenshot-fail',
      sandboxId: 'sandbox-screenshot-fail',
      workspaceRoot: '/workspace/session-screenshot-fail',
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
    {
      uploadToR2: mock.fn(async () => undefined) as any,
    }
  );

  const result = await runtime.execute('debug_open_page', {
    url: 'http://127.0.0.1:3000/',
  });

  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.browserScreenshot.status, 'capture_failed');
  assert.match(payload.browserScreenshot.message, /playwright_module_not_found/);
  assert.match(payload.browserScreenshot.message, /require_playwright/);
  assert.doesNotMatch(payload.browserScreenshot.message, /^exit status 1$/);
  assert.equal(result.evidence?.[0]?.status, 'capture_failed');
  const screenshotCommand = String(runCommandMock.mock.calls.find((call) =>
    String(call.arguments[1]).includes('ONECEO_BROWSER_SCREENSHOT=')
  )?.arguments[1] || '');
  assert.match(screenshotCommand, /PLAYWRIGHT_BROWSERS_PATH="\$\{PLAYWRIGHT_BROWSERS_PATH:-\/opt\/ms-playwright\}"/);
  assert.match(screenshotCommand, /ONECEO_PLAYWRIGHT_CDP_URL/);
  assert.match(screenshotCommand, /\/usr\/local\/lib\/node_modules/);
  assert.match(screenshotCommand, /fullPage:\s*false/);
  assert.match(screenshotCommand, /const timeout = 10000/);
  assert.doesNotMatch(screenshotCommand, /fullPage:\s*true/);
  assert.ok(screenshotCommand.includes(String.raw`/chrome-error:\/\//i`));
  assert.ok(screenshotCommand.includes(String.raw`replace(/\s+/g`));
  assert.doesNotMatch(screenshotCommand, /replace\(\/s\+\/g/);
});

test('debug_open_page preserves structured screenshot timeout reason', async () => {
  const ensureDebugMock = mock.fn(
    async () =>
      ({
        ready: true,
        url: 'https://8081-sandbox-screenshot-timeout.e2b.app',
        status: 'running',
        updatedAt: new Date().toISOString(),
        sandboxId: 'sandbox-screenshot-timeout',
        port: 8081,
        display: ':0',
        cdpPort: 9222,
      }) as any
  );
  mock.method(e2bConnector, 'runCommand', async (_sandboxId, command) => {
    if (String(command).includes('ONECEO_BROWSER_SCREENSHOT=')) {
      return {
        stdout: `__ONECEO_BROWSER_SCREENSHOT_RESULT__=${JSON.stringify({
          ok: false,
          reasonCode: 'browser_screenshot_timeout',
          message: 'page.screenshot timed out after 10000ms',
          diagnostics: {
            stage: 'capture_screenshot',
            cdpEndpoint: 'http://127.0.0.1:9222',
            nodePath: '/usr/local/lib/node_modules',
            playwrightPath: '/usr/local/lib/node_modules/playwright/index.js',
          },
        })}`,
        stderr: '',
        exitCode: 0,
      } as any;
    }
    return {
      stdout: '__ONECEO_DEBUG_OPEN_PAGE_RESULT__={"ok":true,"url":"http://127.0.0.1:3000/","title":"Home"}\n__ONECEO_DEBUG_RESULT__=ok',
      stderr: '',
      exitCode: 0,
    } as any;
  });

  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-screenshot-timeout',
      userId: 'user-screenshot-timeout',
      sandboxId: 'sandbox-screenshot-timeout',
      workspaceRoot: '/workspace/session-screenshot-timeout',
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
    {
      uploadToR2: mock.fn(async () => undefined) as any,
    }
  );

  const result = await runtime.execute('debug_open_page', {
    url: 'http://127.0.0.1:3000/',
  });

  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.browserScreenshot.status, 'capture_failed');
  assert.equal(payload.browserScreenshot.reasonCode, 'browser_screenshot_timeout');
  assert.match(payload.browserScreenshot.message, /page\.screenshot timed out/);
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
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async (_sandboxId, command) => {
    if (String(command).includes('ONECEO_BROWSER_SCREENSHOT=')) {
      return {
        stdout: '{"ok":true,"url":"http://127.0.0.1:8080/","title":"Local","outputPath":"/tmp/shot.png"}',
        stderr: '',
        exitCode: 0,
      } as any;
    }
    return {
      stdout: '__ONECEO_DEBUG_OPEN_PAGE_RESULT__={"ok":true,"url":"http://127.0.0.1:8080/","title":"Local"}\n__ONECEO_DEBUG_RESULT__=ok',
      stderr: '',
      exitCode: 0,
    } as any;
  });
  mock.method(e2bConnector, 'readFile', async () => Buffer.from('png-bytes'));
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
    {
      uploadToR2: mock.fn(async () => undefined) as any,
    }
  );

  const result = await runtime.execute('debug_open_page', {
    url: '127.0.0.1:8080',
  });

  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.targetUrl, 'http://127.0.0.1:8080/');
  assert.equal(runCommandMock.mock.callCount(), 3);
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
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async (_sandboxId, command) => {
    if (String(command).includes('ONECEO_BROWSER_SCREENSHOT=')) {
      return {
        stdout: '{"ok":true,"url":"file:///workspace/session-1/index.html","title":"2048","outputPath":"/tmp/shot.png"}',
        stderr: '',
        exitCode: 0,
      } as any;
    }
    return {
      stdout:
        '__ONECEO_DEBUG_TARGET_FILE_READY__=/workspace/session-1/index.html\n__ONECEO_DEBUG_OPEN_PAGE_RESULT__={"ok":true,"url":"file:///workspace/session-1/index.html","title":"2048"}\n__ONECEO_DEBUG_RESULT__=ok',
      stderr: '',
      exitCode: 0,
    } as any;
  });
  mock.method(e2bConnector, 'readFile', async () => Buffer.from('png-bytes'));
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
    {
      uploadToR2: mock.fn(async () => undefined) as any,
    }
  );

  const result = await runtime.execute('debug_open_page', {
    url: 'file:///workspace/session-1/index.html',
  });

  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.targetUrl, 'file:///workspace/session-1/index.html');
  assert.equal(payload.protocol, 'file');
  assert.equal(payload.localFilePath, '/workspace/session-1/index.html');
  assert.equal(runCommandMock.mock.callCount(), 3);
});

test('browser_interact executes an explicit Playwright action against the debug browser and captures screenshot evidence', async () => {
  const capturedCommands: string[] = [];
  const uploaded: Array<{ key: string; body: Buffer }> = [];
  mock.method(e2bConnector, 'runCommand', async (_sandboxId, command) => {
    capturedCommands.push(String(command));
    if (String(command).includes('ONECEO_BROWSER_SCREENSHOT=')) {
      return {
        stdout: '{"ok":true,"url":"file:///workspace/session-1/index.html","title":"2048","outputPath":"/tmp/shot.png"}',
        stderr: '',
        exitCode: 0,
      };
    }
    return {
      stdout: '{"ok":true,"action":"keyboard_press","url":"file:///workspace/session-1/index.html","title":"2048"}',
      stderr: '',
      exitCode: 0,
    };
  });
  mock.method(e2bConnector, 'readFile', async () => Buffer.from('png-bytes'));

  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-1',
      userId: 'user-1',
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      activeSkills: [],
      mcpProviders: [],
    },
    undefined,
    {
      ensureNekoDebug: mock.fn(
        async () =>
          ({
            ready: true,
            url: 'https://8081-sandbox-1.e2b.app',
            status: 'running',
            updatedAt: new Date().toISOString(),
            sandboxId: 'sandbox-1',
            port: 8081,
            display: ':0',
            cdpPort: 9222,
          }) as any
      ) as any,
      issueIceServersForUser: mock.fn(async () => null) as any,
    },
    {
      uploadToR2: mock.fn(async (key: string, body: Buffer) => {
        uploaded.push({ key, body });
      }) as any,
    }
  );

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
  assert.match(capturedCommands[0] || '', /chromium\.connectOverCDP/);
  assert.match(capturedCommands[0] || '', /ArrowUp/);
  assert.match(capturedCommands[1] || '', /ONECEO_BROWSER_SCREENSHOT/);
  assert.equal(uploaded.length, 1);
  assert.equal(payload.browserScreenshot.status, 'captured');
  assert.equal(payload.browserScreenshot.source.url, 'file:///workspace/session-1/index.html');
  assert.equal(result.evidence?.[0]?.status, 'captured');
});

test('browser_interact fails fast when managed debug browser is not ready', async () => {
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
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async () => {
    throw new Error('should_not_execute_browser_interact_command');
  });

  const runtime = new AltusManagedToolRuntime(
    {
      sessionId: 'session-1',
      userId: 'user-1',
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      activeSkills: [],
      mcpProviders: [],
    },
    undefined,
    {
      ensureNekoDebug: ensureDebugMock as any,
      issueIceServersForUser: mock.fn(async () => null) as any,
    }
  );

  await assert.rejects(
    runtime.execute('browser_interact', {
      action: 'keyboard_press',
      key: 'ArrowUp',
    }),
    /browser_interact_debug_not_ready:ice_failed/
  );

  assert.equal(ensureDebugMock.mock.callCount(), 1);
  assert.equal(runCommandMock.mock.callCount(), 0);
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

test('debug_open_page returns structured Playwright CDP open failures', async () => {
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
    stdout:
      '__ONECEO_DEBUG_OPEN_PAGE_RESULT__={"ok":false,"reasonCode":"debug_open_page_playwright_failed","message":"page.goto: net::ERR_CONNECTION_REFUSED","diagnostics":{"stage":"page_goto","cdpEndpoint":"http://127.0.0.1:9222","playwrightPath":"/usr/local/lib/node_modules/playwright/index.js"}}\n__ONECEO_DEBUG_RESULT__=ok',
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
    /debug_open_page_failed:[\s\S]*debug_open_page_playwright_failed[\s\S]*page_goto[\s\S]*127\.0\.0\.1:9222/
  );

  assert.equal(runCommandMock.mock.callCount(), 1);
  assert.equal(markSandboxDirtyMock.mock.callCount(), 0);
});

test('debug_open_page preserves diagnostics when the debug command exits without stdout', async () => {
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
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async () => {
    throw new Error('exit status 1');
  });
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
    /__ONECEO_DEBUG_COMMAND_FAILED__[\s\S]*__ONECEO_DEBUG_SCRIPT_EXIT__=1[\s\S]*exit status 1/
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

test('debug_open_page ignores ensureDebug false and still fails fast when CDP is not ready', async () => {
  const ensureDebugMock = mock.fn(
    async () =>
      ({
        ready: false,
        status: 'failed',
        reasonCode: 'cdp_not_ready',
        message: 'Chromium CDP 调试端口未就绪，无法打开调试页面',
        sandboxId: 'sandbox-1',
      }) as any
  );
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async () => {
    throw new Error('should_not_execute_debug_open_page_command');
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
    },
    {
      ensureNekoDebug: ensureDebugMock as any,
      issueIceServersForUser: mock.fn(async () => null) as any,
    },
  );

  await assert.rejects(
    runtime.execute('debug_open_page', {
      url: 'http://127.0.0.1:8080/',
      ensureDebug: false,
    }),
    /debug_open_page_debug_not_ready:cdp_not_ready/
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
  assert.equal(result.structuredClarification, undefined);
});

test('ask_user attaches presentation structured clarification fallback when model omits cards', async () => {
  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-ask-user-presentation-brief',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-ask-user-presentation-brief',
    activeSkills: [],
    mcpProviders: [],
  });

  const result = await runtime.execute('ask_user', {
    question: '这份 PPT 开始制作前，先确认 4 个关键决策。你可以直接选择，也可以跳过由 Altus 按推荐项处理。',
    clarificationType: 'presentation_brief',
  });

  assert.equal(result.type, 'ask_user');
  if (result.type !== 'ask_user') {
    throw new Error('expected ask_user result');
  }
  assert.equal(result.structuredClarification?.kind, 'structured_clarification');
  assert.equal(result.structuredClarification?.taskType, 'ppt');
  assert.equal(result.structuredClarification?.cards.length, 4);
});

test('ask_user detects presentation structured clarification fallback from question text', () => {
  const plan = __altusManagedToolRuntimeTestHooks.resolveAskUserStructuredClarification({
    question: '这份 PPT 开始制作前，先确认 4 个关键决策。你可以直接选择，也可以跳过由 Altus 按推荐项处理。',
  });

  assert.equal(plan?.kind, 'structured_clarification');
  assert.equal(plan?.cards.length, 4);
});
