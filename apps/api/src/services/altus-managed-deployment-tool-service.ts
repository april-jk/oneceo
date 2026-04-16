import {
  executeDirectModeDeploymentCapability,
  getDirectModeDeploymentErrorMessage,
} from './direct-mode-deployment-capability-service';
import type {
  DirectModeCapabilityExecutionInput,
  DirectModeCapabilityExecutionResult,
} from './direct-mode-capability-types';
import {
  inspectTaskSessionDeploymentTemplate,
  type DeploymentTemplateBaselineData,
} from './task-creation-deployment-source-service';

export const ALTUS_MANAGED_DEPLOYMENT_TOOL_NAMES = [
  'deploy_application',
  'redeploy_application',
  'rollback_application_deployment',
  'get_application_deployment_status',
] as const;

export type AltusManagedDeploymentToolName = (typeof ALTUS_MANAGED_DEPLOYMENT_TOOL_NAMES)[number];

type RepairCategory =
  | 'workspace_missing'
  | 'template_compliance'
  | 'deployment_configuration';

type AltusManagedDeploymentToolRepair = {
  category: RepairCategory;
  checks: string[];
  suggestedActions: string[];
};

type AltusManagedDeploymentDebug = {
  rawError?: string;
  capabilityId?: string;
  latestStatus?: string;
  latestUrl?: string;
  deploymentId?: string;
  baselineStatus?: DeploymentTemplateBaselineData['status'];
  baselineErrors?: string[];
};

