import type { OneceoApiConnector } from '../connectors/oneceo-api-connector';

function stageLabel(stage?: string | null) {
  if (stage === 'collecting') return '信息收集';
  if (stage === 'clarifying') return '等待补充';
  if (stage === 'planning') return '生成方案';
  if (stage === 'executing') return '执行中';
  if (stage === 'completed') return '已完成';
  if (stage === 'failed') return '已失败';
  if (stage === 'unknown') return '未知阶段';
  return stage || '未知阶段';
}

function sessionStatusLabel(status?: string | null) {
  if (status === 'in_progress') return '进行中';
  if (status === 'waiting_user') return '待确认';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'unknown') return '未知';
  return status || '未知';
}

function agentApiMessageLabel(message?: string | null) {
  if (message === 'Agent API is running') return '智能体接口运行正常';
  if (message === 'unavailable') return '智能体接口不可用';
  return message || '未知';
}

export class AgentManagementService {
  constructor(private readonly oneceoApi: OneceoApiConnector) {}

  async getOverview() {
    const [apiHealth, agentHealth, sessions] = await Promise.allSettled([
      this.oneceoApi.health(),
      this.oneceoApi.getAgentHealth(),
      this.oneceoApi.listTaskCreationSessions(200),
    ]);

    const sessionList = sessions.status === 'fulfilled' ? sessions.value : [];
    const statusSummary = {
      total: sessionList.length,
      inProgress: sessionList.filter((item) => item.status === 'in_progress').length,
      waitingUser: sessionList.filter((item) => item.status === 'waiting_user').length,
      completed: sessionList.filter((item) => item.status === 'completed').length,
      failed: sessionList.filter((item) => item.status === 'failed').length,
    };

    return {
      oneceoApi: {
        online: apiHealth.status === 'fulfilled' && apiHealth.value.status === 'ok',
        timestamp: apiHealth.status === 'fulfilled' ? apiHealth.value.timestamp : null,
      },
      agentApi: {
        online: agentHealth.status === 'fulfilled',
        message: agentHealth.status === 'fulfilled' ? agentApiMessageLabel(agentHealth.value.message) : '智能体接口不可用',
        timestamp: agentHealth.status === 'fulfilled' ? agentHealth.value.timestamp : null,
      },
      capabilities: [
        {
          key: 'task-creation',
          name: 'Task Creation Agent',
          transport: 'WebSocket',
          endpoint: '/ws/task-creation',
          status: 'available',
        },
        {
          key: 'ceo-view',
          name: 'CEO View Agent',
          transport: 'HTTP',
          endpoint: '/api/agents/ceo-view/*',
          status: 'planned',
        },
        {
          key: 'task-detail',
          name: 'Task Detail Agent',
          transport: 'HTTP',
          endpoint: '/api/agents/task-detail/*',
          status: 'planned',
        },
      ],
      taskCreationSessions: statusSummary,
      stageDistribution: this.buildStageDistribution(sessionList),
    };
  }

  private buildStageDistribution(
    sessions: Array<{
      id: string;
      title: string;
      status?: string;
      stage?: string;
      updatedAt: string;
      pendingQuestion?: string;
    }>
  ): Array<{
    stageKey: string;
    label: string;
    value: number;
    statusSummary: Array<{ label: string; value: number }>;
    recentSessions: Array<{
      id: string;
      title: string;
      status: string;
      updatedAt: string;
      pendingQuestion?: string;
    }>;
  }> {
    const map = new Map<
      string,
      {
        stageKey: string;
        label: string;
        value: number;
        statuses: Map<string, number>;
        recentSessions: Array<{
          id: string;
          title: string;
          status: string;
          updatedAt: string;
          pendingQuestion?: string;
        }>;
      }
    >();

    for (const session of sessions) {
      const key = session.stage || 'unknown';
      const bucket =
        map.get(key) ||
        {
          stageKey: key,
          label: stageLabel(key),
          value: 0,
          statuses: new Map<string, number>(),
          recentSessions: [],
        };
      bucket.value += 1;
      const statusKey = session.status || 'unknown';
      bucket.statuses.set(statusKey, (bucket.statuses.get(statusKey) || 0) + 1);
      bucket.recentSessions.push({
        id: session.id,
        title: session.title,
        status: sessionStatusLabel(session.status),
        updatedAt: session.updatedAt,
        pendingQuestion: session.pendingQuestion,
      });
      map.set(key, bucket);
    }

    return Array.from(map.values())
      .map((item) => ({
        stageKey: item.stageKey,
        label: item.label,
        value: item.value,
        statusSummary: Array.from(item.statuses.entries())
          .map(([label, value]) => ({ label: sessionStatusLabel(label), value }))
          .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
        recentSessions: [...item.recentSessions]
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
          .slice(0, 6),
      }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }
}
