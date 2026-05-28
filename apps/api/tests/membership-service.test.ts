import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

import { db } from '../src/config/database';
import {
  creditTransactions,
  membershipAuditLogs,
  membershipGrants,
  membershipPlans,
  userCredits,
  userMemberships,
} from '../src/db/schema';
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

function createChain(items: {
  direct?: unknown[];
  returning?: unknown[];
  execute?: unknown[];
}) {
  const chain: any = {};
  let pendingMode: 'direct' | 'write' = 'write';
  chain.__setMode = (mode: 'direct' | 'write') => {
    pendingMode = mode;
  };
  chain.select = () => {
    pendingMode = 'direct';
    return chain;
  };
  for (const method of ['from', 'where', 'orderBy', 'limit', 'innerJoin', 'onConflictDoUpdate']) {
    chain[method] = () => chain;
  }
  for (const method of ['insert', 'update']) {
    chain[method] = () => {
      pendingMode = 'write';
      return chain;
    };
  }
  for (const method of ['values', 'set']) {
    chain[method] = () => chain;
  }
  chain.returning = async () => items.returning?.shift() || [];
  chain.execute = async () => items.execute?.shift() || { rows: [] };
  chain.then = (resolve: (value: unknown) => void, reject: (reason?: unknown) => void) =>
    Promise.resolve(pendingMode === 'direct' ? items.direct?.shift() || [] : []).then(resolve, reject);
  return chain;
}

test('createPlan syncs register_default users when the new plan is created as default', async () => {
  const previousDefaultPlan = { id: 'old-plan' };
  const createdPlan = {
    id: 'new-plan',
    code: 'new_default',
    name: '新默认会员',
    status: 'active',
    defaultCredits: 500,
    isDefault: true,
    allowedAgentLevelsJson: ['lite'],
    benefitsJson: ['Agent lite'],
    dailyAutoRestoreEnabled: true,
    dailyAutoRestoreCredits: 100,
  };
  const syncedMembership = {
    id: 'membership-1',
    userId: 'user-1',
    membershipPlanId: 'new-plan',
    status: 'active',
    sourceType: 'register_default',
  };
  const insertCalls: any[] = [];
  const updateCalls: any[] = [];
  const trx = createChain({
    direct: [[previousDefaultPlan]],
    returning: [[createdPlan], [syncedMembership]],
  });
  trx.insert = (table: unknown) => {
    insertCalls.push(table);
    trx.__setMode('write');
    return trx;
  };
  trx.update = (table: unknown) => {
    updateCalls.push(table);
    trx.__setMode('write');
    return trx;
  };
  mock.method(db, 'transaction', async (callback: any) => callback(trx));

  const plan = await membershipService.createPlan({
    code: 'new_default',
    name: '新默认会员',
    status: 'active',
    defaultCredits: 500,
    isDefault: true,
    allowedAgentLevelsJson: ['lite'],
    benefitsJson: ['Agent lite'],
    dailyAutoRestoreEnabled: true,
    dailyAutoRestoreCredits: 100,
    description: '',
    sortOrder: 0,
  } as any);

  assert.equal(plan.id, 'new-plan');
  assert.ok(updateCalls.includes(membershipPlans));
  assert.ok(updateCalls.includes(userMemberships));
  assert.equal(insertCalls.filter((item) => item === membershipAuditLogs).length, 2);
});

test('ensureSystemDefaultPlan backfills users without memberships and skips grant for existing credit accounts', async () => {
  const defaultPlan = {
    id: 'default-plan',
    code: 'default',
    name: '默认会员',
    status: 'active',
    defaultCredits: 500,
    isDefault: true,
    allowedAgentLevelsJson: ['lite'],
    benefitsJson: ['Agent lite'],
    dailyAutoRestoreEnabled: true,
    dailyAutoRestoreCredits: 100,
  };
  const insertCalls: any[] = [];
  const insertedValues: any[] = [];
  const trx = createChain({
    direct: [[], [], [defaultPlan], [defaultPlan]],
    execute: [
      {
        rows: [
          { user_id: 'user-without-credits', has_credit_account: false },
          { user_id: 'user-with-credits', has_credit_account: true },
        ],
      },
    ],
    returning: [
      [defaultPlan],
      [{ id: 'membership-1', userId: 'user-without-credits', membershipPlanId: 'default-plan' }],
      [],
      [{ id: 'credit-account-1', userId: 'user-without-credits', balance: 500 }],
      [{ id: 'transaction-1' }],
      [{ id: 'grant-1' }],
      [{ id: 'membership-2', userId: 'user-with-credits', membershipPlanId: 'default-plan' }],
    ],
  });
  trx.insert = (table: unknown) => {
    insertCalls.push(table);
    trx.__setMode('write');
    return trx;
  };
  trx.values = (value: unknown) => {
    insertedValues.push(value);
    return trx;
  };
  mock.method(db, 'transaction', async (callback: any) => callback(trx));

  const result = await membershipService.ensureSystemDefaultPlan();

  assert.equal(result.backfilledMissingMemberships, 2);
  assert.equal(insertCalls.filter((item) => item === userMemberships).length, 2);
  assert.equal(insertCalls.filter((item) => item === userCredits).length, 1);
  assert.equal(insertCalls.filter((item) => item === creditTransactions).length, 1);
  assert.equal(insertCalls.filter((item) => item === membershipGrants).length, 1);
  assert.ok(insertedValues.some((value: any) => value?.userId === 'user-with-credits' && value?.sourceType === 'register_default'));
});
