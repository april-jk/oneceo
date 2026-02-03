// ============================================================================
// 项目相关类型
// ============================================================================

export interface Project {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'completed' | 'paused';
  progress: number;
  deadline: Date;
  managers: Manager[];
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// 经理相关类型
// ============================================================================

export interface Manager {
  id: string;
  name: string;
  role: string;
  avatar: string;
  tasks: Task[];
  employees: Employee[];
  projectId: string;
}

// ============================================================================
// 任务相关类型
// ============================================================================

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: 'low' | 'medium' | 'high';
  deadline: Date;
  assignedEmployees: Employee[];
  deliverables: Deliverable[];
  managerId: string;
  projectId: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// 员工相关类型
// ============================================================================

export interface Employee {
  id: string;
  name: string;
  role: string;
  avatar: string;
  skills: string[];
  managerId: string;
}

// ============================================================================
// 用户相关类型
// ============================================================================

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  credits: number;
  membership: 'free' | 'pro' | 'enterprise';
  role: 'user' | 'admin' | 'ceo';
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// 消息相关类型
// ============================================================================

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'manager' | 'employee' | 'ceo';
  content: string;
  timestamp: Date;
  attachments?: Attachment[];
  metadata?: Record<string, any>;
  conversationId: string;
}

export interface Conversation {
  id: string;
  userId: string;
  projectId?: string;
  taskId?: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// 附件相关类型
// ============================================================================

export interface Attachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
  uploadedAt: Date;
}

// ============================================================================
// 交付物相关类型
// ============================================================================

export interface Deliverable {
  id: string;
  taskId: string;
  title: string;
  content: string;
  attachments: Attachment[];
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  feedback?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Agent 相关类型
// ============================================================================

export interface AgentConfig {
  id: string;
  name: string;
  role: 'ceo' | 'manager' | 'employee';
  model: string;
  systemPrompt: string;
  capabilities: string[];
  temperature?: number;
  maxTokens?: number;
}

export interface AgentTask {
  id: string;
  type: 'project_planning' | 'task_breakdown' | 'task_execution' | 'review';
  input: any;
  output?: any;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  agentId: string;
  createdAt: Date;
  completedAt?: Date;
  error?: string;
}

// ============================================================================
// API 请求/响应类型
// ============================================================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: Date;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================================
// WebSocket 事件类型
// ============================================================================

export type WebSocketEvent =
  | { type: 'message:new'; data: Message }
  | { type: 'message:received'; data: { id: string } }
  | { type: 'task:updated'; data: Task }
  | { type: 'project:updated'; data: Project }
  | { type: 'agent:thinking'; data: { agentId: string; message: string } }
  | { type: 'agent:response'; data: { agentId: string; response: string } };
