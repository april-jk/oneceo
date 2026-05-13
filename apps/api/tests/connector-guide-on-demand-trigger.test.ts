import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import { connectorGuideService } from '../src/services/connector-guide-service';
import { connectorGuideDAO, taskSessionConnectorBindingDAO } from '../src/db/dao';
import taskCreationRoutes from '../src/routes/task-creation-routes';
import { currentUserResolver } from '../src/services/current-user-resolver';
import { sessionConnectorService } from '../src/services/session-connector-service';
import { mockAuthContextMiddleware } from './helpers/mock-auth-context';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const connectorGuideServiceAny = connectorGuideService as any;
const connectorGuideDAOAny = connectorGuideDAO as any;
const bindingDAOAny = taskSessionConnectorBindingDAO as any;
const currentUserResolverAny = currentUserResolver as any;
const sessionConnectorServiceAny = sessionConnectorService as any;
const SESSION_ONE_ID = '31111111-1111-4111-8111-111111111111';
const SESSION_TWO_ID = '32222222-2222-4222-8222-222222222222';

const originalListByTaskSessionId = bindingDAOAny.listByTaskSessionId;
const originalListSessionGuides = connectorGuideDAOAny.listSessionGuides;
const originalRecomputeSessionGuides = connectorGuideServiceAny.recomputeSessionGuides;
const originalCurrentUserRequire = currentUserResolverAny.require;
const originalAssertSessionOwnership = sessionConnectorServiceAny.assertSessionOwnership;
const originalListSessionConnectors = sessionConnectorServiceAny.listSessionConnectors;
const originalSummarizeStatuses = sessionConnectorServiceAny.summarizeStatuses;
const originalEnsureSessionGuidesUpToDate = connectorGuideServiceAny.ensureSessionGuidesUpToDate;

after(() => {
  bindingDAOAny.listByTaskSessionId = originalListByTaskSessionId;
  connectorGuideDAOAny.listSessionGuides = originalListSessionGuides;
  connectorGuideServiceAny.recomputeSessionGuides = originalRecomputeSessionGuides;
  currentUserResolverAny.require = originalCurrentUserRequire;
  sessionConnectorServiceAny.assertSessionOwnership = originalAssertSessionOwnership;
  sessionConnectorServiceAny.listSessionConnectors = originalListSessionConnectors;
  sessionConnectorServiceAny.summarizeStatuses = originalSummarizeStatuses;
  connectorGuideServiceAny.ensureSessionGuidesUpToDate = originalEnsureSessionGuidesUpToDate;
});

async function startServer(): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use(mockAuthContextMiddleware());
  app.use('/api/task-creation', taskCreationRoutes);

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const next = app.listen(0, () => resolve(next));
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve test server address');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

test('ensureSessionGuidesUpToDate recomputes when attached connectors differ from session guides', async () => {
  bindingDAOAny.listByTaskSessionId = async () => [
    { connectorKey: 'github', desiredState: 'attached' },
    { connectorKey: 'supabase', desiredState: 'detached' },
  ];
  connectorGuideDAOAny.listSessionGuides = async () => [];

  let recomputeCount = 0;
  connectorGuideServiceAny.recomputeSessionGuides = async (taskSessionId: string) => {
    recomputeCount += 1;
    assert.equal(taskSessionId, 's-recompute');
  };

  const changed = await connectorGuideService.ensureSessionGuidesUpToDate('s-recompute');
  assert.equal(changed, true);
  assert.equal(recomputeCount, 1);
});

test('ensureSessionGuidesUpToDate skips recompute when connector sets already match', async () => {
  bindingDAOAny.listByTaskSessionId = async () => [
    { connectorKey: 'supabase', desiredState: 'attached' },
    { connectorKey: 'github', desiredState: 'attached' },
    { connectorKey: 'custom', desiredState: 'attached' },
  ];
  connectorGuideDAOAny.listSessionGuides = async () => [
    { sessionGuide: { connectorKey: 'github' } },
    { sessionGuide: { connectorKey: 'supabase' } },
  ];

  let recomputeCount = 0;
  connectorGuideServiceAny.recomputeSessionGuides = async () => {
    recomputeCount += 1;
  };

  const changed = await connectorGuideService.ensureSessionGuidesUpToDate('s-skip');
  assert.equal(changed, false);
  assert.equal(recomputeCount, 0);
});

test('buildPromptSections exposes only guide preload instructions before load_connector_guide', async () => {
  connectorGuideDAOAny.listSessionGuides = async () => [
    {
      sessionGuide: {
        connectorKey: 'notion',
        policyId: 'policy-notion',
        revisionId: 'rev-notion',
        triggerMode: 'on_attach',
      },
      revision: {
        serverInstructionsMarkdown:
          'Use the attached Notion MCP router tools exposed in this session. Start with `notion__COMPOSIO_SEARCH_TOOLS` to find Notion actions.',
        guideReminderMarkdown:
          'Identify the target workspace/page/database first, then call `notion__COMPOSIO_SEARCH_TOOLS`.',
        blockingRulesMarkdown: 'Do not use local Notion MCP.',
      },
    },
  ];

  const sections = await connectorGuideService.buildPromptSections('session-guide-preload');
  const combined = `${sections.instructionsSection}\n${sections.reminderSection}`;

  assert.match(combined, /load_connector_guide with connectorKey=notion/);
  assert.doesNotMatch(combined, /Start with `notion__COMPOSIO_SEARCH_TOOLS`/);
  assert.doesNotMatch(combined, /then call `notion__COMPOSIO_SEARCH_TOOLS`/);
  assert.doesNotMatch(combined, /Search tools first/);
});

test('GET /sessions/:sessionId/connectors triggers on-demand guide check', async () => {
  const server = await startServer();
  let ensureCalledWith = '';

  currentUserResolverAny.require = () => ({ userId: 'user-1' });
  sessionConnectorServiceAny.assertSessionOwnership = async (sessionId: string, userId: string) => {
    assert.equal(sessionId, SESSION_ONE_ID);
    assert.equal(userId, 'user-1');
  };
  connectorGuideServiceAny.ensureSessionGuidesUpToDate = async (sessionId: string) => {
    ensureCalledWith = sessionId;
    return true;
  };
  sessionConnectorServiceAny.listSessionConnectors = async () => [{ connectorKey: 'github', attached: true }];
  sessionConnectorServiceAny.summarizeStatuses = (items: unknown[]) => ({ total: items.length });

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/${SESSION_ONE_ID}/connectors`, {
      headers: {
        'x-test-user-id': 'user-1',
      },
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(ensureCalledWith, SESSION_ONE_ID);
    assert.equal(payload.data.summary.total, 1);
  } finally {
    await server.close();
  }
});

test('GET /sessions/:sessionId/connectors still succeeds when on-demand guide check fails', async () => {
  const server = await startServer();

  currentUserResolverAny.require = () => ({ userId: 'user-2' });
  sessionConnectorServiceAny.assertSessionOwnership = async () => undefined;
  connectorGuideServiceAny.ensureSessionGuidesUpToDate = async () => {
    throw new Error('recompute failed');
  };
  sessionConnectorServiceAny.listSessionConnectors = async () => [{ connectorKey: 'supabase', attached: false }];
  sessionConnectorServiceAny.summarizeStatuses = () => ({ total: 1 });

  try {
    const response = await fetch(`${server.origin}/api/task-creation/sessions/${SESSION_TWO_ID}/connectors`, {
      headers: {
        'x-test-user-id': 'user-2',
      },
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.summary.total, 1);
  } finally {
    await server.close();
  }
});
