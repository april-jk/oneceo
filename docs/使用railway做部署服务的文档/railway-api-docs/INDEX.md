# Railway API 规范文档库 — 统一索引

**版本:** 2.0 | **更新日期:** 2026-03-05
**API Endpoint:** `https://backboard.railway.app/graphql/v2`
**官方 API 文档:** [docs.railway.com/integrations/api](https://docs.railway.com/integrations/api)
**GraphQL Playground:** [railway.com/graphiql](https://railway.com/graphiql)

本文档库共包含 **14 份文档**，分为两层结构：根目录存放系统级规范文档，`instances/` 子目录存放各实例类型的模块化操作规范。

---

## 文档结构总览

```
railway-api-docs/
├── INDEX.md                                          ← 本文件，统一索引
├── deployment_provider_recommendation.md             ← 供应商选型报告
├── railway_customer_isolation_and_api_key_management_report.md  ← 隔离方案调研报告
├── railway_technical_specification.md                ← 租户生命周期规范
├── railway_api_integration_guide.md                  ← 部署全流程集成指南
├── railway_project_management_and_monitoring_guide.md ← 项目管理与监控规范
└── instances/
    ├── README.md                                     ← 实例模块索引
    ├── module-01-github-repo.md                      ← GitHub Repo 服务
    ├── module-02-docker-image.md                     ← Docker Image 服务
    ├── module-03-template.md                         ← Template 模板部署
    ├── module-04-database.md                         ← Database 数据库
    ├── module-05-volume.md                           ← Volume 持久化存储
    ├── module-06-function.md                         ← Function 定时任务
    ├── module-07-bucket.md                           ← Bucket 对象存储
    └── module-08-empty-service.md                    ← Empty Service 空服务
```

---

## 根目录文档说明

### 1. 供应商选型报告
**文件:** [`deployment_provider_recommendation.md`](./deployment_provider_recommendation.md)

对 Railway、Render、Fly.io、Vercel 等主流云部署平台的综合对比分析报告，从 API 能力、稳定性、定价、AI 集成等维度评估，给出最终选型建议。适用于技术决策参考。

---

### 2. 客户隔离与 API Key 管理调研报告
**文件:** [`railway_customer_isolation_and_api_key_management_report.md`](./railway_customer_isolation_and_api_key_management_report.md)

深度调研 Railway 账号体系、Token 粒度机制，以及与 Fly.io 等竞品的隔离方案对比。明确了 Railway `Project Token` 的权限边界和多租户隔离的可行性结论。适用于架构决策参考。

---

### 3. 租户生命周期规范
**文件:** [`railway_technical_specification.md`](./railway_technical_specification.md)

以**租户（Project）**为核心对象，定义了创建（Provisioning）、存续（Management）、销毁（Deprovisioning）三个阶段的完整 API 调用流程，包含所有关键 GraphQL Mutation/Query 和需持久化的字段说明。**这是系统集成的核心规范文档。**

| 覆盖的 API | 说明 |
| :--- | :--- |
| `projectCreate` | 为新租户创建隔离项目 |
| `projectTokenCreate` | 为租户项目生成专属访问密钥 |
| `project` query | 查询项目和服务状态 |
| `serviceCreate` | 向项目添加新服务 |
| `projectTokenDelete` | 吊销租户密钥 |
| `projectDelete` | 彻底销毁租户项目 |

---

### 4. 部署全流程集成指南
**文件:** [`railway_api_integration_guide.md`](./railway_api_integration_guide.md)

覆盖部署生命周期的完整操作规范，包括：环境变量管理、触发部署、轮询部署状态、重新部署、回滚、查看日志。包含可复用的 Python GraphQL 客户端代码和所有部署状态枚举值说明。

| 覆盖的 API | 说明 |
| :--- | :--- |
| `variableCollectionUpsert` | 批量设置环境变量 |
| `serviceInstanceDeployV2` | 触发部署，返回 deploymentId |
| `deployments` query | 查询部署列表和状态 |
| `deploymentRedeploy` | 重新部署 |
| `deploymentRollback` | 回滚到历史版本 |
| `deploymentLogs` query | 查询部署日志 |

---

### 5. 项目管理与监控规范
**文件:** [`railway_project_management_and_monitoring_guide.md`](./railway_project_management_and_monitoring_guide.md)

涵盖项目管理、权限隔离、监控面板、日志系统、域名管理的完整 API 规范，并附有 Token 权限对照表和全部 25 个 API 的速查汇总表。

| 章节 | 覆盖的 API |
| :--- | :--- |
| 项目生命周期 | `projectCreate/Update/Delete`，`project` query |
| 权限隔离 | `projectTokenCreate/Delete`，`projectTokens` query |
| 部署面板 | `deployments` query（含状态过滤） |
| 监控指标 | `metrics` query（CPU/内存/网络/磁盘） |
| 项目事件 | `events` query |
| 部署日志 | `deploymentLogs` query（含增量轮询方案） |
| HTTP 日志 | `httpLogs` query（含字段说明） |
| 域名管理 | `serviceDomainCreate/Delete`，`customDomainCreate/Delete` |

---

## instances/ 子目录文档说明

**子目录索引:** [`instances/README.md`](./instances/README.md)

`instances/` 目录包含 8 种实例类型的模块化操作规范，每个文档独立成文，结构统一（概述 → 创建流程 → 销毁流程 → 持久化字段汇总）。

| 文件 | 实例类型 | 核心 API | 需持久化的 ID |
| :--- | :--- | :--- | :--- |
| [`module-01-github-repo.md`](./instances/module-01-github-repo.md) | GitHub Repo 服务 | `serviceCreate` + `deploymentTriggerCreate` | `serviceId`, `deploymentTriggerId` |
| [`module-02-docker-image.md`](./instances/module-02-docker-image.md) | Docker Image 服务 | `serviceCreate`（source.image） | `serviceId` |
| [`module-03-template.md`](./instances/module-03-template.md) | Template 模板部署 | `templates` query + `templateDeployV2` | `templateId`, `serviceId[]` |
| [`module-04-database.md`](./instances/module-04-database.md) | Database 数据库 | `serviceCreate`（官方镜像） | `serviceId` |
| [`module-05-volume.md`](./instances/module-05-volume.md) | Volume 持久化存储 | `volumeCreate` + `volumeInstanceUpdate` | `volumeId`, `volumeInstanceId` |
| [`module-06-function.md`](./instances/module-06-function.md) | Function 定时任务 | `serviceCreate` + `cronSchedule` 配置 | `serviceId` |
| [`module-07-bucket.md`](./instances/module-07-bucket.md) | Bucket 对象存储 | `bucketCreate` | `bucketId`, `accessKeyId`, `secretAccessKey` |
| [`module-08-empty-service.md`](./instances/module-08-empty-service.md) | Empty Service 空服务 | `serviceCreate` + `serviceConnect` | `serviceId` |

---

## 阅读路径建议

**初次集成（了解整体架构）:**
`deployment_provider_recommendation.md` → `railway_customer_isolation_and_api_key_management_report.md` → `railway_technical_specification.md`

**开发阶段（实现具体功能）:**
`railway_technical_specification.md` → `railway_api_integration_guide.md` → `instances/README.md` → 对应模块文档

**运维阶段（监控与日志）:**
`railway_project_management_and_monitoring_guide.md`（第三章至第五章）

---

## 官方参考资源

| 资源 | 链接 |
| :--- | :--- |
| Railway API 官方文档 | https://docs.railway.com/integrations/api |
| GraphQL Playground | https://railway.com/graphiql |
| Railway 状态页 | https://status.railway.com |
| Railway 社区论坛 | https://station.railway.com |
