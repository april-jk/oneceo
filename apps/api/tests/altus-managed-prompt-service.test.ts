import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  altusManagedPromptService,
  deriveManagedTaskIntentProfile,
} from '../src/services/altus-managed-prompt-service';

test('managed prompt treats task grading as descriptive language and uses taskIntentProfile as the only todo gate', () => {
  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-prompt-test',
    sessionTitle: 'complex task prompt',
    workspaceRoot: '/workspace/session-prompt-test',
    connectors: [],
    taskIntentProfile: {
      mode: 'neutral',
      reason: 'unknown',
      recentUserMessages: ['帮我排查这个会话卡住的问题并修复'],
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
      todoRequired: true,
      todoReason: 'debug_chain',
    },
  });

  assert.match(prompt, /judge the task complexity as simple, normal, or complex/i);
  assert.match(prompt, /do not use that grading as an independent todo trigger/i);
  assert.match(prompt, /if `taskIntentProfile\.todoRequired=true`, you must call `todowrite` before the first execution step/i);
  assert.match(prompt, /The current request requires a pre-execution todo snapshot/i);
  assert.match(
    prompt,
    /multiple files, multiple subsystems, unclear dependencies, staged verification, migrations, infrastructure\/runtime changes, or a non-trivial debugging chain/i,
  );
  assert.match(prompt, /break the work into concrete steps, then complete and verify them sequentially/i);
  assert.match(prompt, /exactly one `in_progress` item/i);
  assert.match(prompt, /After a clarification answer arrives, reassess the request from scratch/i);
});

test('managed prompt explicitly skips pre-execution todo for simple tasks when taskIntentProfile says no', () => {
  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-simple-task-test',
    sessionTitle: 'simple task prompt',
    workspaceRoot: '/workspace/session-simple-task-test',
    connectors: [],
    taskIntentProfile: {
      mode: 'neutral',
      reason: 'unknown',
      recentUserMessages: ['把这个按钮文案改成提交'],
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
    },
  });

  assert.match(prompt, /does not require a pre-execution todo snapshot/i);
  assert.match(prompt, /do not call `todowrite` just because the request sounds non-trivial/i);
});

test('managed prompt defaults debug and testing to Playwright on the same n.eko browser', () => {
  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-debug-tool-choice',
    sessionTitle: 'debug tool choice',
    workspaceRoot: '/workspace/session-debug-tool-choice',
    connectors: [],
  });

  assert.match(prompt, /Browser Use CLI is preinstalled in the sandbox/i);
  assert.match(prompt, /Treat website debugging as entry into a testing workflow/i);
  assert.match(prompt, /Before the first debug_open_page call, write or update a workspace test document/i);
  assert.match(prompt, /docs\/test-plan\.md/i);
  assert.match(prompt, /requirements, target flows, test cases, acceptance criteria, and a results section/i);
  assert.match(prompt, /explicitly enter the testing phase/i);
  assert.match(prompt, /browser_interact/i);
  assert.match(prompt, /locator_click, text_click, coordinate_click, locator_fill, keyboard_type, keyboard_press, mouse_wheel/i);
  assert.match(prompt, /cover the core user flows implied by the request/i);
  assert.match(prompt, /record the failure in the test document, return to repair/i);
  assert.match(prompt, /use Playwright \/ playwright-mcp by default to inspect or test the same n\.eko Chromium session through CDP 9222/i);
  assert.match(prompt, /Do not launch a separate browser instance/i);
  assert.match(prompt, /not about:blank, a Chrome error page, or an unexpected fallback route/i);
  assert.match(prompt, /Use Browser Use for exploratory external-site access and interaction only/i);
  assert.match(prompt, /Use Playwright \/ playwright-mcp by default for debugging, deterministic testing/i);
  assert.match(prompt, /Do not install browser-use, Playwright, or @playwright\/mcp at task time/i);
});

test('managed task intent requires todo workflow for explicit debug trigger', () => {
  const profile = deriveManagedTaskIntentProfile(['启动网站调试功能']);

  assert.equal(profile.todoRequired, true);
  assert.equal(profile.todoReason, 'debug_chain');
});

