import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const base = process.env.KVM_ORCHESTRATOR_URL || '';
const token = process.env.KVM_ORCH_TOKEN || '';

async function main() {
  const url = `${base}/v1/sessions`;
  for (let i = 1; i <= 3; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `codex-rate-probe-${Date.now()}-${i}`,
      },
      body: JSON.stringify({ metadata: { owner: 'codex-rate-probe', round: i, at: new Date().toISOString() } }),
    });

    const text = await res.text();
    console.log(JSON.stringify({
      round: i,
      status: res.status,
      xRequestId: res.headers.get('x-request-id'),
      retryAfter: res.headers.get('retry-after'),
      body: text,
    }, null, 2));

    await new Promise((r) => setTimeout(r, 500));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
