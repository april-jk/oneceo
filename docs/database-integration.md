# 数据库集成文档

## 📋 概述

本文档记录了 PostgreSQL 数据库在任务创建智能体中的集成实现。使用 Railway 托管的 PostgreSQL 数据库，通过 Drizzle ORM 实现数据持久化。

## ⚠️ 瞬时连接异常处理

- 任务创建相关查询接口在遇到数据库瞬时不可用时，不再让异常直接穿透到进程级。
- 当前会识别的典型异常包括：
  - `Connection terminated due to connection timeout`
  - `Connection terminated unexpectedly`
  - `timeout exceeded when trying to connect`
- 处理策略：
  - 会话列表接口优先返回已有缓存的旧数据。
  - 会话详情与消息、意图、任务描述、执行计划等接口返回 `503`，提示数据库暂时不可用。
  - `OpenCode` 事件流入口在读取会话阶段失败时直接返回 `503`，避免未捕获异常导致 API 进程退出。

## 🗄️ 数据库信息

### 连接信息

- **数据库类型**: PostgreSQL
- **托管平台**: Railway
- **连接字符串**: `postgresql://postgres:ByEiZNfHGcTGWJtObsvzQypmEuLanLeZ@centerbeam.proxy.rlwy.net:49514/railway`
- **SSL**: 启用（Railway 要求）

### 环境变量

```bash
DATABASE_URL=postgresql://postgres:ByEiZNfHGcTGWJtObsvzQypmEuLanLeZ@centerbeam.proxy.rlwy.net:49514/railway
```

## 📊 数据库表结构

### 1. task_creation_sessions（任务创建会话表）

记录每次任务创建的会话信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| user_id | TEXT | 用户ID（可选） |
| status | TEXT | 会话状态（in_progress, completed, failed） |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |
| completed_at | TIMESTAMP | 完成时间 |

### 2. conversation_messages（对话消息表）

记录任务创建过程中的所有对话消息。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| session_id | UUID | 会话ID（外键） |
| role | TEXT | 角色（user, agent, system） |
| content | TEXT | 消息内容 |
| message_type | TEXT | 消息类型 |
| metadata | JSONB | 元数据 |
| created_at | TIMESTAMP | 创建时间 |

### 3. intent_recognition_results（意图识别结果表）

记录 Layer 1 的意图识别结果。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| session_id | UUID | 会话ID（外键） |
| user_input | TEXT | 用户输入 |
| intent_type | TEXT | 意图类型 |
| confidence | INTEGER | 置信度（0-100） |
| key_info | JSONB | 关键信息 |
| clarification_needed | BOOLEAN | 是否需要澄清 |
| clarification_questions | JSONB | 澄清问题列表 |
| created_at | TIMESTAMP | 创建时间 |

### 4. task_descriptions（任务描述表）

记录 Layer 2 生成的任务描述。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| session_id | UUID | 会话ID（外键） |
| intent_result_id | UUID | 意图识别结果ID（外键） |
| title | TEXT | 任务标题 |
| objective | TEXT | 任务目标 |
| scope | TEXT | 任务范围 |
| deliverables | JSONB | 交付物列表 |
| constraints | JSONB | 约束条件 |
| additional_info | JSONB | 额外信息 |
| created_at | TIMESTAMP | 创建时间 |

### 5. execution_plans（执行计划表）

记录 Layer 3 生成的执行计划。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| session_id | UUID | 会话ID（外键） |
| task_description_id | UUID | 任务描述ID（外键） |
| project_title | TEXT | 项目标题 |
| project_description | TEXT | 项目描述 |
| estimated_total_hours | INTEGER | 预估总时长 |
| managers | JSONB | 经理和任务列表 |
| created_at | TIMESTAMP | 创建时间 |

### 6. search_records（搜索记录表）

记录任务创建过程中的搜索查询和结果。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| session_id | UUID | 会话ID（外键） |
| query | TEXT | 搜索查询 |
| results | JSONB | 搜索结果 |
| source | TEXT | 搜索来源 |
| created_at | TIMESTAMP | 创建时间 |

## 🏗️ 架构设计

### 数据访问层（DAO）

使用 DAO 模式封装数据库操作，提供清晰的接口。

```typescript
// 创建会话
const session = await taskCreationSessionDAO.createSession({ userId });

// 保存意图识别结果
await taskCreationSessionDAO.saveIntentResult({
  sessionId,
  userInput,
  intentType,
  confidence,
  keyInfo,
});

// 查询会话完整信息
const sessionData = await taskCreationSessionDAO.getSessionWithDetails(sessionId);
```

### 级联删除

所有关联数据通过外键约束实现级联删除，删除会话时会自动删除所有关联的消息、意图识别结果、任务描述、执行计划和搜索记录。

## 📁 文件结构

```
apps/api/src/
├── config/
│   └── database.ts              # 数据库配置和连接
├── db/
│   ├── schema.ts                # 数据库 Schema 定义
│   ├── migrate.ts               # 数据库迁移脚本
│   ├── test-db.ts               # 数据库功能测试
│   └── dao/
│       ├── index.ts             # DAO 导出
│       └── task-creation-session.dao.ts  # 任务创建会话 DAO
├── routes/
│   └── task-creation-routes.ts # 任务创建 API 路由
└── agents/
    └── task-creation/
        └── task-creation-service.ts  # 集成数据库的服务
```

