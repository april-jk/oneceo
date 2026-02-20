# Pause Snapshot: KVM Warm/Cold Startup Validation (2026-02-20)

## Scope
- Topic paused: KVM warm pool + cold fallback stability validation for sandbox provisioning and OSAC relay.
- Reason paused: user requested to suspend this feature development temporarily and preserve current state for later resume.

## Current baseline
- Branch: `task-creation-agent`
- KVM health observed in test: `1.3.3fix17` (not `1.3.3fix16`)
- Validation script used: `apps/api/scripts/_tmp_kvm_fix15_validation.ts`
- Connector path in use: `apps/api/src/connectors/kvm-connector.ts`

## What was verified successfully
1. `pool ensure` returns fast and async behavior looks effective.
- Sample: `pool_ensure_async elapsedMs=16`

2. Rate-limit 429 response now contains machine-readable bucket fields.
- Probe endpoint: `GET /v1/pool/sandboxes/status`
- First 429 sample:
  - `code=RATE_LIMITED`
  - `error.details.bucket=pool`
  - `error.details.reason_code=RATE_LIMIT_BUCKET`
  - `error.details.retry_after_ms` present
  - HTTP `Retry-After` header present (`1`)

## Still failing / not meeting acceptance
1. Claim timeout semantics still not strict.
- Direct probe showed all requests took ~15s regardless of requested timeout.
- Samples:
  - `timeout_ms=0 -> elapsed ~15104ms`
  - `timeout_ms=2000 -> elapsed ~15048ms`
  - `timeout_ms=8000 -> elapsed ~15057ms`
- Server returned details indicate fixed timeout in effect:
  - `effective_timeout_ms=15000`
  - `waited_ms~1503x`
  - `ready_count_at_start=0`
  - `ready_count_at_end=0`

2. Pool convergence not achieved at test time.
- `pool_status` showed `creating=5`, no `ready` members.
- Sample member last_error:
  - `code=POOL_READY_GATE_FAILED`
  - `reason_code=osac_not_listening`
  - `failed_stage=ready_gate`
  - `action_hint.action=replace_member`

3. End-to-end provision path still unstable in this snapshot.
- In validation run: `provision_e2e_timeout_220000ms`

## Interrupted step
- A planned 5-minute convergence polling run (every 30s) was intentionally aborted by user before completion.
- Therefore, no final 3min/5min convergence conclusion was produced in that run.

## Resume checklist (when feature work resumes)
1. Re-run direct claim timeout probes and require true per-request timeout semantics:
- `timeout_ms=0` should return immediately.
- `timeout_ms>0` should honor requested upper bound.

2. Re-run 5-minute pool convergence observation and confirm:
- 3 minutes: `ready >= 3`
- 5 minutes: `ready >= 5`

3. Re-run end-to-end provisioning with default warm-first + cold fallback.
- Confirm no long black-hole wait.
- Confirm OSAC relay path usable after allocation.

4. If still failing with `osac_not_listening`, push KVM and OSAC joint triage with aligned request IDs.

## Reference evidence (this pause point)
- Combined validation output: `apps/api/scripts/_tmp_kvm_fix15_validation.ts` latest run on 2026-02-20.
- Direct timeout probe command output captured in terminal session (timeout 0/2000/8000 all ~15s).
- Rate-limit probe command output captured in terminal session (bucket=pool fields present).