test('managed task intent profile carries a hard clarification gate for broad business-system requests', () => {
  const profile = deriveManagedTaskIntentProfile([
    '帮我做一个企业管理系统。',
  ]);

  assert.equal(profile.needsClarification, true);
  assert.match(profile.clarificationQuestion, /主要使用角色/);
  assert.match(profile.clarificationQuestion, /核心模块/);
  assert.match(profile.clarificationQuestion, /源码/);
  assert.match(profile.clarificationQuestion, /部署/);
  assert.equal(profile.todoRequired, false);
  assert.equal(profile.todoReason, 'none');

  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-clarification-gate-test',
    sessionTitle: 'clarification gate',
    workspaceRoot: '/workspace/session-clarification-gate-test',
    connectors: [],
    taskIntentProfile: profile,
  });

  assert.match(prompt, /under-specified and requires clarification before execution/i);
  assert.match(prompt, /Your next step must be `ask_user`/i);
  assert.match(prompt, /Do not call `todowrite`/i);
  assert.match(prompt, /Active clarification type/i);
});

test('managed prompt does not expose legacy direct PPT workflow globally', () => {
  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-ppt-test',
    sessionTitle: 'ppt phase contract',
    workspaceRoot: '/workspace/session-ppt-test',
    connectors: [],
  });

  assert.doesNotMatch(prompt, /ppt_task_router/i);
  assert.doesNotMatch(prompt, /ppt_storyboard_designer/i);
  assert.doesNotMatch(prompt, /presentation_manifest\.json/i);
  assert.doesNotMatch(prompt, /enforce this PPT QA gate before complete_task/i);
});

test('managed prompt enforces multi-phase DOCX collaboration and QA gate', () => {
  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-docx-test',
    sessionTitle: 'docx phase contract',
    workspaceRoot: '/workspace/session-docx-test',
    connectors: [],
  });

  assert.match(prompt, /docx_task_router/i);
  assert.match(prompt, /docx_outline_architect/i);
  assert.match(prompt, /docx_style_system_designer/i);
  assert.match(prompt, /choose exactly one taskMode from/i);
  assert.match(prompt, /choose exactly one taskMode from .* and one contentArchetype from/i);
  assert.match(prompt, /build the outline using bounded section types/i);
  assert.match(prompt, /Do not use `write_file` to create `\.docx` directly/i);
  assert.match(prompt, /enforce this DOCX QA gate before complete_task/i);
});

test('managed prompt enforces multi-phase XLSX collaboration and formula-first QA gate', () => {
  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-xlsx-test',
    sessionTitle: 'xlsx phase contract',
    workspaceRoot: '/workspace/session-xlsx-test',
    connectors: [],
  });

  assert.match(prompt, /xlsx_task_router/i);
  assert.match(prompt, /xlsx_workbook_designer/i);
  assert.match(prompt, /xlsx_formula_planner/i);
  assert.match(prompt, /choose exactly one taskMode from/i);
  assert.match(prompt, /Formula-First rule/i);
  assert.match(prompt, /plan the workbook before writing cells/i);
  assert.match(prompt, /Do not use `write_file` to create `\.xlsx` directly/i);
  assert.match(prompt, /enforce this XLSX QA gate before complete_task/i);
});

test('managed prompt instructs direct multimodal image analysis instead of OCR-first fallback', () => {
  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-image-test',
    sessionTitle: 'image analysis contract',
    workspaceRoot: '/workspace/session-image-test',
    connectors: [],
  });

  assert.match(prompt, /analyze the image directly from the multimodal message input first/i);
  assert.match(prompt, /do not start with shell file probes, OCR libraries, Pillow, or other local image-processing tools/i);
  assert.match(prompt, /do not ask the user to describe an uploaded image/i);
});

test('managed prompt allows direct plain-text reply for pure identity and memory questions', () => {
  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-memory-chat-test',
    sessionTitle: 'memory chat contract',
    workspaceRoot: '/workspace/session-memory-chat-test',
    connectors: [],
  });

  assert.match(prompt, /pure identity or memory question/i);
  assert.match(prompt, /reply directly with plain assistant text/i);
  assert.match(prompt, /instead of forcing tool calls or complete_task/i);
});

test('managed prompt requires deployment tools and auto-repair loop for publish requests', () => {
  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-deploy-test',
    sessionTitle: 'deploy contract',
    workspaceRoot: '/workspace/session-deploy-test',
    connectors: [],
  });

  assert.match(prompt, /use the managed deployment tools instead of replying with plain text/i);
  assert.match(prompt, /use `deploy_application` for first publish or publishing the latest workspace changes/i);
  assert.match(prompt, /returns `status=retryable_repair_required`, inspect `repair\.category` first/i);
  assert.match(prompt, /keep deployment debug details internal/i);
});

