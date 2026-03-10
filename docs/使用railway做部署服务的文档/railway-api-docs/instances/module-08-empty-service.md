# Module 08 — Empty Service 空服务

**认证:** 所有操作使用 `User Token`，Header: `Authorization: Bearer <USER_TOKEN>`
**API Endpoint:** `https://backboard.railway.app/graphql/v2`

---

## 概述

Empty Service 是一个不预设任何代码来源的空白服务容器，创建后可通过 `serviceConnect` 灵活关联 GitHub 仓库或 Docker 镜像，也可直接通过 `serviceInstanceUpdate` 配置运行参数后部署。适用于需要延迟绑定来源、或在同一服务上切换来源的场景。系统需持久化 `serviceId`。

---

## 创建流程

### Step 1 — 创建空服务 `serviceCreate`

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
    "name": "my-service",
    "projectId": "<projectId>"
  }
}
```

不传 `source` 字段，服务以空白状态创建。

| 返回字段 | 说明 |
| :--- | :--- |
| `id` | **需持久化**，即 `serviceId` |

---

### Step 2 — 关联代码来源 `serviceConnect`

在适当时机将服务连接到具体的代码源。`serviceConnect` 与 `serviceCreate` 中的 `source` 字段等效，但允许在服务创建后再执行。

```graphql
mutation($id: String!, $input: ServiceConnectInput!) {
  serviceConnect(id: $id, input: $input) {
    id
  }
}
```

**关联 GitHub 仓库：**

```json
{
  "id": "<serviceId>",
  "input": {
    "repo": "<github-username>/<repo-name>",
    "branch": "main"
  }
}
```

**关联 Docker 镜像：**

```json
{
  "id": "<serviceId>",
  "input": {
    "image": "node:20-alpine"
  }
}
```

**断开当前来源（恢复为空服务）：**

```graphql
mutation($id: String!) {
  serviceDisconnect(id: $id)
}
```

```json
{ "id": "<serviceId>" }
```

---

### Step 3 — 配置运行参数 `serviceInstanceUpdate`

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
    "startCommand": "node server.js",
    "builder": "NIXPACKS",
    "numReplicas": 1,
    "restartPolicyType": "ON_FAILURE"
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

---

## 销毁流程

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

| 字段 | 来源 | 用途 |
| :--- | :--- | :--- |
| `serviceId` | `serviceCreate` | 服务的核心 ID |
