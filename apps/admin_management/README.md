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

2. 使用上级环境变量文件 `../.env`（脚本已默认读取）

如果你需要覆盖管理端专用监听/访问配置，可在 `../.env` 增加：

```env
ADMIN_MANAGEMENT_BIND_HOST=0.0.0.0
ADMIN_MANAGEMENT_PORT=9310
ADMIN_MANAGEMENT_WEB_HOST=0.0.0.0
ADMIN_MANAGEMENT_WEB_PORT=5174
ADMIN_MANAGEMENT_API_PROXY_HOST=127.0.0.1
ADMIN_MANAGEMENT_CORS_ORIGINS=http://localhost:5174,http://127.0.0.1:5174,http://192.168.1.11:5174
```

配置约定：

- `ADMIN_MANAGEMENT_BIND_HOST`：后台 API 实际监听地址，局域网访问建议保持 `0.0.0.0`
- `ADMIN_MANAGEMENT_WEB_HOST`：Vite 开发服务器监听地址，局域网访问建议保持 `0.0.0.0`
- `ADMIN_MANAGEMENT_API_PROXY_HOST`：Vite 反向代理后台 API 时使用的本机连接地址，默认应为 `127.0.0.1`
- `ADMIN_MANAGEMENT_CORS_ORIGINS`：后台允许的前端来源列表，逗号分隔；未配置时默认允许 `localhost`、`127.0.0.1` 和同端口私网 IP 来源

## 2. 启动开发环境

```bash
npm run dev
```

`npm run dev` 会直接从 `../.env` 读取环境变量，并同时启动后端和前端（可直接进入管理功能）。

默认端口：

- Web: `http://localhost:5174` 或 `http://你的局域网IP:5174`
- API: `http://localhost:9310` 或 `http://你的局域网IP:9310`

> 请确保 `KVM_ORCHESTRATOR_URL` 指向可访问的服务（默认 `http://localhost:8500`）。

## 3. 构建与类型检查

```bash
npm run type-check
npm run build
```

## 4. Railway 部署建议（单服务）

管理端在 Railway 建议作为**单服务**部署，避免同一服务里并行启动多个端口导致平台仅识别一个监听端口。

推荐配置：

1. Root Directory：`apps/admin_management`
2. Build Command：`npm ci && npm run build`
3. Start Command：`npm start`
4. 环境变量：
   - `PORT`：由 Railway 注入（代码已自动回退到 `PORT` 作为 `ADMIN_MANAGEMENT_PORT`）
   - `ONECEO_API_URL`：指向你的 API 服务域名（例如 `https://api-develop.oneceo.ai`）
   - `ONECEO_INTERNAL_TOKEN`：与 API 服务保持一致

说明：

- `npm start` 启动的是管理端 API 服务，同时会托管 `web/dist` 的静态前端文件，外部只暴露一个端口。
- 前端请求 `/api/*` 走同域，不依赖 Vite 开发代理。

## 5. 目录结构

```text
admin_management/
  server/                 # 独立后端
  web/                    # 独立前端（Vite + React）
  data/                   # 宿主机配置与审计日志
  .env.example
  package.json
```
