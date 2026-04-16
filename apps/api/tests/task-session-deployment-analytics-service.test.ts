import assert from 'node:assert/strict';
import { test } from 'node:test';
import { platformDeploymentAccountService } from '../src/services/platform-deployment-account-service';
import {
  prepareTaskSessionAnalyticsBinding,
} from '../src/services/task-session-deployment-analytics-service';
import { umamiAnalyticsService } from '../src/services/umami-analytics-service';

test('prepareTaskSessionAnalyticsBinding reuses existing website id and rewrites domain binding', async () => {
  const originalIsConfigured = umamiAnalyticsService.isConfigured;
  const originalGetTrackerHost = umamiAnalyticsService.getTrackerHost;
  const originalEnsureWebsiteBinding = umamiAnalyticsService.ensureWebsiteBinding;
  const originalUpsertApplicationVariables = platformDeploymentAccountService.upsertApplicationVariables;

  const calls: Array<Record<string, unknown>> = [];
  const variablesCalls: Array<Record<string, string>> = [];

  umamiAnalyticsService.isConfigured = () => true;
  umamiAnalyticsService.getTrackerHost = () => 'https://analytics.oneceo.ai';
  umamiAnalyticsService.ensureWebsiteBinding = async (input) => {
    calls.push({
      websiteId: input.websiteId,
      name: input.name,
      domain: input.domain,
    });
    return {
      id: input.websiteId || 'website_new',
      name: input.name,
      domain: input.domain,
    };
  };
  platformDeploymentAccountService.upsertApplicationVariables = async (_account, variables) => {
    variablesCalls.push(variables);
  };

  try {
    const panel = await prepareTaskSessionAnalyticsBinding({
      sessionId: 'session-12345678',
      orchestratorSessionId: '',
      environmentMetadata: {
        analytics: {
          provider: 'umami',
          websiteId: 'website_existing',
          websiteName: 'Existing site',
          domain: 'old.example.com',
          tag: 'production',
        },
      },
      account: {
        projectId: 'proj',
        environmentId: 'env',
        serviceId: 'svc',
        serviceDomain: 'old.example.com',
      } as any,
      domain: 'https://new.example.com/path',
      tag: 'production',
    });

    assert.equal(panel?.status, 'ready');
    assert.deepEqual(calls, [
      {
        websiteId: 'website_existing',
        name: 'Existing site',
        domain: 'new.example.com',
      },
    ]);
    assert.equal(variablesCalls.length, 1);
    assert.equal(variablesCalls[0]?.VITE_ANALYTICS_HOST, 'https://analytics.oneceo.ai');
    assert.equal(variablesCalls[0]?.VITE_ANALYTICS_WEBSITE_ID, 'website_existing');
    assert.equal(variablesCalls[0]?.VITE_PUBLIC_DOMAIN, 'new.example.com');
  } finally {
    umamiAnalyticsService.isConfigured = originalIsConfigured;
    umamiAnalyticsService.getTrackerHost = originalGetTrackerHost;
    umamiAnalyticsService.ensureWebsiteBinding = originalEnsureWebsiteBinding;
    platformDeploymentAccountService.upsertApplicationVariables = originalUpsertApplicationVariables;
  }
});
