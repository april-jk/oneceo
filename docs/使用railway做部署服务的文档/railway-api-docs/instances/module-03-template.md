# Module 03 — Template 服务

**认证:** 所有操作使用 `User Token`，Header: `Authorization: Bearer <USER_TOKEN>`
**API Endpoint:** `https://backboard.railway.app/graphql/v2`

---

## 概述

通过 Railway 官方或社区模板一键部署多服务组合（如 WordPress + MySQL、Strapi + PostgreSQL 等）。模板部署会在项目中自动创建多个服务，系统需持久化 `templateId` 和所有生成的 `serviceId`。

---

## 创建流程

### Step 1 — 查询可用模板 `templates`

通过关键词搜索模板，获取 `templateId` 和 `serializedConfig`。

```graphql
query($searchTerm: String) {
  templates(searchTerm: $searchTerm) {
    edges {
      node {
        id
        name
        description
        serializedConfig
        services {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    }
  }
}
```

```json
{ "searchTerm": "wordpress" }
```

| 返回字段 | 说明 |
| :--- | :--- |
| `id` | **需持久化**，即 `templateId` |
| `serializedConfig` | 模板的完整配置对象，部署时原样传入 |

---

### Step 2 — 部署模板 `templateDeployV2`

将 Step 1 中获取的 `templateId` 和 `serializedConfig` 传入部署。

```graphql
mutation($input: TemplateDeployV2Input!) {
  templateDeployV2(input: $input) {
    projectId
    workspaceId
  }
}
```

```json
{
  "input": {
    "templateId": "<templateId>",
    "projectId": "<projectId>",
    "environmentId": "<environmentId>",
    "serializedConfig": "<serializedConfig-from-step1>"
  }
}
```

`serializedConfig` 是从 Step 1 查询中直接获取的 JSON 对象，无需手动构造，直接透传即可。

---

### Step 3 — 查询模板生成的服务列表

部署完成后，查询项目中的服务列表，获取所有由模板生成的 `serviceId`。

```graphql
query($projectId: String!) {
  project(id: $projectId) {
    services {
      edges {
        node {
          id
          name
          templateServiceId
        }
      }
    }
  }
}
```

```json
{ "projectId": "<projectId>" }
```

将返回的所有 `serviceId` 与对应服务名称一起持久化。

---

## 销毁流程

模板部署生成的每个服务需单独删除。遍历持久化的 `serviceId` 列表，逐一调用 `serviceDelete`。

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
| `templateId` | `templates` query | 标识使用的模板 |
| `serviceId[]` | `project.services` query | 管理模板生成的每个服务 |
