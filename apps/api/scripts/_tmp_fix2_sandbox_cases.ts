import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

async function runCase(tag: string, payloadExtra: Record<string, unknown>) {
  const base = process.env.KVM_ORCHESTRATOR_URL!;
  const token = process.env.KVM_ORCH_TOKEN!;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const create = await fetch(base + '/v1/sessions', {
    method: 'POST',
    headers: { ...headers, 'Idempotency-Key': `codex-fix2-${tag}-sess-${Date.now()}` },
    body: JSON.stringify({ metadata: { owner: 'codex-fix2-check', purpose: tag } }),
  });
  const createText = await create.text();
  let sessionId = '';
  try {
    const c = JSON.parse(createText) as any;
    sessionId = String(c?.data?.session_id || '');
  } catch {
    // ignore
  }

  console.log('---', tag, 'CREATE_STATUS', create.status, sessionId || 'no_session');
  if (!sessionId) {
    console.log(createText);
    return;
  }

  const payload: Record<string, unknown> = {
    session_id: sessionId,
    vm_name: `sandbox_${sessionId}`,
    auto_bind: true,
    start: true,
    base_image: process.env.KVM_SANDBOX_BASE_IMAGE,
    network: process.env.KVM_SANDBOX_NETWORK,
    memory_mb: Number(process.env.KVM_SANDBOX_MEMORY_MB || 2048),
    vcpus: Number(process.env.KVM_SANDBOX_VCPUS || 2),
    os_variant: process.env.KVM_SANDBOX_OS_VARIANT,
    ...payloadExtra,
  };

  const sandbox = await fetch(base + '/v1/sandboxes', {
    method: 'POST',
    headers: { ...headers, 'Idempotency-Key': `codex-fix2-${tag}-sbx-${Date.now()}` },
    body: JSON.stringify(payload),
  });
  const sandboxText = await sandbox.text();
  console.log('---', tag, 'SANDBOX_STATUS', sandbox.status);
  console.log(sandboxText);
}

(async () => {
  await runCase('default', {});
  await runCase('network-default', { network: 'default' });
  await runCase('start-false', { start: false });
})();
