import { userConnectorProfileDAO } from '../db/dao';
import { connectorSecretService } from './connector-secret-service';
import type { ConnectorAccountSecret } from './connector-registry';
import { userConnectorService } from './user-connector-service';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export class VercelTokenRefreshService {
  async getActiveAccessToken(input: { userId: string; profileId: string }): Promise<string> {
    const profile = await userConnectorService.getProfileMaterial(input.userId, input.profileId);
    if (!profile || profile.connectorKey !== 'vercel') {
      throw new Error('Vercel connector profile does not exist.');
    }

    const accessToken = asText(profile.secret?.accessToken);
    if (!accessToken) {
      throw new Error('Vercel Integration connector is missing an access token. Reinstall the Integration.');
    }

    return accessToken;
  }

  async refreshAccessToken(input: { userId: string; profileId: string }): Promise<string> {
    const row = await userConnectorProfileDAO.getByIdAndUser(input.profileId, input.userId);
    if (!row || row.connectorKey !== 'vercel') {
      throw new Error('Vercel connector profile does not exist.');
    }

    const secret = row.secretCiphertext
      ? connectorSecretService.decryptJson<ConnectorAccountSecret>(row.secretCiphertext, 'vercel')
      : null;
    const accessToken = asText(secret?.accessToken);
    if (!accessToken) {
      await userConnectorService.markProfileNeedsAuth(input.userId, input.profileId, {
        lastError: 'Vercel Integration connector is missing an access token. Reinstall the Integration.',
      });
      throw new Error('Vercel Integration connector is missing an access token. Reinstall the Integration.');
    }

    // Vercel Integration tokens are installation tokens. There is no refresh-token flow here.
    return accessToken;
  }
}

export const vercelTokenRefreshService = new VercelTokenRefreshService();
