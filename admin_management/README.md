# oneceo admin_management

独立后台管理系统（当前目录内独立运行），用于可视化管理 `kvm-orchestrator`：

- KVM 虚拟机开关机与状态查看
- KVM 宿主机状态与容量管理
- 运行状态图表（VM 状态分布、宿主机负载、会话状态）
- 审计日志（开关机操作记录）

## 1. 环境准备

1. 复制环境变量

```bash
cp .env.example .env
```

2. 安装依赖

```bash
npm install
```

## 2. 启动开发环境

```bash
npm run dev
```

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