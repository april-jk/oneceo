# 客户隔离与 API 密钥管理方案调研报告

**致：** 尊敬的客户

**发件人：** Manus AI

**日期：** 2026年3月5日

**主题：** 关于在 Railway 平台实现“主账号 + 客户隔离 + 项目级密钥”安全架构的可行性分析与建议

---

## 1. 核心需求分析

您提出的核心需求是在构建的全流程托管系统中，实现对最终客户的强隔离。具体表现为，不希望使用一个统一的 API Key 管理所有客户的所有项目，而是为每个客户的每个项目生成独立的、权限受限的 API 密钥。这是一个非常关键且合理的安全架构要求，旨在防止潜在的横向越权风险，确保单一客户项目凭证泄露不会影响到其他客户的资产安全。

## 2. 调研结论

经过对 Railway 平台账号体系、权限模型和 API Token 机制的深入调研，并与 Fly.io、Render 等主流 PaaS 平台进行横向对比，**我们确认 Railway 完全有能力支持您所设想的安全架构**。尽管 Railway 没有直接的“子账号”概念，但通过其“工作区 (Workspace)”或“项目 (Project)”结合“项目级 API Token (Project Token)”的机制，可以灵活且安全地实现客户隔离的目标。

**最佳实践架构建议：**

1.  **主账号管理：** 使用您的主 Railway 账户作为最高权限的管理员，负责创建和管理所有客户的资源。
2.  **客户隔离层：** 为每一位最终客户创建一个独立的 **Railway 项目 (Project)**。这是实现资源、配置、环境变量和部署隔离的核心单元。
3.  **项目级密钥生成：** 针对每个客户的项目，通过调用 Railway 的 GraphQL API 中的 `projectTokenCreate` mutation，以编程方式动态生成一个 **项目级 API Token (Project Token)**。此 Token 的权限被严格限制在该项目及其指定的环境（如 `production`）之内。
4.  **密钥分发与管理：** 在您的托管系统中，建立一个安全的凭证管理模块，负责存储、分发和轮换这些为客户生成的 Project Token。当您的系统需要代表客户执行部署或其他操作时，使用其对应的 Project Token 进行 API 调用。

通过此架构，您可以为每个客户的每个项目颁发一个“项目钥匙”，这把钥匙只能打开自己的“项目大门”，从而完美实现了您要求的客户间安全隔离。

## 3. Railway 平台能力详解

我们在调研中确认了以下关键功能点，为上述架构提供了坚实的基础：

| 功能点 | Railway 平台支持情况 | 详细说明 |
| :--- | :--- | :--- |
| **账户层级** | Workspace / Project | Railway 使用 `Workspaces` 来组织 `Projects`。您可以为每个客户创建一个独立的 `Workspace`（重量级隔离，包含独立账单和成员管理），或在一个统一的 `Workspace` 下为每个客户创建一个 `Project`（轻量级隔离，更易于集中管理）。对于您的场景，**“每个客户一个 Project”** 是更推荐的模式。 [1] |
| **API Token 类型** | User Token / Project Token | Railway 提供多种 Token 类型。`User Token` 权限过高，不适用于此场景。`Project Token` 则是完美匹配，其权限被天然地限制在单个项目和环境中。 [2] |
| **Token 编程化管理** | **支持** | Railway 的 GraphQL API 提供了 `projectTokenCreate` 和 `projectTokenDelete` 两个 mutation。通过 API 调用，您可以完全自动化地完成“为客户项目创建专属密钥”和“在客户服务终止时吊销密钥”的完整生命周期管理。 [3] [4] |
| **细粒度权限控制** | Environment RBAC (企业版) | 对于有更高合规性要求的场景，Railway 的企业版提供了基于角色的访问控制（RBAC），可以进一步限制团队成员（非 API Token）对特定环境（如生产环境）的读写权限，实现了更高维度的安全隔离。 [5] |

## 4. 竞品平台对比分析

为了验证 Railway 方案的优越性，我们同样调研了 Fly.io 和 Render 的相关能力。

| 平台 | 客户隔离模型 | API Key 粒度 | 编程化创建 Key | 综合评价 |
| :--- | :--- | :--- | :--- | :--- |
| **Railway** | **每个客户一个 Project** | **项目级 (Project-scoped)** | **支持 (GraphQL API)** | **高度符合要求。** 提供了清晰的隔离模型和完善的 API Token 编程化管理能力，是实现您安全架构的理想选择。 |
| **Fly.io** | 每个客户一个 App | 应用级 (App-scoped) | 支持 (flyctl / API 较复杂) | 也符合要求。Fly.io 推荐“每个客户一个 App”的模式，并提供 App-scoped Token。其 API 也能实现类似功能，但层级和工具链相对更复杂一些。 [6] [7] |
| **Render** | 每个客户一个 Service | **账户级 (Owner-level)** | 不支持 | **不符合要求。** Render 的 API Key 权限过大，一个 Key 可以访问账户下所有资源，无法满足您对客户项目进行安全隔离的核心诉求。 [8] |

## 5. 总结与后续步骤

综上所述，Railway 平台不仅在功能上完全满足您对客户隔离和项目级密钥管理的安全需求，并且其基于 GraphQL 的 API 设计清晰、管理灵活，非常适合集成到您的自动化托管流程中。

我们建议您可以开始基于 **“每个客户一个 Railway Project，并为其动态创建 Project Token”** 的技术方案进行原型设计和开发。在后续的开发过程中，我们将随时准备为您提供进一步的技术支持。

---

### 参考资料

[1] Railway Docs. (2026). *Workspaces*. Retrieved from https://docs.railway.com/projects/workspaces

[2] Railway Docs. (2026). *Public API*. Retrieved from https://docs.railway.com/integrations/api

[3] Railway Community. (2025). *API key with restricted scope?*. Retrieved from https://station.railway.com/questions/api-key-with-restricted-scope-7c55ef24

[4] Railway GraphQL API Introspection. (2026). *Mutation: projectTokenCreate*. Retrieved via API query.

[5] Railway Docs. (2026). *Environment RBAC*. Retrieved from https://docs.railway.com/enterprise/environment-rbac

[6] Fly.io Docs. (2026). *Access tokens*. Retrieved from https://fly.io/docs/security/tokens/

[7] Fly.io Docs. (2026). *One App Per Customer - Why?*. Retrieved from https://fly.io/docs/machines/guides-examples/one-app-per-user-why/

[8] Render Docs. (2026). *The Render API*. Retrieved from https://render.com/docs/api
