import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createDeploymentFlowSnapshot,
  reduceDeploymentFlow,
} from '../src/services/deployment-flow-reducer-service';

const profile = {
  version: '1.0' as const,
  updatedAt: new Date().toISOString(),
  artifactType: 'web_app' as const,
  runtimeFamily: 'static' as const,
  templateFamily: 'legacy_or_custom' as const,
  deployability: 'ready' as const,
  entrypoints: [],
  commands: {},
  analyticsStatus: 'platform_injectable' as const,
  configFiles: {},
  evidence: [],
};

test('deployment flow reaches succeeded only after public access verification', () => {
  let state = createDeploymentFlowSnapshot();
  state = reduceDeploymentFlow(state, { type: 'PROFILE_READY', profile });
  state = reduceDeploymentFlow(state, { type: 'COMPLIANCE_READY', ok: true });
  state = reduceDeploymentFlow(state, { type: 'PUBLISH_STARTED', deploymentId: 'dep-1' });
  state = reduceDeploymentFlow(state, { type: 'PROVIDER_STATUS', status: 'SUCCESS', url: 'https://app.example.com' });

  assert.equal(state.state, 'verifying_public_access');

  state = reduceDeploymentFlow(state, {
    type: 'PUBLIC_ACCESS_VERIFIED',
    statusCode: 200,
    url: 'https://app.example.com',
  });

  assert.equal(state.state, 'succeeded');
});

test('deployment flow maps provider failure to repairable failure', () => {
  let state = createDeploymentFlowSnapshot();
  state = reduceDeploymentFlow(state, { type: 'PROFILE_READY', profile });
  state = reduceDeploymentFlow(state, { type: 'PROVIDER_STATUS', status: 'FAILED', url: 'https://app.example.com' });

  assert.equal(state.state, 'failed_repairable');
  assert.equal(state.repairCategory, 'deployment_failed');
});

test('deployment flow blocks publish after failed compliance until rerun', () => {
  let state = createDeploymentFlowSnapshot();
  state = reduceDeploymentFlow(state, {
    type: 'COMPLIANCE_READY',
    ok: false,
    errors: ['missing start'],
  });
  state = reduceDeploymentFlow(state, {
    type: 'PUBLISH_STARTED',
    deploymentId: 'dep-1',
  });

  assert.equal(state.state, 'failed_repairable');
  assert.deepEqual(state.errors, ['publish blocked until profile/adapt/compliance is rerun']);
});
