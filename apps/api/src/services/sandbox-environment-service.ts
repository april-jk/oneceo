import { kvmConnector } from '../connectors/kvm-connector';
import { KvmClientError } from '../clients/kvm-orchestrator-client';
import { sandboxExecutionEnvironmentDAO } from '../db/dao';
import { ensureDatabaseConnection } from '../config/database';
import { sandboxSecurityConfig } from '../config/sandbox-security';

class ProtectedVmAllocationError extends Error {
  constructor(public readonly vmName: string, public readonly sessionId: string) {
    super(`安全策略阻止使用受保护 VM: ${vmName}`);
  }
}

function pickString(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJob(jobId: string, timeoutMs: number = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await kvmConnector.getJob(jobId);
    const data = job.data as any;
    const status = data?.status;
    if (status && !['queued', 'running'].includes(status)) {
      return data;
    }
    await sleep(1200);
  }
  throw new Error(`等待任务超时: ${jobId}`);
}

async function awaitJobIfNeeded(result: any) {
  const jobId = result?.jobId || result?.job_id;
  if (!jobId) {
    return result;
  }
  return waitForJob(String(jobId));
}

function isKvmWarmPoolEnvironment(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata) return false;
  const allocationSource = pickString(
    metadata.allocationSource,
    (metadata.kvmWarmPool as any)?.allocationSource,
    (metadata.kvmWarmPool as any)?.source
  );
  return allocationSource === 'warm_pool';
}

export class SandboxEnvironmentService {
  private buildIncrementalMapping(sessionId: string) {
    const fileName = `${sessionId}.qcow2`;
    const path = `${sandboxSecurityConfig.incrementalStorageDir}/${fileName}`;
    return {
      baseImage: sandboxSecurityConfig.baseImageName,
      incrementalStorageDir: sandboxSecurityConfig.incrementalStorageDir,
      incrementalFileName: fileName,
      incrementalFilePath: path,
    };
  }

  private buildSecurityProfile() {
    return {
      mode: 'strict',
      protectedVmNames: sandboxSecurityConfig.protectedVmNames,
      denyCidrs: sandboxSecurityConfig.denyCidrs,
      allowedDomains: sandboxSecurityConfig.allowedDomains,
      enforceSessionFirst: sandboxSecurityConfig.enforceSessionFirst,
    };
  }

