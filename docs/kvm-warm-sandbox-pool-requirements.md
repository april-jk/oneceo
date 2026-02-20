# KVM Warm Sandbox Pool Requirements (for Orchestrator v1.3.x)

## 1. Scope and Goal
- Move warm sandbox pool ownership from `apps/api` to `kvm-orchestrator`.
- API layer must only consume KVM pool APIs, and must not maintain local warm pool scheduling/timer/claim logic.
- Goal: keep a stable ready pool for OSAC workloads and reduce cold-start latency.

## 2. Target Behavior
- Keep `N` prewarmed sandboxes in `ready` state at all times.
- Default target: `N=5`.
- When one ready sandbox is claimed, KVM must immediately create/replenish one new sandbox in background.
- Allocation path must be O(1)-like from caller perspective: claim ready first, do not block on cold create unless pool empty.

## 3. Required Sandbox States
KVM must expose a normalized state machine for pool members:
- `creating`: VM/session/bootstrap in progress
- `ready`: can accept OSAC workload immediately
- `using`: already claimed by caller
- `recycling`: being reset/closed/returned
- `failed`: unrecoverable in current attempt

Transitions:
1. `creating -> ready`
2. `ready -> using`
3. `using -> recycling -> creating` (if reusable) or `using -> closed` + new `creating`
4. `creating/ready/using -> failed` (on fatal)

## 4. Ready Gate (Must Pass Before `ready`)
A sandbox can be marked `ready` only when all checks pass:
1. Session exists and binding is valid.
2. VM is running and guest-agent is available.
3. OSAC binary exists and process is up.
4. OSAC listen port (18080) is actually reachable via KVM relay path (not just TCP socket check).
5. Optional fast control-plane probe to OSAC (`/ws` upgrade success or equivalent).

Notes:
- Must not rely on stale VM IP views from API side.
- Readiness should be determined by KVM-owned probes + relay path that production traffic uses.

## 5. Allocation API Requirements
Add/standardize APIs (KVM side):
1. `POST /v1/pool/sandboxes/claim`
- Input: `purpose`, optional `idempotency_key`, optional `timeout_ms`
- Output: claimed sandbox descriptor (`session_id`, `vm_name`, `relay access info`, `lease info`, `request_id`)
- Behavior: prefer `ready`; if none and timeout>0, wait bounded time; else return machine-readable not-ready

2. `POST /v1/pool/sandboxes/{session_id}/release`
- Input: `result=success|failed`, optional reason
- Behavior: mark `using -> recycling`; do not require API layer to close session directly

3. `GET /v1/pool/sandboxes/status`
- Return counts and samples by state (`ready/using/creating/recycling/failed`), target size, deficits, last refill errors

4. `POST /v1/pool/sandboxes/ensure`
- Force a refill cycle; useful for operations and tests

## 6. Relay/Access Contract
Because API side no longer depends on host-port mapping stability:
- KVM should provide relay access contract in claim response (ticket endpoint + protocol info) for OSAC port 18080.
- API side should not need VM IP.
- Ticket TTL, single-use behavior, and retry hints must be machine-readable.

## 7. Concurrency and Fairness
- Support concurrent claim requests safely.
- No duplicate claim for same `ready` sandbox (CAS/lock required).
- Refill workers must be bounded (`max_inflight`) to avoid burst failures.
- If pool empty, support short wait queue with timeout + clear error code when timeout reached.

## 8. Reliability Rules
- Bounded retries only (no infinite loop).
- Exponential backoff with jitter for bootstrap/reachability probes.
- Stale `creating` items must expire and be recycled automatically.
- Service restart must recover pool controller state from persisted session metadata where possible.

## 9. Error Model (Machine-readable)
Claim/release/status paths must return explicit code + action hint, examples:
- `POOL_EMPTY_TEMPORARY` -> `wait_and_retry`
- `POOL_MEMBER_NOT_READY` -> `refresh_or_replace`
- `POOL_CLAIM_CONFLICT` -> `retry`
- `POOL_RELEASE_INVALID_STATE` -> `fix_state`
- `POOL_READY_GATE_FAILED` -> `replace_member`
- `POOL_RELAY_UNAVAILABLE` -> `retry_or_degrade`

Each error should include:
- `reason_code`
- `failed_stage`
- `action_hint`
- `retryable` (bool)
- `retry_after_ms` (if retryable)

## 10. Observability Requirements
Required log keys for each critical event:
- `request_id`, `session_id`, `pool_member_id`, `state_from`, `state_to`, `reason_code`, `elapsed_ms`
- For relay: `relay_id`, `target_port`, `close_code`, `close_reason`

Required metrics:
- pool size by state
- claim latency p50/p95/p99
- refill latency and failure rate
- ready gate failure distribution
- relay connect failure distribution

## 11. Suggested Defaults
- `POOL_TARGET_SIZE=5`
- `POOL_MAX_INFLIGHT_REFILL=2`
- `POOL_CLAIM_WAIT_TIMEOUT_MS=15000`
- `POOL_MEMBER_CREATING_TTL_MS=300000`
- `POOL_READY_GATE_TIMEOUT_MS=60000`
- `POOL_RELAY_CONNECT_TIMEOUT_MS=5000`

## 12. Acceptance Criteria
1. Under steady load, maintain `ready >= 5` (after warm-up window).
2. 20 consecutive claim/release cycles complete without stuck `creating` or orphan `using`.
3. If one sandbox fails ready gate, it is replaced automatically without manual intervention.
4. Relay-based access to OSAC 18080 succeeds for claimed members (no VM IP dependency).
5. After KVM service restart, pool controller converges back to target size automatically.

## 13. API-side Boundary (Must Keep)
- `apps/api` will only call KVM connector for claim/release/status.
- No local warm pool timer, no local seed scheduler, no local warm pool state machine.
- Any pool policy change should be delivered by KVM API/config, not API service code.