test('managed prompt fixes deployable web apps to the official vite-node shell', () => {
  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-fixed-shell-test',
    sessionTitle: 'fixed shell contract',
    workspaceRoot: '/workspace/session-fixed-shell-test',
    connectors: [],
  });

  assert.match(prompt, /without an existing workspace stack to preserve, default to the fixed OneCEO web shell/i);
  assert.match(prompt, /default stable delivery lane for new deployable websites, not as a global migration rule/i);
  assert.match(prompt, /If the workspace already exists in another stack, or the user is debugging, repairing, or extending an existing project, preserve the existing stack/i);
  assert.match(prompt, /root `client\/`, root `server\/`, optional root `shared\/`/i);
  assert.match(prompt, /produce browser assets under `dist\/public` and a server entry at `dist\/index\.js`/i);
  assert.match(prompt, /production start command should resolve to `node dist\/index\.js`/i);
  assert.match(prompt, /creating a new deployable site from scratch, not as permission to switch the deployable runtime/i);
});

test('managed prompt fixes managed database engine to Railway Postgres', () => {
  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-db-fixed-test',
    sessionTitle: 'db fixed contract',
    workspaceRoot: '/workspace/session-db-fixed-test',
    connectors: [],
  });

  assert.match(prompt, /database always means the fixed managed Railway Postgres/i);
  assert.match(prompt, /do not ask the user to choose mysql \/ sqlite \/ other engines/i);
});

test('managed prompt fixes managed storage engine to Railway Bucket', () => {
  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-storage-fixed-test',
    sessionTitle: 'storage fixed contract',
    workspaceRoot: '/workspace/session-storage-fixed-test',
    connectors: [],
  });

  assert.match(prompt, /object storage always means the fixed managed Railway Bucket/i);
  assert.match(prompt, /do not ask the user to choose r2 \/ s3 \/ minio \/ other storage engines/i);
});

test('managed prompt derives non-deployable artifact intent and emits a hard no-deploy contract', () => {
  const profile = deriveManagedTaskIntentProfile([
    '请帮我写一个 HTML 邮件模板，用于报价通知邮件。只需要输出源码文件，不需要做网站，也不要部署。',
    '请按最佳方案直接继续，不需要再提问。',
  ]);
  assert.equal(profile.mode, 'non_deployable_artifact');
  assert.equal(profile.deploymentAllowed, false);

  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-non-deploy-test',
    sessionTitle: 'non deploy contract',
    workspaceRoot: '/workspace/session-non-deploy-test',
    connectors: [],
    taskIntentProfile: profile,
  });

  assert.match(prompt, /# Non-deployable task contract/);
  assert.match(prompt, /do not transform this task into a website/i);
  assert.match(prompt, /do not call `deploy_application`, `redeploy_application`, or `rollback_application_deployment`/i);
});

test('managed prompt does not authorize deployment for website source tasks without an explicit deploy request', () => {
  const profile = deriveManagedTaskIntentProfile([
    '做一个纯 HTML 企业官网，包含首页、关于我们和联系我们，先给我源码文件。',
  ]);

  assert.equal(profile.mode, 'deployable_web_app');
  assert.equal(profile.deployRequested, false);
  assert.equal(profile.deploymentAllowed, false);

  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-web-source-only-test',
    sessionTitle: 'web source only contract',
    workspaceRoot: '/workspace/session-web-source-only-test',
    connectors: [],
    taskIntentProfile: profile,
  });

  assert.match(prompt, /# Deployment trigger contract/);
  assert.match(prompt, /is not an explicit deployment request/i);
  assert.match(prompt, /does not by itself authorize deployment/i);
  assert.doesNotMatch(prompt, /use `deploy_application` for first publish or publishing the latest workspace changes/i);
});

test('managed prompt treats deployment capability questions as advisory, not deploy authorization', () => {
  const profile = deriveManagedTaskIntentProfile([
    '能用vercel部署吗',
  ]);

  assert.equal(profile.mode, 'neutral');
  assert.equal(profile.deployRequested, false);
  assert.equal(profile.deploymentAllowed, false);
  assert.equal(profile.platformCapabilityIntent?.intentKind, 'capability_question');
  assert.equal(profile.platformCapabilityIntent?.mode, 'answer_capability');
  assert.equal(profile.platformCapabilityIntent?.topic, 'vercel');
  assert.equal(profile.platformCapabilityIntent?.shouldExecute, false);

  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-vercel-capability-question',
    sessionTitle: 'vercel capability question',
    workspaceRoot: '/workspace/session-vercel-capability-question',
    connectors: [],
    taskIntentProfile: profile,
  });

  assert.match(prompt, /# Platform capability advisory contract/);
  assert.match(prompt, /Answer the user naturally and directly/i);
  assert.doesNotMatch(prompt, /# Deployment trigger contract/);
  assert.doesNotMatch(prompt, /is not an explicit deployment request/i);
  assert.match(prompt, /Do not say deployment is blocked, disabled, not enabled, unauthorized, or prevented/i);
});

