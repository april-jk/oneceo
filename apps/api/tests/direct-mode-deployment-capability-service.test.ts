import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureDeploymentStartedAfterSourceSync } from '../src/services/task-session-deployment-runtime-service';

test('ensureDeploymentStartedAfterSourceSync keeps source-sync deployment when railway already created one', async () => {
  let manualDeployCalled = false;
  const result = await ensureDeploymentStartedAfterSourceSync({
    waitForSourceSync: async () => ({
      action: 'deploy',
      deploymentId: 'dep_from_source_sync',
    }),
    triggerDeploy: async () => {
      manualDeployCalled = true;
      return {
        action: 'deploy',
        deploymentId: 'dep_manual',
      };
    },
  });

  assert.equal(result.deploymentId, 'dep_from_source_sync');
  assert.equal(manualDeployCalled, false);
});

test('ensureDeploymentStartedAfterSourceSync falls back to manual deploy when source sync creates no deployment', async () => {
  let manualDeployCalled = false;
  const result = await ensureDeploymentStartedAfterSourceSync({
    waitForSourceSync: async () => ({
      action: 'deploy',
    }),
    triggerDeploy: async () => {
      manualDeployCalled = true;
      return {
        action: 'deploy',
        deploymentId: 'dep_manual',
      };
    },
  });

  assert.equal(result.deploymentId, 'dep_manual');
  assert.equal(manualDeployCalled, true);
});
