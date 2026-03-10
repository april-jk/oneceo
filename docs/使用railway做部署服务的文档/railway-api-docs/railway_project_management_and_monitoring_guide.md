# Railway API 规范：项目管理、权限隔离与监控

**版本:** 2.0 | **API Endpoint:** `https://backboard.railway.app/graphql/v2`

本文档提供了一套完整的技术规范，用于通过 Railway GraphQL API 对项目生命周期、权限隔离、监控面板和日志系统进行程序化管理。

---

## 认证模型

- **User Token (账户级):** 用于执行管理操作，如创建/删除项目、创建/删除项目级 Token。必须在系统后端安全存储，**绝不能**暴露给客户端或终端用户。
- **Project Token (项目级):** 用于执行特定项目内的操作，如部署、查看日志、管理服务。每个 Token 与一个项目和一个环境绑定，是实现多租户权限隔离的核心。由系统后端为每个租户动态创建和销毁。

所有 API 调用均在 HTTP Header 中携带相应 Token：
`Authorization: Bearer <TOKEN>`

---
## 第一章：项目生命周期管理

### 1.1 创建项目 `projectCreate`

```graphql
mutation($input: ProjectCreateInput!) {
  projectCreate(input: $input) {
    id
    name
    description
    environments {
      edges {
        node {
          id
          name
        }
      }
    }
  }
}
```

```json
{
  "input": {
    "name": "customer-a-project",
    "description": "Project for Customer A",
    "workspaceId": "<your-workspace-id>",
    "isPublic": false,
    "prDeploys": false
  }
}
```

- **持久化:** `id` (项目 ID) 和 `environments.node.id` (环境 ID)。

### 1.2 查询项目 `project`

```graphql
query($id: String!) {
  project(id: $id) {
    id
    name
    description
    createdAt
    services { edges { node { id name } } }
    environments { edges { node { id name } } }
  }
}
```

```json
{ "id": "<projectId>" }
```

### 1.3 更新项目 `projectUpdate`

```graphql
mutation($id: String!, $input: ProjectUpdateInput!) {
  projectUpdate(id: $id, input: $input)
}
```

```json
{
  "id": "<projectId>",
  "input": {
    "name": "New Project Name",
    "description": "Updated description."
  }
}
```

### 1.4 删除项目 `projectDelete`

**警告：此操作会立即永久删除项目及其所有资源，包括服务、部署、日志和 Volume 数据。**

```graphql
mutation($id: String!) {
  projectDelete(id: $id)
}
```

```json
{ "id": "<projectId>" }
```

---
## 第二章：权限隔离 — 项目级 API Key 管理

通过为每个客户的项目创建专属的 `Project Token`，实现严格的权限隔离。

### 2.1 创建项目级 Token `projectTokenCreate`

使用**账户级 User Token** 调用此接口。

```graphql
mutation($input: ProjectTokenCreateInput!) {
  projectTokenCreate(input: $input) {
    id
    name
    displayToken
  }
}
```

```json
{
  "input": {
    "projectId": "<projectId>",
    "environmentId": "<environmentId>",
    "name": "customer-a-token"
  }
}
```

- **持久化:** `id` (Token 记录的 ID，用于删除) 和 `displayToken` (实际的 API Key，**需加密存储**)。`displayToken` 仅在创建时返回一次。

### 2.2 查询项目级 Token `projectTokens`

使用**账户级 User Token** 调用。

```graphql
query($projectId: String!) {
  projectTokens(projectId: $projectId) {
    edges {
      node {
        id
        name
        createdAt
      }
    }
  }
}
```

```json
{ "projectId": "<projectId>" }
```

### 2.3 吊销项目级 Token `projectTokenDelete`

使用**账户级 User Token** 调用。

```graphql
mutation($id: String!) {
  projectTokenDelete(id: $id)
}
```

```json
{ "id": "<projectTokenId>" }
```

在客户退订或需要轮换密钥时，必须调用此接口吊销旧 Token。

---
## 第三章：监控与部署面板

### 3.1 查询部署列表（部署面板）`deployments`

可使用**项目级 Project Token** 调用。

```graphql
query($input: DeploymentListInput, $first: Int) {
  deployments(input: $input, first: $first) {
    edges {
      node {
        id
        status
        createdAt
        meta {
          ... on GithubMeta {
            commitMessage
            commitAuthor
          }
        }
        service {
          name
        }
      }
    }
  }
}
```

