# 记忆总结（开发 KVM Orchestrator 文件下发相关）

## KVM 执行层

- 已完成 KVM 执行环境基础能力：session→VM 绑定、增量盘映射、DB 持久化、安全策略（保护 VM、session-first 控制）。
- 关键模块：
  - `apps/api/src/services/sandbox-environment-service.ts`
  - `apps/api/src/db/schema.ts` + `sandbox_execution_environments`
  - `apps/api/src/routes/sandbox-routes.ts`
- 已有安全策略与文档：`docs/Agent执行层-KVM安全设计与配置指南.md`

## OSAC（Sandbox Agent）连接模块

- 已实现 OSAC 连接器 + Server 端接口：
  - `apps/api/src/clients/osac-client.ts`
  - `apps/api/src/connectors/osac-connector.ts`
  - `apps/api/src/services/osac-connection-manager.ts`
  - `apps/api/src/services/osac-agent-service.ts`
  - `apps/api/src/routes/osac-routes.ts`
- 路由挂载：`/api/sandbox/osac/*`
- 配置已加入：`apps/api/.env.example`（OSAC_*）

## OSAC 自动化引导（开箱流程）

- 新增 `POST /api/sandbox/osac/provision`：
  自动开 KVM sandbox → 获取 VM IP → 生成 `osacEndpoint` → 写入 `sandbox_execution_environments.metadata`
- OSAC/Opencode 二进制下载接口：
  - `/api/sandbox/osac/binaries/osac`
  - `/api/sandbox/osac/binaries/opencode`
- 新增配置：
  - `OSAC_PORT`
  - `OSAC_BINARY_PATH`
  - `OPENCODE_BINARY_PATH`
  - `OSAC_BINARY_TOKEN`
- 仍需“下发通道”实现，才能在 VM 内自动下载并启动 OSAC。

## 文档产出

- `docs/KVM基础环境配置与执行层使用说明.md`
- `docs/KVM编排器接入与执行层调用说明.md`
- `docs/Agent执行层-KVM安全设计与配置指南.md`
- `docs/20260206:135924_OSAC模块的服务端连接器任务.已完成.md`
- `kvm-orchestrator-新增下发文件功能清单.md`（已根据需求生成）

## 未完成 / 下一步

- kvm-orchestrator 侧需要新增“下发文件”能力（文档已给）。
- 一旦具备下发通道，即可在 VM 内自动部署并启动 `osac-linux` + `opencode`，完成端到端联调。

