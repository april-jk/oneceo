import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, mock, test } from 'node:test';
import {
  __sandboxAgentProvisionInternalsForTest,
  sandboxAgentProvisionService,
} from '../src/services/sandbox-agent-provision-service';
import {
  SANDBOX_LOCAL_LLM_PROXY_API_KEY,
  SANDBOX_LOCAL_LLM_PROXY_BASE_URL,
} from '../src/utils/codex-runtime-config';

afterEach(() => {
  mock.reset();
});

function withProcessEnv(values: Record<string, string | undefined>, fn: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(values)) {
    previous.set(key, process.env[key]);
    const next = values[key];
    if (next === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = next;
    }
  }
  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

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

test('sandbox info transient control-plane errors are classified separately from sandbox death', () => {
  assert.equal(
    __sandboxAgentProvisionInternalsForTest.isSandboxControlPlaneTransientError(
      new TypeError('fetch failed')
    ),
    true
  );
  assert.equal(
    __sandboxAgentProvisionInternalsForTest.isSandboxControlPlaneTransientError(
      new Error('Client network socket disconnected before secure TLS connection was established')
    ),
    true
  );
  assert.equal(
    __sandboxAgentProvisionInternalsForTest.isSandboxControlPlaneTransientError(
      new Error('sandbox was not found')
    ),
    false
  );
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

test('sandbox env never exposes host LLM secrets to user-controlled sandboxes', () => {
  withProcessEnv(
    {
      OPENAI_API_KEY: 'host-openai-secret',
      CODEX_API_KEY: 'host-codex-secret',
      OPENCODE_API_KEY: 'host-opencode-secret',
      ANTHROPIC_API_KEY: 'host-anthropic-secret',
      GEMINI_API_KEY: 'host-gemini-secret',
      SANDBOX_OPENAI_API_KEY: 'legacy-sandbox-secret',
      SANDBOX_OPENAI_BASE_URL: 'https://legacy-sandbox.example/v1',
      SANDBOX_ENGINE_OPENCODE_API_KEY: 'engine-opencode-secret',
      SANDBOX_ENGINE_OPENCODE_BASE_URL: 'https://engine-opencode.example/v1',
      SANDBOX_ENGINE_CODEX_API_KEY: 'engine-codex-secret',
      SANDBOX_ENGINE_CODEX_BASE_URL: 'https://engine-codex.example/v1',
    },
    () => {
      for (const executor of ['opencode', 'codex'] as const) {
        const env = __sandboxAgentProvisionInternalsForTest.buildSandboxEnv(executor);
        assert.equal(env.OPENAI_API_KEY, SANDBOX_LOCAL_LLM_PROXY_API_KEY);
        assert.equal(env.CODEX_API_KEY, SANDBOX_LOCAL_LLM_PROXY_API_KEY);
        assert.equal(env.OPENCODE_API_KEY, SANDBOX_LOCAL_LLM_PROXY_API_KEY);
        assert.equal(env.OPENAI_BASE_URL, SANDBOX_LOCAL_LLM_PROXY_BASE_URL);
        assert.equal(env.OPENAI_API_BASE, SANDBOX_LOCAL_LLM_PROXY_BASE_URL);
        assert.equal(env.CODEX_BASE_URL, SANDBOX_LOCAL_LLM_PROXY_BASE_URL);
        assert.equal(env.OPENCODE_BASE_URL, SANDBOX_LOCAL_LLM_PROXY_BASE_URL);
        assert.equal(env.LLM_PROXY_UPSTREAM_API_TYPE, 'openai');
        assert.equal(env.ANTHROPIC_API_KEY, undefined);
        assert.equal(env.GEMINI_API_KEY, undefined);
        assert.doesNotMatch(JSON.stringify(env), /host-|legacy-sandbox-secret|engine-/);
      }
    }
  );
});

test('opencode config writes only local proxy credential placeholders', () => {
  const env = __sandboxAgentProvisionInternalsForTest.buildSandboxEnv('opencode');
  const config = JSON.parse(__sandboxAgentProvisionInternalsForTest.buildOpencodeConfig(env));

  assert.equal(config.provider.openai.options.baseURL, SANDBOX_LOCAL_LLM_PROXY_BASE_URL);
  assert.equal(config.provider.openai.options.apiKey, SANDBOX_LOCAL_LLM_PROXY_API_KEY);
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

test('e2b browser templates pin browser toolchain package versions', () => {
  for (const relativePath of [
    '../../../e2b_templates/opencode-playwright-mcp/template.ts',
    '../../../e2b_templates/opencode-playwright-mcp-deploy-stable/template.ts',
    '../../../e2b_templates/codex-ws-playwright-sandbox/template.ts',
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');

    assert.match(source, /const playwrightVersion = readTemplateVersion/);
    assert.match(source, /const playwrightMcpVersion = readTemplateVersion/);
    assert.match(source, /const browserUseVersion = readTemplateVersion/);
    assert.match(source, /playwright@\$\{playwrightVersion\}/);
    assert.match(source, /@playwright\/mcp@\$\{playwrightMcpVersion\}/);
    assert.match(source, /browser-use==\$\{browserUseVersion\}/);
    assert.doesNotMatch(source, /@playwright\/mcp@latest/);
    assert.doesNotMatch(source, /npm install -g playwright @playwright\/mcp/);
    assert.doesNotMatch(source, /pip install browser-use['"`]/);
  }
});

test('opencode browser templates pin n.eko source and binary versions', () => {
  for (const relativePath of [
    '../../../e2b_templates/opencode-playwright-mcp/template.ts',
    '../../../e2b_templates/opencode-playwright-mcp-deploy-stable/template.ts',
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');

    assert.match(source, /const nekoVersion = readTemplateVersion/);
    assert.match(source, /neko\/server\/cmd\/neko@\$\{nekoVersion\}/);
    assert.match(source, /git clone --depth 1 --branch \$\{nekoVersion\}/);
    assert.match(source, /ONECEO_TEMPLATE_NEKO_VERSION/);
    assert.doesNotMatch(source, /neko\/server\/cmd\/neko@latest/);
    assert.doesNotMatch(source, /git clone --depth 1 https:\/\/github\.com\/m1k1o\/neko\.git/);
  }
});

test('e2b browser templates read version overrides when buildTemplate is called', () => {
  for (const relativePath of [
    '../../../e2b_templates/opencode-playwright-mcp/template.ts',
    '../../../e2b_templates/opencode-playwright-mcp-deploy-stable/template.ts',
    '../../../e2b_templates/codex-ws-playwright-sandbox/template.ts',
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    const buildTemplateIndex = source.indexOf('export function buildTemplate');

    assert.ok(buildTemplateIndex >= 0, `${relativePath} must export buildTemplate`);
    assert.ok(
      source.indexOf('const playwrightVersion = readTemplateVersion', buildTemplateIndex) > buildTemplateIndex
    );
    assert.ok(
      source.indexOf('const playwrightMcpVersion = readTemplateVersion', buildTemplateIndex) > buildTemplateIndex
    );
    assert.ok(
      source.indexOf('const browserUseVersion = readTemplateVersion', buildTemplateIndex) > buildTemplateIndex
    );

    const topLevelVersionBlock = source.slice(0, buildTemplateIndex);
    assert.doesNotMatch(topLevelVersionBlock, /const playwrightVersion = readTemplateVersion/);
    assert.doesNotMatch(topLevelVersionBlock, /const playwrightMcpVersion = readTemplateVersion/);
    assert.doesNotMatch(topLevelVersionBlock, /const browserUseVersion = readTemplateVersion/);
  }
});
