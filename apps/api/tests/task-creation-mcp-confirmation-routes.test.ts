import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import taskCreationRoutes from '../src/routes/task-creation-routes';
import { mockAuthContextMiddleware } from './helpers/mock-auth-context';
import { sessionConnectorService } from '../src/services/session-connector-service';
import { mcpToolConfirmationService } from '../src/services/mcp-tool-confirmation-service';
import { altusManagedRunService } from '../src/services/altus-managed-run-service';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const sessionConnectorServiceAny = sessionConnectorService as any;
const mcpToolConfirmationServiceAny = mcpToolConfirmationService as any;
const altusManagedRunServiceAny = altusManagedRunService as any;

const originalAssertSessionOwnership = sessionConnectorServiceAny.assertSessionOwnership;
const originalApproveConfirmation = mcpToolConfirmationServiceAny.approveConfirmation;
const originalRejectConfirmation = mcpToolConfirmationServiceAny.rejectConfirmation;
const originalGetPublicSummary = mcpToolConfirmationServiceAny.getPublicSummary;
const originalStartManagedRun = altusManagedRunServiceAny.startRun;

after(() => {
  sessionConnectorServiceAny.assertSessionOwnership = originalAssertSessionOwnership;
  mcpToolConfirmationServiceAny.approveConfirmation = originalApproveConfirmation;
  mcpToolConfirmationServiceAny.rejectConfirmation = originalRejectConfirmation;
  mcpToolConfirmationServiceAny.getPublicSummary = originalGetPublicSummary;
  altusManagedRunServiceAny.startRun = originalStartManagedRun;
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

test('POST /api/task-creation/sessions/:sessionId/mcp-confirmations/:confirmationId/approve directly starts resume run', async () => {
  const server = await startServer();
  let capturedRunStartInput: any = null;
  sessionConnectorServiceAny.assertSessionOwnership = async () => undefined;
  mcpToolConfirmationServiceAny.approveConfirmation = async () => ({
    confirmationId: 'confirmation-1',
    connectorKey: 'google_super',
    toolName: 'google_super__COMPOSIO_MULTI_EXECUTE_TOOL',
    confirmationAgentRunId: 'run-waiting-1',
    confirmationToken: 'token-1',
    expiresAt: '2026-05-04T12:50:00.000Z',
    summary: {
      action: 'google_workspace_write',
      target: 'Quarterly plan',
      impact: '将创建 Google Docs 文档',
      parameterSummary: { title: 'Quarterly plan' },
    },
  });
  altusManagedRunServiceAny.startRun = async (sessionId: string, userId: string, input: any) => {
    capturedRunStartInput = { sessionId, userId, input };
    return { id: 'run-resume-1', sessionId, status: 'queued' };
  };

  try {
    const response = await fetch(
      `${server.origin}/api/task-creation/sessions/session-1/mcp-confirmations/confirmation-1/approve`,
      {
        method: 'POST',
        headers: { 'x-test-user-id': 'user-1' },
      }
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(capturedRunStartInput?.sessionId, 'session-1');
    assert.equal(capturedRunStartInput?.userId, 'user-1');
    assert.equal(capturedRunStartInput?.input?.content, '');
    assert.equal(
      capturedRunStartInput?.input?.metadata?.mcpToolConfirmation?.action,
      'approve'
    );
    assert.equal(
      capturedRunStartInput?.input?.metadata?.mcpToolConfirmation?.confirmationToken,
      'token-1'
    );
    assert.equal(payload.data.run.id, 'run-resume-1');
  } finally {
    await server.close();
  }
});

test('POST /api/task-creation/sessions/:sessionId/mcp-confirmations/:confirmationId/reject directly starts rejection run', async () => {
  const server = await startServer();
  let capturedRunStartInput: any = null;
  sessionConnectorServiceAny.assertSessionOwnership = async () => undefined;
  mcpToolConfirmationServiceAny.rejectConfirmation = async () => ({
    id: 'confirmation-2',
    status: 'rejected',
    connectorKey: 'google_super',
    toolName: 'google_super__COMPOSIO_MULTI_EXECUTE_TOOL',
    agentRunId: 'run-waiting-2',
    summaryJson: {
      action: 'google_workspace_write',
      target: 'Denied doc',
      impact: '将创建 Google Docs 文档',
      parameterSummary: { title: 'Denied doc' },
    },
  });
  mcpToolConfirmationServiceAny.getPublicSummary = (value: unknown) => value;
  altusManagedRunServiceAny.startRun = async (sessionId: string, userId: string, input: any) => {
    capturedRunStartInput = { sessionId, userId, input };
    return { id: 'run-reject-1', sessionId, status: 'queued' };
  };

  try {
    const response = await fetch(
      `${server.origin}/api/task-creation/sessions/session-2/mcp-confirmations/confirmation-2/reject`,
      {
        method: 'POST',
        headers: { 'x-test-user-id': 'user-2' },
      }
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(capturedRunStartInput?.sessionId, 'session-2');
    assert.equal(
      capturedRunStartInput?.input?.metadata?.mcpToolConfirmation?.action,
      'reject'
    );
    assert.equal(payload.data.run.id, 'run-reject-1');
  } finally {
    await server.close();
  }
});
