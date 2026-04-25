import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import readline from 'node:readline';
import { afterEach, test } from 'node:test';
import {
  buildVercelBridgeEnvironment,
  buildVercelStdioBridgeCommand,
} from '../src/connectors/bridges/vercel-stdio-bridge';

type BridgeHandle = {
  child: ChildProcessWithoutNullStreams;
  nextMessage: () => Promise<Record<string, any>>;
};

const openServers = new Set<http.Server>();
const openBridges = new Set<BridgeHandle>();

afterEach(async () => {
  for (const bridge of openBridges) {
    bridge.child.stdin.end();
    if (!bridge.child.killed) {
      bridge.child.kill();
    }
    await once(bridge.child, 'exit').catch(() => undefined);
  }
  openBridges.clear();

  for (const server of openServers) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  openServers.clear();
});

async function startTestServer(
  handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void | Promise<void>
) {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', async () => {
      await handler(req, Buffer.concat(chunks).toString('utf8'), res);
    });
  });
  openServers.add(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('无法获取测试服务端口');
  }
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
  };
}

function startBridge(env: Record<string, string>): BridgeHandle {
  const child = spawn(process.execPath, ['-e', buildVercelStdioBridgeCommand()], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...env,
    },
  });
  const stdout = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const lines: string[] = [];
  const waiters: Array<(line: string) => void> = [];

  stdout.on('line', (line) => {
    const next = waiters.shift();
    if (next) {
      next(line);
      return;
    }
    lines.push(line);
  });

  const handle = {
    child,
    nextMessage: async () => {
      if (lines.length > 0) {
        return JSON.parse(lines.shift() || '{}');
      }
      const line = await new Promise<string>((resolve) => waiters.push(resolve));
      return JSON.parse(line);
    },
  };
  openBridges.add(handle);
  return handle;
}

test('vercel stdio bridge forwards rpc calls and reuses mcp session header', async () => {
  const requests: Array<{ headers: http.IncomingHttpHeaders; payload: any }> = [];
  const { url } = await startTestServer(async (req, body, res) => {
    const payload = JSON.parse(body);
    requests.push({ headers: req.headers, payload });

    if (payload.method === 'initialize') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': 'session-bridge-1',
      });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            serverInfo: { name: 'vercel-test', version: '1.0.0' },
            capabilities: { tools: {} },
          },
        })
      );
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: payload.id,
        result: {
          tools: [{ name: 'vercel_list_projects' }],
        },
      })
    );
  });

  const bridge = startBridge(
    buildVercelBridgeEnvironment({
      mcpUrl: url,
      internalToken: 'internal-token',
      runtimeAuth: 'runtime-auth-token',
      proxyEnabled: false,
    })
  );

  bridge.child.stdin.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    })}\n`
  );
  const initializeReply = await bridge.nextMessage();
  assert.equal(initializeReply.id, 1);
  assert.equal(initializeReply.result?.serverInfo?.name, 'vercel-test');

  bridge.child.stdin.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    })}\n`
  );
  const toolsReply = await bridge.nextMessage();
  assert.equal(toolsReply.id, 2);
  assert.equal(toolsReply.result?.tools?.[0]?.name, 'vercel_list_projects');

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.headers['x-oneceo-internal-token'], 'internal-token');
  assert.equal(
    requests[0]?.headers['x-oneceo-connector-runtime-auth'],
    'runtime-auth-token'
  );
  assert.equal(requests[0]?.headers['mcp-session-id'], undefined);
  assert.equal(requests[1]?.headers['mcp-session-id'], 'session-bridge-1');
  assert.equal(requests[0]?.payload.method, 'initialize');
  assert.equal(requests[1]?.payload.method, 'tools/list');
});

test('vercel stdio bridge returns upstream http errors as json-rpc errors', async () => {
  const { url } = await startTestServer(async (_req, _body, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
  });

  const bridge = startBridge(
    buildVercelBridgeEnvironment({
      mcpUrl: url,
      internalToken: 'internal-token',
      runtimeAuth: 'runtime-auth-token',
      proxyEnabled: false,
    })
  );

  bridge.child.stdin.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
      params: {},
    })}\n`
  );
  const reply = await bridge.nextMessage();
  assert.equal(reply.id, 3);
  assert.equal(reply.error?.code, -32000);
  assert.match(String(reply.error?.message || ''), /HTTP 401/);
});
