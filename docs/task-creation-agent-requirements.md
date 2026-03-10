# Altus 新建任务智能体 - 完整开发文档

## 目录

1. 系统架构
2. 三层 Agent 架构
3. 工作流程
4. API 设计
5. 数据模型
6. 核心模块实现
7. 工具集定义
8. 前端集成
9. 部署和配置
10. 常见问题

## 系统架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     前端应用 (React/Vue)                      │
│                      - 任务输入框                             │
│                      - 实时消息流显示                          │
│                      - 任务计划确认                            │
└─────────────────────────────────────────────────────────────┘
                              ↓ WebSocket
┌─────────────────────────────────────────────────────────────┐
│                  FastAPI WebSocket 服务                       │
│                      - 连接管理                               │
│                      - 消息路由                               │
│                      - 流式推送                               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              新建任务服务 (TaskCreationService)                │
│                   - 任务创建流程管理                           │
│                   - Agent 编排                                │
│                   - 消息推送                                  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                       三层 Agent 系统                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │    Layer 1: 根 Agent (Intent Recognition Agent)       │   │
│  │              - 意图识别                                │   │
│  │              - 任务分类                                │   │
│  │              - 调用子 Agent                            │   │
│  └──────────────────────────────────────────────────────┘   │
│                              ↓                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │       Layer 2: 子 Agent (Planning Agent)              │   │
│  │              - 信息收集                                │   │
│  │              - 调用搜索 API（如需要）                   │   │
│  │              - 任务规划                                │   │
│  │              - 用户澄清                                │   │
│  │              - 调用孙子 Agent                          │   │
│  └──────────────────────────────────────────────────────┘   │
│                              ↓                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │    Layer 3: 孙子 Agent (Execution Plan Agent)         │   │
│  │              - 生成结构化执行计划                       │   │
│  │              - 验证计划可行性                           │   │
│  │              - 返回最终计划                             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                       数据库 & 存储                            │
│                      - 任务记录                               │
│                      - 对话历史                               │
│                      - 任务计划                               │
└─────────────────────────────────────────────────────────────┘
```

## 三层 Agent 架构

### 架构设计原则

采用**解析层-规划层-执行层**的三层结构：

1. **Layer 1 (根 Agent)**: 意图识别和路由
2. **Layer 2 (子 Agent)**: 信息收集和任务规划
3. **Layer 3 (孙子 Agent)**: 执行计划生成

### 意图分类

```python
class IntentType(str, Enum):
    """意图类型枚举"""
    # 研究和分析
    RESEARCH = "research"  # 行业调研、市场分析
    DATA_ANALYSIS = "data_analysis"  # 数据分析、统计
    COMPETITOR_ANALYSIS = "competitor_analysis"  # 竞争对手分析
    
    # 优化和改进
    SEO_OPTIMIZATION = "seo_optimization"  # SEO 优化
    CONTENT_OPTIMIZATION = "content_optimization"  # 内容优化
    
    # 创建和生成
    CONTENT_CREATION = "content_creation"  # 内容创建
    DESIGN_CREATION = "design_creation"  # 设计创建（图表、PPT等）
    SOFTWARE_DEVELOPMENT = "software_development"  # 软件开发
    
    # 策略和规划
    STRATEGY_PLANNING = "strategy_planning"  # 策略规划
    BUSINESS_PLANNING = "business_planning"  # 商业规划
    
    # 其他
    OTHER = "other"  # 其他类型
```

### 三层 Agent 详细设计

#### Layer 1: 根 Agent (IntentRecognitionAgent)

**职责**：
- 解析用户输入
- 识别意图类型
- 提取关键信息
- 决定是否需要澄清
- 路由到对应的子 Agent

**系统提示词**：
```
你是 Altus 系统的意图识别 Agent。你的职责是：

1. 理解用户的自然语言输入
2. 识别用户的意图类型（研究、分析、优化、创建、策略等）
3. 提取关键信息（目标、范围、约束等）
4. 如果信息不足，向用户提问澄清
5. 将识别结果传递给下一层 Agent

意图类型包括：
- research: 行业调研、市场分析
- data_analysis: 数据分析、统计
- competitor_analysis: 竞争对手分析
- seo_optimization: SEO 优化
- content_optimization: 内容优化
- content_creation: 内容创建
- design_creation: 设计创建（图表、PPT等）
- software_development: 软件开发
- strategy_planning: 策略规划
- business_planning: 商业规划
- other: 其他类型

