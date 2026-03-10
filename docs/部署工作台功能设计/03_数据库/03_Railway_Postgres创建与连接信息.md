# 数据库 / Railway Postgres 创建与连接信息

## 1. 功能目标

本页用于明确数据库能力的底层来源和连接信息策略。

当前约束：

- 数据库直接在 Railway 中创建
- 类型固定为 PostgreSQL
- 连接信息直接从 Railway 返回与注入的变量中获取

## 2. 创建方式

数据库创建方式采用 Railway 的数据库服务创建模型。

当前建议：

- 在用户首次需要数据库能力时，由平台在 Railway 项目中创建 `postgres` 服务
- 使用 Railway 官方数据库镜像创建 PostgreSQL 实例
- 数据库服务和应用服务保持在同一个 Railway project / environment 下

参考仓库现有文档：

- [module-04-database.md](/Users/eunice/codingProject/oneceo/docs/使用railway做部署服务的文档/railway-api-docs/instances/module-04-database.md)

## 3. 连接信息来源

Railway 会为 PostgreSQL 自动注入数据库连接变量。

当前设计明确依赖这些值：

- `DATABASE_URL`
- `PGHOST`
- `PGPORT`
- `PGUSER`
- `PGPASSWORD`
- `PGDATABASE`

OneCEO 数据库设置页展示的数据，应直接来自这些 Railway 变量，而不是额外手工拼装一套独立配置。

## 4. 页面展示要求

当用户点击数据库页左下角 `设置` 按钮后，应进入数据库设置与结构管理页，并在连接信息区展示：

- 连接 URL
- 主机
- 端口
- 用户名
- 密码
- 数据库名

每一项要求：

- 单独显示
- 单独复制按钮
- 可直接复制
- 复制后可用于外部数据库管理软件

## 5. 复制目标场景

连接信息允许用户复制到自己的数据库管理软件中使用，例如：

- DBeaver
- DataGrip
- TablePlus
- Postico
- 其他 PostgreSQL 客户端

因此页面不应该只显示“已连接”或“托管中”之类抽象状态，必须能让用户真正拿到可用连接参数。

## 6. 建议接口结构

建议后端提供一个连接信息对象：

```json
{
  "provider": "postgres",
  "source": "railway",
  "url": "postgresql://...",
  "host": "xxx",
  "port": 5432,
  "username": "railway",
  "password": "xxx",
  "database": "railway"
}
```

## 7. 计划设计方式

### 第一阶段

- 平台在 Railway 创建 PostgreSQL
- 拉取 Railway 注入的连接变量
- 在设置页按字段展示并提供复制按钮

### 第二阶段

- 连接信息与数据库浏览能力联动
- 自动检测连接状态
- 支持重新拉取最新连接信息

### 第三阶段

- 支持多数据库实例
- 支持连接轮换与历史审计

## 8. 审核点

- 数据库创建是否固定走 Railway Postgres。
- 连接信息是否就按 Railway 变量原样展示给用户复制。
- 是否需要在第一阶段就展示数据库名 `PGDATABASE`。
