// 智能体角色类型
export type AgentRole = 'altus' | 'ceo' | 'secretary' | 'manager' | 'employee';

// 经理类型
export type ManagerType = 'development' | 'operations' | 'maintenance' | 'market_research' | 'design' | 'qa';

// 消息类型
export type MessageType = 'user' | 'agent' | 'system';

// 任务状态
export type TaskStatus = 'pending' | 'in_progress' | 'review' | 'completed' | 'rejected';

// 评价等级
export type EvaluationLevel = 'acceptable' | 'unacceptable' | 'perfect';

// 智能体接口
export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  avatar?: string;
  description?: string;
  createdAt: Date;
  createdBy?: string;
  status: 'active' | 'idle' | 'busy';
}

// 经理接口
export interface Manager extends Agent {
  role: 'manager';
  type: ManagerType;
  projectId: string;
  employeeIds: string[];
  tasksAssigned: number;
  tasksCompleted: number;
}

// 员工接口
export interface Employee extends Agent {
  role: 'employee';
  managerId: string;
  skills: string[];
  currentTaskId?: string;
  tasksCompleted: number;
  performance: {
    acceptable: number;
    unacceptable: number;
    perfect: number;
  };
}

// 消息接口
export interface Message {
  id: string;
  projectId: string;
  senderId: string;
  senderName: string;
  senderRole: AgentRole;
  content: string;
  type: MessageType;
  timestamp: Date;
  replyTo?: string;
  metadata?: {
    isThinking?: boolean;
    functionCall?: string;
    attachments?: string[];
  };
}

// 任务接口
export interface Task {
  id: string;
  projectId: string;
  moduleId: string;
  phaseId: string;
  title: string;
  description: string;
  assignedTo: string; // employee id
  assignedBy: string; // manager id
  status: TaskStatus;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  dueDate?: Date;
  result?: string;
  evaluation?: {
    level: EvaluationLevel;
    comment: string;
    evaluatedBy: string;
    evaluatedAt: Date;
  };
}

// 项目流程状态
export interface ProjectFlow {
  projectId: string;
  currentStage: 'user_input' | 'ceo_analysis' | 'secretary_support' | 'ceo_planning' | 'manager_creation' | 'manager_analysis' | 'employee_creation' | 'task_execution';
  stages: {
    stage: string;
    status: 'pending' | 'in_progress' | 'completed';
    startedAt?: Date;
    completedAt?: Date;
    agentId?: string;
    agentName?: string;
  }[];
}

// 秘书与总经理的交互记录
export interface SecretaryInteraction {
  id: string;
  projectId: string;
  round: number;
  secretaryMessage: string;
  ceoResponse: string;
  timestamp: Date;
  shouldContinue: boolean;
}
