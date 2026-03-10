# 编排流程：KVM 冷启动 + 端口转发稳定化最佳实践

更新时间：2026-02-20  
适用版本：KVM Orchestrator `1.3.3fix16+`，编排侧 `apps/api`。

## 1. 目标

在编排流程里使用 KVM 冷启动一个全新 Sandbox VM，并通过“多次刷新 + 探测”确认端口转发稳定后再放行上层业务，避免刚创建即使用导致抖动和失败。

## 2. 强制约束（必须遵守）

1. 仅通过 `apps/api/src/connectors/kvm-connector.ts` 调 KVM，不允许业务层直接请求 KVM。
2. 端口探测统一使用 `apps/api/src/connectors/kvm-call-pattern.ts` 的方法：
- `buildSandboxPortProbeQuery`
- `extractSandboxPortMappings`
- `findSandboxPortMapping`
- `isSandboxPortReady`
3. 所有重试流程必须有超时熔断，禁止无限等待。

## 3. 冷启动标准流程

### 步骤 1：创建会话 + 创建 Sandbox

1. 调 `kvmConnector.createSession(...)`，写入 `Idempotency-Key`。
2. 调 `kvmConnector.createSandbox(...)`（带 `session_id`）。

建议：
- 冷启动总超时建议 `<= 300s`。
- 若返回 `RATE_LIMITED`，按 `retry_after_ms` 退避。

### 步骤 2：等待 Sandbox ready gate 收敛

循环调用 `kvmConnector.getSandbox(sessionId)`，关注：

1. `lifecycle_state` 是否到 `ready`。
2. `ready_gate` 是否通过。
3. 若失败，读取 `last_error.reason_code / failed_stage / action_hint`。

建议：
- 轮询间隔 `2s`。
- 最长等待 `120s~180s`。

### 步骤 3：创建端口映射

调用 `kvmConnector.createSandboxPort(sessionId, { vm_port, host_port, protocol: 'tcp' })`。  
若 host 端口冲突可换端口重试，不要阻塞主流程。

### 步骤 4：多次刷新端口状态直到“稳定”

每轮调用：

1. `kvmConnector.listSandboxPorts(sessionId, buildSandboxPortProbeQuery(waitSeconds))`
2. 用 `extractSandboxPortMappings + findSandboxPortMapping` 找目标映射
3. 用 `isSandboxPortReady` 判断 ready

稳定判定建议（推荐）：

1. 至少连续 2 次 `portReady=true`。
2. 连续 2 次 `hostPort` 不变。
3. 若返回 `mapping_epoch`，连续 2 次不回退。

建议参数：

- `wait_seconds=5`（每次刷新带 KVM 侧探测窗口）
- 外层最大刷新轮次 `8~12`
- 外层轮询间隔 `2s`
- 外层总超时 `<= 90s`

## 4. 推荐错误处理策略

### 可重试类（短退避）

1. `PORT_MAPPING_PENDING`
2. `SANDBOX_PORT_NOT_READY`
3. `SANDBOX_READY_GATE_FAILED`（先看 `failed_stage`，必要时重启 Sandbox）
4. `RATE_LIMITED`（必须遵守 `retry_after_ms`）
5. 网络类 `5xx/timeout`

处理建议：

1. 最多重试 2~3 轮大周期。
2. 每轮内部走“多次刷新”。
3. 超过总预算直接失败返回，交由上层决策（重建或回退）。

### 不可盲重试类（先修复）

1. `SANDBOX_BINDING_MISSING`
2. 权限类 `*_PERMISSION_DENIED`
3. 配置类 `AUTH_* / TOKEN_*`

## 5. 可直接落地的伪代码（TypeScript）

```ts
import { kvmConnector } from '../src/connectors/kvm-connector';
import {
  buildSandboxPortProbeQuery,
  extractSandboxPortMappings,
  findSandboxPortMapping,
  isSandboxPortReady,
  normalizeSandboxPortMapping,
} from '../src/connectors/kvm-call-pattern';

export async function coldStartAndWaitStablePort(input: {
  sessionId: string;
  vmPort: number;
  hostPort: number;
  verifyWaitSeconds?: number; // default 5
  maxRefresh?: number; // default 10
  refreshIntervalMs?: number; // default 2000
}) {
  const verifyWaitSeconds = input.verifyWaitSeconds ?? 5;
  const maxRefresh = input.maxRefresh ?? 10;
  const refreshIntervalMs = input.refreshIntervalMs ?? 2000;

  await kvmConnector.createSandboxPort(input.sessionId, {
    vm_port: input.vmPort,
    host_port: input.hostPort,
    protocol: 'tcp',
  });

  let stableHit = 0;
  let lastHostPort: number | null = null;
  let lastEpoch: number | null = null;

  for (let i = 0; i < maxRefresh; i++) {
    const ports = await kvmConnector.listSandboxPorts(
      input.sessionId,
      buildSandboxPortProbeQuery(verifyWaitSeconds)
    );

    const items = extractSandboxPortMappings(ports.data);
    const matched = findSandboxPortMapping(items as any[], input.vmPort, input.hostPort);
    if (!matched || !isSandboxPortReady(matched as any)) {
      stableHit = 0;
      await sleep(refreshIntervalMs);
      continue;
    }

    const norm = normalizeSandboxPortMapping(matched as any);
    const hostUnchanged = lastHostPort === null || lastHostPort === norm.hostPort;
    const epochStable = lastEpoch === null || norm.mappingEpoch === null || norm.mappingEpoch >= lastEpoch;

    if (hostUnchanged && epochStable) {
      stableHit += 1;
    } else {
      stableHit = 0;
    }

    lastHostPort = norm.hostPort;
    if (norm.mappingEpoch !== null) lastEpoch = norm.mappingEpoch;

    if (stableHit >= 2) {
      return {
        ready: true,
        vmPort: norm.vmPort,
        hostPort: norm.hostPort,
        mappingEpoch: norm.mappingEpoch,
      };
    }

    await sleep(refreshIntervalMs);
  }

  throw new Error('port mapping not stable within refresh budget');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

## 6. 审计与日志字段（建议最小集）

每轮刷新至少记录：

1. `requestId`
2. `sessionId`
3. `vmPort`
4. `hostPort`
5. `attempt`
6. `portReady`
7. `mappingEpoch`
8. `error.code`（若失败）

## 7. 与热启动并存的建议

1. 默认可先尝试热启动池。
2. 热启动不可用时，立即走本文冷启动流程。
3. 冷启动路径必须始终可独立成功，不依赖热启动状态。

## 8. 编排侧落地点

建议统一在 `apps/api/src/services/sandbox-agent-provision-service.ts` 编排冷启动与稳定性等待逻辑；  
外部调用仍通过服务层，避免路由层散落重复重试代码。

