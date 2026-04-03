import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import internalConnectorGuideRoutes from '../src/routes/internal-connector-guide-routes';
import { connectorGuideService } from '../src/services/connector-guide-service';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const connectorGuideServiceAny = connectorGuideService as any;
const originalToken = process.env.ONECEO_INTERNAL_TOKEN;
const originalListPolicies = connectorGuideServiceAny.listPolicies;
const originalListSessionGuides = connectorGuideServiceAny.listSessionGuides;

after(() => {
  process.env.ONECEO_INTERNAL_TOKEN = originalToken;
  connectorGuideServiceAny.listPolicies = originalListPolicies;
  connectorGuideServiceAny.listSessionGuides = originalListSessionGuides;
});

async function startServer(): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use('/api/internal', internalConnectorGuideRoutes);

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

test('GET /api/internal/connector-guides returns 403 when internal token is not configured', async () => {
  const server = await startServer();
  process.env.ONECEO_INTERNAL_TOKEN = '';

  try {
    const response = await fetch(`${server.origin}/api/internal/connector-guides`);
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.success, false);
    assert.equal(payload.error, 'connector guide 内部接口未启用');
  } finally {
    await server.close();
  }
});

test('GET /api/internal/connector-guides returns 401 when token is configured but missing', async () => {
  const server = await startServer();
  process.env.ONECEO_INTERNAL_TOKEN = 'internal-secret';

  try {
    const response = await fetch(`${server.origin}/api/internal/connector-guides`);
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
    assert.equal(payload.error, '未授权的内部请求');
  } finally {
    await server.close();
  }
});

test('GET /api/internal/connector-guides returns list with valid token', async () => {
  const server = await startServer();
  process.env.ONECEO_INTERNAL_TOKEN = 'internal-secret';
  connectorGuideServiceAny.listPolicies = async () => [{ id: 'policy-1', connectorKey: 'supabase' }];

  try {
    const response = await fetch(`${server.origin}/api/internal/connector-guides`, {
      headers: {
        'x-oneceo-internal-token': 'internal-secret',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.length, 1);
    assert.equal(payload.data[0].id, 'policy-1');
  } finally {
    await server.close();
  }
});

test('GET /api/internal/connector-guides-debug/sessions/:taskSessionId returns session guides with valid token', async () => {
  const server = await startServer();
  process.env.ONECEO_INTERNAL_TOKEN = 'internal-secret';
  connectorGuideServiceAny.listSessionGuides = async (taskSessionId: string) => {
    assert.equal(taskSessionId, 'session-1');
    return [{ sessionGuide: { connectorKey: 'supabase' } }];
  };

  try {
    const response = await fetch(`${server.origin}/api/internal/connector-guides-debug/sessions/session-1`, {
      headers: {
        'x-oneceo-internal-token': 'internal-secret',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.length, 1);
    assert.equal(payload.data[0].sessionGuide.connectorKey, 'supabase');
  } finally {
    await server.close();
  }
});
