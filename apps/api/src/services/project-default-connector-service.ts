import { userConnectorService } from './user-connector-service';
import type { ProjectDefaultConnectorProfile } from '../db/dao/app-user-project.dao';

export type ProjectDefaultConnectorSummary = {
  connectorKey: ProjectDefaultConnectorProfile['connectorKey'];
  profileId: string;
  profileName: string | null;
  displayName: string | null;
  authStatus: string;
};

export type ProjectDefaultConnectorDraftEntry = {
  connectorKey: ProjectDefaultConnectorProfile['connectorKey'];
  profileId: string;
  desiredState: 'attached';
  enabledTools: string[];
  sessionConfig: null;
};

class ProjectDefaultConnectorService {
  async assertValidForWrite(userId: string, connectors: ProjectDefaultConnectorProfile[]) {
    for (const item of connectors) {
      const profile = await userConnectorService.getProfileMaterial(userId, item.profileId);
      if (!profile) {
        throw new Error(`默认连接器 profile 不存在: ${item.profileId}`);
      }
      if (profile.connectorKey !== item.connectorKey) {
        throw new Error(`默认连接器与 profile 类型不匹配: ${item.connectorKey}`);
      }
    }
  }

  async resolveForProject(userId: string, connectors: ProjectDefaultConnectorProfile[]) {
    const resolved = await Promise.all(
      connectors.map(async (item): Promise<ProjectDefaultConnectorSummary> => {
        const profile = await userConnectorService.getProfileMaterial(userId, item.profileId);
        if (!profile || profile.connectorKey !== item.connectorKey) {
          return {
            connectorKey: item.connectorKey,
            profileId: item.profileId,
            profileName: null,
            displayName: null,
            authStatus: 'deleted',
          };
        }
        return {
          connectorKey: item.connectorKey,
          profileId: item.profileId,
          profileName: profile.profileName || null,
          displayName: profile.displayName || null,
          authStatus: profile.authStatus || 'unknown',
        };
      })
    );
    return resolved;
  }

  toDraftEntries(connectors: ProjectDefaultConnectorProfile[]): ProjectDefaultConnectorDraftEntry[] {
    return connectors.map((item) => ({
      connectorKey: item.connectorKey,
      profileId: item.profileId,
      desiredState: 'attached',
      enabledTools: [],
      sessionConfig: null,
    }));
  }
}

export const projectDefaultConnectorService = new ProjectDefaultConnectorService();
