# Agent 代码修改快速指南

本文档提供三个智能体代码的快速定位和修改指南。

---

## 📍 快速定位标记

在代码中搜索以下标记可以快速定位到需要修改的位置：

### 智能体 1：任务创建智能体

| 标记 | 位置 | 说明 |
|------|------|------|
| `【智能体创建位置 - 智能体1】` | constructor | 配置智能体基本参数 |
| `【提示词编写位置 - 智能体1】` | systemPrompt | 编写和修改提示词 |
| `【工具调用位置 - 智能体1】` | initializeTools() | 添加和配置工具 |

**文件路径**：`apps/api/src/agents/task-creation/task-creation-agent.ts`

---

### 智能体 2：总经理视图智能体

| 标记 | 位置 | 说明 |
|------|------|------|
| `【智能体创建位置 - 智能体2】` | constructor | 配置智能体基本参数 |
| `【提示词编写位置 - 智能体2】` | systemPrompt | 编写和修改提示词 |
| `【工具调用位置 - 智能体2】` | initializeTools() | 添加和配置工具 |

**文件路径**：`apps/api/src/agents/ceo-view/ceo-view-agent.ts`

---

### 智能体 3：任务详情智能体（经理智能体）

| 标记 | 位置 | 说明 |
|------|------|------|
| `【智能体创建位置 - 智能体3】` | constructor | 配置智能体基本参数 |
| `【提示词编写位置 - 智能体3】` | systemPrompt | 编写和修改提示词 |
| `【工具调用位置 - 智能体3】` | initializeTools() | 添加和配置工具 |

**文件路径**：`apps/api/src/agents/task-detail/task-detail-agent.ts`

---

## 🔧 常见修改场景

### 场景 1：修改提示词

**步骤**：

1. 打开对应的智能体文件
2. 搜索 `【提示词编写位置 - 智能体X】`（X 为 1、2 或 3）
3. 在 `systemPrompt` 字段中修改提示词内容
4. 保存并重启服务

**示例**：

```typescript
// 搜索：【提示词编写位置 - 智能体1】
systemPrompt: `你是一个专业的项目管理助手...

// 在这里修改提示词内容
你的主要职责：
1. 理解用户的任务描述...
2. 分析任务的复杂度...
...
`,
```

**提示词修改建议**：
- 使用清晰、具体的语言
- 提供具体的示例和模板
- 根据实际使用反馈不断优化
- 区分不同角色的需求（如经理 vs 员工）

---

### 场景 2：添加工具函数

**步骤**：

1. 打开对应的智能体文件
2. 搜索 `【工具调用位置 - 智能体X】`
3. 在 `initializeTools()` 方法中添加工具
4. 保存并重启服务

**示例**：

```typescript
// 搜索：【工具调用位置 - 智能体1】
private initializeTools(): StructuredTool[] {
  import { DynamicStructuredTool } from '@langchain/core/tools';
  
  return [
    new DynamicStructuredTool({
      name: "analyze_task_complexity",
      description: "分析任务的复杂度，返回简单/中等/复杂",
      schema: z.object({
        description: z.string().describe("任务描述"),
      }),
      func: async ({ description }) => {
        // 实现工具逻辑
        // 可以调用数据库、外部 API 等
        return JSON.stringify({
          complexity: "中等",
          reason: "任务涉及多个模块",
        });
      },
    }),
    // 添加更多工具...
  ];
}
```

**工具实现建议**：
- 工具名称使用 snake_case（如 `get_task_details`）
- 工具描述要清晰，帮助 LLM 理解何时使用
- 使用 zod schema 定义参数类型
- 返回结构化的 JSON 数据
- 添加错误处理

---

### 场景 3：调整智能体参数

**步骤**：

1. 打开对应的智能体文件
2. 搜索 `【智能体创建位置 - 智能体X】`
3. 在 `AgentConfig` 对象中修改参数
4. 保存并重启服务

**示例**：

```typescript
// 搜索：【智能体创建位置 - 智能体1】
const config: AgentConfig = {
  name: 'TaskCreationAgent',
  description: '任务创建智能体...',
  systemPrompt: `...`,
  tools: this.initializeTools(),
  
  // 修改这些参数
  modelName: 'gpt-4.1-mini',    // 可选：gpt-4.1-nano（更快更便宜）
  temperature: 0.7,              // 0-1，越高越随机
  maxIterations: 10,             // 最大迭代次数
};
```

