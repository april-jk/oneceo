import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { e2bConnector } from '../src/connectors/e2b-connector';
import {
  formatTaskSessionDeploymentLocalPreflightFailure,
  isTaskSessionDeploymentLocalPreflightSupported,
  runTaskSessionDeploymentLocalPreflight,
} from '../src/services/task-session-deployment-local-preflight-service';
import type { DeploymentTemplateBaselineData } from '../src/services/task-creation-deployment-source-service';

function createBaseline(overrides: Partial<DeploymentTemplateBaselineData> = {}): DeploymentTemplateBaselineData {
  return {
    status: 'ready',
    checkedAt: new Date().toISOString(),
    workspaceDetected: true,
    analyticsMode: 'platform_injected',
    manifestGenerated: false,
    manifestPath: '/workspace/oneceo.manifest.json',
    templateVersion: '1.0.0',
    appType: 'web_app',
    stack: 'oneceo_fixed_vite_node_shell',
    buildCommand: 'npm run build',
    startCommand: 'node dist/index.js',
    healthcheckPath: '/api/system/health',
    features: {
      analytics: true,
      userTracking: true,
      database: false,
      auth: 'optional',
      objectStorage: false,
    },
    checks: {
      build: true,
      start: true,
      analytics: true,
      healthcheck: true,
      database: null,
    },
    warnings: [],
    errors: [],
    ...overrides,
  };
}

test('local deployment preflight runs manifest build/start/browser smoke for supported web stacks', async () => {
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async (_sandboxId, command, options) => {
    assert.match(command, /pnpm install --frozen-lockfile/);
    assert.match(command, /npm install --package-lock=false/);
    assert.match(command, /sh -lc "\$build_command"/);
    assert.match(command, /ONECEO_PREFLIGHT_ROOT_URL/);
    assert.equal(options?.cwd, '/workspace/app');
    return {
      stdout:
        '__ONECEO_DEPLOYMENT_LOCAL_PREFLIGHT__' +
        JSON.stringify({
          status: 'passed',
          phase: 'browser_smoke',
          checkedAt: new Date().toISOString(),
          buildCommand: 'npm run build',
          startCommand: 'node dist/index.js',
          rootUrl: 'http://127.0.0.1:18123/',
          browserMode: 'playwright_node',
        }),
      exitCode: 0,
    };
  });

  try {
    const report = await runTaskSessionDeploymentLocalPreflight({
      orchestratorSessionId: 'sandbox-1',
      workspaceRoot: '/workspace/app',
      baseline: createBaseline(),
    });

    assert.equal(report.status, 'passed');
    assert.equal(report.phase, 'browser_smoke');
    assert.equal(report.browserMode, 'playwright_node');
    assert.equal(runCommandMock.mock.callCount(), 1);
  } finally {
    mock.restoreAll();
  }
});

test('local deployment preflight skips stacks outside the current node/js/html fast lane', async () => {
  const runCommandMock = mock.method(e2bConnector, 'runCommand', async () => {
    throw new Error('should_not_run');
  });

  try {
    const baseline = createBaseline({
      stack: 'java_spring_boot_thymeleaf_dbless',
      buildCommand: './mvnw package',
      startCommand: 'java -jar target/app.jar',
    });

    assert.equal(isTaskSessionDeploymentLocalPreflightSupported(baseline), false);
    const report = await runTaskSessionDeploymentLocalPreflight({
      orchestratorSessionId: 'sandbox-1',
      workspaceRoot: '/workspace/app',
      baseline,
    });

    assert.equal(report.status, 'skipped');
    assert.equal(report.phase, 'unsupported');
    assert.equal(runCommandMock.mock.callCount(), 0);
  } finally {
    mock.restoreAll();
  }
});

test('local deployment preflight formats failed build evidence for Altus repair', async () => {
  mock.method(e2bConnector, 'runCommand', async () => ({
    stdout:
      '__ONECEO_DEPLOYMENT_LOCAL_PREFLIGHT__' +
      JSON.stringify({
        status: 'failed',
        phase: 'build',
        checkedAt: new Date().toISOString(),
        message: 'Build command failed before Railway deployment.',
        buildCommand: 'npm run build',
        buildOutput: 'Unexpected token in App.jsx',
      }),
    exitCode: 0,
  }));

  try {
    const report = await runTaskSessionDeploymentLocalPreflight({
      orchestratorSessionId: 'sandbox-1',
      workspaceRoot: '/workspace/app',
      baseline: createBaseline(),
    });
    const formatted = formatTaskSessionDeploymentLocalPreflightFailure(report);

    assert.equal(report.status, 'failed');
    assert.equal(report.phase, 'build');
    assert.match(formatted, /已停止 Railway 发布/);
    assert.match(formatted, /Unexpected token in App\.jsx/);
  } finally {
    mock.restoreAll();
  }
});
