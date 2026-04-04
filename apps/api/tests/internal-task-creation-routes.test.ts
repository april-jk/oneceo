import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import internalTaskCreationRoutes from '../src/routes/internal-task-creation-routes';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const originalToken = process.env.ONECEO_INTERNAL_TOKEN;

after(() => {
  process.env.ONECEO_INTERNAL_TOKEN = originalToken;
});

async function startServer(): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use('/api/internal', internalTaskCreationRoutes);

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

test('POST /api/internal/task-creation/sessions/:sessionId/runtime/start returns 403 when internal token is not configured', async () => {
  const server = await startServer();
  process.env.ONECEO_INTERNAL_TOKEN = '';

  try {
    const response = await fetch(`${server.origin}/api/internal/task-creation/sessions/session-1/runtime/start`, {
      method: 'POST',
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.success, false);
    assert.equal(payload.error, 'task creation 内部接口未启用');
  } finally {
    await server.close();
  }
});

test('POST /api/internal/task-creation/sessions/:sessionId/runtime/start returns 401 when token is configured but missing', async () => {
  const server = await startServer();
  process.env.ONECEO_INTERNAL_TOKEN = 'internal-secret';

  try {
    const response = await fetch(`${server.origin}/api/internal/task-creation/sessions/session-1/runtime/start`, {
      method: 'POST',
    });
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
    assert.equal(payload.error, '未授权的内部请求');
  } finally {
    await server.close();
  }
});
