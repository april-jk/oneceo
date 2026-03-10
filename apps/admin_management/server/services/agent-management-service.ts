import type { OneceoApiConnector } from '../connectors/oneceo-api-connector';

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
        message: agentHealth.status === 'fulfilled' ? agentHealth.value.message : 'unavailable',
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
    sessions: Array<{ stage?: string }>
  ): Array<{ label: string; value: number }> {
    const map = new Map<string, number>();
    for (const session of sessions) {
      const key = session.stage || 'unknown';
      map.set(key, (map.get(key) || 0) + 1);
    }

    return Array.from(map.entries()).map(([label, value]) => ({ label, value }));
  }
}

