# Module 01 — GitHub Repo 服务

**认证:** 所有操作使用 `User Token`，Header: `Authorization: Bearer <USER_TOKEN>`
**API Endpoint:** `https://backboard.railway.app/graphql/v2`

---

## 概述

从 GitHub 仓库创建一个持续部署服务。完整流程分为四步：创建服务 → 配置自动触发器 → 配置构建参数 → 触发首次部署。系统需持久化 `serviceId` 和 `deploymentTriggerId`。

---

## 创建流程

### Step 1 — 创建服务 `serviceCreate`

```graphql
mutation($input: ServiceCreateInput!) {
  serviceCreate(input: $input) {
    id
    name
  }
}
```

```json
{
  "input": {
    "name": "web-app",
    "projectId": "<projectId>",
    "source": {
      "repo": "<github-username>/<repo-name>"
    },
    "branch": "main"
  }
}
```

| 返回字段 | 说明 |
| :--- | :--- |
| `id` | **需持久化**，即 `serviceId`，后续所有操作的核心标识 |
| `name` | 服务名称 |

---

### Step 2 — 配置自动部署触发器 `deploymentTriggerCreate`

触发器使 GitHub Push 事件自动触发 Railway 重新部署。

```graphql
mutation($input: DeploymentTriggerCreateInput!) {
  deploymentTriggerCreate(input: $input) {
    id
    repository
    branch
  }
}
```

```json
{
  "input": {
    "projectId": "<projectId>",
    "environmentId": "<environmentId>",
    "serviceId": "<serviceId>",
    "provider": "github",
    "repository": "<github-username>/<repo-name>",
    "branch": "main",
    "checkSuites": false,
    "rootDirectory": ""
  }
}
```

| 返回字段 | 说明 |
| :--- | :--- |
| `id` | **需持久化**，即 `deploymentTriggerId`，用于后续更新或删除触发器 |

---

### Step 3 — 配置构建参数 `serviceInstanceUpdate`

设置构建器类型、构建命令、启动命令、健康检查等运行时参数。

```graphql
mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
  serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
}
```

```json
{
  "serviceId": "<serviceId>",
  "environmentId": "<environmentId>",
  "input": {
    "builder": "NIXPACKS",
    "buildCommand": "npm run build",
    "startCommand": "npm start",
    "rootDirectory": "/",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 300,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3,
    "numReplicas": 1
  }
}
```

`builder` 枚举值：`NIXPACKS`（默认，自动检测语言）、`DOCKERFILE`（使用项目内 Dockerfile）、`HEROKU`（Heroku Buildpack）。

---

### Step 4 — 触发首次部署 `serviceInstanceDeployV2`

```graphql
mutation($serviceId: String!, $environmentId: String!) {
  serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
}
```

```json
{
  "serviceId": "<serviceId>",
  "environmentId": "<environmentId>"
}
```

返回值为新部署的 `deploymentId`，可用于轮询部署状态（参考主文档 deployment query）。

---

## 销毁流程

销毁前建议先删除触发器，再删除服务，确保无残留的 webhook 监听。

### Step 1 — 删除部署触发器 `deploymentTriggerDelete`

```graphql
mutation($id: String!) {
  deploymentTriggerDelete(id: $id)
}
```

```json
{ "id": "<deploymentTriggerId>" }
```

### Step 2 — 删除服务 `serviceDelete`

```graphql
mutation($id: String!, $environmentId: String) {
  serviceDelete(id: $id, environmentId: $environmentId)
}
```

```json
{
  "id": "<serviceId>",
  "environmentId": null
}
```

`environmentId` 为 `null` 时删除所有环境中的该服务；传入具体 ID 则仅删除指定环境中的实例。

---

## 持久化字段汇总

| 字段 | 来源 Mutation | 用途 |
| :--- | :--- | :--- |
| `serviceId` | `serviceCreate` | 所有服务操作的核心 ID |
| `deploymentTriggerId` | `deploymentTriggerCreate` | 管理自动触发器 |
