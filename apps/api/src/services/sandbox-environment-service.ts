import { e2bConnector } from '../connectors/e2b-connector';
import { e2bConfig } from '../config/e2b-config';
import { sandboxExecutionEnvironmentDAO, taskSessionRunDAO } from '../db/dao';
import { ensureDatabaseConnection } from '../config/database';
import { sandboxSecurityConfig } from '../config/sandbox-security';
import { archiveSandboxWorkspace, isArchiveStorageConfigured } from './sandbox-archive-service';
import { setSandboxMetadata } from './sandbox-activity-service';
import { sessionMcpRecoveryService } from './session-mcp-recovery-service';

const SANDBOX_BLOCKED_ENV_PATTERNS = [
  /^R2_/i,
  /^CF_/i,
  /^CLOUDFLARE_/i,
  /^AWS_ACCESS_KEY_ID$/i,
  /^AWS_SECRET_ACCESS_KEY$/i,
  /^AWS_SESSION_TOKEN$/i,
];

function isE2bEnvironment(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata) return false;
  return String(metadata.sandboxProvider || '').toLowerCase() === 'e2b';
}

export function sanitizeSandboxEnvs(envs?: Record<string, string>): Record<string, string> | undefined {
  if (!envs) return undefined;
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(envs)) {
    if (!key) continue;
    if (SANDBOX_BLOCKED_ENV_PATTERNS.some((pattern) => pattern.test(key))) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

export class SandboxEnvironmentService {
  private shouldArchiveOnClose(): boolean {
    const raw = String(process.env.E2B_ARCHIVE_ON_CLOSE || 'true').trim().toLowerCase();
    return !['0', 'false', 'no', 'off'].includes(raw);
  }

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
    templateOverride?: string;
  }) {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
    const selectedTemplate = (input.templateOverride || e2bConfig.template).trim() || e2bConfig.template;
    const sanitizedEnvs = sanitizeSandboxEnvs(input.envs);
    const sandbox = await e2bConnector.createSandbox({
      template: selectedTemplate,
      metadata: input.metadata || {},
      envs: sanitizedEnvs,
      timeoutMs: e2bConfig.timeoutMs,
      allowInternetAccess: e2bConfig.allowInternetAccess,
      allowPublicTraffic: e2bConfig.allowPublicTraffic,
    });

    const securityProfile = this.buildSecurityProfile();
    const mapping = {
      baseImage: selectedTemplate,
      incrementalStorageDir: 'e2b',
      incrementalFileName: sandbox.sandboxId,
      incrementalFilePath: sandbox.sandboxId,
    };

    const metadata: Record<string, unknown> = {
      ...(input.metadata || {}),
      sandboxProvider: 'e2b',
      lastActiveAt: new Date().toISOString(),
      lastActiveReason: 'create',
      pendingArchiveUpdate: false,
      e2b: {
        sandboxId: sandbox.sandboxId,
        template: selectedTemplate,
        timeoutMs: e2bConfig.timeoutMs,
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

    if (isE2b && this.shouldArchiveOnClose() && isArchiveStorageConfigured()) {
      try {
        await archiveSandboxWorkspace(environment.orchestratorSessionId, 'close_environment', {
          forceUpload: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('[SANDBOX_CLOSE] archive before close failed', sessionId, message);
        try {
          await setSandboxMetadata(sessionId, {
            archiveStatus: 'failed',
            archiveReason: 'close_environment',
            archiveError: message,
          });
        } catch (metaError) {
          console.warn('[SANDBOX_CLOSE] set archive failure metadata failed', sessionId, metaError);
        }
      }
    }

    if (isE2b) {
      await sessionMcpRecoveryService
        .markPendingRecoverByOrchestratorSessionId(environment.orchestratorSessionId)
        .catch(() => null);
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

  async listRegistryEnvironments(limit: number = 20) {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
    return sandboxExecutionEnvironmentDAO.listRecentRegistry(limit);
  }

  async listTaskSessionEnvironments(taskSessionId: string) {
    const normalizedTaskSessionId = String(taskSessionId || '').trim();
    if (!normalizedTaskSessionId) {
      throw new Error('taskSessionId 不能为空');
    }

    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
    const [binding, canonicalEnvironment, relatedEnvironments] = await Promise.all([
      taskSessionRunDAO.getSandboxBindingBySession(normalizedTaskSessionId),
      sandboxExecutionEnvironmentDAO.findCanonicalByTaskSessionId(normalizedTaskSessionId),
      sandboxExecutionEnvironmentDAO.listByTaskSessionId(normalizedTaskSessionId, 200),
    ]);

    const bindingEnvironment = binding?.sandboxId
      ? await sandboxExecutionEnvironmentDAO.getBySessionId(binding.sandboxId)
      : null;
    const environmentById = new Map<string, typeof canonicalEnvironment>();
    for (const environment of [bindingEnvironment, canonicalEnvironment, ...relatedEnvironments]) {
      if (environment?.sessionId) {
        environmentById.set(environment.sessionId, environment);
      }
    }

    return {
      taskSessionId: normalizedTaskSessionId,
      binding: binding || null,
      primaryEnvironment: canonicalEnvironment || bindingEnvironment || relatedEnvironments[0] || null,
      relatedEnvironments: Array.from(environmentById.values()).filter(Boolean),
    };
  }
}

export const sandboxEnvironmentService = new SandboxEnvironmentService();