重要原则：
- 高自主性：尽可能根据现有信息做出判断
- 高清晰度：如果不确定，主动向用户提问
- 简洁明了：用户应该能看到你在做什么
```

**工具集**：
- `search`: 搜索相关信息（可选）
- `ask_user`: 向用户提问

**输出格式**：
```json
{
  "intent_type": "research",
  "confidence": 0.95,
  "key_info": {
    "target": "Python 开发行业",
    "scope": "2024年市场趋势",
    "constraints": "中文资源优先"
  },
  "clarification_needed": false,
  "next_agent": "planning_agent"
}
```

#### Layer 2: 子 Agent (PlanningAgent)

**职责**：
- 接收意图识别结果
- 收集更多信息（调用搜索 API）
- 与用户交互澄清细节
- 生成结构化任务描述
- 调用孙子 Agent 生成执行计划

**系统提示词**：
```
你是 Altus 系统的规划 Agent。你的职责是：

1. 接收意图识别结果
2. 根据意图类型，确定需要的信息
3. 调用搜索 API 获取最新信息（如需要）
4. 与用户交互，澄清任务细节
5. 生成结构化的任务描述
6. 将任务描述传递给执行计划 Agent

工作流程：
- 分析意图类型和关键信息
- 确定是否需要搜索（根据意图类型和信息完整性）
- 如需要，调用搜索 API
- 根据搜索结果和用户输入，生成任务描述
- 如信息不足，向用户提问
- 最后，调用孙子 Agent 生成执行计划

重要原则：
- 搜索决策：只在必要时调用搜索（例如：研究、分析类任务）
- 用户交互：主动澄清不清楚的地方
- 信息整合：综合搜索结果和用户输入
- 结构化输出：生成清晰的任务描述
```

**工具集**：
- `search`: 搜索相关信息
- `ask_user`: 向用户提问
- `call_execution_plan_agent`: 调用孙子 Agent

**输出格式**：
```json
{
  "task_description": {
    "title": "Python 开发行业市场调研",
    "objective": "了解2024年Python开发行业的市场趋势和机会",
    "scope": "中文市场，重点关注Web开发和数据科学领域",
    "deliverables": ["市场分析报告", "竞争对手分析", "机会识别"],
    "constraints": ["时间：2周", "资源：1名研究员"]
  },
  "next_step": "call_execution_plan_agent"
}
```

#### Layer 3: 孙子 Agent (ExecutionPlanAgent)

**职责**：
- 生成结构化执行计划
- 验证计划可行性
- 返回最终计划

**系统提示词**：
```
你是 Altus 系统的执行计划 Agent。你的职责是：

1. 接收任务描述
2. 生成详细的执行计划
3. 将任务分解为具体的步骤
4. 为每个步骤分配经理和员工
5. 估算时间和资源需求
6. 验证计划的可行性

执行计划应包括：
- 任务分解（managers 和 tasks）
- 时间估算
- 资源需求
- 依赖关系
- 风险识别

输出格式必须符合系统的数据模型。
```

**工具集**：
- `validate_plan`: 验证计划可行性
- `estimate_resources`: 估算资源需求

**输出格式**：
```json
{
  "project": {
    "title": "Python 开发行业市场调研",
    "description": "了解2024年Python开发行业的市场趋势和机会",
    "managers": [
      {
        "id": "m1",
        "name": "市场研究经理",
        "description": "负责市场调研和分析",
        "tasks": [
          {
            "id": "t1",
            "title": "行业趋势分析",
            "description": "分析Python开发行业的最新趋势",
            "estimated_hours": 16,
            "deliverables": ["趋势分析报告"]
          }
        ]
      }
    ]
  }
}
```

## 工作流程

### 完整流程图

```
用户输入
  ↓
Layer 1: 意图识别
  ├─ 识别意图类型
  ├─ 提取关键信息
  └─ 是否需要澄清？
      ├─ 是 → 向用户提问 → 回到 Layer 1
      └─ 否 → 传递给 Layer 2
  ↓
