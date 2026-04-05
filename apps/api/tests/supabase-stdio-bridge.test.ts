import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSupabaseBridgeEnvironment,
  buildSupabaseStdioBridgeCommand,
} from '../src/connectors/bridges/supabase-stdio-bridge';

test('supabase bridge command includes session header handling and serialized queue', () => {
  const command = buildSupabaseStdioBridgeCommand();
  assert.match(command, /Mcp-Session-Id/);
  assert.match(command, /mcpSessionId/);
  assert.match(command, /input\.on\('line', \(line\) =>/);
  assert.match(command, /queue = queue\.then\(\(\) => handleLine\(line\)\)/);
  assert.match(command, /SUPABASE_BRIDGE_SESSION_UPDATED/);
});

test('supabase bridge environment preserves proxy and project settings', () => {
  process.env.HTTP_PROXY = 'http://127.0.0.1:7890';
  process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';
  process.env.NO_PROXY = 'localhost,127.0.0.1';

  const env = buildSupabaseBridgeEnvironment({
    accessToken: 'token-123',
    projectUrl: 'https://abc.supabase.co',
    mcpUrl: 'https://mcp.supabase.com/mcp',
    proxyEnabled: true,
  });

  assert.equal(env.SUPABASE_ACCESS_TOKEN, 'token-123');
  assert.equal(env.SUPABASE_PROJECT_URL, 'https://abc.supabase.co');
  assert.equal(env.SUPABASE_MCP_URL, 'https://mcp.supabase.com/mcp');
  assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:7890');
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7890');
  assert.equal(env.NO_PROXY, 'localhost,127.0.0.1');
});
