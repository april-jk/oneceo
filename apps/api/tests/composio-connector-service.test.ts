import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { composioConnectorService } from '../src/services/composio-connector-service';

const originalFetch = global.fetch;

afterEach(() => {
  mock.reset();
  global.fetch = originalFetch;
});

function buildRuntimeContext(connectorKey: 'figma' | 'notion') {
  return {
    connectorKey,
    taskSessionId: `task-${connectorKey}`,
    userId: `user-${connectorKey}`,
    profileId: `profile-${connectorKey}`,
    profileSecret: {
      source: 'composio',
      composioMcpUrl: 'https://composio.example.com/mcp',
      composioMcpHeaders: { 'x-api-key': 'test-key' },
    },
    profileMetadata: { provider: 'composio' },
    catalogItem: {
      key: connectorKey,
      name: connectorKey === 'figma' ? 'Figma' : 'Notion',
      composio: {
        provider: 'composio',
        toolNamePrefix: connectorKey,
        toolkitSlugs: [connectorKey],
        allowedTools: [],
      },
    },
  } as any;
}

test('Figma COMPOSIO_SEARCH_TOOLS uses deterministic platform discovery instead of remote router search', async () => {
  global.fetch = mock.fn(async () => {
    throw new Error('remote search should not be called for Figma tool discovery');
  }) as any;

  const result = await composioConnectorService.executeRpc({
    method: 'tools/call',
    params: {
      name: 'figma__COMPOSIO_SEARCH_TOOLS',
      arguments: {
        queries: [{ use_case: 'verify Figma connection' }],
        session: { generate_id: true },
      },
    },
    runtimeContext: buildRuntimeContext('figma'),
  });

  assert.equal((global.fetch as any).mock.calls.length, 0);
  assert.equal((result as any).toolkit, 'figma');
  assert.equal((result as any).source, 'oneceo_figma_deterministic_tool_discovery');
  assert.ok((result as any).session_id);
  assert.ok(
    ((result as any).tools as Array<{ tool_slug: string }>).some(
      (tool) => tool.tool_slug === 'FIGMA_GET_CURRENT_USER'
    )
  );
  assert.ok(
    ((result as any).tools as Array<{ tool_slug: string }>).some(
      (tool) => tool.tool_slug === 'FIGMA_GET_FILE_METADATA'
    )
  );
});
