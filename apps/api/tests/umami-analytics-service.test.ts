import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { umamiAnalyticsService } from '../src/services/umami-analytics-service';

const originalEnv = {
  UMAMI_ENABLED: process.env.UMAMI_ENABLED,
  UMAMI_HOST_URL: process.env.UMAMI_HOST_URL,
  UMAMI_USERNAME: process.env.UMAMI_USERNAME,
  UMAMI_PASSWORD: process.env.UMAMI_PASSWORD,
  UMAMI_PLATFORM_TEAM_ID: process.env.UMAMI_PLATFORM_TEAM_ID,
  UMAMI_PLATFORM_WEBSITE_ID: process.env.UMAMI_PLATFORM_WEBSITE_ID,
  UMAMI_DEPLOYMENT_TEAM_ID: process.env.UMAMI_DEPLOYMENT_TEAM_ID,
};

const originalFetch = global.fetch;

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
  global.fetch = originalFetch;
  (umamiAnalyticsService as any).authToken = null;
});

test('umami analytics requires deployment team for deployment scope', () => {
  process.env.UMAMI_ENABLED = 'true';
  process.env.UMAMI_HOST_URL = 'https://analytics.oneceo.ai';
  process.env.UMAMI_USERNAME = 'user';
  process.env.UMAMI_PASSWORD = 'pass';
  process.env.UMAMI_PLATFORM_TEAM_ID = 'team_platform';
  delete process.env.UMAMI_DEPLOYMENT_TEAM_ID;

  assert.equal(umamiAnalyticsService.isConfigured('platform'), true);
  assert.equal(umamiAnalyticsService.isConfigured('deployment'), false);
});

test('platform website configuration requires the fixed OneCEO website id', () => {
  process.env.UMAMI_ENABLED = 'true';
  process.env.UMAMI_HOST_URL = 'https://analytics.oneceo.ai';
  process.env.UMAMI_USERNAME = 'user';
  process.env.UMAMI_PASSWORD = 'pass';
  process.env.UMAMI_PLATFORM_TEAM_ID = 'team_platform';
  delete process.env.UMAMI_PLATFORM_WEBSITE_ID;

  assert.equal(umamiAnalyticsService.isConfigured('platform'), true);
  assert.equal(umamiAnalyticsService.isPlatformWebsiteConfigured(), false);

  process.env.UMAMI_PLATFORM_WEBSITE_ID = 'website_platform';
  assert.equal(umamiAnalyticsService.getPlatformWebsiteId(), 'website_platform');
  assert.equal(umamiAnalyticsService.isPlatformWebsiteConfigured(), true);
});

