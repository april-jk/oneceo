# OneCEO.ai Agent 框架

基于 LangChain 的智能体框架，为 OneCEO.ai 平台提供三个核心智能体。

## 📋 目录结构

```
agents/
├── base-agent.ts                    # 基础 Agent 抽象类
├── index.ts                         # Agent 管理器和统一导出
├── README.md                        # 本文档
│
├── task-creation/                   # 任务创建智能体
│   ├── task-creation-agent.ts       # 智能体实现
│   ├── tools/                       # 工具目录（待实现）
│   └── prompts/                     # 提示词模板目录（待实现）
│
├── ceo-view/                        # 总经理视图智能体
│   ├── ceo-view-agent.ts            # 智能体实现
│   ├── tools/                       # 工具目录（待实现）
│   └── prompts/                     # 提示词模板目录（待实现）
│
└── task-detail/                     # 任务详情智能体
    ├── task-detail-agent.ts         # 智能体实现
    ├── tools/                       # 工具目录（待实现）
    └── prompts/                     # 提示词模板目录（待实现）
```

## 🤖 三个核心智能体

### 1. 任务创建智能体 (Task Creation Agent)

**使用场景**：创建任务页面 (`NewTaskDialog.tsx`)

**主要职责**：
- 理解用户的任务描述和需求
- 智能分析任务复杂度和所需资源
- 建议合适的经理和员工配置
- 生成任务分解建议
- 估算任务时间和优先级

**API 端点**：
- `POST /api/agents/task-creation/analyze` - 分析任务描述
- `POST /api/agents/task-creation/suggest` - 生成任务建议

**使用示例**：
```typescript
import { taskCreationAgent } from './agents';

// 分析任务
const result = await taskCreationAgent.analyzeTask(
  "开发一个用户管理系统，包括登录、注册、权限管理等功能"
);

// 生成任务建议（带约束条件）
const suggestion = await taskCreationAgent.generateTaskSuggestions(
  "开发用户管理系统",
  {
    budget: 50000,
    deadline: "2024-03-31",
    teamSize: 5
  }
);
```

---

### 2. 总经理视图智能体 (CEO View Agent)

**使用场景**：总经理视图页面 (`CEOView.tsx`)

**主要职责**：
- 提供项目全局视角和战略洞察
- 监控所有项目的整体进度和健康状况
- 识别跨项目的资源冲突和瓶颈
- 提供决策支持和优先级建议
- 生成项目报告和数据分析
- 协助项目间的资源调配

**API 端点**：
- `POST /api/agents/ceo-view/analyze-portfolio` - 分析项目组合
- `POST /api/agents/ceo-view/executive-summary` - 生成执行摘要
- `POST /api/agents/ceo-view/resource-analysis` - 资源分析
- `POST /api/agents/ceo-view/decision-support` - 决策支持
- `POST /api/agents/ceo-view/compare-projects` - 比较项目

**使用示例**：
```typescript
import { ceoViewAgent } from './agents';

// 分析项目组合
const portfolio = await ceoViewAgent.analyzePortfolio(['project-1', 'project-2']);

// 生成每周执行摘要
const summary = await ceoViewAgent.generateExecutiveSummary('weekly');

// 识别资源问题
const resourceIssues = await ceoViewAgent.identifyResourceIssues();

// 提供决策支持
const decision = await ceoViewAgent.provideDecisionSupport(
  "是否应该增加项目 A 的预算？",
  { currentBudget: 100000, requestedIncrease: 20000 }
);
```

---

### 3. 任务详情智能体 (Task Detail Agent)

**使用场景**：任务详情页面 (`TaskDetail.tsx`)  
**路由示例**：`/task/:projectId/:managerId/:taskId` (如 `/task/1/m1/t1`)

**主要职责**：
- 协助经理和员工完成具体任务
- 提供任务执行指导和最佳实践建议
- 解答任务相关的技术和业务问题
- 协助任务进度跟踪和状态更新
- 生成任务文档和交付物
- 识别任务执行中的问题和风险

**API 端点**：
- `POST /api/agents/task-detail/guidance` - 提供执行指导
- `POST /api/agents/task-detail/generate-document` - 生成任务文档
- `POST /api/agents/task-detail/analyze-progress` - 分析任务进度
- `POST /api/agents/task-detail/identify-blockers` - 识别阻塞因素
- `POST /api/agents/task-detail/validate-deliverable` - 验证交付物
- `POST /api/agents/task-detail/suggest-next-steps` - 建议下一步行动
- `POST /api/agents/task-detail/generate-checklist` - 生成检查清单

**使用示例**：
```typescript
import { taskDetailAgent } from './agents';

// 提供任务指导（经理视角）
const guidance = await taskDetailAgent.provideGuidance(
  'task-123',
  '如何协调团队成员完成这个任务？',
  'manager'
);

// 生成任务计划文档
const plan = await taskDetailAgent.generateDocument('task-123', 'plan');

// 分析任务进度
const progress = await taskDetailAgent.analyzeProgress('task-123', {
  completedSteps: 5,
  totalSteps: 10,
  daysElapsed: 7
});

// 识别阻塞因素
const blockers = await taskDetailAgent.identifyBlockers(
  'task-123',
  '团队成员反馈 API 文档不完整，无法继续开发'
);

// 验证交付物
const validation = await taskDetailAgent.validateDeliverable(
  'task-123',
  '已完成用户登录功能，包括前端页面和后端 API'
);
```

