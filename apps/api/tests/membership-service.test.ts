import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

import { membershipService } from '../src/services/membership-service';

afterEach(() => {
  mock.reset();
});

test('assertUserCanUseAgentLevel allows only the levels granted by active membership', async () => {
  mock.method(membershipService, 'getActiveMembershipEntitlement', async () => ({
    membership: {
      id: 'membership-1',
      userId: 'user-1',
      membershipPlanId: 'plan-1',
      status: 'active',
    },
    plan: {
      id: 'plan-1',
      name: '默认会员',
      allowedAgentLevelsJson: ['lite'],
    },
    allowedAgentLevels: ['lite'],
  }) as any);

  const allowed = await membershipService.assertUserCanUseAgentLevel('user-1', 'lite');
  assert.equal(allowed.level, 'lite');

  await assert.rejects(
    () => membershipService.assertUserCanUseAgentLevel('user-1', 'pro'),
    /当前会员类型仅允许使用 agent lite/
  );
});

test('assertUserCanUseAgentLevel rejects users without active membership', async () => {
  mock.method(membershipService, 'getActiveMembershipEntitlement', async () => null);

  await assert.rejects(
    () => membershipService.assertUserCanUseAgentLevel('user-1', 'lite'),
    /当前用户没有启用中的会员类型/
  );
});
