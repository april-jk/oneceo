# Module 05 — Volume 持久化存储

**认证:** 所有操作使用 `User Token`，Header: `Authorization: Bearer <USER_TOKEN>`
**API Endpoint:** `https://backboard.railway.app/graphql/v2`

---

## 概述

Volume 是挂载到服务容器内指定路径的持久化块存储。服务重启或重新部署后，挂载路径中的数据不会丢失。一个 Volume 可以在不同时间点挂载到不同服务，但同一时刻只能挂载到一个服务实例。系统需持久化 `volumeId` 和 `volumeInstanceId`。

---

## 创建流程

### Step 1 — 创建 Volume `volumeCreate`

```graphql
mutation($input: VolumeCreateInput!) {
  volumeCreate(input: $input) {
    id
    name
    volumeInstances {
      edges {
        node {
          id
          environmentId
          mountPath
          serviceId
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
    "mountPath": "/data",
    "serviceId": "<serviceId>",
    "environmentId": "<environmentId>",
    "region": "us-west1"
  }
}
```

| 参数 | 类型 | 说明 |
| :--- | :--- | :--- |
| `mountPath` | `String!` | 容器内的挂载路径，如 `/data`、`/var/lib/postgresql/data` |
| `serviceId` | `String` | 关联的服务 ID；不填则创建未挂载的游离 Volume |
| `environmentId` | `String` | 目标环境；不填则在所有非 fork 环境中创建 |
| `region` | `String` | 存储区域，应与关联服务的部署区域一致 |

| 返回字段 | 说明 |
| :--- | :--- |
| `id` | **需持久化**，即 `volumeId` |
| `volumeInstances.node.id` | **需持久化**，即 `volumeInstanceId`，用于更新和备份操作 |

---

### Step 2 — 更新挂载配置 `volumeInstanceUpdate`

用于修改挂载路径、切换关联服务或暂停/恢复 Volume。

```graphql
mutation($volumeId: String!, $environmentId: String, $input: VolumeInstanceUpdateInput!) {
  volumeInstanceUpdate(volumeId: $volumeId, environmentId: $environmentId, input: $input)
}
```

```json
{
  "volumeId": "<volumeId>",
  "environmentId": "<environmentId>",
  "input": {
    "mountPath": "/data",
    "serviceId": "<new-serviceId>",
    "state": "ACTIVE"
  }
}
```

`state` 枚举值：`ACTIVE`（正常挂载）、`REMOVED`（从服务卸载但保留数据）。

---

### Step 3 — 创建备份 `volumeInstanceBackupCreate`

```graphql
mutation($volumeInstanceId: String!, $name: String) {
  volumeInstanceBackupCreate(volumeInstanceId: $volumeInstanceId, name: $name) {
    id
    createdAt
  }
}
```

```json
{
  "volumeInstanceId": "<volumeInstanceId>",
  "name": "backup-before-migration"
}
```

---

## 销毁流程

删除 Volume 会永久销毁其中的所有数据，操作不可逆。

### 删除 Volume `volumeDelete`

```graphql
mutation($volumeId: String!) {
  volumeDelete(volumeId: $volumeId)
}
```

```json
{ "volumeId": "<volumeId>" }
```

---

## 持久化字段汇总

| 字段 | 来源 | 用途 |
| :--- | :--- | :--- |
| `volumeId` | `volumeCreate` | Volume 的核心 ID，用于删除和更新 |
| `volumeInstanceId` | `volumeCreate.volumeInstances` | 用于备份、恢复和状态管理 |
