import type { OneceoApiConnector, TaskCreationSession } from '../connectors/oneceo-api-connector';

export class ConversationManagementService {
  constructor(private readonly oneceoApi: OneceoApiConnector) {}

  async listSessions(limit = 20) {
    const sessions = await this.oneceoApi.listTaskCreationSessions(limit);
    const normalized = sessions.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      stage: item.stage,
      pendingQuestion: item.pendingQuestion,
      pendingOptions: item.pendingOptions,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

    return {
      total: normalized.length,
      sessions: normalized,
    };
  }

  async getSessionDetail(sessionId: string) {
    const [session, messages, intent, taskDescription, executionPlan] = await Promise.all([
      this.oneceoApi.getTaskCreationSession(sessionId),
      this.oneceoApi.getTaskCreationMessages(sessionId).catch(() => []),
      this.oneceoApi.getTaskCreationIntent(sessionId).catch(() => null),
      this.oneceoApi.getTaskCreationTaskDescription(sessionId).catch(() => null),
      this.oneceoApi.getTaskCreationExecutionPlan(sessionId).catch(() => null),
    ]);

    return {
      session,
      messages: Array.isArray(messages) ? messages : [],
      intent,
      taskDescription,
      executionPlan,
    };
  }

  summarizeStatus(sessions: TaskCreationSession[]) {
    return {
      total: sessions.length,
      inProgress: sessions.filter((item) => item.status === 'in_progress').length,
      waitingUser: sessions.filter((item) => item.status === 'waiting_user').length,
      completed: sessions.filter((item) => item.status === 'completed').length,
      failed: sessions.filter((item) => item.status === 'failed').length,
    };
  }
}