test('managed prompt authorizes deployment only for explicit action wording', () => {
  const profile = deriveManagedTaskIntentProfile([
    '帮我部署当前项目',
  ]);

  assert.equal(profile.deployRequested, true);
  assert.equal(profile.deploymentAllowed, true);
  assert.equal(profile.platformCapabilityIntent?.intentKind, 'explicit_action');
  assert.equal(profile.platformCapabilityIntent?.capabilityKind, 'deploy');
});

test('managed prompt builds minimal skill catalog index without full body', () => {
  const prompt = altusManagedPromptService.buildSkillCatalogPrompt([
    {
      sourceType: 'platform',
      skillId: 'skill-1',
      revisionId: 'rev-1',
      slug: 'ppt-workflow',
      name: 'PPT 工作流',
      description: '按子任务编排准备 PPT 渲染指令草稿',
      category: 'office',
      revisionNumber: 3,
      resourceSummary: {
        totalCount: 4,
        referenceCount: 3,
        templateCount: 1,
        paths: [
          'references/subtask-contracts.md',
          'references/visual-plan-guide.md',
          'references/preflight-checklist.md',
          'templates/render-instruction-draft.md',
        ],
      },
    },
  ]);

  assert.match(prompt, /available skills catalog/i);
  assert.match(prompt, /ppt-workflow: 按子任务编排准备 PPT 渲染指令草稿/);
  assert.match(prompt, /id=skill-catalog:platform:skill-1:rev-1/);
  assert.match(prompt, /resources=3 references, 1 templates/);
  assert.match(prompt, /call `load_skill_resource`/i);
  assert.doesNotMatch(prompt, /compatibility:\s*opencode/i);
});

