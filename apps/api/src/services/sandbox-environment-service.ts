import { e2bConnector } from '../connectors/e2b-connector';
import { e2bConfig } from '../config/e2b-config';
import { sandboxExecutionEnvironmentDAO } from '../db/dao';
import { ensureDatabaseConnection } from '../config/database';
import { sandboxSecurityConfig } from '../config/sandbox-security';

function isE2bEnvironment(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata) return false;
  return String(metadata.sandboxProvider || '').toLowerCase() === 'e2b';
}

export class SandboxEnvironmentService {
  private buildSecurityProfile() {
    return {
      mode: 'e2b',
      provider: 'e2b',
      denyCidrs: sandboxSecurityConfig.denyCidrs,
      allowedDomains: sandboxSecurityConfig.allowedDomains,
    };
  }

  async openEnvironment(input: {
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
    bind?: Record<string, unknown>;
    envs?: Record<string, string>;
  }) {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
    const sandbox = await e2bConnector.createSandbox({
      template: e2bConfig.template,
      metadata: input.metadata || {},
      envs: input.envs,
      timeoutMs: e2bConfig.timeoutMs,
      allowInternetAccess: e2bConfig.allowInternetAccess,
      allowPublicTraffic: e2bConfig.allowPublicTraffic,
    });

    const securityProfile = this.buildSecurityProfile();
    const mapping = {
      baseImage: e2bConfig.template,
      incrementalStorageDir: 'e2b',
      incrementalFileName: sandbox.sandboxId,
      incrementalFilePath: sandbox.sandboxId,
    };

    const metadata: Record<string, unknown> = {
      ...(input.metadata || {}),
      sandboxProvider: 'e2b',
      lastActiveAt: new Date().toISOString(),
      lastActiveReason: 'create',
      e2b: {
        sandboxId: sandbox.sandboxId,
        template: e2bConfig.template,
        sandboxDomain: sandbox.sandboxDomain,
        trafficAccessToken: sandbox.trafficAccessToken || null,
      },
    };

    const existed = await sandboxExecutionEnvironmentDAO.getBySessionId(sandbox.sandboxId);
    if (!existed) {
      await sandboxExecutionEnvironmentDAO.createEnvironment({
        sessionId: sandbox.sandboxId,
        orchestratorSessionId: sandbox.sandboxId,
        vmName: null,
        baseImage: mapping.baseImage,
        incrementalStorageDir: mapping.incrementalStorageDir,
        incrementalFileName: mapping.incrementalFileName,
        incrementalFilePath: mapping.incrementalFilePath,
        status: 'ready',
        securityProfile,
        networkPolicy: {
          mode: 'e2b',
          denyCidrs: sandboxSecurityConfig.denyCidrs,
          allowedDomains: sandboxSecurityConfig.allowedDomains,
        },
        metadata,
      });
    } else {
      await sandboxExecutionEnvironmentDAO.updateMetadata(sandbox.sandboxId, {
        ...(existed.metadata || {}),
        ...metadata,
      });
      await sandboxExecutionEnvironmentDAO.updateStatus(sandbox.sandboxId, 'ready', existed.vmName || null);
    }

    return {
      sessionId: sandbox.sandboxId,
      vmName: null,
      status: 'ready',
      attempt: 1,
      storage: mapping,
      security: securityProfile,
      orchestrator: {
        createRequestId: sandbox.sandboxId,
        bindRequestId: sandbox.sandboxId,
        vmRequestId: sandbox.sandboxId,
      },
    };
  }

  async closeEnvironment(sessionId: string) {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });

    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
    if (!environment) {
      throw new Error(`未找到环境记录: ${sessionId}`);
    }
    const metadata = ((environment.metadata || {}) as Record<string, unknown>) || {};
    const isE2b = isE2bEnvironment(metadata);

    await sandboxExecutionEnvironmentDAO.updateStatus(sessionId, 'closing', environment.vmName || null);
    if (isE2b) {
      await e2bConnector.killSandbox(environment.orchestratorSessionId);
    }

    const updated = await sandboxExecutionEnvironmentDAO.updateStatus(
      sessionId,
      'closed',
      environment.vmName || null
    );

    return {
      sessionId,
      vmName: updated?.vmName,
      status: updated?.status || 'closed',
      closedAt: updated?.closedAt,
    };
  }

  async getEnvironment(sessionId: string) {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
    if (!environment) {
      throw new Error(`未找到环境记录: ${sessionId}`);
    }
    return environment;
  }

  async findEnvironment(sessionId: string) {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
    return sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
  }

  async listEnvironments(limit: number = 20) {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
    return sandboxExecutionEnvironmentDAO.listRecent(limit);
  }
}

export const sandboxEnvironmentService = new SandboxEnvironmentService();
