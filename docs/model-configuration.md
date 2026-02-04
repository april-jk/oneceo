# LLM 模型配置说明

## 当前配置

本项目使用 **Claude 系列模型**，通过自定义 API 端点访问。

---

## API 配置

### API 端点
- **Base URL**: `https://www.fucheers.top/v1`
- **API Key**: `sk-MRwNM2uHuQSWHohygTJQlWx0jR26xkf20gJJTp8NdRUDLO3c`

### 环境变量配置
```env
OPENAI_API_KEY=sk-MRwNM2uHuQSWHohygTJQlWx0jR26xkf20gJJTp8NdRUDLO3c
OPENAI_BASE_URL=https://www.fucheers.top/v1
```

---

## 可用模型

### 1. Claude Haiku 4.5
- **模型名称**: `claude-haiku-4-5-20251001`
- **特点**: 快速响应，成本低
- **适用场景**: 意图识别、简单分类、快速交互

### 2. Claude Sonnet 4.5
- **模型名称**: `claude-sonnet-4-5-20250929`
- **特点**: 平衡性能和成本
- **适用场景**: 任务规划、信息整合、复杂推理

### 3. Claude Opus 4.5
- **模型名称**: `claude-opus-4-5-20251101`
- **特点**: 最高质量输出
- **适用场景**: 执行计划生成、复杂任务分解、高质量内容创作

---

## 三层 Agent 模型分配

### Layer 1 - 意图识别 Agent
- **模型**: `claude-haiku-4-5-20251001`
- **原因**: 意图识别需要快速响应，Haiku 模型速度快、成本低
- **温度**: 0.7
- **文件**: `apps/api/src/agents/task-creation/layers/intent-recognition-agent.ts`

### Layer 2 - 任务规划 Agent
- **模型**: `claude-sonnet-4-5-20250929`
- **原因**: 任务规划需要平衡推理能力和响应速度，Sonnet 是最佳选择
- **温度**: 0.7
- **文件**: `apps/api/src/agents/task-creation/layers/planning-agent.ts`

### Layer 3 - 执行计划 Agent
- **模型**: `claude-opus-4-5-20251101`
- **原因**: 执行计划需要高质量输出，Opus 提供最佳的任务分解和规划能力
- **温度**: 0.6（更保守，确保输出质量）
- **文件**: `apps/api/src/agents/task-creation/layers/execution-plan-agent.ts`

---

## BaseAgent 默认配置

- **默认模型**: `claude-sonnet-4-5-20250929`
- **默认温度**: 0.7
- **文件**: `apps/api/src/agents/base-agent.ts`

如果 Agent 没有指定模型，将使用 Sonnet 作为默认模型。

---

## 模型选择原则

### 1. 速度优先
使用 **Haiku** 模型：
- 意图识别
- 简单分类
- 实时交互

### 2. 平衡性能
使用 **Sonnet** 模型：
- 任务规划
- 信息整合
- 复杂推理
- 默认场景

### 3. 质量优先
使用 **Opus** 模型：
- 执行计划生成
- 复杂任务分解
- 高质量内容创作
- 关键决策

---

## 成本优化建议

### 当前配置（推荐）
```
Layer 1: Haiku   (快速、低成本)
Layer 2: Sonnet  (平衡)
Layer 3: Opus    (高质量)
```

### 成本敏感配置
```
Layer 1: Haiku   (快速、低成本)
Layer 2: Haiku   (降低成本)
Layer 3: Sonnet  (平衡质量和成本)
```

### 质量优先配置
```
Layer 1: Sonnet  (提高准确率)
Layer 2: Opus    (最佳规划)
Layer 3: Opus    (最佳执行计划)
```

---

## 修改模型配置

### 方法 1: 修改 Agent 配置
在各个 Agent 的构造函数中修改 `modelName`：

```typescript
const config: AgentConfig = {
  name: 'IntentRecognitionAgent',
  modelName: 'claude-haiku-4-5-20251001', // 修改这里
  temperature: 0.7,
  // ...
};
```

### 方法 2: 修改默认配置
在 `BaseAgent` 中修改默认模型：

```typescript
this.llm = new ChatOpenAI({
  modelName: config.modelName || 'claude-sonnet-4-5-20250929', // 修改这里
  // ...
});
```

### 方法 3: 通过环境变量（未实现）
可以添加环境变量支持：

```env
DEFAULT_MODEL=claude-sonnet-4-5-20250929
INTENT_MODEL=claude-haiku-4-5-20251001
PLANNING_MODEL=claude-sonnet-4-5-20250929
EXECUTION_MODEL=claude-opus-4-5-20251101
```

---

## 温度参数说明

### 温度范围: 0.0 - 1.0

- **0.0 - 0.3**: 非常确定性，适合需要精确输出的任务
- **0.4 - 0.6**: 平衡创造性和确定性
- **0.7 - 0.9**: 更有创造性，适合内容生成
- **1.0**: 最大创造性，输出更随机

### 当前配置
- **Layer 1 (意图识别)**: 0.7 - 需要一定灵活性理解用户意图
- **Layer 2 (任务规划)**: 0.7 - 平衡创造性和结构化
- **Layer 3 (执行计划)**: 0.6 - 更保守，确保计划质量

---

## 测试和验证

### 测试不同模型
1. 修改 Agent 的 `modelName`
2. 重启后端服务
3. 发送测试请求
4. 比较响应质量和速度

### 监控指标
- **响应时间**: 记录每个 Agent 的处理时间
- **输出质量**: 评估生成内容的准确性和完整性
- **成本**: 追踪 API 调用成本

---

## 故障排查

### 问题 1: 模型不存在
**错误**: `Model not found: claude-xxx`

**解决方案**:
1. 检查模型名称拼写
2. 确认 API 端点支持该模型
3. 查看 API 文档获取可用模型列表

### 问题 2: API 调用失败
**错误**: `API request failed`

**解决方案**:
1. 检查 API Key 是否正确
2. 检查 Base URL 是否可访问
3. 查看后端日志获取详细错误信息

### 问题 3: 响应格式错误
**错误**: `Failed to parse JSON response`

**解决方案**:
1. 检查提示词是否明确要求 JSON 输出
2. 调整温度参数（降低温度提高确定性）
3. 在提示词中添加更多格式示例

---

## 更新日志

### 2024-02-04
- 从 OpenAI GPT 模型切换到 Claude 系列模型
- 配置三层 Agent 使用不同的 Claude 模型
- Layer 1: Haiku（快速）
- Layer 2: Sonnet（平衡）
- Layer 3: Opus（高质量）

### 初始配置
- 使用 OpenAI GPT-4.1-mini 模型
- 所有 Agent 使用相同模型

---

## 参考资料

- [Claude API 文档](https://docs.anthropic.com/)
- [LangChain ChatOpenAI 文档](https://js.langchain.com/docs/integrations/chat/openai)
- [模型选择指南](https://www.anthropic.com/claude)
