# OSAC / KVM 联合诊断报告（Fix10p4 Debug）

日期：2026-02-19
范围：`apps/api` 编排侧 + KVM 管理侧 + VM 内 OSAC 运行态

## 1. 结论摘要

当前问题不是单点故障，而是两类问题叠加：

1. 编排侧桥接保持问题（可恢复）
- 当未建立并保持 OSAC persistent WS bridge 时，VM 内本地代理 `127.0.0.1:18111` 返回 `bridge_disconnected`。
- 建立 bridge 且加载桥接处理器后，同一 session 可稳定成功调用 `/v1/models` 和 `/v1/chat/completions`。

2. KVM / 会话生命周期一致性问题（阻断）
- 存在 `status=ready` 但 VM 内 OSAC 进程不存在、host 端口 `ECONNREFUSED` 的会话。
- 存在大量 `status=creating` 但 KVM 侧已无会话/无 VM 绑定/无端口映射的数据漂移。

因此：
- OSAC 协议链路本身在“健康会话 + 有 bridge”条件下可工作。
- 当前主阻断是 KVM 会话状态一致性 + 编排端 bridge 保持策略。

## 2. 关键证据

### 2.1 成功样本（证明 OSAC 可用）
会话：`sess_b5149850bccd4e3a`

操作：启动本地 bridge 路由 + `osacLlmProxyBridgeService.initialize()` + `ensurePersistent(sessionId)` 后，在 VM 内执行：
- `curl http://127.0.0.1:18111/v1/models`
- `curl http://127.0.0.1:18111/v1/chat/completions`

结果：
- `/v1/models` 返回 200，模型列表正常。
- `/v1/chat/completions` 返回 200，内容 `sandbox_proxy_ok`。

### 2.2 失败样本 A（无 bridge 时）
同会话：`sess_b5149850bccd4e3a`

操作：未保持 persistent bridge 时在 VM 内请求 `/v1/models`。

结果：
- 返回 `{"error":{"code":"bridge_disconnected",...}}`

说明：OSAC 进程在，但上层桥接未就绪。

### 2.3 失败样本 B（KVM/运行态漂移）
会话：`sess_3fb5d8eaa5074e2b`

诊断结果：
- DB: `status=ready`
- KVM ports: host `20146 -> vm:18080`
- VM 内：`NO_OSAC_PID`，`127.0.0.1:18111` 连接拒绝
- API 侧 WS：`connect ECONNREFUSED 192.168.10.172:20146`

说明：状态“ready”与实际运行态不一致（会话可见但 OSAC 未运行/端口无服务）。

### 2.4 失败样本 C（creating 长时间卡滞）
抽样会话：
- `sess_6f504dd05d03470f`：KVM 返回 `Session not found`
- `sess_0f17e84f77b347f5` / `sess_1ddc89d0882148da` / `sess_b19318e5de984bdc`：`Session has no VM binding`

共同特征：
- DB 仍为 `creating`
- KVM 侧无有效 VM 绑定或已找不到会话

说明：编排 DB 状态与 KVM 实际状态未收敛，造成预热池与后续调度污染。

## 3. 已完成的脚本修正（避免假失败）

文件：`apps/api/scripts/osac_opencode_regression.ts`

修复点：
- 本地临时 bridge server 改为与生产一致的挂载方式：
  - `app.use('/api/llm-proxy', express.raw(...), llmProxyRoutes)`
- 避免路径拼接产生 `/v1/api/llm-proxy/v1/models` 这类伪错误。

## 4. 对 KVM 团队的修复请求（P0）

1. 会话状态一致性收敛
- 若 session 在 KVM 不存在或无 VM 绑定，必须回写编排为 `failed/retired`，禁止长期 `creating`。

2. ready 判定升级
- `ready` 必须包含：
  - VM running
  - guest agent 可用
  - OSAC 进程存在
  - `127.0.0.1:18111` 可连接
  - hostPort 映射有效（非仅记录存在）

3. 端口映射有效性校验
- 对 hostPort 做主动探测（tcp connect + ws handshake）后再标记可用。

4. 冷启动超时与异步作业回传
- 冷启动超过阈值时返回结构化失败码，不要让编排无边界等待。

## 5. 对 OSAC 团队的修复请求（P1）

1. bridge 未就绪时日志上下文补齐
- `bridge_disconnected/bridge_no_ack` 日志必须始终包含 `sessionId/connId/lifecycleId`（禁止空值）。

2. 无上游 bridge 场景快速恢复建议
- 在 `/debug/bridge-state` 中增加最近一次 ACK 超时原因与建议 `nextAction`。

3. 保留当前 Fix10p4 的 ACK 重试与 backpressure 指标输出
- 便于与编排/KVM 联调统一判责。

## 6. 对编排/API 团队的修复请求（P0）

1. 默认开启启动恢复
- `OSAC_PERSISTENT_RECOVER_ON_STARTUP` 不应在联调环境关闭。

2. 预热池出队前强校验
- 出队条件必须包含：
  - `ensurePersistent(sessionId)` 成功
  - VM 内 `/v1/models` 预探测成功

3. creating 垃圾回收
- 对超时 creating（且 KVM 无 session/无绑定）自动标记失败并回收。

4. 回归脚本统一超时熔断
- 所有阶段都保留 `stage timeout + total budget`，避免长时间黑洞等待。

## 7. 建议下一步联调顺序

1. KVM 先修状态收敛（creating/ready 真值化）。
2. 编排启用 persistent recover，并清理历史脏会话。
3. 在“健康 session”上跑 20 轮回归（含弱网场景），再评估 OSAC 是否仍有剩余缺陷。
