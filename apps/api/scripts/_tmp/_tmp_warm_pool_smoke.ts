import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

process.env.OSAC_WARM_POOL_ENABLED = 'true';
process.env.OSAC_WARM_POOL_SIZE = '1';
process.env.OSAC_WARM_POOL_MAX_INFLIGHT = '1';
process.env.OSAC_WARM_POOL_CHECK_INTERVAL_MS = '5000';
process.env.OSAC_WARM_POOL_SCAN_LIMIT = '120';

const sleep = (ms:number) => new Promise((r)=>setTimeout(r, ms));

(async()=>{
  const { sandboxAgentProvisionService } = await import('../src/services/sandbox-agent-provision-service');
  const started = Date.now();
  for (let i=1;i<=18;i++) {
    const status = await sandboxAgentProvisionService.getWarmPoolStatus();
    console.log(JSON.stringify({
      tick: i,
      elapsedMs: Date.now()-started,
      availableCount: status.availableCount,
      seedingCount: status.seedingCount,
      inFlight: status.inFlight,
      totalWarmCount: status.totalWarmCount,
      lastEnsureReason: status.lastEnsureReason,
      lastEnsureError: status.lastEnsureError,
      sample: status.samples[0] || null,
    }));
    if (status.availableCount >= 1) {
      process.exit(0);
    }
    await sleep(10000);
  }
  process.exit(2);
})();
