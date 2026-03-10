# Agent 代码位置速查表

## 🎯 快速定位

### 智能体 1：任务创建智能体

**文件**：`apps/api/src/agents/task-creation/task-creation-agent.ts`

| 要修改的内容 | 搜索关键词 | 行数范围 |
|-------------|-----------|---------|
| 智能体配置（模型、温度等） | `【智能体创建位置 - 智能体1】` | constructor |
| 系统提示词 | `【提示词编写位置 - 智能体1】` | systemPrompt |
| 工具函数 | `【工具调用位置 - 智能体1】` | initializeTools() |

**使用场景**：创建任务页面 (`NewTaskDialog.tsx`)

---

### 智能体 2：总经理视图智能体

**文件**：`apps/api/src/agents/ceo-view/ceo-view-agent.ts`

| 要修改的内容 | 搜索关键词 | 行数范围 |
|-------------|-----------|---------|
| 智能体配置（模型、温度等） | `【智能体创建位置 - 智能体2】` | constructor |
| 系统提示词 | `【提示词编写位置 - 智能体2】` | systemPrompt |
| 工具函数 | `【工具调用位置 - 智能体2】` | initializeTools() |

**使用场景**：总经理视图页面 (`CEOView.tsx`)

---

### 智能体 3：任务详情智能体（经理智能体）

**文件**：`apps/api/src/agents/task-detail/task-detail-agent.ts`

| 要修改的内容 | 搜索关键词 | 行数范围 |
|-------------|-----------|---------|
| 智能体配置（模型、温度等） | `【智能体创建位置 - 智能体3】` | constructor |
| 系统提示词 | `【提示词编写位置 - 智能体3】` | systemPrompt |
| 工具函数 | `【工具调用位置 - 智能体3】` | initializeTools() |

**使用场景**：任务详情页面 (`/task/:projectId/:managerId/:taskId`)

---

## 📝 修改步骤

### 1. 修改提示词

```bash
# 步骤 1：打开文件
code apps/api/src/agents/task-creation/task-creation-agent.ts

# 步骤 2：搜索（Ctrl+F 或 Cmd+F）
【提示词编写位置 - 智能体1】

# 步骤 3：修改 systemPrompt 字段的内容

# 步骤 4：保存并重启服务
cd apps/api && pnpm dev
```

---

### 2. 添加工具函数

```bash
# 步骤 1：打开文件
code apps/api/src/agents/task-creation/task-creation-agent.ts

# 步骤 2：搜索
【工具调用位置 - 智能体1】

# 步骤 3：在 initializeTools() 方法中添加工具

# 步骤 4：保存并重启服务
cd apps/api && pnpm dev
```

---

### 3. 调整智能体参数

```bash
# 步骤 1：打开文件
code apps/api/src/agents/task-creation/task-creation-agent.ts

# 步骤 2：搜索
【智能体创建位置 - 智能体1】

# 步骤 3：修改 modelName、temperature、maxIterations 等参数

# 步骤 4：保存并重启服务
cd apps/api && pnpm dev
```

---

## 🔍 VS Code 快速搜索技巧

### 全局搜索（跨文件）

1. 按 `Ctrl+Shift+F`（Windows/Linux）或 `Cmd+Shift+F`（Mac）
2. 输入：`【提示词编写位置`
3. 会显示所有三个智能体的提示词位置

### 文件内搜索

1. 打开智能体文件
2. 按 `Ctrl+F`（Windows/Linux）或 `Cmd+F`（Mac）
3. 输入：`【提示词编写位置`
4. 按 Enter 跳转

---

## 📚 完整文档

- **详细修改指南**：`AGENT_CODE_MODIFICATION_GUIDE.md`
- **使用示例**：`AGENT_USAGE_EXAMPLES.md`
- **框架文档**：`apps/api/src/agents/README.md`

---

## 🚀 测试命令

```bash
# 启动服务
cd apps/api && pnpm dev

# 测试智能体 1
curl -X POST http://localhost:4000/api/agents/task-creation/analyze \
  -H "Content-Type: application/json" \
  -d '{"description": "开发用户管理系统"}'

# 测试智能体 2
curl -X POST http://localhost:4000/api/agents/ceo-view/analyze-portfolio \
  -H "Content-Type: application/json"

# 测试智能体 3
curl -X POST http://localhost:4000/api/agents/task-detail/guidance \
  -H "Content-Type: application/json" \
  -d '{"taskId": "task-123", "question": "如何开始？", "userRole": "employee"}'
```

---

## 💡 提示

- 所有搜索关键词都使用中文方括号 `【】`，便于识别
- 每个位置都有详细的注释说明
- 修改后记得重启服务才能生效
- 建议先在测试环境验证修改效果
