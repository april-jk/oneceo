import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCodexConfigToml,
  ensurePlaywrightMcpInConfigToml,
} from '../src/utils/codex-runtime-config';

test('codex config uses fixed playwright-mcp command instead of npx lookup', () => {
  const config = buildCodexConfigToml({
    baseUrl: 'https://llmapi.oneceo.ai/v1',
    model: 'gpt-test',
  });

  assert.match(config, /\[mcp_servers\.playwright\]/);
  assert.match(config, /command = "playwright-mcp"/);
  assert.match(config, /args = \["--cdp-endpoint", "http:\/\/127\.0\.0\.1:9222"\]/);
  assert.match(config, /NODE_PATH = "\/usr\/local\/lib\/node_modules"/);
  assert.doesNotMatch(config, /@playwright\/mcp@latest/);
  assert.doesNotMatch(config, /command = "npx"/);
});

test('codex config does not rewrite an existing playwright mcp section', () => {
  const source = [
    '[mcp_servers.playwright]',
    'command = "custom-playwright-mcp"',
    '',
  ].join('\n');

  assert.equal(ensurePlaywrightMcpInConfigToml(source), source);
});
