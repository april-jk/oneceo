import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { PlatformOperationsAnalyticsService } from '../src/services/platform-operations-analytics-service';

const originalEnv = {
  UMAMI_ENABLED: process.env.UMAMI_ENABLED,
  UMAMI_HOST_URL: process.env.UMAMI_HOST_URL,
  UMAMI_USERNAME: process.env.UMAMI_USERNAME,
  UMAMI_PASSWORD: process.env.UMAMI_PASSWORD,
  UMAMI_PLATFORM_TEAM_ID: process.env.UMAMI_PLATFORM_TEAM_ID,
  UMAMI_PLATFORM_WEBSITE_ID: process.env.UMAMI_PLATFORM_WEBSITE_ID,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  restoreEnv();
});

test('platform operations overview keeps Umami website fixed and returns OneCEO DB business facts', async () => {
  process.env.UMAMI_ENABLED = 'false';
  process.env.UMAMI_HOST_URL = 'https://analytics.oneceo.ai';
  process.env.UMAMI_PLATFORM_TEAM_ID = 'team_platform';
  process.env.UMAMI_PLATFORM_WEBSITE_ID = 'website_platform';

  const service = new PlatformOperationsAnalyticsService(
    async () => ({
      rows: [
        {
          newUsers: '3',
          activeLoggedInUsers: '2',
          newTaskSessions: '9',
          completedTaskSessions: '6',
          failedTaskSessions: '1',
          agentRunsStarted: '8',
          agentRunsCompleted: '5',
          agentRunsFailed: '1',
          sandboxBoundSessions: '4',
        },
      ],
    }),
    () => Date.parse('2026-04-24T06:34:00.000Z')
  );

  const overview = await service.getOverview({ range: '7d', timezone: 'Asia/Shanghai' });

  assert.equal(overview.source.umami.websiteId, 'website_platform');
  assert.equal(overview.source.umami.configured, false);
  assert.equal(overview.range.key, '7d');
  assert.equal(overview.business.metrics.find((item) => item.key === 'newUsers')?.value, 3);
  assert.equal(overview.business.metrics.find((item) => item.key === 'agentRunsCompleted')?.value, 5);
  assert.ok(overview.alerts.some((item) => item.includes('Umami 平台 website 未配置')));
});
