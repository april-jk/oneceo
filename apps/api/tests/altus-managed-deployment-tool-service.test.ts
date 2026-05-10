import assert from 'node:assert/strict';
import test from 'node:test';

import { AltusManagedDeploymentToolService } from '../src/services/altus-managed-deployment-tool-service';

function createReadyBaseline() {
  return {
    status: 'ready' as const,
    checkedAt: new Date().toISOString(),
    workspaceDetected: true,
    analyticsMode: 'platform_injected' as const,
    manifestGenerated: false,
    manifestPath: '/tmp/workspace/oneceo.manifest.json',
    templateVersion: '1.0.0',
    appType: 'web_app' as const,
    stack: 'oneceo_fixed_vite_node_shell',
    buildCommand: 'pnpm build',
    startCommand: 'node dist/index.js',
    healthcheckPath: '/api/system/health',
    features: {
      analytics: true,
      userTracking: true,
      database: false,
      auth: 'optional' as const,
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
  };
}

function createReadyProjectProfile() {
  return {
    version: '1.0' as const,
    sessionId: 'session-1',
    updatedAt: new Date().toISOString(),
    artifactType: 'web_app' as const,
    runtimeFamily: 'frontend_dist' as const,
    templateFamily: 'legacy_or_custom' as const,
    deployability: 'ready' as const,
    entrypoints: [{ path: 'index.html', kind: 'html' as const }],
    commands: {
      build: 'pnpm build',
      start: 'node server.js',
    },
    healthcheckPath: '/api/system/health',
    analyticsStatus: 'runtime_injectable' as const,
    configFiles: {
      packageJson: true,
      manifest: true,
      railwayJson: true,
    },
    evidence: [{ source: 'file_scan' as const, message: 'detected runtimeFamily=frontend_dist' }],
  };
}

function createOfficialTemplateProjectProfile() {
  return {
    ...createReadyProjectProfile(),
    templateFamily: 'oneceo_official_vite_node_shell' as const,
    commands: {
      build: 'pnpm build',
      start: 'node dist/index.js',
    },
    evidence: [
      { source: 'file_scan' as const, message: 'detected runtimeFamily=frontend_dist' },
      {
        source: 'file_scan' as const,
        message: 'detected templateFamily=oneceo_official_vite_node_shell',
      },
    ],
  };
}

function createLegacyStaticSiteProfile() {
  return {
    ...createReadyProjectProfile(),
    artifactType: 'static_site' as const,
    runtimeFamily: 'static' as const,
    commands: {
      build: 'npm run build',
      start: 'node dist/index.js',
    },
    evidence: [{ source: 'file_scan' as const, message: 'detected runtimeFamily=static' }],
  };
}

test('deploy_application returns repair_required when baseline is not ready', async () => {
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => ({
      ...createReadyBaseline(),
      status: 'needs_attention',
      checks: {
        build: false,
        start: true,
        analytics: false,
        healthcheck: false,
        database: null,
      },
      errors: ['缺少 package.json scripts.build'],
    }),
    resolveSession: async () => ({
      id: 'session-1',
      messages: [],
    } as any),
    buildDeploymentResponse: async () => {
      throw new Error('should_not_build_response');
    },
    executeDeploymentAction: async () => {
      throw new Error('should_not_execute_action');
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'deploy_application',
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(result.status, 'retryable_repair_required');
  assert.equal(result.phase, 'repair_required');
  assert.deepEqual(result.repair?.checks, [
    'missing_build_script',
    'missing_analytics_entry',
    'missing_healthcheck_route',
  ]);
});

test('redeploy_application republishes current workspace through deployment runtime action', async () => {
  let runtimeAction = '';
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => createReadyBaseline(),
    resolveSession: async () => ({
      id: 'session-1',
      messages: [],
    } as any),
    buildDeploymentResponse: async () => {
      throw new Error('should_not_build_response');
    },
    executeDeploymentAction: async (input) => {
      runtimeAction = input.action;
      return {
        panel: {
          latestStatus: 'SUCCESS',
          latestUrl: 'https://demo.oneceo.app',
          deploymentId: 'dep_123',
        },
        actionResult: {
          action: 'redeploy',
          deploymentId: 'dep_123',
        },
      } as any;
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'redeploy_application',
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(runtimeAction, 'redeploy');
  assert.equal(result.status, 'success');
  assert.equal(result.summary, '重新发布完成，状态 SUCCESS，地址 demo.oneceo.app');
  assert.equal(result.url, 'https://demo.oneceo.app');
});

test('deploy_application returns project profile and succeeded deployment flow on successful publish', async () => {
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => createReadyBaseline(),
    inspectProjectProfile: async () => createOfficialTemplateProjectProfile(),
    resolveSession: async () => ({
      id: 'session-1',
      messages: [],
    } as any),
    buildDeploymentResponse: async () => {
      throw new Error('should_not_build_response');
    },
    executeDeploymentAction: async () => {
      return {
        panel: {
          latestStatus: 'SUCCESS',
          latestUrl: 'https://demo.oneceo.app',
          deploymentId: 'dep_123',
        },
        actionResult: {
          action: 'deploy',
          deploymentId: 'dep_123',
        },
      } as any;
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'deploy_application',
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(result.status, 'success');
  assert.equal(result.projectProfile?.runtimeFamily, 'frontend_dist');
  assert.equal(result.projectProfile?.templateFamily, 'oneceo_official_vite_node_shell');
  assert.equal(result.projectProfile?.deployability, 'ready');
  assert.equal(result.deploymentFlow?.state, 'succeeded');
  assert.equal(result.deploymentFlow?.profile?.runtimeFamily, 'frontend_dist');
});

test('deploy_application requires template repair when frontend_dist project is not on the official shell', async () => {
  let executed = false;
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => createReadyBaseline(),
    inspectProjectProfile: async () => createReadyProjectProfile(),
    resolveSession: async () => ({
      id: 'session-1',
      messages: [],
    } as any),
    buildDeploymentResponse: async () => {
      throw new Error('should_not_build_response');
    },
    executeDeploymentAction: async () => {
      executed = true;
      throw new Error('should_not_execute_action');
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'deploy_application',
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(executed, false);
  assert.equal(result.status, 'retryable_repair_required');
  assert.equal(result.repair?.category, 'template_compliance');
  assert.deepEqual(result.repair?.checks, ['non_official_frontend_template']);
  assert.match(result.summary, /官方固定模板壳/);
});

test('deploy_application requires template repair when static site project is not on the official shell main lane', async () => {
  let executed = false;
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => createReadyBaseline(),
    inspectProjectProfile: async () => createLegacyStaticSiteProfile(),
    resolveSession: async () => ({
      id: 'session-1',
      messages: [],
    } as any),
    buildDeploymentResponse: async () => {
      throw new Error('should_not_build_response');
    },
    executeDeploymentAction: async () => {
      executed = true;
      throw new Error('should_not_execute_action');
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'deploy_application',
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(executed, false);
  assert.equal(result.status, 'retryable_repair_required');
  assert.equal(result.repair?.category, 'template_compliance');
  assert.deepEqual(result.repair?.checks, ['non_official_frontend_template']);
});

test('deploy_application surfaces platform capability failures without asking Altus to repair workspace code', async () => {
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => createReadyBaseline(),
    inspectProjectProfile: async () => createOfficialTemplateProjectProfile(),
    resolveSession: async () => ({
      id: 'session-1',
      messages: [],
    } as any),
    buildDeploymentResponse: async () => {
      throw new Error('should_not_build_response');
    },
    executeDeploymentAction: async () => {
      throw new Error(
        "deployment_platform_capability_not_ready:Playwright smoke test failed because sandbox Playwright capability is unavailable before Railway deployment.\nError: Cannot find module 'playwright'"
      );
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'deploy_application',
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(result.status, 'retryable_repair_required');
  assert.equal(result.repair?.category, 'platform_capability');
  assert.deepEqual(result.repair?.checks, ['sandbox_playwright_unavailable']);
  assert.match(result.summary, /平台预检环境阻断/);
});

test('deploy_application does not require database when session has no explicit declaration', async () => {
  let executed = false;
  const baseline = createReadyBaseline();
  baseline.features.database = false;
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => baseline,
    resolveSession: async () => ({
      id: 'session-1',
      messages: [],
    } as any),
    getProjectAccount: async () => {
      throw new Error('should_not_check_project_account');
    },
    getStorageStatus: async () => {
      throw new Error('should_not_check_storage_status');
    },
    getResourceDeclarations: async () => ({
      database: null,
      storage: null,
    }),
    buildDeploymentResponse: async () => {
      throw new Error('should_not_build_response');
    },
    executeDeploymentAction: async () => {
      executed = true;
      return {
        panel: {
          latestStatus: 'SUCCESS',
          latestUrl: 'https://demo.oneceo.app',
          deploymentId: 'dep_123',
        },
        actionResult: {
          action: 'deploy',
          deploymentId: 'dep_123',
        },
      } as any;
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'deploy_application',
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(executed, true);
  assert.equal(result.status, 'success');
});

test('deploy_application requires database only after explicit session declaration', async () => {
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => createReadyBaseline(),
    resolveSession: async () => ({
      id: 'session-1',
      messages: [],
    } as any),
    getProjectAccount: async () => null,
    getResourceDeclarations: async () => ({
      database: {
        requested: true,
        provisioned: true,
        source: 'tool',
        toolName: 'ensure_project_database',
        updatedAt: new Date().toISOString(),
      },
      storage: null,
    }),
    buildDeploymentResponse: async () => {
      throw new Error('should_not_build_response');
    },
    executeDeploymentAction: async () => {
      throw new Error('should_not_execute_action');
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'deploy_application',
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(result.status, 'retryable_repair_required');
  assert.equal(result.phase, 'repair_required');
  assert.equal(result.repair?.category, 'deployment_configuration');
  assert.deepEqual(result.repair?.checks, ['database_resource_missing']);
  assert.match(result.summary, /当前会话已显式声明需要数据库/);
});

test('deploy_application requires storage when manifest explicitly enables object storage', async () => {
  const baseline = createReadyBaseline();
  baseline.features.objectStorage = true;
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => baseline,
    resolveSession: async () => ({
      id: 'session-1',
      messages: [],
    } as any),
    getStorageStatus: async () => ({ configured: false }) as any,
    getResourceDeclarations: async () => ({
      database: null,
      storage: null,
    }),
    buildDeploymentResponse: async () => {
      throw new Error('should_not_build_response');
    },
    executeDeploymentAction: async () => {
      throw new Error('should_not_execute_action');
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'deploy_application',
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(result.status, 'retryable_repair_required');
  assert.equal(result.phase, 'repair_required');
  assert.deepEqual(result.repair?.checks, ['object_storage_resource_missing']);
  assert.match(result.summary, /manifest 已明确声明需要对象存储/);
});

test('deploy_application returns deployment_pending while Railway is still provisioning', async () => {
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => createReadyBaseline(),
    resolveSession: async () => ({
      id: 'session-1',
      messages: [],
    } as any),
    buildDeploymentResponse: async () => {
      throw new Error('should_not_build_response');
    },
    executeDeploymentAction: async () => {
      return {
        panel: {
          bindingState: 'provisioning',
          activeDeploymentPending: true,
          latestStatus: 'INITIALIZING',
          latestUrl: 'https://demo.oneceo.app',
          deploymentId: 'dep_123',
          message: 'Railway 已返回部署版本，后台正在同步公网可达性与部署状态。',
        },
        actionResult: {
          action: 'deploy',
          deploymentId: 'dep_123',
        },
      } as any;
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'deploy_application',
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(result.status, 'retryable_repair_required');
  assert.equal(result.repair?.category, 'deployment_pending');
  assert.equal(result.deploymentStatus, 'INITIALIZING');
  assert.equal(result.url, 'https://demo.oneceo.app');
});

test('get_application_deployment_status treats public_settling with SUCCESS and public URL as success', async () => {
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => createReadyBaseline(),
    resolveSession: async () => ({
      id: 'session-1',
      messages: [],
    } as any),
    buildDeploymentResponse: async () => ({
      bindingState: 'public_settling',
      activeDeploymentPending: true,
      latestStatus: 'SUCCESS',
      latestUrl: 'https://demo.oneceo.app',
      deploymentId: 'dep_123',
      message: '发布完成，正在等待公网生效。',
    } as any),
    executeDeploymentAction: async () => {
      throw new Error('should_not_execute_action');
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'get_application_deployment_status',
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(result.status, 'success');
  assert.equal(result.phase, 'completed');
  assert.equal(result.bindingState, 'public_settling');
  assert.equal(result.deploymentStatus, 'SUCCESS');
  assert.equal(result.url, 'https://demo.oneceo.app');
});

test('get_application_deployment_status returns structured success payload', async () => {
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => createReadyBaseline(),
    resolveSession: async () => ({
      id: 'session-1',
      messages: [],
    } as any),
    buildDeploymentResponse: async () => ({
      latestStatus: 'SUCCESS',
      latestUrl: 'https://demo.oneceo.app',
      deploymentId: 'dep_123',
      message: '当前部署状态：SUCCESS；访问地址：demo.oneceo.app',
    } as any),
    executeDeploymentAction: async () => {
      throw new Error('should_not_execute_action');
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'get_application_deployment_status',
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(result.status, 'success');
  assert.equal(result.phase, 'completed');
  assert.equal(result.deploymentStatus, 'SUCCESS');
  assert.equal(result.url, 'https://demo.oneceo.app');
});

test('get_application_deployment_status returns repair_required when Railway deployment failed', async () => {
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => createReadyBaseline(),
    resolveSession: async () => ({
      id: 'session-1',
      messages: [],
    } as any),
    buildDeploymentResponse: async () => ({
      bindingState: 'ready',
      activeDeploymentPending: false,
      latestStatus: 'FAILED',
      latestUrl: 'https://app-demo.up.railway.app',
      deploymentId: 'dep_failed',
      message: '部署平台已返回成功状态，但公网访问验证失败。部署已完成，但公网地址尚未就绪: https://app-demo.up.railway.app/ -> 404 (Application not found)',
    } as any),
    executeDeploymentAction: async () => {
      throw new Error('should_not_execute_action');
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'get_application_deployment_status',
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(result.status, 'retryable_repair_required');
  assert.equal(result.phase, 'repair_required');
  assert.equal(result.repair?.category, 'deployment_failed');
  assert.equal(result.deploymentStatus, 'FAILED');
  assert.equal(result.url, 'https://app-demo.up.railway.app');
  assert.match(result.repair?.checks.join(',') || '', /public_access_failed/);
});

test('deploy_application returns repair_required when deployment action ends with failed status', async () => {
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => createReadyBaseline(),
    resolveSession: async () => ({
      id: 'session-1',
      messages: [],
    } as any),
    buildDeploymentResponse: async () => {
      throw new Error('should_not_build_response');
    },
    executeDeploymentAction: async () => {
      return {
        panel: {
          bindingState: 'ready',
          activeDeploymentPending: false,
          latestStatus: 'FAILED',
          latestUrl: 'https://app-demo.up.railway.app',
          deploymentId: 'dep_failed',
          message: '部署完成，状态 FAILED，地址 app-demo.up.railway.app',
        },
        actionResult: {
          action: 'deploy',
          deploymentId: 'dep_failed',
        },
      } as any;
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'deploy_application',
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(result.status, 'retryable_repair_required');
  assert.equal(result.phase, 'repair_required');
  assert.equal(result.repair?.category, 'deployment_failed');
  assert.equal(result.deploymentStatus, 'FAILED');
  assert.equal(result.deploymentId, 'dep_failed');
});

test('deploy_application returns deployment_failed when public reachability validation throws', async () => {
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => createReadyBaseline(),
    resolveSession: async () => ({
      id: 'session-1',
      messages: [],
    } as any),
    buildDeploymentResponse: async () => {
      throw new Error('should_not_build_response');
    },
    executeDeploymentAction: async () => {
      throw new Error('部署平台已返回成功状态，但公网访问验证失败。部署已完成，但公网地址尚未就绪: https://app-demo.up.railway.app/ -> 404 (Application not found)');
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'deploy_application',
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(result.status, 'retryable_repair_required');
  assert.equal(result.phase, 'repair_required');
  assert.equal(result.repair?.category, 'deployment_failed');
  assert.match(result.summary, /公网访问验证失败/);
  assert.match(result.debug?.rawError || '', /Application not found/);
});

test('deploy_application returns local_preflight repair when sandbox validation fails before Railway', async () => {
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => createReadyBaseline(),
    resolveSession: async () => ({
      id: 'session-1',
      messages: [],
    } as any),
    buildDeploymentResponse: async () => {
      throw new Error('should_not_build_response');
    },
    executeDeploymentAction: async () => {
      throw new Error(
        'deployment_preflight_not_ready:本地运行验收未通过，已停止 Railway 发布。\nphase=build\nbuildLog=Unexpected token in App.jsx'
      );
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'deploy_application',
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(result.status, 'retryable_repair_required');
  assert.equal(result.phase, 'repair_required');
  assert.equal(result.repair?.category, 'local_preflight');
  assert.match(result.debug?.rawError || '', /Unexpected token in App\.jsx/);
});

test('deploy_application returns fatal_error when provider error remains after ready baseline', async () => {
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => createReadyBaseline(),
    resolveSession: async () => ({
      id: 'session-1',
      messages: [],
    } as any),
    buildDeploymentResponse: async () => {
      throw new Error('should_not_build_response');
    },
    executeDeploymentAction: async () => {
      throw new Error('平台部署供应链接入未完成');
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'deploy_application',
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(result.status, 'fatal_error');
  assert.equal(result.phase, 'failed');
  assert.match(result.summary, /发布暂未完成/);
  assert.match(result.debug?.rawError || '', /平台部署供应链接入未完成/);
});

test('rollback_application_deployment routes through rollback runtime action', async () => {
  let runtimeAction = '';
  const service = new AltusManagedDeploymentToolService({
    inspectBaseline: async () => createReadyBaseline(),
    resolveSession: async () => ({
      id: 'session-1',
      messages: [],
    } as any),
    buildDeploymentResponse: async () => {
      throw new Error('should_not_build_response');
    },
    executeDeploymentAction: async (input) => {
      runtimeAction = input.action;
      return {
        panel: {
          latestStatus: 'SUCCESS',
          latestUrl: 'https://demo.oneceo.app',
          deploymentId: 'dep_123',
        },
        actionResult: {
          action: 'rollback',
          deploymentId: 'dep_123',
        },
      } as any;
    },
    getErrorMessage: (error) => String((error as Error)?.message || error),
  });

  const result = await service.execute({
    action: 'rollback_application_deployment',
    sessionId: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
  });

  assert.equal(runtimeAction, 'rollback');
  assert.equal(result.status, 'success');
  assert.match(result.summary, /回滚完成/);
});
