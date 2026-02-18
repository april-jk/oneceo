import type { OneceoApiConnector, SandboxEnvironmentRecord } from '../connectors/oneceo-api-connector';

type SandboxStatusSummary = {
  total: number;
  ready: number;
  creating: number;
  closed: number;
  failed: number;
};

function summarizeStatus(records: SandboxEnvironmentRecord[]): SandboxStatusSummary {
  return {
    total: records.length,
    ready: records.filter((item) => item.status === 'ready').length,
    creating: records.filter((item) => item.status === 'creating').length,
    closed: records.filter((item) => item.status === 'closed').length,
    failed: records.filter((item) => item.status === 'failed').length,
  };
}

export class SandboxManagementService {
  constructor(private readonly oneceoApi: OneceoApiConnector) {}

  async getOverview(limit = 50) {
    const [health, environments] = await Promise.allSettled([
      this.oneceoApi.getSandboxHealth(),
      this.oneceoApi.listSandboxEnvironments(limit),
    ]);

    const environmentList = environments.status === 'fulfilled' ? environments.value : [];
    const healthInfo = health.status === 'fulfilled' ? health.value : null;

    return {
      sandboxApi: {
        online: Boolean(healthInfo && healthInfo.status === 'ok'),
        status: healthInfo?.status || 'unavailable',
        service: healthInfo?.service || 'sandbox',
        version: healthInfo?.version || null,
        timestamp: healthInfo?.time || null,
      },
      summary: summarizeStatus(environmentList),
      environments: environmentList.slice(0, limit),
    };
  }
}

