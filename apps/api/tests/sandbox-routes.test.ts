import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import sandboxRoutes from '../src/routes/sandbox-routes';
import { e2bConnector } from '../src/connectors/e2b-connector';
import { opencodeHttpClient } from '../src/connectors/opencode-http-client';
import { sandboxEnvironmentService } from '../src/services/sandbox-environment-service';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const originalFindEnvironment = sandboxEnvironmentService.findEnvironment;
const originalGetSandboxInfo = e2bConnector.getSandboxInfo;
const originalRunCommand = e2bConnector.runCommand;
const originalEnsureServerReady = opencodeHttpClient.ensureServerReady;

after(() => {
  sandboxEnvironmentService.findEnvironment = originalFindEnvironment;
  e2bConnector.getSandboxInfo = originalGetSandboxInfo;
  e2bConnector.runCommand = originalRunCommand;
  opencodeHttpClient.ensureServerReady = originalEnsureServerReady;
});

async function startServer(): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use('/api/sandbox', sandboxRoutes);

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

test('POST /api/sandbox/environment/:sessionId/connectivity-check falls back to live sandbox metadata', async () => {
  const server = await startServer();
  sandboxEnvironmentService.findEnvironment = async () => null as any;
  e2bConnector.getSandboxInfo = async () =>
    ({
      sandboxId: 'live-only-sandbox',
      metadata: {
        workspaceRoot: '/workspace/live-only-task',
        stateRoot: '/state/live-only-task',
        opencodeBaseUrl: 'https://opencode.live-only.example',
        osacEndpoint: 'http://127.0.0.1:18080',
        e2b: {
          trafficAccessToken: 'token-present',
        },
      },
    }) as any;
  e2bConnector.runCommand = async (_sessionId: string, command: string) => {
    if (command.includes('ss -ltnp')) {
      return { stdout: 'LISTEN 0 128 0.0.0.0:18080', output: '', exitCode: 0 } as any;
    }
    if (command.includes('WORKSPACE_OK')) {
      return { stdout: 'WORKSPACE_OK\nSTATE_OK\n', output: '', exitCode: 0 } as any;
    }
    return { stdout: '', output: '', exitCode: 0 } as any;
  };
  opencodeHttpClient.ensureServerReady = async () => undefined as any;

  try {
    const response = await fetch(`${server.origin}/api/sandbox/environment/live-only-sandbox/connectivity-check`, {
      method: 'POST',
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.source, 'live_only');
    assert.equal(payload.data.workspace.workspaceRoot, '/workspace/live-only-task');
    assert.equal(payload.data.workspace.stateRoot, '/state/live-only-task');
    assert.equal(payload.data.workspace.workspaceReachable, true);
    assert.equal(payload.data.workspace.stateReachable, true);
    assert.equal(payload.data.opencode.reachable, true);
    assert.equal(payload.data.osac.reachable, true);
  } finally {
    await server.close();
  }
});
