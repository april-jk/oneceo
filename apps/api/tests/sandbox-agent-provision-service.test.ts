import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, mock, test } from 'node:test';
import {
  __sandboxAgentProvisionInternalsForTest,
  sandboxAgentProvisionService,
} from '../src/services/sandbox-agent-provision-service';

afterEach(() => {
  mock.reset();
});

test('provisionWithLock shares in-flight work only for the same executor surface', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provisionMock = mock.method(sandboxAgentProvisionService, 'provision', async (input: any) => {
    await gate;
    return {
      sessionId: `sandbox-${input.executor}`,
      allocationSource: 'created',
    } as any;
  });

  const first = sandboxAgentProvisionService.provisionWithLock({
    executor: 'altus',
    metadata: {
      taskSessionId: 'session-lock-1',
    },
  });
  const second = sandboxAgentProvisionService.provisionWithLock({
    executor: 'altus',
    metadata: {
      taskSessionId: 'session-lock-1',
    },
  });
  const third = sandboxAgentProvisionService.provisionWithLock({
    executor: 'opencode',
    metadata: {
      taskSessionId: 'session-lock-1',
    },
  });

  release();
  const [firstResult, secondResult, thirdResult] = await Promise.all([first, second, third]);

  assert.equal(provisionMock.mock.callCount(), 2);
  assert.equal(firstResult.sessionId, 'sandbox-altus');
  assert.equal(secondResult.sessionId, 'sandbox-altus');
  assert.equal(thirdResult.sessionId, 'sandbox-opencode');
});

test('opencode config uses fixed sandbox browser dependency paths', () => {
  const config = JSON.parse(
    __sandboxAgentProvisionInternalsForTest.buildOpencodeConfig({
      OPENAI_BASE_URL: 'https://llmapi.oneceo.ai/v1',
      OPENAI_API_KEY: 'test-key',
      OPENCODE_MODEL: 'gpt-test',
      DISPLAY: ':0',
      PLAYWRIGHT_BROWSERS_PATH: '/opt/ms-playwright',
      NODE_PATH: '/usr/local/lib/node_modules',
      ONECEO_PLAYWRIGHT_CDP_URL: 'http://127.0.0.1:9222',
      ONECEO_PLAYWRIGHT_MCP_COMMAND: 'playwright-mcp',
      ONECEO_BROWSER_USE_COMMAND: 'browser-use',
    })
  );

  assert.deepEqual(config.mcp.browser_use.command, ['browser-use', '--mcp']);
  assert.deepEqual(config.mcp.playwright.command, [
    '/usr/bin/env',
    'DISPLAY=:0',
    'PLAYWRIGHT_HEADLESS=false',
    'PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright',
    'NODE_PATH=/usr/local/lib/node_modules',
    'XDG_RUNTIME_DIR=/tmp',
    'playwright-mcp',
    '--cdp-endpoint',
    'http://127.0.0.1:9222',
  ]);
  assert.doesNotMatch(JSON.stringify(config.mcp.playwright.command), /npx|@playwright\/mcp@latest/);
});

test('sandbox verify script checks fixed browser toolchain locations', () => {
  const script = __sandboxAgentProvisionInternalsForTest.buildSandboxVerifyScript();

  assert.match(script, /command -v playwright/);
  assert.match(script, /command -v playwright-mcp/);
  assert.match(script, /require\.resolve\(\\"playwright\\"\)/);
  assert.match(script, /require\.resolve\(\\"@playwright\/mcp\/package\.json\\"\)/);
  assert.match(script, /ONECEO_PLAYWRIGHT_CDP_URL/);
  assert.match(script, /PLAYWRIGHT_BROWSERS_PATH/);
  assert.match(script, /NODE_PATH/);
  assert.match(script, /ONECEO_NEKO_STATIC_ROOT/);
});

test('e2b templates build playwright-mcp wrapper from package bin metadata', () => {
  for (const relativePath of [
    '../../../e2b_templates/opencode-playwright-mcp/template.ts',
    '../../../e2b_templates/opencode-playwright-mcp-deploy-stable/template.ts',
    '../../../e2b_templates/codex-ws-playwright-sandbox/template.ts',
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');

    assert.match(source, /packageJson\.bin/);
    assert.match(source, /bin\['playwright-mcp'\]/);
    assert.match(source, /\/usr\/local\/bin\/playwright-mcp/);
    assert.match(source, /export NODE_PATH="\\\$\{NODE_PATH:-\/usr\/local\/lib\/node_modules\}"/);
    assert.doesNotMatch(source, /@playwright\/mcp\/cli\.js/);
  }
});