```json
{
  "input": {
    "projectId": "<projectId>",
    "environmentId": "<environmentId>",
    "status": {
      "in": ["SUCCESS", "FAILED", "CRASHED"]
    }
  },
  "first": 20
}
```

- **`status.in` 可用值:** `BUILDING`, `CRASHED`, `DEPLOYING`, `FAILED`, `INITIALIZING`, `QUEUED`, `REMOVED`, `SUCCESS`, `WAITING`。

### 3.2 查询资源使用与监控指标 `metrics`

可使用**项目级 Project Token** 调用。

```graphql
query($projectId: String!, $environmentId: String!, $startDate: DateTime!, $endDate: DateTime!, $measurements: [MetricMeasurement!]!) {
  metrics(
    projectId: $projectId
    environmentId: $environmentId
    startDate: $startDate
    endDate: $endDate
    measurements: $measurements
    sampleRateSeconds: 300
  ) {
    measurement
    series {
      tags {
        key
        value
      }
      points {
        ts
        value
      }
    }
  }
}
```

```json
{
  "projectId": "<projectId>",
  "environmentId": "<environmentId>",
  "startDate": "2024-01-01T00:00:00Z",
  "endDate": "2024-01-02T00:00:00Z",
  "measurements": ["CPU_USAGE", "MEMORY_USAGE_GB"]
}
```

- **`measurements` 可用值:** `CPU_USAGE`, `MEMORY_USAGE_GB`, `NETWORK_RX_GB`, `NETWORK_TX_GB`, `DISK_USAGE_GB`。
- `sampleRateSeconds` 定义采样间隔，单位秒。

### 3.3 查询项目事件（活动日志）`events`

```graphql
query($projectId: String!, $first: Int) {
  events(projectId: $projectId, first: $first) {
    edges {
      node {
        id
        action
        object
        createdAt
        user {
          name
        }
      }
    }
  }
}
```

```json
{
  "projectId": "<projectId>",
  "first": 50
}
```

---
## 第四章：日志系统

### 4.1 查询部署日志 `deploymentLogs`

可使用**项目级 Project Token** 调用。用于获取构建和运行时日志。

```graphql
query($deploymentId: String!, $limit: Int, $filter: String) {
  deploymentLogs(deploymentId: $deploymentId, limit: $limit, filter: $filter) {
    timestamp
    message
    severity
  }
}
```

```json
{
  "deploymentId": "<deploymentId>",
  "limit": 1000,
  "filter": "error"
}
```

- `filter` 支持简单的文本过滤。
- 日志按时间倒序返回。

### 4.2 查询 HTTP 请求日志 `httpLogs`

可使用**项目级 Project Token** 调用。仅适用于有公开网络访问的服务。

```graphql
query($deploymentId: String!, $limit: Int, $filter: String) {
  httpLogs(deploymentId: $deploymentId, limit: $limit, filter: $filter) {
    timestamp
    method
    path
    httpStatus
    totalDuration
    srcIp
    edgeRegion
  }
}
```

```json
{
  "deploymentId": "<deploymentId>",
  "limit": 500,
  "filter": "status:500"
}
```

- `filter` 支持 `status:<code>`、`method:<METHOD>` 等结构化过滤。

### 4.3 实时日志流

GraphQL 不直接支持实时日志流。如需实时日志，建议通过 `deploymentLogs` 或 `httpLogs` 进行高频轮询（例如每 2-5 秒），并使用 `startDate` / `endDate` 或 `afterDate` / `beforeDate` 参数来获取增量日志，模拟实时效果。

```graphql
query($deploymentId: String!, $afterDate: String) {
  deploymentLogs(deploymentId: $deploymentId, afterDate: $afterDate) {
    timestamp
    message
  }
}
```

在每次轮询中，将最后一条日志的 `timestamp` 保存下来，作为下一次请求的 `afterDate` 参数值。

---
## 第五章：域名管理

### 5.1 创建 Railway 子域名 `serviceDomainCreate`

```graphql
mutation($input: ServiceDomainCreateInput!) {
  serviceDomainCreate(input: $input) {
    id
    domain
    serviceId
  }
}
```

