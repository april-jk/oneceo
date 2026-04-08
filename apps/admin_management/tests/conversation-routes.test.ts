import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createConversationRoutes } from '../server/routes/conversation-routes';
import { errorMiddleware } from '../server/utils/http';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

async function startServer(service: any): Promise<TestServer> {
  const app = express();
  app.use('/api/conversations', createConversationRoutes(service));
  app.use(errorMiddleware);

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

test('GET /api/conversations/sessions returns service payload', async () => {
  const service = {
    listSessions: async () => ({
      total: 1,
      sessions: [
        {
          id: 's-1',
          title: '会话 1',
          status: 'in_progress',
          stage: 'collecting',
          createdAt: '2026-04-07T00:00:00.000Z',
          updatedAt: '2026-04-07T00:01:00.000Z',
        },
      ],
    }),
  };
  const server = await startServer(service);

  try {
    const response = await fetch(`${server.origin}/api/conversations/sessions?limit=20`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.total, 1);
    assert.equal(payload.data.sessions[0]?.id, 's-1');
  } finally {
    await server.close();
  }
});

test('GET /api/conversations/sessions returns 500 when upstream fails', async () => {
  const service = {
    listSessions: async () => {
      throw new Error('upstream unavailable');
    },
  };
  const server = await startServer(service);

  try {
    const response = await fetch(`${server.origin}/api/conversations/sessions?limit=20`);
    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.equal(payload.success, false);
    assert.equal(payload.error?.message, '服务器内部错误');
  } finally {
    await server.close();
  }
});

