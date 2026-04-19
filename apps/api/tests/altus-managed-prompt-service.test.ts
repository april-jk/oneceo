import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  altusManagedPromptService,
  deriveManagedTaskIntentProfile,
} from '../src/services/altus-managed-prompt-service';

test('managed prompt requires task grading and detailed todo for complex tasks', () => {
  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-prompt-test',
    sessionTitle: 'complex task prompt',
    workspaceRoot: '/workspace/session-prompt-test',
    connectors: [],
  });

  assert.match(prompt, /judge the task complexity as simple, normal, or complex/i);
  assert.match(prompt, /for complex tasks, you must first form a detailed step-by-step todo list/i);
  assert.match(
    prompt,
    /multiple files, multiple subsystems, unclear dependencies, staged verification, migrations, infrastructure\/runtime changes, or a non-trivial debugging chain/i,
  );
  assert.match(prompt, /complete one step, validate it, then move to the next step/i);
});

test('managed prompt enforces multi-phase PPT collaboration and QA gate', () => {
  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-ppt-test',
    sessionTitle: 'ppt phase contract',
    workspaceRoot: '/workspace/session-ppt-test',
    connectors: [],
  });

  assert.match(prompt, /execute the internal multi-phase workflow in this fixed order/i);
  assert.match(prompt, /ppt_task_router/i);
  assert.match(prompt, /ppt_storyboard_designer/i);
  assert.match(prompt, /ppt_visual_system_designer/i);
  assert.match(prompt, /presentation_manifest\.json/i);
  assert.match(prompt, /choose pageType from/i);
  assert.match(prompt, /choose exactly one paletteKey from/i);
  assert.match(prompt, /enforce this PPT QA gate before complete_task/i);
  assert.match(prompt, /do not allow three consecutive slides with the same layout/i);
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
  assert.match(prompt, /document_manifest\.json/i);
  assert.match(prompt, /choose exactly one taskMode from/i);
  assert.match(prompt, /choose exactly one taskMode from .* and one contentArchetype from/i);
  assert.match(prompt, /build the outline using bounded section types/i);
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
  assert.match(prompt, /workbook_manifest\.json/i);
  assert.match(prompt, /choose exactly one taskMode from/i);
  assert.match(prompt, /Formula-First rule/i);
  assert.match(prompt, /plan the workbook before writing cells/i);
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

test('managed prompt builds minimal skill catalog index without full body', () => {
  const prompt = altusManagedPromptService.buildSkillCatalogPrompt([
    {
      sourceType: 'platform',
      skillId: 'skill-1',
      revisionId: 'rev-1',
      slug: 'office-ppt',
      name: 'PPT 办公',
      description: '创建、改写或重组专业演示文稿',
      category: 'office',
      revisionNumber: 3,
      resourceSummary: {
        totalCount: 2,
        referenceCount: 1,
        templateCount: 1,
        paths: ['references/slide-structure-guide.md', 'templates/business-deck-outline.md'],
      },
    },
  ]);

  assert.match(prompt, /available skills catalog/i);
  assert.match(prompt, /office-ppt: 创建、改写或重组专业演示文稿/);
  assert.match(prompt, /resources=1 references, 1 templates/);
  assert.match(prompt, /call `load_skill_resource`/i);
  assert.doesNotMatch(prompt, /compatibility:\s*opencode/i);
});

test('managed prompt shows active skill resource summary alongside full body', () => {
  const prompt = altusManagedPromptService.buildSkillContextPrompt([
    {
      sourceType: 'platform',
      skillId: 'skill-1',
      revisionId: 'rev-1',
      slug: 'office-ppt',
      name: 'PPT 办公',
      description: '创建、改写或重组专业演示文稿',
      category: 'office',
      renderedMarkdown: '# Skill Brief\n\nDo the work.',
      revisionNumber: 3,
      resourceSummary: {
        totalCount: 2,
        referenceCount: 1,
        templateCount: 1,
        paths: ['references/slide-structure-guide.md', 'templates/business-deck-outline.md'],
      },
    },
  ]);

  assert.match(prompt, /# Active skills/);
  assert.match(prompt, /currently active for the run/i);
  assert.match(prompt, /resources: 1 references, 1 templates/);
  assert.match(prompt, /# Skill Brief/);
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
