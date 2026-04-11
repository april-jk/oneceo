import type { OneceoApiConnector } from '../connectors/oneceo-api-connector';

export class ConnectorGuideManagementService {
  constructor(private readonly oneceoApi: OneceoApiConnector) {}

  listPolicies(filters?: { connectorKey?: string; status?: string; query?: string }) {
    return this.oneceoApi.listConnectorGuides(filters);
  }

  getPolicy(policyId: string) {
    return this.oneceoApi.getConnectorGuidePolicy(policyId);
  }

  createPolicy(input: {
    connectorKey: string;
    triggerMode: string;
    description?: string;
    createdBy?: string;
  }) {
    return this.oneceoApi.createConnectorGuidePolicy(input);
  }

  updatePolicy(
    policyId: string,
    input: {
      triggerMode?: string;
      description?: string;
      status?: string;
    }
  ) {
    return this.oneceoApi.updateConnectorGuidePolicy(policyId, input);
  }

  createRevision(policyId: string, input?: { createdBy?: string }) {
    return this.oneceoApi.createConnectorGuideRevision(policyId, input);
  }

  getRevision(policyId: string, revisionId: string) {
    return this.oneceoApi.getConnectorGuideRevision(policyId, revisionId);
  }

  updateRevision(
    policyId: string,
    revisionId: string,
    input: {
      serverInstructionsMarkdown?: string;
      guideReminderMarkdown?: string;
      blockingRulesMarkdown?: string;
      notes?: string;
    }
  ) {
    return this.oneceoApi.updateConnectorGuideRevision(policyId, revisionId, input);
  }

  validateRevision(policyId: string, revisionId: string) {
    return this.oneceoApi.validateConnectorGuideRevision(policyId, revisionId);
  }

  publishRevision(policyId: string, revisionId: string) {
    return this.oneceoApi.publishConnectorGuideRevision(policyId, revisionId);
  }

  rollbackRevision(policyId: string, revisionId: string) {
    return this.oneceoApi.rollbackConnectorGuideRevision(policyId, revisionId);
  }

  async getCatalogSummary() {
    const items = await this.oneceoApi.listConnectorCatalog();
    const stats = items.reduce(
      (acc, item) => {
        acc.total += 1;
        if (item.available) acc.available += 1;
        else acc.unavailable += 1;
        return acc;
      },
      { total: 0, available: 0, unavailable: 0 }
    );

    return {
      items,
      stats,
      updatedAt: new Date().toISOString(),
    };
  }
}
