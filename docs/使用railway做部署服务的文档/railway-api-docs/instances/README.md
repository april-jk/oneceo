# Railway 实例管理 API 规范 — 主索引

**版本:** 1.0 | **API Endpoint:** `https://backboard.railway.app/graphql/v2`

本文档为主索引，定义了在 Railway 项目中对 8 种实例类型进行生命周期管理的模块化规范体系。每种实例类型对应一个独立的模块文档，包含完整的创建与销毁 API 调用流程。

---

## 认证说明

所有模块文档中的操作均使用 **`User Token`** 进行认证，在 HTTP Header 中携带：

```
Authorization: Bearer <USER_TOKEN>
```

`User Token` 为账户级凭证，拥有对所有项目的完全管理权限，必须作为高优先级机密存储，不得分发给外部系统或客户。

---

## 模块文档索引

| 模块 | 文件 | 实例类型 | 核心 Mutation | 需持久化的 ID |
| :--- | :--- | :--- | :--- | :--- |
| 01 | [module-01-github-repo.md](./module-01-github-repo.md) | GitHub Repo 服务 | `serviceCreate` + `deploymentTriggerCreate` | `serviceId`, `deploymentTriggerId` |
| 02 | [module-02-docker-image.md](./module-02-docker-image.md) | Docker Image 服务 | `serviceCreate` (source.image) | `serviceId` |
| 03 | [module-03-template.md](./module-03-template.md) | Template 模板部署 | `templateDeployV2` | `templateId`, `serviceId[]` |
| 04 | [module-04-database.md](./module-04-database.md) | Database 数据库 | `serviceCreate` (官方镜像) | `serviceId` |
| 05 | [module-05-volume.md](./module-05-volume.md) | Volume 持久化存储 | `volumeCreate` | `volumeId`, `volumeInstanceId` |
| 06 | [module-06-function.md](./module-06-function.md) | Function 定时任务 | `serviceCreate` + `serviceInstanceUpdate` (cronSchedule) | `serviceId` |
| 07 | [module-07-bucket.md](./module-07-bucket.md) | Bucket 对象存储 | `bucketCreate` | `bucketId`, `accessKeyId`, `secretAccessKey` |
| 08 | [module-08-empty-service.md](./module-08-empty-service.md) | Empty Service 空服务 | `serviceCreate` + `serviceConnect` | `serviceId` |

---

## 通用销毁 Mutation 速查

| 实例类型 | 销毁 Mutation | 参数 |
| :--- | :--- | :--- |
| 所有 Service 类型（01/02/03/04/06/08） | `serviceDelete` | `id: String!, environmentId: String` |
| Volume | `volumeDelete` | `volumeId: String!` |
| Bucket | `bucketDelete` | `id: String!` |

`serviceDelete` 的 `environmentId` 传 `null` 时删除所有环境中的该服务；传入具体 ID 则仅删除指定环境中的实例。

---

## 实例类型决策指引

在为项目选择实例类型时，可参考以下决策逻辑：

| 需求场景 | 推荐类型 | 对应模块 |
| :--- | :--- | :--- |
| 从 GitHub 仓库持续部署 Web 应用 | GitHub Repo | Module 01 |
| 部署已有的 Docker 镜像 | Docker Image | Module 02 |
| 一键部署多服务组合（如 CMS + DB） | Template | Module 03 |
| 需要关系型/缓存数据库 | Database | Module 04 |
| 服务需要持久化文件存储（如上传文件、数据库数据目录） | Volume | Module 05 |
| 需要定时执行脚本或任务 | Function | Module 06 |
| 需要 S3 兼容的对象存储 | Bucket | Module 07 |
| 来源待定、需要灵活配置的服务 | Empty Service | Module 08 |

---

## 关联文档

本索引文档与以下规范文档共同构成完整的 Railway 集成规范：

- `railway_technical_specification.md` — 租户（Project）生命周期管理规范（创建、查询、销毁）
- `railway_api_integration_guide.md` — 部署、变量管理、状态监控规范