---

## 🛠️ 基础架构

### BaseAgent 类

所有智能体都继承自 `BaseAgent` 抽象类，提供统一的接口和功能：

```typescript
abstract class BaseAgent {
  // 初始化 Agent
  protected async initialize(): Promise<void>
  
  // 执行 Agent
  async execute(input: string, chatHistory?: BaseMessage[]): Promise<AgentResult>
  
  // 流式执行（用于实时响应）
  async executeStream(
    input: string,
    chatHistory?: BaseMessage[],
    onToken?: (token: string) => void
  ): Promise<AgentResult>
  
  // 获取 Agent 信息
  getInfo(): AgentInfo
}
```

### AgentManager 类

提供统一的 Agent 访问接口：

```typescript
import { AgentManager } from './agents';

// 获取特定智能体
const taskAgent = AgentManager.getTaskCreationAgent();
const ceoAgent = AgentManager.getCEOViewAgent();
const detailAgent = AgentManager.getTaskDetailAgent();

// 根据类型获取智能体
const agent = AgentManager.getAgent('task-creation');

// 获取所有智能体信息
const info = AgentManager.getAllAgentsInfo();
```

---

## 🔧 配置

### 环境变量

在 `.env` 文件中配置：

```bash
# OpenAI API Key（必需）
OPENAI_API_KEY=your_openai_api_key

# LLM 模型配置（可选）
DEFAULT_MODEL=gpt-4.1-mini
DEFAULT_TEMPERATURE=0.7
```

### Agent 配置

每个 Agent 可以通过 `AgentConfig` 进行配置：

```typescript
interface AgentConfig {
  name: string;              // Agent 名称
  description: string;       // Agent 描述
  systemPrompt: string;      // 系统提示词
  tools: StructuredTool[];   // 可用工具列表
  modelName?: string;        // LLM 模型名称
  temperature?: number;      // LLM 温度参数
  maxIterations?: number;    // 最大迭代次数
}
```

---

## 📝 待完善的功能

### 1. 工具实现 (Tools)

每个智能体都需要实现具体的工具函数，用于与系统交互：

**任务创建智能体工具**：
- `analyzeTaskComplexity` - 分析任务复杂度
- `suggestTeamStructure` - 建议团队结构
- `generateTaskBreakdown` - 生成任务分解
- `estimateTimeline` - 估算时间线
- `identifyRisks` - 识别风险

**总经理视图智能体工具**：
- `getAllProjectsStatus` - 获取所有项目状态
- `analyzeResourceAllocation` - 分析资源分配
- `identifyBottlenecks` - 识别瓶颈
- `generateExecutiveSummary` - 生成执行摘要
- `compareProjectPerformance` - 比较项目表现
- `predictProjectRisks` - 预测项目风险

**任务详情智能体工具**：
- `getTaskDetails` - 获取任务详细信息
- `updateTaskStatus` - 更新任务状态
- `generateTaskDocument` - 生成任务文档
- `searchBestPractices` - 搜索最佳实践
- `analyzeTaskProgress` - 分析任务进度
- `identifyBlockers` - 识别阻塞因素

### 2. 提示词优化

需要根据实际使用情况优化每个智能体的系统提示词，包括：
- 更精确的角色定义
- 更详细的工作流程
- 更多的示例和模板
- 更好的上下文理解

### 3. 意图识别

需要实现意图识别机制，自动判断用户的请求类型：
- 信息查询
- 任务执行
- 决策支持
- 文档生成
- 问题解决

### 4. 记忆管理

需要实现对话历史和上下文管理：
- 短期记忆（当前对话）
- 长期记忆（历史交互）
- 上下文压缩和总结

### 5. 错误处理和重试

需要完善错误处理机制：
- 自动重试失败的请求
- 降级策略
- 用户友好的错误提示

---

## 🚀 集成到 API 服务

在 `src/index.ts` 中集成 Agent 路由：

```typescript
import agentRoutes from './routes/agent-routes';

// 注册 Agent 路由
app.use('/api/agents', agentRoutes);
```

---

## 📚 相关文档

- [LangChain 官方文档](https://js.langchain.com/)
- [OpenAI API 文档](https://platform.openai.com/docs)
- [项目整体架构文档](../../README.md)

---

## 🤝 贡献指南

在完善智能体功能时，请遵循以下原则：

1. **保持一致性**：所有智能体应遵循相同的接口和模式
2. **注释清晰**：每个函数都应有详细的 JSDoc 注释
3. **类型安全**：充分利用 TypeScript 的类型系统
4. **错误处理**：妥善处理所有可能的错误情况
5. **测试覆盖**：为关键功能编写单元测试

---

## 📞 联系方式

如有问题或建议，请联系开发团队。