Layer 2: 任务规划
  ├─ 是否需要搜索？
  │   ├─ 是 → 调用搜索 API
  │   └─ 否 → 跳过
  ├─ 生成任务描述
  └─ 是否需要澄清？
      ├─ 是 → 向用户提问 → 回到 Layer 2
      └─ 否 → 传递给 Layer 3
  ↓
Layer 3: 执行计划生成
  ├─ 任务分解
  ├─ 资源估算
  └─ 验证可行性
  ↓
返回给用户确认
  ├─ 用户确认 → 创建任务
  └─ 用户修改 → 回到对应层级
```

## API 设计

### WebSocket 端点

```
POST /ws/task-creation
```

### 消息类型

#### 1. 用户输入消息

```json
{
  "type": "user_input",
  "content": "我想做一个Python开发行业的市场调研"
}
```

#### 2. Agent 消息

```json
{
  "type": "agent_message",
  "agent": "intent_recognition",
  "content": "我理解您想要进行Python开发行业的市场调研。让我为您规划这个任务...",
  "metadata": {
    "intent_type": "research",
    "confidence": 0.95
  }
}
```

#### 3. 澄清请求

```json
{
  "type": "clarification_request",
  "agent": "planning",
  "question": "您希望重点关注哪些Python开发领域？（Web开发、数据科学、机器学习等）",
  "options": ["Web开发", "数据科学", "机器学习", "全部"]
}
```

#### 4. 计划生成完成

```json
{
  "type": "plan_generated",
  "plan": {
    "project": { ... }
  }
}
```

#### 5. 错误消息

```json
{
  "type": "error",
  "message": "处理失败，请重试"
}
```

## 数据模型

### Project 模型

```json
{
  "id": "project-uuid",
  "title": "项目标题",
  "description": "项目描述",
  "created_at": "2024-01-01T00:00:00Z",
  "managers": [...]
}
```

### Manager 模型

```json
{
  "id": "m1",
  "name": "经理名称",
  "description": "经理职责描述",
  "tasks": [...]
}
```

### Task 模型

```json
{
  "id": "t1",
  "title": "任务标题",
  "description": "任务描述",
  "estimated_hours": 16,
  "deliverables": ["交付物1", "交付物2"],
  "status": "pending"
}
```

## 核心模块实现

### 1. TaskCreationService

负责整个任务创建流程的编排。

### 2. IntentRecognitionAgent

负责意图识别和路由。

### 3. PlanningAgent

负责任务规划和信息收集。

### 4. ExecutionPlanAgent

负责生成执行计划。

### 5. WebSocket 管理器

负责 WebSocket 连接管理和消息推送。

## 工具集定义

### search 工具

```python
def search(query: str, num_results: int = 5) -> List[Dict]:
    """搜索相关信息"""
    # 调用搜索 API
    pass
```

### ask_user 工具

```python
def ask_user(question: str, options: List[str] = None) -> str:
    """向用户提问"""
    # 通过 WebSocket 发送澄清请求
    # 等待用户回复
    pass
```

### call_execution_plan_agent 工具

```python
def call_execution_plan_agent(task_description: Dict) -> Dict:
    """调用执行计划 Agent"""
    # 调用 Layer 3 Agent
    pass
```

## 前端集成

### WebSocket 连接

```typescript
const ws = new WebSocket('ws://localhost:8000/ws/task-creation');

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  switch (message.type) {
    case 'agent_message':
      // 显示 Agent 消息
      break;
    case 'clarification_request':
      // 显示澄清问题
      break;
    case 'plan_generated':
      // 显示生成的计划
      break;
    case 'error':
      // 显示错误
      break;
  }
};

// 发送用户输入
ws.send(JSON.stringify({
  type: 'user_input',
  content: '我想做一个市场调研'
}));
```

## 部署和配置

### 环境变量

```bash
OPENAI_API_KEY=your-api-key
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
```

### 启动服务

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

## 常见问题

### 1. 如何处理用户中断？

在任何层级，用户都可以中断流程并重新开始。

### 2. 如何处理超时？

设置合理的超时时间，超时后向用户报告并提供重试选项。

### 3. 如何优化性能？

- 使用缓存减少重复搜索
- 异步处理提高响应速度
- 流式输出提升用户体验

---

**文档版本**: 1.0  
**最后更新**: 2024-02-04
