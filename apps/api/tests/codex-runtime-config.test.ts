import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCodexConfigToml,
  buildCodexAuthJson,
  ensurePlaywrightMcpInConfigToml,
  SANDBOX_LOCAL_LLM_PROXY_API_KEY,
  SANDBOX_LOCAL_LLM_PROXY_BASE_URL,
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

test('sandbox codex runtime points at local OSAC proxy with placeholder auth', () => {
  const config = buildCodexConfigToml({
    baseUrl: SANDBOX_LOCAL_LLM_PROXY_BASE_URL,
    model: 'gpt-test',
  });
  const auth = JSON.parse(buildCodexAuthJson({ apiKey: SANDBOX_LOCAL_LLM_PROXY_API_KEY }));

  assert.match(config, /base_url = "http:\/\/127\.0\.0\.1:18111"/);
  assert.equal(auth.OPENAI_API_KEY, SANDBOX_LOCAL_LLM_PROXY_API_KEY);
});
