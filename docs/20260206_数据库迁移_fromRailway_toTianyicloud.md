# 20260206 数据库迁移（Railway -> Tianyicloud）

## 背景
- 新数据库不支持 pgcrypto 扩展，无法使用 `gen_random_uuid()`。
- 新数据库不支持 SSL 连接，需要禁用 SSL。

## 迁移过程
1. 使用新的连接串：
   - `DATABASE_URL=postgresql://oneceo_dev_user:***@182.42.66.5:25172/oneceo_dev`
   - `DATABASE_SSL=disable`
2. 执行迁移脚本创建表结构：
   - `task_creation_sessions`
   - `conversation_messages`
   - `intent_recognition_results`
   - `task_descriptions`
   - `execution_plans`
   - `search_records`
3. 数据库权限已在 `public` schema 授权（`USAGE/CREATE`）。

## 代码改动
- 数据库连接支持通过环境变量禁用 SSL：
  - `apps/api/src/config/database.ts`
- 去除数据库端 `gen_random_uuid()` 依赖，改为应用侧生成 UUID：
  - `apps/api/src/db/migrate.ts`
  - `apps/api/src/db/schema.ts`
  - `apps/api/src/db/dao/task-creation-session.dao.ts`

## 验证
- 迁移执行成功（已创建全部表）。
- `pnpm --filter api exec tsx src/db/test-db.ts` 执行返回 0（环境里未输出日志）。

## 注意事项
- 若后续数据库支持 `pgcrypto`，可以恢复数据库端默认 UUID。
- 运行时需保持 `DATABASE_SSL=disable`（或连接串带 `sslmode=disable`）。
