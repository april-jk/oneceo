# Module 02 — Docker Image 服务

**认证:** 所有操作使用 `User Token`，Header: `Authorization: Bearer <USER_TOKEN>`
**API Endpoint:** `https://backboard.railway.app/graphql/v2`

---

## 概述

从 Docker Hub 或 GitHub Container Registry (GHCR) 的镜像创建服务。支持公开镜像和私有镜像（需提供凭证）。完整流程：创建服务 → 配置运行参数 → 触发部署。系统需持久化 `serviceId`。

---

## 创建流程

### Step 1 — 创建服务（公开镜像）`serviceCreate`

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
    "name": "nginx-proxy",
    "projectId": "<projectId>",
    "source": {
      "image": "nginx:latest"
    }
  }
}
```

### Step 1（变体）— 创建服务（私有镜像）

私有镜像需在 `source.image` 中提供完整镜像路径，并附带 `registryCredentials`。

```json
{
  "input": {
    "name": "private-app",
    "projectId": "<projectId>",
    "source": {
      "image": "ghcr.io/<org>/<image>:<tag>"
    },
    "registryCredentials": {
      "username": "<registry-username>",
      "password": "<registry-token-or-password>"
    }
  }
}
```

对于 GHCR 私有镜像，`username` 为 GitHub 用户名，`password` 为具有 `read:packages` 权限的 Personal Access Token。

| 返回字段 | 说明 |
| :--- | :--- |
| `id` | **需持久化**，即 `serviceId` |

---

### Step 2 — 配置运行参数 `serviceInstanceUpdate`

配置容器启动命令、副本数、区域、资源限制等。

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
    "startCommand": "",
    "numReplicas": 1,
    "region": "us-west1",
    "restartPolicyType": "ALWAYS",
    "restartPolicyMaxRetries": 5,
    "healthcheckPath": "/",
    "healthcheckTimeout": 60
  }
}
```

`region` 可选值（Railway 支持的区域）：`us-west1`、`us-east4`、`eu-west4`、`asia-southeast1` 等。`startCommand` 为空时使用镜像默认 CMD/ENTRYPOINT。

---

### Step 3 — 配置资源限制 `serviceInstanceLimitsUpdate`

```graphql
mutation($input: ServiceInstanceLimitsUpdateInput!) {
  serviceInstanceLimitsUpdate(input: $input)
}
```

```json
{
  "input": {
    "serviceId": "<serviceId>",
    "environmentId": "<environmentId>",
    "memoryGB": 0.5,
    "vCPUs": 0.5
  }
}
```

---

### Step 4 — 触发部署 `serviceInstanceDeployV2`

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

返回 `deploymentId`，可用于轮询状态。

---

## 更新镜像版本

当需要更新镜像 tag 时，通过 `serviceInstanceUpdate` 更新 `source.image` 后重新部署。

```json
{
  "serviceId": "<serviceId>",
  "environmentId": "<environmentId>",
  "input": {
    "source": {
      "image": "nginx:1.25.3"
    }
  }
}
```

---

## 销毁流程

### 删除服务 `serviceDelete`

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

---

## 持久化字段汇总

| 字段 | 来源 Mutation | 用途 |
| :--- | :--- | :--- |
| `serviceId` | `serviceCreate` | 所有服务操作的核心 ID |