export type AltusManagedDeploymentToolResult = {
  action: AltusManagedDeploymentToolName;
  phase: 'completed' | 'repair_required' | 'failed';
  status: 'success' | 'retryable_repair_required' | 'fatal_error';
  summary: string;
  deploymentStatus?: string;
  url?: string;
  deploymentId?: string;
  repair?: AltusManagedDeploymentToolRepair;
  baseline?: DeploymentTemplateBaselineData;
  debug?: AltusManagedDeploymentDebug;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function compactUrl(value: unknown): string {
  const text = asText(value);
  return text ? text.replace(/^https?:\/\//, '') : '';
}

function extractBaselineChecks(baseline: DeploymentTemplateBaselineData) {
  const checks: string[] = [];
  if (!baseline.workspaceDetected) {
    checks.push('workspace_missing');
  }
  if (baseline.checks.build === false) {
    checks.push('missing_build_script');
  }
  if (baseline.checks.start === false) {
    checks.push('missing_start_script');
  }
  if (baseline.checks.analytics === false) {
    checks.push('missing_analytics_entry');
  }
  if (baseline.checks.healthcheck === false) {
    checks.push('missing_healthcheck_route');
  }
  if (baseline.checks.database === false) {
    checks.push('database_contract_mismatch');
  }
  return checks;
}

function buildSuggestedActions(checks: string[]) {
  const suggestions = new Set<string>();
  for (const check of checks) {
    if (check === 'workspace_missing') {
      suggestions.add('先生成或补齐可部署的项目工作区，再重新触发发布');
    }
    if (check === 'missing_build_script') {
      suggestions.add('补齐 package.json 的 build 脚本，确保项目具备标准构建入口');
    }
    if (check === 'missing_start_script') {
      suggestions.add('补齐 package.json 的 start 脚本，确保部署后可标准启动');
    }
    if (check === 'missing_analytics_entry') {
      suggestions.add('确保前端入口可被 OneCEO analytics bootstrap 注入，或保留显式 analytics 接入入口');
    }
    if (check === 'missing_healthcheck_route') {
      suggestions.add('补齐健康检查路由，优先使用 /api/system/health');
    }
    if (check === 'database_contract_mismatch') {
      suggestions.add('修正数据库依赖与 manifest 契约，保持 Railway Postgres 与 pg/drizzle-orm 一致');
    }
  }
  return Array.from(suggestions);
}

function buildRepairResult(
  action: AltusManagedDeploymentToolName,
  baseline: DeploymentTemplateBaselineData,
  rawError?: string
): AltusManagedDeploymentToolResult {
  const checks = extractBaselineChecks(baseline);
  const category: RepairCategory =
    !baseline.workspaceDetected || baseline.status === 'unavailable'
      ? 'workspace_missing'
      : checks.includes('database_contract_mismatch')
        ? 'deployment_configuration'
        : 'template_compliance';

  return {
    action,
    phase: 'repair_required',
    status: 'retryable_repair_required',
    summary:
      category === 'workspace_missing'
        ? '当前还没有可直接发布的项目工作区，Altus 需要先补齐项目文件后再继续发布。'
        : '当前项目缺少稳定发布所需的部署基线，Altus 需要先自动修复后再继续发布。',
    repair: {
      category,
      checks,
      suggestedActions: buildSuggestedActions(checks),
    },
    baseline,
    debug: {
      rawError: asText(rawError) || undefined,
      baselineStatus: baseline.status,
      baselineErrors: baseline.errors,
    },
  };
}

function buildFatalResult(
  action: AltusManagedDeploymentToolName,
  summary: string,
  extra?: Partial<AltusManagedDeploymentToolResult>
): AltusManagedDeploymentToolResult {
  return {
    action,
    phase: 'failed',
    status: 'fatal_error',
    summary,
    ...extra,
  };
}

function buildSuccessResult(
  action: AltusManagedDeploymentToolName,
  capabilityResult: DirectModeCapabilityExecutionResult
): AltusManagedDeploymentToolResult {
  const metadata = pickRecord(capabilityResult.metadata);
  const deploymentStatus = asText(metadata.latestStatus);
  const url = asText(metadata.latestUrl);
  const deploymentId = asText(metadata.deploymentId);

  if (action === 'get_application_deployment_status') {
    return {
      action,
      phase: 'completed',
      status: 'success',
      summary: capabilityResult.message,
      deploymentStatus: deploymentStatus || undefined,
      url: url || undefined,
      deploymentId: deploymentId || undefined,
      debug: {
        capabilityId: capabilityResult.capabilityId,
        latestStatus: deploymentStatus || undefined,
        latestUrl: url || undefined,
        deploymentId: deploymentId || undefined,
      },
    };
  }

  const summaryParts: string[] = [];
  if (action === 'rollback_application_deployment') {
    summaryParts.push('回滚完成');
  } else if (action === 'redeploy_application') {
    summaryParts.push('重新发布完成');
  } else {
    summaryParts.push('发布完成');
  }
  if (deploymentStatus) {
    summaryParts.push(`状态 ${deploymentStatus}`);
  }
  if (url) {
    summaryParts.push(`地址 ${compactUrl(url)}`);
  }

  return {
    action,
    phase: 'completed',
    status: 'success',
    summary: summaryParts.join('，') || capabilityResult.message,
    deploymentStatus: deploymentStatus || undefined,
    url: url || undefined,
    deploymentId: deploymentId || undefined,
    debug: {
      capabilityId: capabilityResult.capabilityId,
      latestStatus: deploymentStatus || undefined,
      latestUrl: url || undefined,
      deploymentId: deploymentId || undefined,
    },
  };
}

export class AltusManagedDeploymentToolService {
  constructor(
    private readonly deps: {
      inspectBaseline: typeof inspectTaskSessionDeploymentTemplate;
      executeCapability: typeof executeDirectModeDeploymentCapability;
      getErrorMessage: typeof getDirectModeDeploymentErrorMessage;
    } = {
      inspectBaseline: inspectTaskSessionDeploymentTemplate,
      executeCapability: executeDirectModeDeploymentCapability,
      getErrorMessage: getDirectModeDeploymentErrorMessage,
    }
  ) {}

  private async inspectBaseline(input: {
    sandboxId: string;
    workspaceRoot: string;
  }) {
    return this.deps.inspectBaseline({
      orchestratorSessionId: input.sandboxId,
      workspaceRoot: input.workspaceRoot,
    });
  }

  private async runCapability(
    capabilityId: DirectModeCapabilityExecutionResult['capabilityId'],
    input: DirectModeCapabilityExecutionInput
  ) {
    return this.deps.executeCapability(capabilityId, input);
  }

  async execute(input: {
    action: AltusManagedDeploymentToolName;
    sessionId: string;
    sandboxId: string;
    workspaceRoot: string;
    notes?: string;
  }): Promise<AltusManagedDeploymentToolResult> {
    const capabilityInput: DirectModeCapabilityExecutionInput = {
      taskSessionId: input.sessionId,
      content: asText(input.notes) || input.action,
      orchestratorSessionId: input.sandboxId,
      workspacePath: input.workspaceRoot,
    };

    if (input.action === 'get_application_deployment_status') {
      try {
        const result = await this.runCapability('get_session_deployment_status', capabilityInput);
        return buildSuccessResult(input.action, result);
      } catch (error) {
        return buildFatalResult(input.action, '当前还无法获取部署状态。', {
          debug: {
            rawError: this.deps.getErrorMessage(error),
            capabilityId: 'get_session_deployment_status',
          },
        });
      }
    }

    if (input.action === 'rollback_application_deployment') {
      try {
        const result = await this.runCapability('rollback_session_deployment', capabilityInput);
        return buildSuccessResult(input.action, result);
      } catch (error) {
        return buildFatalResult(input.action, '当前还无法回滚部署，内部调试信息已记录。', {
          debug: {
            rawError: this.deps.getErrorMessage(error),
            capabilityId: 'rollback_session_deployment',
          },
        });
      }
    }

    const baseline = await this.inspectBaseline({
      sandboxId: input.sandboxId,
      workspaceRoot: input.workspaceRoot,
    });
    if (baseline.status !== 'ready') {
      return buildRepairResult(input.action, baseline);
    }

    try {
      const result = await this.runCapability('deploy_session_website', capabilityInput);
      return buildSuccessResult(input.action, result);
    } catch (error) {
      const latestBaseline = await this.inspectBaseline({
        sandboxId: input.sandboxId,
        workspaceRoot: input.workspaceRoot,
      }).catch(() => null);
      const rawError = this.deps.getErrorMessage(error);
      if (latestBaseline && latestBaseline.status !== 'ready') {
        return buildRepairResult(input.action, latestBaseline, rawError);
      }
      return buildFatalResult(
        input.action,
        input.action === 'redeploy_application'
          ? '重新发布暂未完成，内部调试信息已记录。'
          : '发布暂未完成，内部调试信息已记录。',
        {
          baseline: latestBaseline || undefined,
          debug: {
            rawError,
            capabilityId: 'deploy_session_website',
            baselineStatus: latestBaseline?.status,
            baselineErrors: latestBaseline?.errors,
          },
        }
      );
    }
  }
}

export const altusManagedDeploymentToolService = new AltusManagedDeploymentToolService();
