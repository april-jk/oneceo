import assert from 'node:assert/strict';
import { test } from 'node:test';
import { altusManagedPromptService } from '../src/services/altus-managed-prompt-service';

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
