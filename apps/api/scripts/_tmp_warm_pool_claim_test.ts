import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
process.env.OSAC_WARM_POOL_ENABLED = 'true';
process.env.OSAC_WARM_POOL_SIZE = '5';

(async()=>{
  const { ensureDatabaseConnection } = await import('../src/config/database');
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  const { sandboxAgentProvisionService } = await import('../src/services/sandbox-agent-provision-service');

  await ensureDatabaseConnection({ retries: 1, delayMs: 100 });
  const rows = await sandboxExecutionEnvironmentDAO.listRecent(60);
  const candidate = (rows as any[]).find((r)=>String(r?.status||'')==='ready');
  if (!candidate) {
    console.log(JSON.stringify({ ok:false, reason:'no_ready_candidate' }));
    process.exit(2);
  }

  const sid = String(candidate.sessionId);
  const metadata = ((candidate.metadata || {}) as Record<string, unknown>) || {};
  const patched = {
    ...metadata,
    owner: 'osac-warm-pool',
    purpose: 'osac-warm-pool',
    warmPool: {
      ...((metadata.warmPool || {}) as Record<string, unknown>),
      state: 'ready',
      sandboxStatus: 'ready',
      markedAt: new Date().toISOString(),
      reason: 'smoke_test_ready',
    },
    warmPoolSandboxStatus: 'ready',
  } as Record<string, unknown>;
  await sandboxExecutionEnvironmentDAO.updateMetadata(sid, patched);

  const before = await sandboxAgentProvisionService.getWarmPoolStatus();
  const result = await sandboxAgentProvisionService.provision({ metadata: { smoke: 'warm-pool-claim' } });
  const after = await sandboxAgentProvisionService.getWarmPoolStatus();

  console.log(JSON.stringify({
    ok: true,
    candidateSessionId: sid,
    claimedSessionId: result.sessionId,
    warmPoolHit: result.warmPoolHit === true,
    before: {
      availableCount: before.availableCount,
      usingCount: before.usingCount,
      readyQueue: before.readyQueue,
    },
    after: {
      availableCount: after.availableCount,
      usingCount: after.usingCount,
      readyQueue: after.readyQueue,
    }
  }, null, 2));
  process.exit(0);
})();