test('listWebsites uses the requested team scope', async () => {
  process.env.UMAMI_ENABLED = 'true';
  process.env.UMAMI_HOST_URL = 'https://analytics.oneceo.ai';
  process.env.UMAMI_USERNAME = 'user';
  process.env.UMAMI_PASSWORD = 'pass';
  process.env.UMAMI_PLATFORM_TEAM_ID = 'team_platform';
  process.env.UMAMI_DEPLOYMENT_TEAM_ID = 'team_deployment';

  const requested: string[] = [];
  global.fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith('/api/auth/login')) {
      return new Response(JSON.stringify({ token: 'token-123' }), { status: 200 });
    }
    assert.equal(init?.headers instanceof Headers, true);
    return new Response(
      JSON.stringify({
        data: [{ id: 'site_1', name: 'OneCEO Main', domain: 'oneceo.ai' }],
        count: 1,
        page: 1,
        pageSize: 100,
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  const sites = await umamiAnalyticsService.listWebsites({ scope: 'platform' });

  assert.equal(sites.length, 1);
  assert.match(requested[1] || '', /teamId=team_platform/);
});

test('platform analytics methods read stats, pageviews and expanded metrics from the fixed website API', async () => {
  process.env.UMAMI_ENABLED = 'true';
  process.env.UMAMI_HOST_URL = 'https://analytics.oneceo.ai';
  process.env.UMAMI_USERNAME = 'user';
  process.env.UMAMI_PASSWORD = 'pass';
  process.env.UMAMI_PLATFORM_TEAM_ID = 'team_platform';
  process.env.UMAMI_PLATFORM_WEBSITE_ID = 'website_platform';

  const requested: string[] = [];
  global.fetch = (async (input: any) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith('/api/auth/login')) {
      return new Response(JSON.stringify({ token: 'token-123' }), { status: 200 });
    }
    if (url.includes('/stats?')) {
      return new Response(JSON.stringify({ pageviews: 120, visits: 40, visitors: 30, bounces: 8, totaltime: 2000 }), { status: 200 });
    }
    if (url.includes('/pageviews?')) {
      return new Response(JSON.stringify({
        pageviews: [{ x: '2026-04-24T00:00:00Z', y: 12 }],
        sessions: [{ x: '2026-04-24T00:00:00Z', y: 5 }],
      }), { status: 200 });
    }
    if (url.includes('/metrics/expanded?')) {
      return new Response(JSON.stringify([{ name: '/', pageviews: 80, visitors: 20, visits: 25, bounces: 3, totaltime: 900 }]), { status: 200 });
    }
    return new Response(JSON.stringify({ visitors: 2 }), { status: 200 });
  }) as typeof fetch;

  const range = { startAt: 1000, endAt: 2000, unit: 'hour' as const, timezone: 'Asia/Shanghai' };
  const stats = await umamiAnalyticsService.getWebsiteStats('website_platform', range);
  const activeVisitors = await umamiAnalyticsService.getWebsiteActiveVisitors('website_platform', { scope: 'platform' });
  const pageviews = await umamiAnalyticsService.getWebsitePageviews('website_platform', range);
  const metrics = await umamiAnalyticsService.getWebsiteMetric('website_platform', {
    ...range,
    type: 'path',
    expanded: true,
  });

  assert.equal(stats?.pageviews, 120);
  assert.equal(activeVisitors, 2);
  assert.deepEqual(pageviews?.sessions, [{ x: '2026-04-24T00:00:00Z', y: 5 }]);
  assert.equal(metrics[0].name, '/');
  assert.ok(requested.some((url) => url.includes('/api/websites/website_platform/stats?startAt=1000&endAt=2000')));
  assert.ok(requested.some((url) => url.includes('/api/websites/website_platform/pageviews?')));
  assert.ok(requested.some((url) => url.includes('/api/websites/website_platform/metrics/expanded?')));
});

test('ensureWebsiteBinding reuses website inside target scope instead of stale cross-team website id', async () => {
  const originalListWebsites = umamiAnalyticsService.listWebsites;
  const originalUpdateWebsite = umamiAnalyticsService.updateWebsite;
  const originalEnsureWebsite = umamiAnalyticsService.ensureWebsite;

  const updates: Array<Record<string, unknown>> = [];
  const creates: Array<Record<string, unknown>> = [];

  umamiAnalyticsService.listWebsites = async ({ scope } = {}) => {
    assert.equal(scope, 'deployment');
    return [
      {
        id: 'website_in_deployment_team',
        name: 'Existing deployment site',
        domain: 'new.example.com',
        teamId: 'team_deployment',
      },
    ];
  };
  umamiAnalyticsService.updateWebsite = async (websiteId, input) => {
    updates.push({ websiteId, scope: input.scope, domain: input.domain });
    return {
      id: websiteId,
      name: input.name,
      domain: input.domain,
      teamId: 'team_deployment',
    };
  };
  umamiAnalyticsService.ensureWebsite = async (input) => {
    creates.push({ scope: input.scope, domain: input.domain });
    return {
      id: 'created_website',
      name: input.name,
      domain: input.domain,
      teamId: 'team_deployment',
    };
  };

  try {
    const website = await umamiAnalyticsService.ensureWebsiteBinding({
      scope: 'deployment',
      websiteId: 'stale_platform_team_website',
      name: 'Existing deployment site',
      domain: 'https://new.example.com/path',
    });

    assert.equal(website.id, 'website_in_deployment_team');
    assert.deepEqual(updates, [
      {
        websiteId: 'website_in_deployment_team',
        scope: 'deployment',
        domain: 'https://new.example.com/path',
      },
    ]);
    assert.equal(creates.length, 0);
  } finally {
    umamiAnalyticsService.listWebsites = originalListWebsites;
    umamiAnalyticsService.updateWebsite = originalUpdateWebsite;
    umamiAnalyticsService.ensureWebsite = originalEnsureWebsite;
  }
});
