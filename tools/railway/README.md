# Railway 一键三端部署脚本

脚本路径：`tools/railway/deploy-three-services.sh`

## 目标

一键完成 OneCEO 三端服务（`api`、`web`、`admin-management`）在 Railway 的基础配置与部署，避免手动点选复杂操作。

## 行为说明

脚本会自动执行：

1. 检查 Railway 登录态（未登录则触发 `railway login`）
2. 检查当前目录是否已绑定 Railway 项目
3. 自动创建并绑定 3 个服务（若不存在）
4. 为每个服务写入 `RAILPACK_*_COMMAND` 与 `RAILPACK_*_CMD`（双写，兼容不同 Railpack 版本）
5. 顺序部署 3 个服务

## 使用方式

在仓库根目录执行：

```bash
bash tools/railway/deploy-three-services.sh
```

若当前目录未绑定项目，可先：

```bash
pnpm dlx @railway/cli@latest link
```

或通过环境变量自动绑定：

```bash
RAILWAY_PROJECT_ID=<your_project_id> bash tools/railway/deploy-three-services.sh
```

## 仅配置不部署

```bash
DEPLOY_NOW=false bash tools/railway/deploy-three-services.sh
```

## 备注

- 本脚本采用“仓库根目录部署 + 服务级构建命令”的方式，避免 `api` 的 workspace 依赖（`@oneceo/shared`）在子目录独立部署时不稳定的问题。
- 业务环境变量（如 `DATABASE_URL`、`FRONTEND_URL`、`ONECEO_API_URL` 等）请在 Railway 对应服务中按需补齐。
