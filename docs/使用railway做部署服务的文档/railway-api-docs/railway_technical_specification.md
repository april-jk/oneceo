# Railway API 技术规范：多租户仓库生命周期管理

**版本:** 2.0
**目标受众:** 平台后端系统开发者
**摘要:** 本文档为内部技术规范，定义了通过 Railway GraphQL API 对租户（用户）的仓库（在 Railway 中映射为 Project）进行全生命周期管理的标准化流程。所有操作均从系统后台视角出发。

---

## 目录

1.  [**认证模型**](#auth-model)
2.  [**第一节：租户资源供给 (Provisioning)**](#provisioning)
    *   1.1. 创建租户项目 (Project)
    *   1.2. 创建项目服务 (Service)
    *   1.3. 生成项目级访问凭证 (Project Token)
3.  [**第二节：租户资源管理 (Management)**](#management)
    *   2.1. 查询租户项目与服务
    *   2.2. 为现有项目添加新服务
4.  [**第三节：租户资源回收 (Deprovisioning)**](#deprovisioning)
    *   3.1. 吊销项目级访问凭证
    *   3.2. 删除租户项目
5.  [**第四节：核心 API 对象参考**](#api-reference)

---

<a id="auth-model"></a>
## 认证模型

系统与 Railway API 的交互采用双重 Token 认证模型：

-   **Admin-Level Operations**: 使用全局唯一的 **`User Token`**。此 Token 拥有账户完全权限，用于执行租户隔离边界之外的管理操作，包括项目的创建与销毁。此 Token 必须作为高优先级机密进行存储。
-   **Tenant-Level Operations**: 使用租户专属的 **`Project Token`**。此 Token 权限被严格限制在单个项目和环境中，用于执行所有租户内部的资源操作，如部署、变量管理等。此 Token 由系统动态生成并分发给相应的业务逻辑模块。

**API Endpoint:** `https://backboard.railway.app/graphql/v2`
**HTTP Header:** `Authorization: Bearer <TOKEN>`

---

<a id="provisioning"></a>
## 第一节：租户资源供给 (Provisioning)

此流程在系统后台为新租户创建一套完整的、隔离的云资源。所有操作均使用 **`User Token`** 认证。

### 1.1. 创建租户项目 (Project)

为租户创建一个独立的 `Project` 作为所有资源的容器。

-   **Mutation:** `projectCreate`
-   **Input:** `ProjectCreateInput`
-   **核心字段:**
    -   `name`: `String` - 租户的唯一标识符 (e.g., `tenant-uuid-12345`).
    -   `workspaceId`: `String` - 系统所属的 Railway 工作区 ID。

**GraphQL:**
```graphql
mutation($input: ProjectCreateInput!) {
  projectCreate(input: $input) {
    id
    name
  }
}
```
**Variables:**
```json
{
  "input": {
    "name": "tenant-uuid-12345",
    "workspaceId": "<your-workspace-id>"
  }
}
```
**输出:** 持久化返回的 `id` (`projectId`) 作为租户资源的核心索引。

### 1.2. 创建项目服务 (Service)

在项目中创建一个或多个服务，用于运行租户的应用代码或数据库。

-   **Mutation:** `serviceCreate`
-   **Input:** `ServiceCreateInput`
-   **核心字段:**
    -   `name`: `String` - 服务的逻辑名称 (e.g., `app-server`, `postgres-db`).
    -   `projectId`: `String!` - 上一步获取的 `projectId`。
    -   `source`: `ServiceSourceInput` - 定义服务来源，可以是 Git 仓库 (`repo`) 或 Docker 镜像 (`image`)。

**GraphQL (From Git Repo):**
```graphql
mutation($input: ServiceCreateInput!) {
  serviceCreate(input: $input) {
    id
    name
  }
}
```
**Variables:**
```json
{
  "input": {
    "name": "app-server",
    "projectId": "<tenant-project-id>",
    "source": {
      "repo": "<user-github-username>/<user-repo-name>"
    }
  }
}
```
**输出:** 持久化返回的 `id` (`serviceId`)，用于后续的服务专属操作。

### 1.3. 生成项目级访问凭证 (Project Token)

为项目生成一个权限受限的 API Token，用于后续所有租户级别的操作。

-   **Mutation:** `projectTokenCreate`
-   **Input:** `ProjectTokenCreateInput`
-   **核心字段:**
    -   `name`: `String!` - Token 的描述性名称 (e.g., `token-tenant-12345`).
    -   `projectId`: `String!` - 租户的 `projectId`。
    -   `environmentId`: `String!` - 目标环境 ID。需先查询项目获取。

**流程:**
1.  **查询 Environment ID:**
    ```graphql
    query($projectId: String!) {
      project(id: $projectId) {
        environments(first: 1) { # 通常取第一个，即默认环境
          edges { node { id name } }
        }
      }
    }
    ```
2.  **创建 Project Token:**
    ```graphql
    mutation($input: ProjectTokenCreateInput!) {
      projectTokenCreate(input: $input) {
        id      # Token ID, for deletion
        token   # The actual token value
      }
    }
    ```
    **Variables:**
    ```json
    {
      "input": {
        "name": "token-tenant-12345",
        "projectId": "<tenant-project-id>",
        "environmentId": "<retrieved-environment-id>"
      }
    }
    ```
**输出:** 安全地存储返回的 `id` (`projectTokenId`) 和 `token` (`projectTokenValue`)。`token` 必须加密存储。

---

<a id="management"></a>
## 第二节：租户资源管理 (Management)

此流程用于查询和修改已存在的租户资源。所有操作均使用 **`User Token`** 认证。

### 2.1. 查询租户项目与服务

通过已知的 ID 或其他属性查询项目和服务的详细信息。

-   **Query:** `project` / `service`

**GraphQL (Query Project with Services):**
```graphql
query($projectId: String!) {
  project(id: $projectId) {
    id
    name
    description
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
```

### 2.2. 为现有项目添加新服务

此操作与 `1.2. 创建项目服务` 完全相同，只需传入已存在的 `projectId` 即可。

-   **Mutation:** `serviceCreate`
-   **认证:** `User Token`

---

<a id="deprovisioning"></a>
## 第三节：租户资源回收 (Deprovisioning)

此流程在租户生命周期结束时，安全、彻底地移除其所有云资源。所有操作均使用 **`User Token`** 认证。

### 3.1. 吊销项目级访问凭证

在删除任何资源前，首先吊销其 `Project Token`，立即切断所有租户级 API 访问。

-   **Mutation:** `projectTokenDelete`
-   **核心字段:**
    -   `id`: `String!` - 在 `1.3` 中获取并存储的 `projectTokenId`。

**GraphQL:**
```graphql
mutation($id: String!) {
  projectTokenDelete(id: $id)
}
```
**Variables:**
```json
{
  "id": "<tenant-project-token-id>"
}
```

### 3.2. 删除租户项目

吊销访问权限后，安全地删除整个项目，这将级联删除所有内部服务、部署、环境变量等。

-   **Mutation:** `projectDelete`
-   **核心字段:**
    -   `id`: `String!` - 租户的 `projectId`。

**GraphQL:**
```graphql
mutation($id: String!) {
  projectDelete(id: $id)
}
```
**Variables:**
```json
{
  "id": "<tenant-project-id>"
}
```
**后续操作:** 在系统数据库中清理与此租户相关的所有 Railway 资源 ID。

---

<a id="api-reference"></a>
## 第四节：核心 API 对象参考

本节提供在上述生命周期管理中涉及的核心 Railway API 对象的字段参考。

### Project

代表一个租户的资源容器。

| 字段名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `id` | `ID!` | 项目的唯一标识符。 |
| `name` | `String!` | 项目名称。 |
| `description` | `String` | 项目描述。 |
| `environments` | `Connection` | 项目下的环境列表。 |
| `services` | `Connection` | 项目下的服务列表。 |
| `createdAt` | `DateTime!` | 创建时间。 |

### Service

在项目中运行的单个应用或数据库。

| 字段名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `id` | `ID!` | 服务的唯一标识符。 |
| `name` | `String!` | 服务名称。 |
| `projectId` | `String!` | 所属项目的 ID。 |
| `repoTriggers` | `Connection` | 关联的 Git 仓库触发器。 |

### Environment

项目内的一个独立环境，如 `production` 或 `staging`。

| 字段名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `id` | `ID!` | 环境的唯一标识符。 |
| `name` | `String!` | 环境名称。 |
| `projectId` | `String!` | 所属项目的 ID。 |
| `deployments` | `Connection` | 此环境下的部署历史。 |
| `serviceInstances` | `Connection` | 此环境下所有服务的实例配置。 |

### ProjectToken

项目级的访问凭证。

| 字段名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `id` | `ID!` | Token 本身的唯一标识符，用于删除。 |
| `token` | `String!` | **(仅在创建时返回)** 实际的 API 令牌字符串。 |
| `displayToken` | `String!` | 经过部分屏蔽处理的令牌字符串，用于显示。 |
| `name` | `String!` | Token 的名称。 |
| `projectId` | `String!` | 关联的项目 ID。 |
| `environmentId` | `String!` | 关联的环境 ID。 |
| `createdAt` | `DateTime!` | 创建时间。 |