```json
{
  "input": {
    "serviceId": "<serviceId>",
    "environmentId": "<environmentId>",
    "targetPort": 3000
  }
}
```

Railway 会自动分配 `*.up.railway.app` 格式的子域名。`targetPort` 为服务容器内监听的端口。

### 5.2 绑定自定义域名 `customDomainCreate`

```graphql
mutation($input: CustomDomainCreateInput!) {
  customDomainCreate(input: $input) {
    id
    domain
    cnameTarget
    status {
      dnsRecords {
        type
        name
        value
      }
    }
  }
}
```

```json
{
  "input": {
    "domain": "app.customer-a.com",
    "projectId": "<projectId>",
    "serviceId": "<serviceId>",
    "environmentId": "<environmentId>",
    "targetPort": 3000
  }
}
```

创建后，返回的 `cnameTarget` 即为客户需要在其 DNS 服务商处配置的 CNAME 目标值。

### 5.3 查询域名列表 `domains`

```graphql
query($projectId: String!, $serviceId: String!, $environmentId: String!) {
  domains(projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId) {
    serviceDomains {
      id
      domain
    }
    customDomains {
      id
      domain
      status {
        dnsRecords {
          type
          name
          value
        }
      }
    }
  }
}
```

### 5.4 删除域名

```graphql
# 删除 Railway 子域名
mutation { serviceDomainDelete(id: "<serviceDomainId>") }

# 删除自定义域名
mutation { customDomainDelete(id: "<customDomainId>") }
```

---

## 第六章：API 快速参考

### 6.1 Token 权限对照表

| 操作 | User Token | Project Token |
| :--- | :---: | :---: |
| 创建/删除项目 | ✅ | ❌ |
| 创建/删除 Project Token | ✅ | ❌ |
| 创建/删除服务 | ✅ | ❌ |
| 触发部署 | ✅ | ✅ |
| 查询部署列表 | ✅ | ✅ |
| 查询部署日志 | ✅ | ✅ |
| 查询 HTTP 日志 | ✅ | ✅ |
| 查询监控指标 | ✅ | ✅ |
| 管理环境变量 | ✅ | ✅ |
| 创建/删除域名 | ✅ | ❌ |

### 6.2 全部 API 速查表

| 功能 | 类型 | Mutation / Query |
| :--- | :--- | :--- |
| 创建项目 | mutation | `projectCreate(input)` |
| 查询项目 | query | `project(id)` |
| 更新项目 | mutation | `projectUpdate(id, input)` |
| 删除项目 | mutation | `projectDelete(id)` |
| 查询所有项目 | query | `projects(workspaceId)` |
| 创建项目级 Token | mutation | `projectTokenCreate(input)` |
| 查询项目级 Token 列表 | query | `projectTokens(projectId)` |
| 吊销项目级 Token | mutation | `projectTokenDelete(id)` |
| 查询当前 Token 信息 | query | `projectToken()` |
| 创建环境 | mutation | `environmentCreate(input)` |
| 查询环境 | query | `environment(id, projectId)` |
| 删除环境 | mutation | `environmentDelete(id)` |
| 查询部署列表 | query | `deployments(input, first)` |
| 取消部署 | mutation | `deploymentCancel(id)` |
| 重新部署 | mutation | `deploymentRedeploy(id)` |
| 回滚部署 | mutation | `deploymentRollback(id)` |
| 停止部署 | mutation | `deploymentStop(id)` |
| 删除部署记录 | mutation | `deploymentRemove(id)` |
| 查询部署日志 | query | `deploymentLogs(deploymentId, limit, filter)` |
| 查询 HTTP 日志 | query | `httpLogs(deploymentId, limit, filter)` |
| 查询监控指标 | query | `metrics(projectId, measurements, startDate, endDate)` |
| 查询项目事件 | query | `events(projectId, first)` |
| 创建 Railway 子域名 | mutation | `serviceDomainCreate(input)` |
| 删除 Railway 子域名 | mutation | `serviceDomainDelete(id)` |
| 创建自定义域名 | mutation | `customDomainCreate(input)` |
| 删除自定义域名 | mutation | `customDomainDelete(id)` |
| 查询域名列表 | query | `domains(projectId, serviceId, environmentId)` |