## 🔧 使用方法

### 1. 数据库迁移

创建所有必要的表：

```bash
cd apps/api
DATABASE_URL="your-database-url" npx tsx src/db/migrate.ts
```

### 2. 测试数据库功能

运行完整的功能测试：

```bash
cd apps/api
DATABASE_URL="your-database-url" npx tsx src/db/test-db.ts
```

### 3. API 端点

#### 获取会话列表

```http
GET /api/task-creation/sessions?limit=10&userId=xxx
```

#### 获取会话详情

```http
GET /api/task-creation/sessions/:sessionId
```

#### 获取对话消息

```http
GET /api/task-creation/sessions/:sessionId/messages
```

#### 获取意图识别结果

```http
GET /api/task-creation/sessions/:sessionId/intent
```

#### 获取任务描述

```http
GET /api/task-creation/sessions/:sessionId/task-description
```

#### 获取执行计划

```http
GET /api/task-creation/sessions/:sessionId/execution-plan
```

#### 删除会话

```http
DELETE /api/task-creation/sessions/:sessionId
```

## 🔄 数据流程

### 任务创建流程中的数据保存

1. **创建会话**
   ```typescript
   const session = await taskCreationSessionDAO.createSession({ userId });
   ```

2. **保存用户输入**
   ```typescript
   await taskCreationSessionDAO.addMessage({
     sessionId,
     role: 'user',
     content: userInput,
   });
   ```

3. **保存意图识别结果**（Layer 1）
   ```typescript
   await taskCreationSessionDAO.saveIntentResult({
     sessionId,
     userInput,
     intentType,
     confidence,
     keyInfo,
   });
   ```

4. **保存任务描述**（Layer 2）
   ```typescript
   await taskCreationSessionDAO.saveTaskDescription({
     sessionId,
     intentResultId,
     title,
     objective,
     deliverables,
   });
   ```

5. **保存执行计划**（Layer 3）
   ```typescript
   await taskCreationSessionDAO.saveExecutionPlan({
     sessionId,
     taskDescriptionId,
     projectTitle,
     managers,
   });
   ```

6. **更新会话状态**
   ```typescript
   await taskCreationSessionDAO.updateSessionStatus(sessionId, 'completed');
   ```

## 🔍 查询示例

### 查询最近的会话

```typescript
const sessions = await taskCreationSessionDAO.getRecentSessions(10);
```

### 查询会话完整信息

```typescript
const sessionData = await taskCreationSessionDAO.getSessionWithDetails(sessionId);
// 返回：
// {
//   session: {...},
//   messages: [...],
//   intentResult: {...},
//   taskDescription: {...},
//   executionPlan: {...},
//   searchRecords: [...]
// }
```

## 🛡️ 安全性

### Railway 数据库访问约束

根据架构约束，所有数据库请求必须通过后端服务进行，前端不能直接访问数据库。这确保了：

1. **数据安全**：数据库凭证不暴露给前端
2. **访问控制**：所有数据访问都经过后端验证
3. **审计追踪**：可以在后端记录所有数据库操作

### SSL 连接

Railway 数据库要求使用 SSL 连接，配置中已启用：

```typescript
ssl: {
  rejectUnauthorized: false,
}
```

## 📊 性能优化

### 连接池配置

```typescript
{
  max: 20,                    // 最大连接数
  idleTimeoutMillis: 30000,   // 空闲连接超时
  connectionTimeoutMillis: 10000, // 连接超时
}
```

### 索引

已为常用查询字段创建索引：

- `conversation_messages.session_id`
- `intent_recognition_results.session_id`
- `task_descriptions.session_id`
- `execution_plans.session_id`
- `search_records.session_id`
- `task_creation_sessions.status`
- `task_creation_sessions.created_at`

## 🧪 测试结果

所有数据库功能测试通过：

- ✅ 数据库连接
- ✅ 创建会话
- ✅ 添加对话消息
- ✅ 保存意图识别结果
- ✅ 保存任务描述
- ✅ 保存执行计划
- ✅ 更新会话状态
- ✅ 查询会话完整信息
- ✅ 查询最近的会话列表
- ✅ 删除会话（级联删除）

## 📝 注意事项

1. **环境变量**：确保在 `.env` 文件中配置正确的 `DATABASE_URL`
2. **迁移**：首次使用前需要运行迁移脚本创建表
3. **级联删除**：删除会话会自动删除所有关联数据，请谨慎操作
4. **时区**：所有时间戳使用 UTC 时区
5. **JSONB 类型**：使用 JSONB 存储复杂数据结构，支持高效查询

## 🔗 相关文档

- [任务创建智能体实现文档](./task-creation-agent-implementation.md)
- [需求文档](./task-creation-agent-requirements.md)
- [代码修改指南](../AGENT_CODE_MODIFICATION_GUIDE.md)

---

**版本**: 1.0.0  
**最后更新**: 2024-02-04  
**开发者**: Manus AI Agent