  async attachPoolEnvironment(input: {
    sessionId: string;
    vmName?: string | null;
    metadata?: Record<string, unknown>;
    status?: 'creating' | 'ready';
  }) {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });

    const sessionId = input.sessionId.trim();
    if (!sessionId) {
      throw new Error('attachPoolEnvironment 缺少 sessionId');
    }

    const mapping = this.buildIncrementalMapping(sessionId);
    const securityProfile = this.buildSecurityProfile();
    const status = input.status || 'ready';
    const metadata = input.metadata || {};

    const existed = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
    if (!existed) {
      return sandboxExecutionEnvironmentDAO.createEnvironment({
        sessionId,
        orchestratorSessionId: sessionId,
        vmName: input.vmName || null,
        baseImage: mapping.baseImage,
        incrementalStorageDir: mapping.incrementalStorageDir,
        incrementalFileName: mapping.incrementalFileName,
        incrementalFilePath: mapping.incrementalFilePath,
        status,
        securityProfile,
        networkPolicy: {
          mode: 'default_deny_egress',
          denyCidrs: sandboxSecurityConfig.denyCidrs,
          allowedDomains: sandboxSecurityConfig.allowedDomains,
        },
        metadata,
      });
    }

    const mergedMetadata = {
      ...((existed.metadata || {}) as Record<string, unknown>),
      ...metadata,
    };
    await sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, mergedMetadata);
    await sandboxExecutionEnvironmentDAO.updateStatus(sessionId, status, input.vmName || existed.vmName || null);
    return sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
  }

  async openEnvironment(input: {
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
    bind?: Record<string, unknown>;
  }) {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
    let lastError: unknown;

    for (let attempt = 1; attempt <= sandboxSecurityConfig.envOpenMaxAttempts; attempt++) {
      try {
        const attemptIdempotencyKey =
          attempt === 1 ? input.idempotencyKey : undefined;

        const created = await kvmConnector.createSession(
          {
            metadata: input.metadata || {},
          },
          attemptIdempotencyKey
        );

        const sessionData = created.data as any;
        const orchestratorSessionId = pickString(
          sessionData?.sessionId,
          sessionData?.id,
          sessionData?.session
        );

        if (!orchestratorSessionId) {
          throw new Error('创建 KVM Session 成功，但未返回 session_id');
        }

        const mapping = this.buildIncrementalMapping(orchestratorSessionId);
        const securityProfile = this.buildSecurityProfile();

        const existed = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
        if (!existed) {
          await sandboxExecutionEnvironmentDAO.createEnvironment({
            sessionId: orchestratorSessionId,
            orchestratorSessionId,
            baseImage: mapping.baseImage,
            incrementalStorageDir: mapping.incrementalStorageDir,
            incrementalFileName: mapping.incrementalFileName,
            incrementalFilePath: mapping.incrementalFilePath,
            status: 'creating',
            securityProfile,
            networkPolicy: {
              mode: 'default_deny_egress',
              denyCidrs: sandboxSecurityConfig.denyCidrs,
              allowedDomains: sandboxSecurityConfig.allowedDomains,
            },
            metadata: input.metadata || {},
          });
        }

        let bindResult: any = null;
        if (sandboxSecurityConfig.useSandboxApi) {
          const vmName =
            pickString(input.bind?.vm_name, input.bind?.vmName) ||
            `sandbox_${orchestratorSessionId}`;
          const sandboxInput: Record<string, unknown> = {
            session_id: orchestratorSessionId,
            vm_name: vmName,
            auto_bind: true,
            start: true,
          };
          if (sandboxSecurityConfig.sandboxBaseImagePath) {
            sandboxInput.base_image = sandboxSecurityConfig.sandboxBaseImagePath;
          }
          if (sandboxSecurityConfig.sandboxNetwork) {
            sandboxInput.network = sandboxSecurityConfig.sandboxNetwork;
          }
          if (sandboxSecurityConfig.sandboxMemoryMb) {
            sandboxInput.memory_mb = sandboxSecurityConfig.sandboxMemoryMb;
          }
          if (sandboxSecurityConfig.sandboxVcpus) {
            sandboxInput.vcpus = sandboxSecurityConfig.sandboxVcpus;
          }
          if (sandboxSecurityConfig.sandboxOsVariant) {
            sandboxInput.os_variant = sandboxSecurityConfig.sandboxOsVariant;
          }
          const sandboxIdempotencyKey = attemptIdempotencyKey
            ? `${attemptIdempotencyKey}-sandbox`
            : undefined;
          try {
            bindResult = await kvmConnector.createSandbox(sandboxInput, sandboxIdempotencyKey);
            await awaitJobIfNeeded(bindResult);
          } catch (error) {
            if (error instanceof KvmClientError && error.status === 409) {
              // VM 已存在：尝试复用已有 sandbox 并继续绑定/查询
              const sandbox = await kvmConnector.getSandbox(orchestratorSessionId);
              bindResult = sandbox;
            } else {
              throw error;
            }
          }
        } else {
          bindResult = await kvmConnector.bindSessionVm(orchestratorSessionId, {
            auto: true,
            excludeVmNames: sandboxSecurityConfig.protectedVmNames,
            ...(input.bind || {}),
          });
        }

        const vmResult = await kvmConnector.getSessionVm(orchestratorSessionId);
        const vmName = pickString(
          (vmResult.data as any)?.name,
          (vmResult.data as any)?.vmName,
          (vmResult.data as any)?.vm?.name,
          (bindResult.data as any)?.name,
          (bindResult.data as any)?.vmName
        );

        if (!vmName) {
          await sandboxExecutionEnvironmentDAO.updateStatus(orchestratorSessionId, 'failed');
          throw new Error('KVM Session 已创建并绑定，但未获取到 VM 名称');
        }

        if (sandboxSecurityConfig.protectedVmNames.includes(vmName)) {
          await kvmConnector.closeSession(orchestratorSessionId, { graceful: true });
          await sandboxExecutionEnvironmentDAO.updateStatus(orchestratorSessionId, 'failed', vmName);
          throw new ProtectedVmAllocationError(vmName, orchestratorSessionId);
        }

        await sandboxExecutionEnvironmentDAO.updateStatus(orchestratorSessionId, 'ready', vmName);

        return {
          sessionId: orchestratorSessionId,
          vmName,
          status: 'ready',
          attempt,
          storage: mapping,
          security: securityProfile,
          orchestrator: {
            createRequestId: created.requestId,
            bindRequestId: bindResult.requestId,
            vmRequestId: vmResult.requestId,
          },
        };
      } catch (error) {
        lastError = error;
        const canRetry =
          error instanceof ProtectedVmAllocationError &&
          attempt < sandboxSecurityConfig.envOpenMaxAttempts;
        if (!canRetry) {
          break;
        }
      }
    }

    if (lastError instanceof ProtectedVmAllocationError) {
      throw new Error(
        `多次分配均命中受保护 VM（最后一次: ${lastError.vmName}），请检查上游分配策略或保护名单配置`
      );
    }
    throw lastError instanceof Error ? lastError : new Error('创建执行环境失败');
  }

  async closeEnvironment(sessionId: string) {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });

    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
    if (!environment) {
      throw new Error(`未找到环境记录: ${sessionId}`);
    }
    const metadata = ((environment.metadata || {}) as Record<string, unknown>) || {};
    const fromKvmWarmPool = isKvmWarmPoolEnvironment(metadata);

    await sandboxExecutionEnvironmentDAO.updateStatus(sessionId, 'closing', environment.vmName || null);

    if (fromKvmWarmPool) {
      try {
        await kvmConnector.releasePoolSandbox(environment.orchestratorSessionId, {
          result: 'success',
          reason: 'api_close_environment',
        });
      } catch (error) {
        console.warn(
          '[KVM_POOL_RELEASE_ERROR]',
          sessionId,
          error instanceof Error ? error.message : String(error)
        );
        await kvmConnector.closeSession(environment.orchestratorSessionId, { graceful: true });
      }
    } else {
      await kvmConnector.closeSession(environment.orchestratorSessionId, { graceful: true });
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
