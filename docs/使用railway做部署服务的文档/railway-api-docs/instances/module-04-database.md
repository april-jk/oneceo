# Module 04 — Database 服务

**认证:** 所有操作使用 `User Token`，Header: `Authorization: Bearer <USER_TOKEN>`
**API Endpoint:** `https://backboard.railway.app/graphql/v2`

---

## 概述

Railway 的 Database 类型本质上是使用官方维护的 Docker 镜像创建的服务。通过 `serviceCreate` 指定对应数据库镜像，Railway 会自动注入连接所需的环境变量（如 `DATABASE_URL`）。支持 PostgreSQL、MySQL、Redis、MongoDB。

---

## 各数据库创建参数

### PostgreSQL

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
    "name": "postgres",
    "projectId": "<projectId>",
    "source": {
      "image": "postgres:16"
    },
    "variables": {
      "POSTGRES_USER": "railway",
      "POSTGRES_PASSWORD": "<generated-password>",
      "POSTGRES_DB": "railway"
    }
  }
}
```

Railway 自动注入的连接变量：`DATABASE_URL`（格式：`postgresql://user:pass@host:5432/db`）、`PGHOST`、`PGPORT`、`PGUSER`、`PGPASSWORD`、`PGDATABASE`。

---

### MySQL

```json
{
  "input": {
    "name": "mysql",
    "projectId": "<projectId>",
    "source": {
      "image": "mysql:8"
    },
    "variables": {
      "MYSQL_ROOT_PASSWORD": "<generated-password>",
      "MYSQL_DATABASE": "railway",
      "MYSQL_USER": "railway",
      "MYSQL_PASSWORD": "<generated-password>"
    }
  }
}
```

Railway 自动注入的连接变量：`DATABASE_URL`（格式：`mysql://user:pass@host:3306/db`）、`MYSQLHOST`、`MYSQLPORT`、`MYSQLUSER`、`MYSQLPASSWORD`、`MYSQLDATABASE`。

---

### Redis

```json
{
  "input": {
    "name": "redis",
    "projectId": "<projectId>",
    "source": {
      "image": "redis:7"
    },
    "variables": {
      "REDIS_PASSWORD": "<generated-password>"
    }
  }
}
```

Railway 自动注入的连接变量：`REDIS_URL`（格式：`redis://:pass@host:6379`）、`REDISHOST`、`REDISPORT`、`REDISPASSWORD`。

---

### MongoDB

```json
{
  "input": {
    "name": "mongodb",
    "projectId": "<projectId>",
    "source": {
      "image": "mongo:7"
    },
    "variables": {
      "MONGO_INITDB_ROOT_USERNAME": "railway",
      "MONGO_INITDB_ROOT_PASSWORD": "<generated-password>"
    }
  }
}
```

Railway 自动注入的连接变量：`MONGO_URL`（格式：`mongodb://user:pass@host:27017`）。

---

## 将数据库连接注入到其他服务

数据库创建后，通过 `variableCollectionUpsert` 将连接变量注入到需要访问数据库的应用服务。

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
      "DATABASE_URL": "${{postgres.DATABASE_URL}}"
    }
  }
}
```

Railway 支持使用 `${{serviceName.VARIABLE_NAME}}` 语法引用同项目内其他服务的变量，实现服务间变量共享。

---

## 触发部署

数据库服务创建并配置变量后，触发部署使其运行。

```graphql
mutation($serviceId: String!, $environmentId: String!) {
  serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
}
```

```json
{
  "serviceId": "<db-serviceId>",
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
{ "id": "<db-serviceId>" }
```

删除数据库服务会永久销毁所有数据，销毁前应确保已完成数据备份或已通知相关方。

---

## 持久化字段汇总

| 字段 | 来源 | 用途 |
| :--- | :--- | :--- |
| `serviceId` | `serviceCreate` | 数据库服务的核心 ID |
| `DATABASE_URL` 等连接变量 | Railway 自动注入 | 供其他服务引用，建议同步存储到系统 |
