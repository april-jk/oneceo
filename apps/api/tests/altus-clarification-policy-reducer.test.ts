import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AltusClarificationPolicyReducer } from '../src/services/altus-clarification-policy-reducer';

test('clarification reducer allows advisory transition without blocking on old pending question', () => {
  const reducer = new AltusClarificationPolicyReducer();
  const result = reducer.reduce(
    {
      status: 'clarifying',
      pendingClarificationType: 'artifact_type',
      pendingQuestion: '这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？',
    },
    {
      action: 'switch_to_advisory_mode',
      reason: 'user asks for a proposal before implementation',
    }
  );

  assert.equal(result.accepted, true);
  assert.equal(result.nextState, 'advisory');
  assert.equal(result.clearedPending, true);
});

test('clarification reducer accepts low-risk delegated defaults', () => {
  const reducer = new AltusClarificationPolicyReducer();
  const result = reducer.reduce(
    {
      status: 'clarifying',
      pendingClarificationType: 'tech_stack',
      pendingQuestion: '这次希望使用哪种开发语言或框架？',
    },
    {
      action: 'delegate_to_agent_default',
      clarificationType: 'tech_stack',
      assumedDefault: 'Use the repository default stack.',
      confidence: 'high',
      targetCapability: 'project.local_scaffold',
      reason: 'user delegated the choice',
    }
  );

  assert.equal(result.accepted, true);
  assert.equal(result.nextState, 'ready_to_execute');
  assert.deepEqual(result.assumptions, ['Use the repository default stack.']);
});

test('clarification reducer ignores unknown target capability on ordinary clarification answers', () => {
  const reducer = new AltusClarificationPolicyReducer();
  const result = reducer.reduce(
    {
      status: 'clarifying',
      pendingClarificationType: 'artifact_type',
      pendingQuestion: '这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？',
    },
    {
      action: 'answer_clarification',
      clarificationType: 'artifact_type',
      answer: '网页应用',
      confidence: 'high',
      targetCapability: 'unknown.generated_web_app',
      reason: 'user answered the artifact type',
    }
  );

  assert.equal(result.accepted, true);
  assert.equal(result.nextState, 'ready_to_execute');
  assert.equal(result.clearedPending, true);
});

test('clarification reducer blocks unknown risk capability', () => {
  const reducer = new AltusClarificationPolicyReducer();
  const result = reducer.reduce(
    {
      status: 'clarifying',
      pendingClarificationType: 'acceptance_requirement',
      pendingQuestion: '这次只需要源码，还是还需要本地可运行、测试通过，或可以直接部署？',
    },
    {
      action: 'request_risk_confirmation',
      clarificationType: 'acceptance_requirement',
      riskCapability: 'unknown.external_side_effect',
      question: '是否继续？',
      reason: 'unknown external risk',
    }
  );

  assert.equal(result.accepted, false);
  assert.equal(result.nextState, 'risk_confirmation');
  assert.equal(result.reason, 'missing_capability');
});

test('clarification reducer ignores unknown risk capability for ordinary artifact answer', () => {
  const reducer = new AltusClarificationPolicyReducer();
  const result = reducer.reduce(
    {
      status: 'clarifying',
      pendingClarificationType: 'artifact_type',
      pendingQuestion: '这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？',
    },
    {
      action: 'request_risk_confirmation',
      clarificationType: 'artifact_type',
      riskCapability: 'unknown.web_app_generation',
      question: '这一步涉及未声明的平台能力，我需要先确认目标和风险边界。',
      reason: 'model misclassified an artifact answer as risky',
    }
  );

  assert.equal(result.accepted, true);
  assert.equal(result.nextState, 'ready_to_execute');
  assert.equal(result.clearedPending, true);
  assert.equal(result.reason, 'ignored_unknown_risk_capability');
});

test('clarification reducer turns protected production deployment into confirmation', () => {
  const reducer = new AltusClarificationPolicyReducer();
  const result = reducer.reduce(
    {
      status: 'clarifying',
      pendingClarificationType: 'acceptance_requirement',
      pendingQuestion: '这次只需要源码，还是还需要本地可运行、测试通过，或可以直接部署？',
    },
    {
      action: 'delegate_to_agent_default',
      clarificationType: 'acceptance_requirement',
      assumedDefault: 'Deploy to production.',
      confidence: 'medium',
      targetCapability: 'deploy.production',
      reason: 'user delegated the delivery choice',
    }
  );

  assert.equal(result.accepted, false);
  assert.equal(result.nextState, 'risk_confirmation');
  assert.equal(result.reason, 'risk_requires_confirmation');
  assert.match(result.question, /生产环境/);
});

test('clarification reducer rejects invalid state transitions', () => {
  const reducer = new AltusClarificationPolicyReducer();
  const result = reducer.reduce(
    {
      status: 'risk_confirmation',
      pendingClarificationType: 'acceptance_requirement',
      pendingQuestion: '这会部署到生产环境，请明确确认是否继续。',
    },
    {
      action: 'continue_execution',
      reason: 'skip confirmation',
    }
  );

  assert.equal(result.accepted, false);
  assert.equal(result.nextState, 'clarifying');
  assert.equal(result.reason, 'invalid_transition');
});
