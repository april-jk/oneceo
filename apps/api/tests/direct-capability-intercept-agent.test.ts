import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DirectCapabilityInterceptAgent } from '../src/agents/task-creation/layers/direct-capability-intercept-agent';

const CAPABILITIES = [
  'deploy_session_website',
  'redeploy_session_website',
  'rollback_session_deployment',
  'get_session_deployment_status',
] as const;

test('intercepts explicit deploy request in direct mode', async () => {
  const agent = new DirectCapabilityInterceptAgent();
  const decision = await agent.decide({
    content: '帮我部署这个网站',
    availableCapabilities: CAPABILITIES,
  });

  assert.equal(decision.action, 'platform_capability');
  assert.equal(decision.capabilityId, 'deploy_session_website');
  assert.equal(decision.source, 'heuristic');
});

test('does not intercept deployment capability questions', async () => {
  const agent = new DirectCapabilityInterceptAgent();
  const decision = await agent.decide({
    content: '能用vercel部署吗',
    availableCapabilities: CAPABILITIES,
  });

  assert.equal(decision.action, 'passthrough');
  assert.equal(decision.source, 'heuristic');
});

test('does not intercept deployment how-to advice requests', async () => {
  const agent = new DirectCapabilityInterceptAgent();
  const decision = await agent.decide({
    content: '怎么部署到 Vercel？',
    availableCapabilities: CAPABILITIES,
  });

  assert.equal(decision.action, 'passthrough');
  assert.equal(decision.source, 'heuristic');
});

test('passes through regular development request', async () => {
  const agent = new DirectCapabilityInterceptAgent();
  const decision = await agent.decide({
    content: '帮我开发一个官网首页，带定价和联系我们模块',
    availableCapabilities: CAPABILITIES,
  });

  assert.equal(decision.action, 'passthrough');
  assert.equal(decision.source, 'heuristic');
});

test('passes through mixed development and deploy request', async () => {
  const agent = new DirectCapabilityInterceptAgent();
  const decision = await agent.decide({
    content: '把首页改完后帮我部署',
    availableCapabilities: CAPABILITIES,
  });

  assert.equal(decision.action, 'passthrough');
  assert.equal(decision.source, 'heuristic');
});

test('intercepts deployment status request', async () => {
  const agent = new DirectCapabilityInterceptAgent();
  const decision = await agent.decide({
    content: '帮我查看当前部署状态',
    availableCapabilities: CAPABILITIES,
  });

  assert.equal(decision.action, 'platform_capability');
  assert.equal(decision.capabilityId, 'get_session_deployment_status');
});

test('does not intercept deployment status concept questions', async () => {
  const agent = new DirectCapabilityInterceptAgent();
  const decision = await agent.decide({
    content: '部署状态是什么意思？',
    availableCapabilities: CAPABILITIES,
  });

  assert.equal(decision.action, 'passthrough');
  assert.equal(decision.source, 'heuristic');
});
