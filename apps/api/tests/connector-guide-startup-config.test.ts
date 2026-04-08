import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isConnectorGuideStartupRecomputeEnabled } from '../src/services/connector-guide-startup-config';

test('startup recompute is disabled by default', () => {
  assert.equal(isConnectorGuideStartupRecomputeEnabled(undefined), false);
  assert.equal(isConnectorGuideStartupRecomputeEnabled(''), false);
});

test('startup recompute is enabled only when env is true', () => {
  assert.equal(isConnectorGuideStartupRecomputeEnabled('true'), true);
  assert.equal(isConnectorGuideStartupRecomputeEnabled('TRUE'), true);
  assert.equal(isConnectorGuideStartupRecomputeEnabled(' true '), true);

  assert.equal(isConnectorGuideStartupRecomputeEnabled('1'), false);
  assert.equal(isConnectorGuideStartupRecomputeEnabled('yes'), false);
  assert.equal(isConnectorGuideStartupRecomputeEnabled('false'), false);
});

