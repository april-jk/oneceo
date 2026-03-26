import assert from 'node:assert/strict';
import { test } from 'node:test';
import { altusManagedPromptService } from '../src/services/altus-managed-prompt-service';

test('managed prompt requires task grading and detailed todo for complex tasks', () => {
  const prompt = altusManagedPromptService.buildSystemPrompt({
    sessionId: 'session-prompt-test',
    sessionTitle: '复杂任务提示词测试',
    workspaceRoot: '/workspace/session-prompt-test',
    connectors: [],
  });

  assert.match(prompt, /judge the task complexity as simple, normal, or complex/i);
  assert.match(prompt, /for complex tasks, you must first form a detailed step-by-step todo list/i);
  assert.match(prompt, /multiple files, multiple subsystems, unclear dependencies, staged verification, migrations, infrastructure\/runtime changes, or a non-trivial debugging chain/i);
  assert.match(prompt, /complete one step, validate it, then move to the next step/i);
});
