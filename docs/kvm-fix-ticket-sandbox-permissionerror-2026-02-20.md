# 修复工单（P0）

工单日期：2026-02-20  
优先级：P0  
目标版本：建议 `1.3.3fix3`（或更高）  
影响范围：Sandbox 创建链路（`/v1/sandboxes`）

## 1. 问题摘要
在 `kvm-orchestrator 1.3.3fix2` 中，`POST /v1/sandboxes` 仍稳定失败，返回：
- HTTP 500
- `code=INTERNAL_ERROR`
- `error.details.exception=PermissionError`

这导致“新建 sandbox -> 部署 OSAC -> 通过 relay 访问 18080”的标准流程无法自动完成。

## 2. 现网验证结论
已确认以下路径是可用的：
1. `POST /v1/sessions` 可用。
2. `POST /v1/sessions/{session_id}/bind`（绑定已运行 VM）可用。
3. VM 内 OSAC 监听 `:18080` 后，KVM WS relay 可访问该端口。
4. relay 到 OSAC `/ws` 可返回 `HTTP/1.1 101 Switching Protocols`。

结论：问题不在 WS relay，也不在 OSAC 18080 通道；问题集中在 `/v1/sandboxes` 创建阶段的权限链路。

## 3. 复现信息（已实测）

### 3.1 版本
- `/health` 返回：`1.3.3fix2`

### 3.2 复现矩阵
以下三种请求均失败（同一错误）：
1. 默认参数创建 sandbox
2. `network=default`
3. `start=false`

### 3.3 关键 request_id
- `a69ff70b-cf59-40c2-89ca-788cc50fa8ae`
- `f2737208-6213-43e5-b8a9-ef8abdd8c035`
- `138b89e2-8c3a-4f6d-aad8-a4a1e57eedc1`
- `9f680c1b-a384-4480-884d-3db6875e3f06`

## 4. 修复要求（必须）
1. 定位并修复 `/v1/sandboxes` 创建链路中的 `PermissionError` 根因。
2. 不允许继续仅返回泛化 `INTERNAL_ERROR`，需返回可机读错误码和阶段字段。
3. 返回体需至少包含：
   - `reason_code`
   - `failed_stage`
   - `action_hint`
   - `request_id`
4. 保证 `KVM_ORCH_FIREWALL_REQUIRED=false` 时，防火墙相关失败不会阻断 sandbox 创建主流程。
5. 仅需保障 OSAC 端口（`18080`）链路可用，不要求其他业务端口。

## 5. 建议优先排查点
1. overlay 创建目录/文件权限（mkdir/chown/chmod/qemu-img）。
2. libvirt define/start 调用用户权限（virsh/qemu 侧）。
3. sandbox metadata/状态文件写入权限。
4. 自动创建流程中任何 `PermissionError` 的异常包装丢失（导致无法输出明确 `reason_code`）。

## 6. 验收标准
1. 连续 20 次 `POST /v1/sandboxes` 成功（默认配置）。
2. 若失败，必须返回明确机读码（非泛化 INTERNAL_ERROR）。
3. 端到端通过：
   - 创建 sandbox
   - VM 内启动 OSAC（监听 `:18080`）
   - 申请 relay ticket
   - WS relay 访问 OSAC `/ws` 返回 `101`。
4. 不出现“创建成功但 lifecycle 错误停留在 creating/failed 且与真实 VM 状态不一致”的情况。

## 7. 交付要求
1. 新版本号与变更清单。
2. 对应 commit hash。
3. 20 轮回归结果（含失败分桶）。
4. 至少 1 组成功链路日志（create -> ready -> relay -> 101）。
