/**
 * 意图类型定义
 * 
 * 用于任务创建智能体的意图识别
 */

export enum IntentType {
  // 研究和分析
  RESEARCH = "research", // 行业调研、市场分析
  DATA_ANALYSIS = "data_analysis", // 数据分析、统计
  COMPETITOR_ANALYSIS = "competitor_analysis", // 竞争对手分析

  // 优化和改进
  SEO_OPTIMIZATION = "seo_optimization", // SEO 优化
  CONTENT_OPTIMIZATION = "content_optimization", // 内容优化

  // 创建和生成
  CONTENT_CREATION = "content_creation", // 内容创建
  DESIGN_CREATION = "design_creation", // 设计创建（图表、PPT等）
  SOFTWARE_DEVELOPMENT = "software_development", // 软件开发

  // 策略和规划
  STRATEGY_PLANNING = "strategy_planning", // 策略规划
  BUSINESS_PLANNING = "business_planning", // 商业规划

  // 其他
  OTHER = "other", // 其他类型
}

/**
 * 意图识别结果
 */
export interface IntentRecognitionResult {
  intent_type: IntentType;
  confidence: number;
  key_info: {
    target?: string;
    scope?: string;
    constraints?: string;
    [key: string]: any;
  };
  clarification_needed: boolean;
  clarification_question?: string;
  clarification_questions?: string[]; // 多个澄清问题
  next_agent: "planning_agent" | "user_clarification";
}

/**
 * 任务描述
 */
export interface TaskDescription {
  title: string;
  objective: string;
  scope: string;
  deliverables: string[];
  constraints: string[] | Record<string, any>;
  additional_info?: Record<string, any>; // 额外信息
}

/**
 * 执行计划
 */
export interface ExecutionPlan {
  project: {
    title: string;
    description: string;
    estimated_total_hours?: number; // 预估总时长
    managers: Manager[];
  };
}

export interface Manager {
  id: string;
  name: string;
  description: string;
  tasks: Task[];
}

export interface Task {
  id: string;
  title: string;
  description: string;
  estimated_hours: number;
  deliverables: string[];
  status?: "pending" | "in_progress" | "completed";
}

/**
 * WebSocket 消息类型
 */
export enum MessageType {
  USER_INPUT = "user_input",
  AGENT_MESSAGE = "agent_message",
  CLARIFICATION_REQUEST = "clarification_request",
  PLAN_GENERATED = "plan_generated",
  ERROR = "error",
}

/**
 * WebSocket 消息接口
 */
export interface WebSocketMessage {
  type: MessageType;
  content?: string;
  agent?: string;
  metadata?: any;
  question?: string;
  options?: string[];
  plan?: ExecutionPlan;
  message?: string;
}
