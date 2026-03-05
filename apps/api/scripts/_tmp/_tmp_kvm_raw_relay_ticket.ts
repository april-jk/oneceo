import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2] || 'sess_af703dc831394e30';
const base = process.env.KVM_ORCHESTRATOR_URL || '';
const token = process.env.KVM_ORCH_TOKEN || '';

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  console.log(`=== ${path} status=${res.status} ===`);
  console.log(text);
}

async function main() {
  await call(`/v1/sandboxes/${sid}`);
  await call(`/v1/sessions/${sid}/relay/tcp/ticket`, {
    method: 'POST',
    body: JSON.stringify({
      target_port: 18080,
      target_host: 'vm',
      connect_timeout_ms: 5000,
      idle_timeout_ms: 180000,
      ticket_ttl_ms: 30000,
      single_use: true,
    }),
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
