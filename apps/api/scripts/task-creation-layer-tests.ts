import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IntentType } from '../src/agents/task-creation/types/intent';
import { PlanningAgent } from '../src/agents/task-creation/layers/planning-agent';
import { getPlanningPersona } from '../src/agents/task-creation/layers/planners/persona-registry';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';

type TestCase = {
  name: string;
  fn: () => Promise<void> | void;
};

const tests: TestCase[] = [];

function test(name: string, fn: TestCase['fn']) {
  tests.push({ name, fn });
}

function buildIntentResult(intentType: IntentType) {
  return {
    intent_type: intentType,
    confidence: 0.95,
    key_info: {
      target: 'test',
      scope: 'scope',
      constraints: 'none',
    },
    clarification_needed: false,
    clarification_questions: [],
    next_agent: 'planning_agent',
  } as any;
}

test('persona registry maps intent types', () => {
  const software = getPlanningPersona(IntentType.SOFTWARE_DEVELOPMENT);
  assert.ok(software.roleName.includes('编程'), 'software persona mismatch');
  assert.ok((software.deliverableTemplate || []).length > 0, 'software deliverable template missing');

  const finance = getPlanningPersona(IntentType.BUSINESS_PLANNING);
  assert.ok(finance.roleName.includes('财务') || finance.roleName.includes('商业'), 'finance persona mismatch');

  const ops = getPlanningPersona(IntentType.STRATEGY_PLANNING);
  assert.ok(ops.roleName.includes('运营') || ops.roleName.includes('策略'), 'ops persona mismatch');

  const content = getPlanningPersona(IntentType.CONTENT_CREATION);
  assert.ok(content.roleName.includes('内容') || content.roleName.includes('文案'), 'content persona mismatch');

  const design = getPlanningPersona(IntentType.DESIGN_CREATION);
  assert.ok(design.roleName.includes('设计'), 'design persona mismatch');

  const research = getPlanningPersona(IntentType.RESEARCH);
  assert.ok(research.roleName.includes('研究') || research.roleName.includes('分析'), 'research persona mismatch');
});

test('planning agent injects persona templates into prompt', async () => {
  const agent = new PlanningAgent();
  let capturedPrompt = '';
  (agent as any).execute = async (prompt: string) => {
    capturedPrompt = prompt;
    return {
      success: true,
      output: JSON.stringify({
        task_description: {
          title: '测试任务',
          objective: '验证规划提示词',
          scope: '单文件',
          deliverables: ['a'],
          constraints: ['b'],
        },
      }),
    };
  };
  const intentResult = buildIntentResult(IntentType.SOFTWARE_DEVELOPMENT);
  await agent.generateTaskDescription(intentResult, '创建测试任务');
  assert.ok(capturedPrompt.includes('编程规划智能体'), 'persona prompt missing');
  assert.ok(capturedPrompt.includes('澄清问题模板'), 'clarification template missing');
  assert.ok(capturedPrompt.includes('默认交付模板'), 'deliverable template missing');
});

test('state machine maps phase to stage and blocks backward transitions', async () => {
  const sessionId = randomUUID();
  await taskCreationFileMemoryStore.createSession('测试会话', sessionId);

  await taskCreationFileMemoryStore.updateSessionState(sessionId, { phase: 'analysis' });
  let session = await taskCreationFileMemoryStore.getSession(sessionId);
  assert.equal(session?.phase, 'analysis');
  assert.equal(session?.stage, 'planning');

  // attempt to go backwards (analysis -> ideation) should be ignored
  await taskCreationFileMemoryStore.updateSessionState(sessionId, { phase: 'ideation' });
  session = await taskCreationFileMemoryStore.getSession(sessionId);
  assert.equal(session?.phase, 'analysis', 'backward phase transition should be blocked');

  // completed terminal should block further transitions
  await taskCreationFileMemoryStore.updateSessionState(sessionId, { status: 'completed' });
  await taskCreationFileMemoryStore.updateSessionState(sessionId, { phase: 'testing' });
  session = await taskCreationFileMemoryStore.getSession(sessionId);
  assert.equal(session?.status, 'completed');
  assert.equal(session?.phase, 'delivery');
});

async function run() {
  const results: { name: string; error?: unknown }[] = [];
  for (const t of tests) {
    try {
      await t.fn();
      results.push({ name: t.name });
      // eslint-disable-next-line no-console
      console.log(`✅ ${t.name}`);
    } catch (error) {
      results.push({ name: t.name, error });
      // eslint-disable-next-line no-console
      console.error(`❌ ${t.name}`, error);
    }
  }
  const failed = results.filter((r) => r.error);
  if (failed.length) {
    // eslint-disable-next-line no-console
    console.error(`\n失败 ${failed.length} 项`);
    process.exitCode = 1;
  } else {
    // eslint-disable-next-line no-console
    console.log('\n全部通过');
  }
}

run();
