# Module 07 — Bucket 对象存储

**认证:** 所有操作使用 `User Token`，Header: `Authorization: Bearer <USER_TOKEN>`
**API Endpoint:** `https://backboard.railway.app/graphql/v2`

---

## 概述

Bucket 是 Railway 提供的 S3 兼容对象存储服务。创建后系统会生成访问凭证（`accessKeyId`、`secretAccessKey`、`endpoint`），可通过标准 S3 SDK 进行文件读写。系统需持久化 `bucketId` 和访问凭证。

> **注意:** `BucketCreateInput` 中的 `environmentId` 字段当前状态为 `[unimplemented]`，传入该字段不会生效，Bucket 将在项目所有环境中可用。

---

## 创建流程

### Step 1 — 创建 Bucket `bucketCreate`

```graphql
mutation($input: BucketCreateInput!) {
  bucketCreate(input: $input) {
    id
    name
    region
    accessKeyId
    secretAccessKey
    endpoint
    publicUrl
  }
}
```

```json
{
  "input": {
    "projectId": "<projectId>",
    "name": "user-uploads"
  }
}
```

| 参数 | 类型 | 说明 |
| :--- | :--- | :--- |
| `projectId` | `String!` | 所属项目 ID |
| `name` | `String` | Bucket 名称，不填则自动生成 |

| 返回字段 | 说明 |
| :--- | :--- |
| `id` | **需持久化**，即 `bucketId`，用于删除操作 |
| `accessKeyId` | **需加密持久化**，S3 访问密钥 ID |
| `secretAccessKey` | **需加密持久化**，S3 访问密钥，仅在创建时返回 |
| `endpoint` | S3 兼容端点 URL |
| `publicUrl` | 公开访问的基础 URL |

---

### Step 2 — 将访问凭证注入到应用服务

创建 Bucket 后，将凭证通过 `variableCollectionUpsert` 注入到需要访问存储的服务。

```graphql
mutation($input: VariableCollectionUpsertInput!) {
  variableCollectionUpsert(input: $input)
}
```

```json
{
  "input": {
    "projectId": "<projectId>",
    "environmentId": "<environmentId>",
    "serviceId": "<app-serviceId>",
    "variables": {
      "S3_ACCESS_KEY_ID": "<accessKeyId>",
      "S3_SECRET_ACCESS_KEY": "<secretAccessKey>",
      "S3_ENDPOINT": "<endpoint>",
      "S3_BUCKET_NAME": "user-uploads"
    }
  }
}
```

---

### Step 3 — 查询 Bucket 信息

若需重新获取 Bucket 的访问凭证或状态，通过项目查询。

```graphql
query($projectId: String!) {
  project(id: $projectId) {
    buckets {
      edges {
        node {
          id
          name
          endpoint
          accessKeyId
          publicUrl
        }
      }
    }
  }
}
```

注意：`secretAccessKey` 仅在创建时返回，后续查询不会再次返回，需在创建时妥善存储。

---

## 销毁流程

```graphql
mutation($id: String!) {
  bucketDelete(id: $id)
}
```

```json
{ "id": "<bucketId>" }
```

删除 Bucket 会永久销毁其中的所有文件，操作不可逆。

---

## 持久化字段汇总

| 字段 | 来源 | 用途 |
| :--- | :--- | :--- |
| `bucketId` | `bucketCreate` | 用于删除操作 |
| `accessKeyId` | `bucketCreate` | S3 访问凭证 |
| `secretAccessKey` | `bucketCreate`（仅一次） | S3 访问凭证，必须加密存储 |
| `endpoint` | `bucketCreate` | S3 兼容端点 |