**参数说明**：

| 参数 | 说明 | 建议值 |
|------|------|--------|
| `modelName` | LLM 模型名称 | `gpt-4.1-mini`（平衡）<br>`gpt-4.1-nano`（快速） |
| `temperature` | 温度参数 | 创意任务：0.7-0.9<br>确定性任务：0.3-0.5 |
| `maxIterations` | 最大迭代次数 | 简单任务：5-10<br>复杂任务：10-20 |

---

## 📋 三个智能体的详细说明

### 智能体 1：任务创建智能体

**文件**：`apps/api/src/agents/task-creation/task-creation-agent.ts`

**使用场景**：创建任务页面 (`NewTaskDialog.tsx`)

**主要方法**：
- `analyzeTask(description)` - 分析任务描述
- `generateTaskSuggestions(description, constraints)` - 生成任务建议

**建议的工具**：
- `analyzeTaskComplexity` - 分析任务复杂度
- `suggestTeamStructure` - 建议团队结构
- `generateTaskBreakdown` - 生成任务分解
- `estimateTimeline` - 估算时间线
- `identifyRisks` - 识别风险

**提示词重点**：
- 项目规划和任务分解
- 资源约束和可行性
- 结构化的建议

---

### 智能体 2：总经理视图智能体

**文件**：`apps/api/src/agents/ceo-view/ceo-view-agent.ts`

**使用场景**：总经理视图页面 (`CEOView.tsx`)

**主要方法**：
- `analyzePortfolio(projectIds)` - 分析项目组合
- `generateExecutiveSummary(period)` - 生成执行摘要
- `identifyResourceIssues()` - 识别资源问题
- `provideDecisionSupport(question, context)` - 决策支持
- `compareProjects(projectIds)` - 比较项目

**建议的工具**：
- `getAllProjectsStatus` - 获取所有项目状态
- `analyzeResourceAllocation` - 分析资源分配
- `identifyBottlenecks` - 识别瓶颈
- `generateExecutiveSummary` - 生成执行摘要
- `compareProjectPerformance` - 比较项目表现
- `predictProjectRisks` - 预测项目风险

**提示词重点**：
- 高层次的战略视角
- 基于数据的客观分析
- 较低的温度参数（0.5）保持一致性

---

### 智能体 3：任务详情智能体（经理智能体）

**文件**：`apps/api/src/agents/task-detail/task-detail-agent.ts`

**使用场景**：任务详情页面 (`/task/:projectId/:managerId/:taskId`)

**主要方法**：
- `provideGuidance(taskId, question, userRole)` - 提供执行指导
- `generateDocument(taskId, documentType)` - 生成文档
- `analyzeProgress(taskId, currentStatus)` - 分析进度
- `identifyBlockers(taskId, description)` - 识别阻塞
- `validateDeliverable(taskId, deliverable)` - 验证交付物
- `suggestNextSteps(taskId, currentStage)` - 建议下一步
- `generateChecklist(taskId, taskType)` - 生成检查清单

**建议的工具**：
- `getTaskDetails` - 获取任务详细信息
- `updateTaskStatus` - 更新任务状态
- `generateTaskDocument` - 生成任务文档
- `searchBestPractices` - 搜索最佳实践
- `analyzeTaskProgress` - 分析任务进度
- `identifyBlockers` - 识别阻塞因素
- `validateDeliverable` - 验证交付物

**提示词重点**：
- 关注具体执行细节
- 区分经理和员工角色
- 覆盖任务全生命周期

---

## 🛠️ 工具实现模板

### 模板 1：数据查询工具

```typescript
new DynamicStructuredTool({
  name: "get_data",
  description: "从数据库获取数据",
  schema: z.object({
    id: z.string().describe("数据 ID"),
  }),
  func: async ({ id }) => {
    try {
      // 从数据库查询
      // const data = await db.collection.findById(id);
      
      return JSON.stringify({
        success: true,
        data: {
          // 返回的数据
        },
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
}),
```

---

### 模板 2：数据更新工具

```typescript
new DynamicStructuredTool({
  name: "update_data",
  description: "更新数据库中的数据",
  schema: z.object({
    id: z.string().describe("数据 ID"),
    updates: z.object({}).describe("要更新的字段"),
  }),
  func: async ({ id, updates }) => {
    try {
      // 更新数据库
      // await db.collection.updateById(id, updates);
      
      return JSON.stringify({
        success: true,
        message: "更新成功",
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
}),
```

