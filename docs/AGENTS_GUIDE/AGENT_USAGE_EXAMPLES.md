# OneCEO.ai Agent 使用示例

本文档提供三个智能体的详细使用示例和 API 调用方法。

## 📋 目录

1. [任务创建智能体](#1-任务创建智能体)
2. [总经理视图智能体](#2-总经理视图智能体)
3. [任务详情智能体](#3-任务详情智能体)
4. [前端集成示例](#4-前端集成示例)
5. [WebSocket 实时交互](#5-websocket-实时交互)

---

## 1. 任务创建智能体

### 使用场景

在创建任务对话框 (`NewTaskDialog.tsx`) 中，用户输入任务描述后，智能体会：
- 分析任务的复杂度和需求
- 建议合适的团队结构
- 提供任务分解建议
- 估算时间和优先级

### API 调用示例

#### 1.1 分析任务描述

```bash
curl -X POST http://localhost:4000/api/agents/task-creation/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "description": "开发一个电商平台，包括商品管理、订单处理、支付集成、用户评价等功能"
  }'
```

**响应示例**：
```json
{
  "success": true,
  "data": {
    "output": "根据您的描述，这是一个中等到复杂的项目...",
    "intermediateSteps": [...]
  }
}
```

#### 1.2 生成任务建议（带约束条件）

```bash
curl -X POST http://localhost:4000/api/agents/task-creation/suggest \
  -H "Content-Type: application/json" \
  -d '{
    "description": "开发电商平台",
    "constraints": {
      "budget": 100000,
      "deadline": "2024-06-30",
      "teamSize": 8
    }
  }'
```

### 前端集成示例 (React)

```typescript
// NewTaskDialog.tsx
import { useState } from 'react';

function NewTaskDialog() {
  const [description, setDescription] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);

  const analyzeTask = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/agents/task-creation/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      
      const result = await response.json();
      if (result.success) {
        setAnalysis(result.data.output);
      }
    } catch (error) {
      console.error('分析失败:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="描述您的任务..."
      />
      <button onClick={analyzeTask} disabled={loading}>
        {loading ? '分析中...' : 'AI 分析'}
      </button>
      {analysis && (
        <div className="analysis-result">
          <h3>AI 分析结果</h3>
          <p>{analysis}</p>
        </div>
      )}
    </div>
  );
}
```

---

## 2. 总经理视图智能体

### 使用场景

在总经理视图页面 (`CEOView.tsx`) 中，智能体提供：
- 项目组合的整体分析
- 资源分配优化建议
- 执行摘要报告
- 战略决策支持

### API 调用示例

#### 2.1 分析项目组合

```bash
curl -X POST http://localhost:4000/api/agents/ceo-view/analyze-portfolio \
  -H "Content-Type: application/json" \
  -d '{
    "projectIds": ["project-1", "project-2", "project-3"]
  }'
```

#### 2.2 生成执行摘要

```bash
curl -X POST http://localhost:4000/api/agents/ceo-view/executive-summary \
  -H "Content-Type: application/json" \
  -d '{
    "period": "weekly"
  }'
```

**period 可选值**：`daily`, `weekly`, `monthly`

#### 2.3 资源分析

```bash
curl -X POST http://localhost:4000/api/agents/ceo-view/resource-analysis \
  -H "Content-Type: application/json"
```

#### 2.4 决策支持

```bash
curl -X POST http://localhost:4000/api/agents/ceo-view/decision-support \
  -H "Content-Type: application/json" \
  -d '{
    "question": "是否应该增加项目 A 的预算以加快进度？",
    "context": {
      "projectName": "电商平台开发",
      "currentBudget": 100000,
      "requestedIncrease": 30000,
      "currentProgress": 0.6,
      "deadline": "2024-06-30"
    }
  }'
```

#### 2.5 比较项目表现

```bash
curl -X POST http://localhost:4000/api/agents/ceo-view/compare-projects \
  -H "Content-Type: application/json" \
  -d '{
    "projectIds": ["project-1", "project-2"]
  }'
```

### 前端集成示例 (React)

```typescript
// CEOView.tsx
import { useState, useEffect } from 'react';

function CEOView() {
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(false);

  const generateWeeklySummary = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/agents/ceo-view/executive-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: 'weekly' }),
      });
      
      const result = await response.json();
      if (result.success) {
        setSummary(result.data.output);
      }
    } catch (error) {
      console.error('生成摘要失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const askForDecisionSupport = async (question: string) => {
    const response = await fetch('/api/agents/ceo-view/decision-support', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    
    const result = await response.json();
    return result.data.output;
  };

  return (
    <div>
      <button onClick={generateWeeklySummary}>
        生成每周摘要
      </button>
      {loading && <p>生成中...</p>}
      {summary && (
        <div className="summary">
          <h2>每周执行摘要</h2>
          <pre>{summary}</pre>
        </div>
      )}
    </div>
  );
}
```

---

## 3. 任务详情智能体

### 使用场景

在任务详情页面 (`/task/:projectId/:managerId/:taskId`) 中，智能体协助：
- 提供任务执行指导
- 生成任务相关文档
- 分析任务进度
- 识别和解决阻塞问题
- 验证交付物质量

### API 调用示例

#### 3.1 获取任务执行指导

```bash
# 员工视角
curl -X POST http://localhost:4000/api/agents/task-detail/guidance \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task-123",
    "question": "如何实现用户登录功能的 JWT 认证？",
    "userRole": "employee"
  }'

# 经理视角
curl -X POST http://localhost:4000/api/agents/task-detail/guidance \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task-123",
    "question": "如何协调团队成员完成这个任务？",
    "userRole": "manager"
  }'
```

#### 3.2 生成任务文档

```bash
# 生成任务计划
curl -X POST http://localhost:4000/api/agents/task-detail/generate-document \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task-123",
    "documentType": "plan"
  }'

# 生成进度报告
curl -X POST http://localhost:4000/api/agents/task-detail/generate-document \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task-123",
    "documentType": "progress"
  }'
```

**documentType 可选值**：`plan`, `progress`, `deliverable`, `summary`

#### 3.3 分析任务进度

```bash
curl -X POST http://localhost:4000/api/agents/task-detail/analyze-progress \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task-123",
    "currentStatus": {
      "completedSteps": 7,
      "totalSteps": 10,
      "daysElapsed": 12,
      "estimatedDays": 15
    }
  }'
```

#### 3.4 识别阻塞因素

```bash
curl -X POST http://localhost:4000/api/agents/task-detail/identify-blockers \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task-123",
    "description": "第三方 API 文档不完整，无法完成支付功能集成"
  }'
```

#### 3.5 验证交付物

```bash
curl -X POST http://localhost:4000/api/agents/task-detail/validate-deliverable \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task-123",
    "deliverable": "已完成用户登录功能，包括：\n1. 前端登录表单和验证\n2. 后端 JWT 认证 API\n3. Token 刷新机制\n4. 单元测试覆盖率 85%"
  }'
```

#### 3.6 建议下一步行动

```bash
curl -X POST http://localhost:4000/api/agents/task-detail/suggest-next-steps \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task-123",
    "currentStage": "executing"
  }'
```

**currentStage 可选值**：`planning`, `executing`, `reviewing`, `completed`

#### 3.7 生成任务检查清单

```bash
curl -X POST http://localhost:4000/api/agents/task-detail/generate-checklist \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task-123",
    "taskType": "backend-api-development"
  }'
```

### 前端集成示例 (React)

```typescript
// TaskDetail.tsx
import { useState } from 'react';
import { useParams } from 'react-router-dom';

function TaskDetail() {
  const { projectId, managerId, taskId } = useParams();
  const [question, setQuestion] = useState('');
  const [guidance, setGuidance] = useState('');
  const [userRole] = useState<'manager' | 'employee'>('employee');

  const askForGuidance = async () => {
    const response = await fetch('/api/agents/task-detail/guidance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId,
        question,
        userRole,
      }),
    });
    
    const result = await response.json();
    if (result.success) {
      setGuidance(result.data.output);
    }
  };

  const generateDocument = async (type: string) => {
    const response = await fetch('/api/agents/task-detail/generate-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId,
        documentType: type,
      }),
    });
    
    const result = await response.json();
    return result.data.output;
  };

  const validateDeliverable = async (deliverable: string) => {
    const response = await fetch('/api/agents/task-detail/validate-deliverable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId,
        deliverable,
      }),
    });
    
    const result = await response.json();
    return result.data.output;
  };

  return (
    <div>
      <h1>任务详情 - {taskId}</h1>
      
      {/* AI 助手 */}
      <div className="ai-assistant">
        <h2>AI 助手</h2>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="询问任务相关问题..."
        />
        <button onClick={askForGuidance}>获取指导</button>
        {guidance && <div className="guidance">{guidance}</div>}
      </div>

      {/* 文档生成 */}
      <div className="document-actions">
        <button onClick={() => generateDocument('plan')}>
          生成任务计划
        </button>
        <button onClick={() => generateDocument('progress')}>
          生成进度报告
        </button>
        <button onClick={() => generateDocument('summary')}>
          生成任务总结
        </button>
      </div>
    </div>
  );
}
```

---

## 4. 前端集成示例

### 4.1 创建 Agent API 客户端

```typescript
// src/lib/agent-client.ts

export class AgentClient {
  private baseUrl: string;

  constructor(baseUrl: string = '/api/agents') {
    this.baseUrl = baseUrl;
  }

  // 任务创建智能体
  async analyzeTask(description: string, constraints?: any) {
    return this.post('/task-creation/analyze', { description, constraints });
  }

  // 总经理视图智能体
  async analyzePortfolio(projectIds?: string[]) {
    return this.post('/ceo-view/analyze-portfolio', { projectIds });
  }

  async generateExecutiveSummary(period: 'daily' | 'weekly' | 'monthly' = 'weekly') {
    return this.post('/ceo-view/executive-summary', { period });
  }

  async getDecisionSupport(question: string, context?: any) {
    return this.post('/ceo-view/decision-support', { question, context });
  }

  // 任务详情智能体
  async getTaskGuidance(taskId: string, question: string, userRole: 'manager' | 'employee') {
    return this.post('/task-detail/guidance', { taskId, question, userRole });
  }

  async generateTaskDocument(taskId: string, documentType: string) {
    return this.post('/task-detail/generate-document', { taskId, documentType });
  }

  async analyzeTaskProgress(taskId: string, currentStatus?: any) {
    return this.post('/task-detail/analyze-progress', { taskId, currentStatus });
  }

  async validateDeliverable(taskId: string, deliverable: string) {
    return this.post('/task-detail/validate-deliverable', { taskId, deliverable });
  }

  // 通用请求方法
  private async post(endpoint: string, data: any) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    return response.json();
  }
}

// 导出单例
export const agentClient = new AgentClient();
```

### 4.2 在组件中使用

```typescript
import { agentClient } from '@/lib/agent-client';

// 在任何组件中使用
const result = await agentClient.analyzeTask('开发用户管理系统');
const summary = await agentClient.generateExecutiveSummary('weekly');
const guidance = await agentClient.getTaskGuidance('task-123', '如何开始？', 'employee');
```

---

## 5. WebSocket 实时交互

### 5.1 流式响应（未来功能）

为了提供更好的用户体验，可以实现流式响应：

```typescript
// 服务端（未来实现）
io.on('connection', (socket) => {
  socket.on('agent:stream-request', async (data) => {
    const { agentType, input, taskId } = data;
    
    const agent = AgentManager.getAgent(agentType);
    
    await agent.executeStream(input, [], (token) => {
      // 实时发送 token
      socket.emit('agent:stream-token', { token });
    });
    
    socket.emit('agent:stream-complete');
  });
});

// 客户端
socket.on('agent:stream-token', ({ token }) => {
  // 实时显示 token
  appendToOutput(token);
});

socket.on('agent:stream-complete', () => {
  // 完成
  console.log('Stream complete');
});
```

---

## 📝 注意事项

1. **API Key 配置**：确保在 `.env` 文件中配置了 `OPENAI_API_KEY`
2. **错误处理**：所有 API 调用都应该有适当的错误处理
3. **加载状态**：在等待 AI 响应时显示加载指示器
4. **超时处理**：AI 响应可能需要较长时间，建议设置合理的超时时间
5. **用户反馈**：提供清晰的用户反馈，说明 AI 正在处理请求

---

## 🔗 相关资源

- [Agent 框架文档](./apps/api/src/agents/README.md)
- [API 路由文档](./apps/api/src/routes/agent-routes.ts)
- [项目整体文档](./README.md)
