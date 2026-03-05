import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getValue(...values: any[]): string {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

async function main() {
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  const created: any = await kvmConnector.createSession({
    metadata: {
      owner: 'codex-fix10-smoke',
      purpose: 'kvm-fix10-smoke',
      at: new Date().toISOString(),
    },
  });
  const sid = getValue(created?.data?.sessionId, created?.data?.session_id);
  if (!sid) throw new Error('missing sid');
  console.log('SID=', sid);

  const sbCreate: any = await kvmConnector.createSandbox({
    session_id: sid,
    vm_name: `sandbox_${sid}`,
    auto_bind: true,
    start: true,
  });
  console.log('CREATE_SANDBOX=', JSON.stringify(sbCreate?.data || {}, null, 2));

  let sandbox: any = null;
  for (let i = 0; i < 60; i++) {
    sandbox = await kvmConnector.getSandbox(sid);
    const state = String(sandbox?.data?.lifecycleState || sandbox?.data?.lifecycle_state || '').toLowerCase();
    const stage = String(sandbox?.data?.lifecycleStage || sandbox?.data?.lifecycle_stage || '').toLowerCase();
    console.log('SANDBOX_STATE=', state, 'stage=', stage);
    if (state === 'ready') break;
    if (state === 'failed') {
      console.log('SANDBOX_FAIL=', JSON.stringify(sandbox?.data?.lastError || sandbox?.data?.last_error || {}, null, 2));
      break;
    }
    await sleep(2000);
  }

  const vm: any = await kvmConnector.getSessionVm(sid);
  const vmName = getValue(vm?.data?.vm?.name, vm?.data?.name, vm?.data?.vmName);
  console.log('VM=', vmName);

  const execSubmit: any = await kvmConnector.execSession(sid, {
    path: '/bin/bash',
    args: ['-lc', "ss -ltnp | grep -E ':18080|:18111' || true"],
    capture_output: true,
    timeout_seconds: 45,
  });
  const jobId = getValue(execSubmit?.data?.jobId, execSubmit?.data?.job_id, execSubmit?.jobId, execSubmit?.job_id);
  if (jobId) {
    for (let i = 0; i < 120; i++) {
      const j: any = await kvmConnector.getJob(jobId);
      const st = String(j?.data?.status || '').toLowerCase();
      if (st && st !== 'queued' && st !== 'running') {
        const out = String(j?.data?.result?.stdout || j?.data?.stdout || '');
        console.log('PORT_LISTEN=', out);
        break;
      }
      await sleep(1000);
    }
  }

  try {
    const ticket: any = await kvmConnector.createRelayTcpTicket(sid, {
      target_port: 18080,
      target_host: 'vm',
      connect_timeout_ms: 5000,
      idle_timeout_ms: 180000,
      ticket_ttl_ms: 30000,
      single_use: true,
    });
    console.log('RELAY_TICKET_OK=', JSON.stringify(ticket?.data || {}, null, 2));
  } catch (error) {
    console.log('RELAY_TICKET_ERR=', error instanceof Error ? error.message : String(error));
  }

  try {
    const ports: any = await kvmConnector.listSandboxPorts(sid, { refresh: 'true', verify: 'true', wait_seconds: '3' } as any);
    console.log('PORTS=', JSON.stringify(ports?.data || {}, null, 2));
  } catch (error) {
    console.log('PORTS_ERR=', error instanceof Error ? error.message : String(error));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
