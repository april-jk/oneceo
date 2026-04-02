# OneCEO Agent 使用示例

本文档只保留当前代码中仍然存在的主链示例。

## 1. 用户端认证

### 注册

```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "demo@example.com",
    "password": "Passw0rd!",
    "displayName": "Demo User"
  }'
```

### 登录

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "demo@example.com",
    "password": "Passw0rd!"
  }' \
  -c /tmp/oneceo-app.cookie
```

### 获取当前用户

```bash
curl http://localhost:4000/api/auth/me \
  -b /tmp/oneceo-app.cookie
```

## 2. 创建任务会话

### 创建会话

```bash
curl -X POST http://localhost:4000/api/task-creation/sessions \
  -H "Content-Type: application/json" \
  -b /tmp/oneceo-app.cookie \
  -d '{
    "mode": "sandbox",
    "executor": "codex",
    "initialMessage": "帮我分析当前仓库的任务会话恢复链路并给出修复方案"
  }'
```

### 获取会话列表

```bash
curl "http://localhost:4000/api/task-creation/sessions?limit=20" \
  -b /tmp/oneceo-app.cookie
```

### 获取最近消息

```bash
curl http://localhost:4000/api/task-creation/sessions/<sessionId>/messages/recent \
  -b /tmp/oneceo-app.cookie
```

## 3. 启动或打断运行时

### 启动运行时

```bash
curl -X POST http://localhost:4000/api/task-creation/sessions/<sessionId>/runtime/start \
  -b /tmp/oneceo-app.cookie
```

### 中断运行时

```bash
curl -X POST http://localhost:4000/api/task-creation/sessions/<sessionId>/runtime/interrupt \
  -H "Content-Type: application/json" \
  -b /tmp/oneceo-app.cookie \
  -d '{}'
```

## 4. Altus Managed Run

### 提交 managed 输入

```bash
curl -X POST http://localhost:4000/api/altus-managed/inputs \
  -b /tmp/oneceo-app.cookie \
  -F sessionId=<sessionId> \
  -F content='请继续完善当前任务的执行计划'
```

### 查询最新 run

```bash
curl http://localhost:4000/api/altus-managed/sessions/<sessionId>/runs/latest \
  -b /tmp/oneceo-app.cookie
```

### 订阅 run 流

```bash
curl -N http://localhost:4000/api/altus-managed/runs/<runId>/stream \
  -b /tmp/oneceo-app.cookie
```

## 5. 连接器与 Skills

### 获取连接器目录

```bash
curl http://localhost:4000/api/connectors/catalog \
  -b /tmp/oneceo-app.cookie
```

### 获取当前用户连接器

```bash
curl http://localhost:4000/api/connectors/me \
  -b /tmp/oneceo-app.cookie
```

### 获取当前用户可用 Skills

```bash
curl http://localhost:4000/api/task-creation/skills \
  -b /tmp/oneceo-app.cookie
```

### 获取用户 Skill 设置

```bash
curl http://localhost:4000/api/task-creation/settings/skills \
  -b /tmp/oneceo-app.cookie
```

## 6. Workspace 与交付物

### 获取工作区树

```bash
curl http://localhost:4000/api/task-creation/sessions/<sessionId>/workspace/tree \
  -b /tmp/oneceo-app.cookie
```

### 获取工作区文件内容

```bash
curl "http://localhost:4000/api/task-creation/sessions/<sessionId>/workspace/file?path=README.md" \
  -b /tmp/oneceo-app.cookie
```

### 获取交付物列表

```bash
curl http://localhost:4000/api/task-creation/sessions/<sessionId>/deliverables \
  -b /tmp/oneceo-app.cookie
```

## 7. 前端对应入口

- Web 认证客户端：`apps/web/client/src/lib/auth-client.ts`
- 任务会话客户端：`apps/web/client/src/lib/task-creation-client.ts`
- 任务会话 Hook：`apps/web/client/src/hooks/useTaskCreationAgent.ts`
- 登录页：`apps/web/client/src/pages/Login.tsx`
- 注册页：`apps/web/client/src/pages/Register.tsx`
- 任务页入口：`apps/web/client/src/pages/Home.tsx`、`apps/web/client/src/components/TaskCreationChat.tsx`
