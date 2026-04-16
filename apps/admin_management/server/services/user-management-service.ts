import type { OneceoApiConnector } from '../connectors/oneceo-api-connector';

export class UserManagementService {
  constructor(private readonly oneceoApi: OneceoApiConnector) {}

  listAppUsers(filters?: {
    limit?: number;
    query?: string;
    status?: string;
    activity?: string;
    hasSession?: string;
    hasConversation?: string;
    hasSandbox?: string;
    ownershipHealth?: string;
  }) {
    return this.oneceoApi.listAppUsers(filters);
  }

  getAppUserDetail(userId: string) {
    return this.oneceoApi.getAppUserDetail(userId);
  }

  updateAppUserStatus(userId: string, status: 'active' | 'disabled') {
    return this.oneceoApi.updateAppUserStatus(userId, status);
  }

  revokeAppUserSessions(userId: string) {
    return this.oneceoApi.revokeAppUserSessions(userId);
  }
}
