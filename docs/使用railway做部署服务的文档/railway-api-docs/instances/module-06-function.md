# Module 06 — Function 定时任务服务

**认证:** 所有操作使用 `User Token`，Header: `Authorization: Bearer <USER_TOKEN>`
**API Endpoint:** `https://backboard.railway.app/graphql/v2`

---

## 概述

Function 类型用于创建按 Cron 表达式定时执行的任务服务，不持续运行，任务完成后容器退出。实现方式是创建一个服务并通过 `serviceInstanceUpdate` 配置 `cronSchedule`。系统需持久化 `serviceId`。

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
    "name": "daily-report-job",
    "projectId": "<projectId>"
  }
}
```

此时不传 `source`，后续通过 `serviceConnect` 关联代码源。

| 返回字段 | 说明 |
| :--- | :--- |
| `id` | **需持久化**，即 `serviceId` |

---

### Step 2 — 关联代码源 `serviceConnect`

将服务连接到 GitHub 仓库或 Docker 镜像。

```graphql
mutation($id: String!, $input: ServiceConnectInput!) {
  serviceConnect(id: $id, input: $input) {
    id
  }
}
```

**连接 GitHub 仓库：**

```json
{
  "id": "<serviceId>",
  "input": {
    "repo": "<github-username>/<repo-name>",
    "branch": "main"
  }
}
```

**连接 Docker 镜像：**

```json
{
  "id": "<serviceId>",
  "input": {
    "image": "python:3.12-slim"
  }
}
```

---

### Step 3 — 配置 Cron 调度与执行命令 `serviceInstanceUpdate`

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
    "cronSchedule": "0 2 * * *",
    "startCommand": "python scripts/daily_report.py",
    "restartPolicyType": "NEVER"
  }
}
```

`cronSchedule` 使用标准 5 字段 Cron 表达式（分 时 日 月 周）。`restartPolicyType` 建议设为 `NEVER`，避免任务完成后被误判为崩溃而重启。

常用 Cron 表达式示例：

| 表达式 | 含义 |
| :--- | :--- |
| `0 2 * * *` | 每天凌晨 2:00 |
| `*/15 * * * *` | 每 15 分钟 |
| `0 9 * * 1` | 每周一上午 9:00 |
| `0 0 1 * *` | 每月 1 日零点 |

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

---

## 销毁流程

```graphql
mutation($id: String!) {
  serviceDelete(id: $id, environmentId: null)
}
```

```json
{ "id": "<serviceId>" }
```

---

## 持久化字段汇总

| 字段 | 来源 | 用途 |
| :--- | :--- | :--- |
| `serviceId` | `serviceCreate` | 定时任务服务的核心 ID |
