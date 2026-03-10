# Railway API 集成指南：构建多租户部署平台

**版本:** 1.0
**作者:** Manus AI
**日期:** 2026年3月5日

---

## 摘要

本指南旨在为开发者提供一个完整、可执行的方案，以利用 Railway 的 GraphQL API 构建一个安全、可靠的多租户托管部署平台。我们将遵循“一个客户一个项目”的最佳实践，实现客户间的强隔离，并通过编程方式管理项目和 API 密钥的完整生命周期。

本文档结构清晰，分段加载友好，旨在为 AI Agent 和人类开发者提供清晰的调用逻辑和代码示例。

## 目录

1.  [**第一章：认证与授权**](#chapter-1)
    *   1.1. 核心认证机制：User Token vs. Project Token
    *   1.2. 准备工作：获取您的主 `User Token`

2.  [**第二章：多租户架构设计**](#chapter-2)
    *   2.1. 隔离模型：一个客户，一个项目
    *   2.2. 架构图

3.  [**第三章：核心工作流：客户引导 (Onboarding)**](#chapter-3)
    *   3.1. 步骤一：为新客户创建项目 (Project)
    *   3.2. 步骤二：在项目中创建服务 (Service)
    *   3.3. 步骤三：生成项目级 API 密钥 (Project Token)
    *   3.4. 步骤四：存储与管理客户凭证

4.  [**第四章：核心工作流：应用部署与管理**](#chapter-4)
    *   4.1. 认证方式：使用客户的 Project Token
    *   4.2. 步骤一：配置环境变量
    *   4.3. 步骤二：触发部署
    *   4.4. 步骤三：监控部署状态
    *   4.5. 步骤四：管理部署（重新部署、回滚、查看日志）

5.  [**第五章：核心工作流：客户退订 (Offboarding)**](#chapter-5)
    *   5.1. 步骤一：吊销项目级 API 密钥
    *   5.2. 步骤二：删除客户项目

6.  [**第六章：附录：GraphQL API 片段与示例**](#chapter-6)
    *   6.1. 通用 GraphQL 客户端（Python 示例）
    *   6.2. 关键 Mutation 与 Query 汇总

---

<a id="chapter-1"></a>
## 第一章：认证与授权

在与 Railway API 交互之前，必须首先理解其认证模型。正确的认证是保障整个多租户平台安全性的基石。

### 1.1. 核心认证机制：User Token vs. Project Token

Railway API 提供两种核心的 Token 类型，它们的权限范围截然不同，适用于不同的场景：

| Token 类型 | 权限范围 | 适用场景 | 安全性 |
| :--- | :--- | :--- | :--- |
| **User Token** | **账户级** | 拥有您 Railway 账户的完全访问权限，可以创建/删除项目、管理工作区、生成其他 Token 等。 | **极高，需妥善保管** |
| **Project Token** | **项目级** | 权限被严格限制在单个项目 (Project) 和单个环境 (Environment) 内。无法访问其他项目或执行账户级操作。 | **受控，可编程分发** |

在我们的多租户架构中，这两种 Token 的职责划分非常清晰：

-   **您的平台后端** 将使用一个**全局的、唯一的 `User Token`** 来执行管理操作，例如为新客户创建项目、为项目生成专属的 `Project Token`。
-   **您的平台后端在代表特定客户执行部署、管理环境变量等操作时**，必须使用该客户对应的 **`Project Token`**。这确保了操作的权限被最小化，实现了客户间的安全隔离。

### 1.2. 准备工作：获取您的主 `User Token`

这个 `User Token` 是您平台的“万能钥匙”，必须作为最高级别的机密信息存储在安全的地方（例如，使用云服务商的 Secret Manager 或 HashiCorp Vault）。

**获取步骤：**

1.  登录您的 [Railway 账户](https://railway.app/)。
2.  导航至 [Tokens 页面](https://railway.app/account/tokens)。
3.  点击 “Create Token” 或 “New Token” 按钮。
4.  为该 Token 提供一个描述性的名称，例如 `Multi-Tenant_Platform_Admin_Token`。
5.  复制生成的 Token。**请注意，这个 Token 只会显示一次，请立即将其安全保存。**

在您的平台后端应用中，将此 Token 设置为一个环境变量，例如 `RAILWAY_ADMIN_TOKEN`。所有发起 GraphQL 请求的客户端都需要在 HTTP Header 中携带此 Token。

**认证 Header 示例：**

```
Authorization: Bearer <YOUR_RAILWAY_ADMIN_TOKEN>
```

---

<a id="chapter-2"></a>
## 第二章：多租户架构设计

我们采用“一个客户，一个项目”的模式作为多租户隔离的核心思想。这种模式在资源独立性、安全性、成本归属和可扩展性之间取得了最佳平衡。

### 2.1. 隔离模型：一个客户，一个项目 (Project)

- **资源隔离**: 每个 Railway 项目都是一个独立的单元，拥有自己的服务、数据库、环境变量和部署历史。这天然地防止了不同客户的应用互相干扰。
- **安全隔离**: 如前所述，通过为每个项目生成专属的 `Project Token`，我们将 API 访问权限严格限制在项目内部。即使某个客户的 Token 泄露，攻击者也无法访问到任何其他客户的项目数据。
- **成本归属**: Railway 的计费是基于项目资源的。将每个客户映射到一个独立项目，使得您可以清晰地追踪和分摊每个客户的实际资源消耗，为您的计费系统提供精确的数据支持。
- **灵活扩展**: 您可以根据客户的需求，独立地调整其项目内服务的规格（CPU、内存），而不会影响到平台的其他租户。

### 2.2. 架构图

下图清晰地展示了这种多租户架构模型：


![多租户架构图](architecture.png)

---

<a id="chapter-3"></a>
## 第三章：核心工作流：客户引导 (Onboarding)

当一个新客户注册您的平台时，您的后端服务需要执行一系列自动化操作，为该客户在 Railway 上建立一个完全隔离的托管环境。这个过程我们称之为“客户引导” (Onboarding)。

**前提：** 以下所有 API 调用都必须使用您在[第一章](#chapter-1)中获取的**主 `User Token`** 进行认证。

### 3.1. 步骤一：为新客户创建项目 (Project)

第一步是为客户创建一个新的 Railway 项目。这个项目将作为该客户所有云资源的容器。

- **Mutation:** `projectCreate`
- **核心参数:**
    - `name`: 项目名称。建议使用对您有意义的标识，例如 `customer-<customer-id>`。
    - `workspaceId`: 您的 Railway 工作区 ID。您可以通过查询 `me` 端点来获取。
    - `description`: 项目的描述，可以包含客户信息。

**GraphQL 请求示例:**

```graphql
mutation CreateProjectForCustomer($name: String!, $workspaceId: String!) {
  projectCreate(input: {
    name: $name,
    workspaceId: $workspaceId,
    description: "Project for customer XYZ"
  }) {
    id
    name
    createdAt
  }
}
```

**调用逻辑:**

1.  在您的代码中，构造此 GraphQL mutation。
2.  将变量 `$name` 设置为客户的唯一标识，例如 `customer-12345`。
3.  执行请求，您将获得新创建项目的 `id`。**这个 `projectId` 是后续所有操作的关键，必须将其与客户信息一起存储在您的数据库中。**

### 3.2. 步骤二：在项目中创建服务 (Service)

项目创建后，您需要在其中创建一个或多个服务。服务是实际运行您客户代码的单元，可以是一个 Web Server、一个后台 Worker 或者一个数据库。

- **Mutation:** `serviceCreate`
- **核心参数:**
    - `name`: 服务名称，例如 `web-app` 或 `database`。
    - `projectId`: 上一步中获取的 `projectId`。
    - `source`: 定义服务的来源。最常见的两种方式是关联一个 Git 仓库或一个 Docker 镜像。

**GraphQL 请求示例 (从 GitHub 仓库创建):**

```graphql
mutation CreateServiceFromRepo($projectId: String!, $repoUrl: String!) {
  serviceCreate(input: {
    name: "web-app",
    projectId: $projectId,
    source: {
      repo: $repoUrl
    }
  }) {
    id
    name
  }
}
```

**调用逻辑:**

1.  使用上一步获得的 `projectId`。
2.  根据客户提供的代码仓库 URL (例如 `github:username/my-cool-app`) 设置 `$repoUrl`。
3.  执行请求，获取新服务的 `id`。**这个 `serviceId` 在后续管理特定服务（如部署、配置变量）时会用到。**

### 3.3. 步骤三：生成项目级 API 密钥 (Project Token)

这是实现安全隔离最关键的一步。为刚刚创建的项目生成一个专属的、权限受限的 API Token。

- **Mutation:** `projectTokenCreate`
- **核心参数:**
    - `projectId`: 客户的 `projectId`。
    - `environmentId`: 您希望此 Token 有权访问的环境 ID。通常是默认创建的 `production` 环境。您可以通过查询项目的 `environments` 来获取。
    - `name`: Token 的名称，例如 `token-for-customer-12345`。

**GraphQL 请求示例:**

```graphql
mutation CreateProjectToken($projectId: String!, $environmentId: String!) {
  projectTokenCreate(input: {
    name: "token-for-customer-12345",
    projectId: $projectId,
    environmentId: $environmentId
  }) {
    token
  }
}
```

**调用逻辑:**

1.  首先，您需要查询项目以获取其默认环境的 `environmentId`。
2.  然后，调用 `projectTokenCreate` mutation。
3.  **返回的 `token` 字段就是客户专属的 API 密钥。这个密钥同样只会显示一次，必须立即进行安全存储。**

### 3.4. 步骤四：存储与管理客户凭证

在完成以上步骤后，您的数据库中应该为每个客户存储了以下关键信息：

-   `customerId` (您系统中的客户 ID)
-   `railwayProjectId`
-   `railwayServiceId` (如果适用)
-   `railwayEnvironmentId`
-   `encryptedRailwayProjectToken` (**必须加密存储**)

强烈建议使用专业的密钥管理服务（如 AWS KMS, Google Cloud KMS, HashiCorp Vault）来加密和管理 `Project Token`，而不是明文存储在数据库中。

---

<a id="chapter-4"></a>
## 第四章：核心工作流：应用部署与管理

客户引导完成后，您的平台需要能够代表客户管理其应用的整个生命周期，核心就是部署、配置和监控。本章将详细介绍如何使用客户专属的 `Project Token` 来完成这些操作。

### 4.1. 认证方式：使用客户的 Project Token

**这是一个至关重要的安全实践转变。** 从本章开始，所有与特定客户项目相关的 API 请求，都**必须**使用您在[第三章](#chapter-3)中为该客户生成的、并已安全存储的 **`Project Token`** 进行认证。不再使用全局的 `User Token`。

您的 GraphQL 客户端在执行操作前，需要从您的凭证存储中动态加载对应客户的 `Project Token`，并设置到 `Authorization` Header 中。

**认证 Header 示例 (客户操作):**

```
Authorization: Bearer <CUSTOMER_SPECIFIC_PROJECT_TOKEN>
```

### 4.2. 步骤一：配置环境变量

在部署应用之前，通常需要为其配置必要的环境变量，如数据库连接字符串、第三方 API 密钥等。

- **Mutation:** `variableCollectionUpsert`
- **描述:** 此 mutation 功能强大，可以一次性创建、更新或删除多个环境变量。通过设置 `replace: true`，您可以确保环境中的变量与您提供的一致，删除所有未包含在请求中的变量。
- **核心参数:**
    - `projectId`: 客户的 `projectId`。
    - `environmentId`: 客户的 `environmentId`。
    - `serviceId`: 您要配置变量的 `serviceId`。
    - `variables`: 一个包含键值对的对象，代表您要设置的环境变量。

**GraphQL 请求示例:**

```graphql
mutation UpsertVariablesForService($projectId: String!, $environmentId: String!, $serviceId: String!) {
  variableCollectionUpsert(input: {
    projectId: $projectId,
    environmentId: $environmentId,
    serviceId: $serviceId,
    variables: {
      "NODE_ENV": "production",
      "DATABASE_URL": "your-customer-specific-db-url",
      "API_SECRET": "some-secret-value"
    }
  })
}
```

### 4.3. 步骤二：触发部署

配置好变量后，就可以触发新的部署了。Railway 会根据您在创建服务时连接的源码（Git 仓库或 Docker 镜像）拉取最新代码并开始构建。

- **Mutation:** `serviceInstanceDeployV2`
- **描述:** 这是一个直接、简单的触发特定服务部署的方式。
- **核心参数:**
    - `serviceId`: 您要部署的 `serviceId`。
    - `environmentId`: 客户的 `environmentId`。

**GraphQL 请求示例:**

```graphql
mutation DeployService($serviceId: String!, $environmentId: String!) {
  serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
}
```

**调用逻辑:**

1.  执行此 mutation 后，API 会立即返回一个 `deploymentId`。
2.  这个 `deploymentId` 是新部署的唯一标识，您需要用它来追踪部署的后续状态。

### 4.4. 步骤三：监控部署状态

部署是一个异步过程。您需要通过轮询 `deployment` 查询来获取部署的实时状态，以便向您的客户展示进度（例如：构建中、部署中、成功、失败）。

- **Query:** `deployment`
- **核心参数:**
    - `id`: 上一步中获取的 `deploymentId`。

**GraphQL 请求示例:**

```graphql
query GetDeploymentStatus($deploymentId: String!) {
  deployment(id: $deploymentId) {
    id
    status
    staticUrl
    url
    createdAt
  }
}
```

**调用逻辑:**

1.  在触发部署后，您的后端可以启动一个轮询任务。
2.  每隔一定时间（例如 5-10 秒），调用此 query。
3.  检查返回的 `status` 字段，直到它变为一个终态（如 `SUCCESS` 或 `FAILED`）。
4.  **部署状态 (Status) 枚举值:**
    - `BUILDING`: 构建中
    - `DEPLOYING`: 部署中
    - `INITIALIZING`: 初始化中
    - `QUEUED`: 排队等待中
    - `WAITING`: 等待用户批准（不常见于 API 流程）
    - **`SUCCESS`**: 部署成功，应用正在运行！
    - **`FAILED`**: 构建或部署失败
    - **`CRASHED`**: 应用启动后崩溃
    - `REMOVED`: 已被移除

### 4.5. 步骤四：管理部署（重新部署、回滚、查看日志）

除了首次部署，您还可以执行其他管理操作。

| 操作 | Mutation/Query | 描述 |
| :--- | :--- | :--- |
| **重新部署** | `deploymentRedeploy` | 使用与之前完全相同的源码和配置，重新执行一次部署。适用于修复临时性网络问题或应用状态问题。 |
| **回滚** | `deploymentRollback` | 将服务回滚到某一个历史上的成功部署。您需要提供目标历史部署的 `deploymentId`。 |
| **查看构建日志** | `buildLogs` | 获取指定 `deploymentId` 在构建阶段的日志。 |
| **查看运行时日志** | `deploymentLogs` | 获取指定 `deploymentId` 在运行阶段的日志。 |

这些操作的调用方式与上述类似，都是通过提供相应的 ID 来执行。详细的 GraphQL 结构请参考[附录](#chapter-6)或 Railway 官方文档。

---

<a id="chapter-5"></a>
## 第五章：核心工作流：客户退订 (Offboarding)

当客户决定终止服务时，执行清晰的退订流程至关重要，以确保资源被彻底释放，访问权限被完全撤销。

**前提：** 与客户引导一样，退订操作也必须使用您的**主 `User Token`** 进行认证，因为它需要执行删除项目的权限。

### 5.1. 步骤一：吊销项目级 API 密钥

在删除任何资源之前，首先应该吊销该客户用于 API 访问的 `Project Token`。这是一个关键的安全步骤，确保即使项目删除出现延迟，外部访问也已被立即切断。

- **Mutation:** `projectTokenDelete`
- **核心参数:**
    - `id`: 您要删除的 `Project Token` 的 ID。您需要在创建 Token 时将其 ID 与 Token 本身一起存储，或者通过查询项目的 `projectTokens` 来获取。

**GraphQL 请求示例:**

```graphql
mutation DeleteProjectToken($token_id: String!) {
  projectTokenDelete(id: $token_id)
}
```

### 5.2. 步骤二：删除客户项目

吊销了访问权限后，就可以安全地删除整个项目了。这将一并删除项目内的所有服务、部署、环境变量和日志，彻底释放所有相关资源。

- **Mutation:** `projectDelete`
- **核心参数:**
    - `id`: 客户的 `projectId`。

**GraphQL 请求示例:**

```graphql
mutation DeleteCustomerProject($projectId: String!) {
  projectDelete(id: $projectId)
}
```

**调用逻辑:**

1.  执行 `projectTokenDelete`。
2.  执行 `projectDelete`。
3.  在您的数据库中，标记该客户为“已删除”，并清理掉所有相关的 Railway ID 和凭证。

---

<a id="chapter-6"></a>
## 第六章：附录：GraphQL API 片段与示例

### 6.1. 通用 GraphQL 客户端（Python 示例）

这里提供一个简单的 Python 函数，可以作为您与 Railway GraphQL API 交互的基础。

```python
import requests

def execute_railway_query(query, variables, token):
    """
    Executes a GraphQL query against the Railway API.

    Args:
        query (str): The GraphQL query or mutation string.
        variables (dict): A dictionary of variables for the query.
        token (str): The API token (User Token or Project Token).

    Returns:
        dict: The JSON response from the API.
    """
    api_url = "https://backboard.railway.app/graphql/v2"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    response = requests.post(
        api_url,
        json={"query": query, "variables": variables},
        headers=headers
    )
    response.raise_for_status()  # Raises an exception for bad status codes
    return response.json()

# --- Example Usage ---
# admin_token = "... your user token ..."
# new_project_query = "... mutation from 3.1 ..."
# project_vars = {"name": "customer-x", "workspaceId": "..."}
# result = execute_railway_query(new_project_query, project_vars, admin_token)
# print(result)
```

### 6.2. 关键 Mutation 与 Query 汇总

为方便快速查阅，以下是本指南中提到的核心 GraphQL 操作的精简列表。

| 阶段 | 操作 | GraphQL Mutation/Query |
| :--- | :--- | :--- |
| **客户引导** | 创建项目 | `projectCreate(input: ProjectCreateInput!)` |
| | 创建服务 | `serviceCreate(input: ServiceCreateInput!)` |
| | 获取环境ID | `project(id: $id) { environments { edges { node { id name } } } }` |
| | 创建项目Token | `projectTokenCreate(input: ProjectTokenCreateInput!)` |
| **部署管理** | 更新环境变量 | `variableCollectionUpsert(input: VariableCollectionUpsertInput!)` |
| | 触发部署 | `serviceInstanceDeployV2(serviceId: String!, environmentId: String!)` |
| | 查询部署状态 | `deployment(id: String!)` |
| | 重新部署 | `deploymentRedeploy(id: String!)` |
| | 回滚部署 | `deploymentRollback(id: String!)` |
| | 获取构建日志 | `buildLogs(deploymentId: String!, limit: Int)` |
| | 获取运行时日志 | `deploymentLogs(deploymentId: String!, limit: Int)` |
| **客户退订** | 吊销项目Token | `projectTokenDelete(id: String!)` |
| | 删除项目 | `projectDelete(id: String!)` |

**免责声明:** Railway 的 API 可能会更新。本指南基于截至 2026年3月 的 API 结构。在生产环境中使用前，请务必查阅最新的 [Railway API 官方文档](https://docs.railway.com/integrations/api)。
