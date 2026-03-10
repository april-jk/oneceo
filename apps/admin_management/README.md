# oneceo admin_management

独立后台管理系统（当前目录内独立运行），用于可视化管理 `kvm-orchestrator`：

- KVM 虚拟机开关机与状态查看
- KVM 宿主机状态与容量管理
- 运行状态图表（VM 状态分布、宿主机负载、会话状态）
- 审计日志（开关机操作记录）

## 1. 环境准备

1. 安装依赖

```bash
npm install
```

2. 使用上级环境变量文件 `..\\.env`（脚本已默认读取）

如果你需要覆盖管理端专用端口/跨域配置，可在 `..\\.env` 增加：

```env
ADMIN_MANAGEMENT_PORT=9310
ADMIN_MANAGEMENT_CORS_ORIGIN=http://localhost:5174
```

## 2. 启动开发环境

```bash
npm run dev
```

`npm run dev` 会直接从 `..\\.env` 读取环境变量，并同时启动后端和前端（可直接进入管理功能）。

默认端口：

- Web: `http://localhost:5174`
- API: `http://localhost:9310`

> 请确保 `KVM_ORCHESTRATOR_URL` 指向可访问的服务（默认 `http://localhost:8500`）。

## 3. 构建与类型检查

```bash
npm run type-check
npm run build
```

## 4. 目录结构

```text
admin_management/
  server/                 # 独立后端
  web/                    # 独立前端（Vite + React）
  data/                   # 宿主机配置与审计日志
  .env.example
  package.json
```