test('managed prompt exposes ppt workflow as catalog-only pre-render skill', () => {
  const prompt = altusManagedPromptService.buildSkillCatalogPrompt([
    {
      sourceType: 'platform',
      skillId: 'skill-ppt-workflow',
      revisionId: 'rev-ppt-workflow',
      slug: 'ppt-workflow',
      name: 'PPT 工作流',
      description: '按竞品式子任务编排完成 PPT 生成前工作流',
      category: 'office',
      revisionNumber: 1,
      resourceSummary: {
        totalCount: 4,
        referenceCount: 3,
        templateCount: 1,
        paths: [
          'references/subtask-contracts.md',
          'references/visual-plan-guide.md',
          'references/preflight-checklist.md',
          'templates/render-instruction-draft.md',
        ],
      },
    },
  ]);

  assert.match(prompt, /ppt-workflow: 按竞品式子任务编排完成 PPT 生成前工作流/);
  assert.match(prompt, /id=skill-catalog:platform:skill-ppt-workflow:rev-ppt-workflow/);
  assert.match(prompt, /resources=3 references, 1 templates/);
  assert.match(prompt, /call `load_skill_resource`/i);
  assert.doesNotMatch(prompt, /# Skill Brief: PPT 子任务编排工作流/);
});

test('managed prompt shows active skill resource summary alongside full body', () => {
  const prompt = altusManagedPromptService.buildSkillContextPrompt([
    {
      sourceType: 'platform',
      skillId: 'skill-1',
      revisionId: 'rev-1',
      slug: 'ppt-workflow',
      name: 'PPT 工作流',
      description: '按子任务编排准备 PPT 渲染指令草稿',
      category: 'office',
      renderedMarkdown: '# Skill Brief\n\nDo the work.',
      revisionNumber: 3,
      resourceSummary: {
        totalCount: 2,
        referenceCount: 1,
        templateCount: 1,
        paths: ['references/subtask-contracts.md', 'templates/render-instruction-draft.md'],
      },
    },
  ]);

  assert.match(prompt, /# Active skills/);
  assert.match(prompt, /currently active for the run/i);
  assert.match(prompt, /id=skill:platform:skill-1:rev-1/);
  assert.match(prompt, /resources: 1 references, 1 templates/);
  assert.match(prompt, /# Skill Brief/);
});

test('managed prompt includes full ppt workflow instructions when skill is active', () => {
  const prompt = altusManagedPromptService.buildSkillContextPrompt([
    {
      sourceType: 'platform',
      skillId: 'skill-ppt-workflow',
      revisionId: 'rev-ppt-workflow',
      slug: 'ppt-workflow',
      name: 'PPT 工作流',
      description: '按竞品式子任务编排完成 PPT 生成前工作流',
      category: 'office',
      renderedMarkdown: [
        '# Skill Brief: PPT 子任务编排工作流',
        '',
        '当前阶段不调用 PPT 专用渲染器。',
        '固定顺序：`ppt_intent_analyzer -> ppt_research_planner -> ppt_material_collector -> ppt_visual_planner -> ppt_outline_planner -> ppt_render_instruction_planner -> ppt_preflight_reviewer`。',
        '最终产物是 `PptRenderInstructionDraft`。',
      ].join('\n'),
      revisionNumber: 1,
      resourceSummary: {
        totalCount: 4,
        referenceCount: 3,
        templateCount: 1,
        paths: [
          'references/subtask-contracts.md',
          'references/visual-plan-guide.md',
          'references/preflight-checklist.md',
          'templates/render-instruction-draft.md',
        ],
      },
    },
  ]);

  assert.match(prompt, /# Active skills/);
  assert.match(prompt, /slug: ppt-workflow/);
  assert.match(prompt, /id=skill:platform:skill-ppt-workflow:rev-ppt-workflow/);
  assert.match(prompt, /resources: 3 references, 1 templates/);
  assert.match(prompt, /# Skill Brief: PPT 子任务编排工作流/);
  assert.match(prompt, /ppt_intent_analyzer/);
  assert.match(prompt, /PptRenderInstructionDraft/);
});

test('managed prompt can append auto-attached skill instructions after a governed tool call', () => {
  const prompt = altusManagedPromptService.buildAutoAttachedSkillPrompt(
    [
      {
        sourceType: 'platform',
        skillId: 'skill-1',
        revisionId: 'rev-1',
        slug: 'deployment-orchestrator',
        name: '部署编排',
        description: '自动处理部署工作流',
        category: 'deployment',
        renderedMarkdown: '# Skill Brief\n\nUse deployment tools carefully.',
        revisionNumber: 1,
        resourceSummary: {
          totalCount: 2,
          referenceCount: 2,
          templateCount: 0,
          paths: ['references/runtime-classifier.md', 'references/nodejs.md'],
        },
      },
    ],
    'deploy_application'
  );

  assert.match(prompt, /newly auto-attached skills/i);
  assert.match(prompt, /because tool `deploy_application` was used/i);
  assert.match(prompt, /use deployment tools carefully/i);
});

test('managed prompt labels attached connectors by runtime status instead of treating all attached connectors as callable', () => {
  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-connector-status-test',
    sessionTitle: 'connector runtime prompt',
    workspaceRoot: '/workspace/session-connector-status-test',
    connectors: [
      {
        connectorKey: 'notion',
        name: 'Notion',
        icon: 'notion',
        authMode: 'oauth',
        available: true,
        globalAuthStatus: 'authorized',
        attached: true,
        desiredState: 'attached',
        runtimeStatus: 'pending_recover',
        usageStatus: 'idle',
        attachedProfileName: 'workspace-a',
      },
      {
        connectorKey: 'github',
        name: 'GitHub',
        icon: 'github',
        authMode: 'oauth',
        available: true,
        globalAuthStatus: 'authorized',
        attached: true,
        desiredState: 'attached',
        runtimeStatus: 'connected',
        usageStatus: 'idle',
        attachedProfileName: 'repo-scope',
      },
      {
        connectorKey: 'slack',
        name: 'Slack',
        icon: 'slack',
        authMode: 'oauth',
        available: true,
        globalAuthStatus: 'authorized',
        attached: true,
        desiredState: 'attached',
        runtimeStatus: 'failed',
        usageStatus: 'idle',
        attachedProfileName: 'team-a',
      },
    ],
  });

  assert.match(prompt, /notion \| runtime_status=pending_recover \| tool_access=blocked_until_runtime_recovers/i);
  assert.match(prompt, /github \| runtime_status=connected \| tool_access=available/i);
  assert.match(prompt, /slack \| runtime_status=failed \| tool_access=blocked_attach_failed/i);
});
