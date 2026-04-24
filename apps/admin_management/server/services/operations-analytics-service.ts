import type {
  OneceoApiConnector,
  OperationsAnalyticsRangeKey,
  OperationsAnalyticsOverviewResponse,
} from '../connectors/oneceo-api-connector';

export class OperationsAnalyticsService {
  constructor(private readonly connector: OneceoApiConnector) {}

  getOverview(input?: {
    range?: OperationsAnalyticsRangeKey;
    timezone?: string;
  }): Promise<OperationsAnalyticsOverviewResponse> {
    return this.connector.getOperationsAnalyticsOverview(input);
  }
}