---

### 模板 3：分析工具

```typescript
new DynamicStructuredTool({
  name: "analyze_data",
  description: "分析数据并返回洞察",
  schema: z.object({
    data: z.string().describe("要分析的数据"),
  }),
  func: async ({ data }) => {
    try {
      // 执行分析逻辑
      // const analysis = await analyzeService.analyze(data);
      
      return JSON.stringify({
        summary: "分析摘要",
        insights: [
          "洞察 1",
          "洞察 2",
        ],
        recommendations: [
          "建议 1",
          "建议 2",
        ],
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
}),
```

---

## 🔍 使用 VS Code 快速搜索

### 方法 1：全局搜索

1. 按 `Ctrl+Shift+F`（Windows/Linux）或 `Cmd+Shift+F`（Mac）
2. 输入搜索标记，如 `【提示词编写位置 - 智能体1】`
3. 点击结果直接跳转

### 方法 2：文件内搜索

1. 打开对应的智能体文件
2. 按 `Ctrl+F`（Windows/Linux）或 `Cmd+F`（Mac）
3. 输入搜索标记
4. 按 Enter 跳转

---

## 📝 修改后的测试

修改代码后，建议进行以下测试：

### 1. 启动服务

```bash
cd apps/api
pnpm dev
```

### 2. 测试 API

```bash
# 测试任务创建智能体
curl -X POST http://localhost:4000/api/agents/task-creation/analyze \
  -H "Content-Type: application/json" \
  -d '{"description": "开发一个用户管理系统"}'

# 测试总经理视图智能体
curl -X POST http://localhost:4000/api/agents/ceo-view/analyze-portfolio \
  -H "Content-Type: application/json"

# 测试任务详情智能体
curl -X POST http://localhost:4000/api/agents/task-detail/guidance \
  -H "Content-Type: application/json" \
  -d '{"taskId": "task-123", "question": "如何开始？", "userRole": "employee"}'
```

### 3. 查看日志

服务启动后会输出详细的日志，包括：
- Agent 初始化信息
- 工具调用记录
- LLM 响应内容
- 错误信息

---

## 🚨 常见问题

### 问题 1：修改提示词后没有生效

**原因**：需要重启服务

**解决**：
```bash
# 停止服务（Ctrl+C）
# 重新启动
pnpm dev
```

---

### 问题 2：工具调用失败

**原因**：
- 工具名称不符合规范（应使用 snake_case）
- schema 定义错误
- func 函数返回格式不正确

**解决**：
- 检查工具名称是否使用 snake_case
- 确保 schema 使用 zod 正确定义
- 确保 func 返回 JSON 字符串

---

### 问题 3：LLM 响应不符合预期

**原因**：
- 提示词不够清晰
- 温度参数设置不当
- 缺少必要的上下文

**解决**：
- 优化提示词，提供更多示例
- 调整温度参数（确定性任务降低温度）
- 在 prompt 中提供更多上下文信息

---

## 📚 相关资源

- [Agent 框架文档](./apps/api/src/agents/README.md)
- [使用示例文档](./AGENT_USAGE_EXAMPLES.md)
- [LangChain 官方文档](https://js.langchain.com/)
- [OpenAI API 文档](https://platform.openai.com/docs)

---

## 💡 最佳实践

1. **提示词编写**
   - 使用清晰、具体的语言
   - 提供具体的示例
   - 定义明确的输出格式
   - 根据反馈持续优化

2. **工具实现**
   - 保持工具的单一职责
   - 返回结构化的数据
   - 添加完善的错误处理
   - 编写清晰的工具描述

3. **参数调整**
   - 根据任务类型选择合适的模型
   - 根据需求调整温度参数
   - 设置合理的迭代次数上限

4. **测试和迭代**
   - 每次修改后进行测试
   - 收集用户反馈
   - 持续优化和改进
   - 记录最佳实践

---

## 🎯 快速开始

1. **选择要修改的智能体**（1、2 或 3）
2. **确定修改类型**（提示词、工具或参数）
3. **使用搜索标记快速定位**
4. **参考模板和示例进行修改**
5. **保存并重启服务**
6. **测试修改效果**
7. **根据反馈继续优化**

祝您修改顺利！如有问题，请参考相关文档或联系开发团队。
