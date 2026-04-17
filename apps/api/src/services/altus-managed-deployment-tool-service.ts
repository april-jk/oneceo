import { inspectTaskSessionDeploymentTemplate, type DeploymentTemplateBaselineData } from './task-creation-deployment-source-service';
import {
  buildTaskSessionDeploymentResponse,
  executeTaskSessionDeploymentAction,
  getTaskSessionDeploymentErrorMessage,
  resolveTaskSessionRecord,
} from './task-session-deployment-runtime-service';
import {
  classifyRailwayDeploymentError,
  type RailwayDeploymentPanelData,
} from './railway-deployment-service';

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
  | 'deployment_configuration'
  | 'resource_binding';

type AltusManagedDeploymentToolRepair = {
  category: RepairCategory;
  checks: string[];
  suggestedActions: string[];
};

type AltusManagedDeploymentDebug = {
  rawError?: string;
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

function buildResourceBindingRepairResult(
  action: AltusManagedDeploymentToolName,
  rawError: string,
  baseline?: DeploymentTemplateBaselineData | null
): AltusManagedDeploymentToolResult {
  const classified = classifyRailwayDeploymentError(rawError);
  return {
    action,
    phase: 'repair_required',
    status: 'retryable_repair_required',
    summary: classified.userMessage,
    repair: {
      category: 'resource_binding',
      checks: [classified.code],
      suggestedActions: [
        '优先修复 Railway 部署资源绑定，不要继续修改工作区模板或本地启动脚本',
        '修复完成后直接再次调用部署工具，重新校验部署状态',
      ],
    },
    baseline: baseline || undefined,
    debug: {
      rawError,
      baselineStatus: baseline?.status,
      baselineErrors: baseline?.errors,
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

function buildSuccessResult(input: {
  action: AltusManagedDeploymentToolName;
  panel: RailwayDeploymentPanelData;
  fallbackSummary?: string;
}): AltusManagedDeploymentToolResult {
  const deploymentStatus = asText(input.panel.latestStatus);
  const url = asText(input.panel.latestStaticUrl || input.panel.latestUrl);
  const deploymentId = asText(input.panel.deploymentId);

  if (input.action === 'get_application_deployment_status') {
    return {
      action: input.action,
      phase: 'completed',
      status: 'success',
      summary: input.fallbackSummary || input.panel.message || '已获取当前部署状态。',
      deploymentStatus: deploymentStatus || undefined,
      url: url || undefined,
      deploymentId: deploymentId || undefined,
      debug: {
        latestStatus: deploymentStatus || undefined,
        latestUrl: url || undefined,
        deploymentId: deploymentId || undefined,
      },
    };
  }

  const summaryParts: string[] = [];
  if (input.action === 'rollback_application_deployment') {
    summaryParts.push('回滚完成');
  } else if (input.action === 'redeploy_application') {
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
    action: input.action,
    phase: 'completed',
    status: 'success',
    summary: summaryParts.join('，') || input.fallbackSummary || input.panel.message || '部署完成',
    deploymentStatus: deploymentStatus || undefined,
    url: url || undefined,
    deploymentId: deploymentId || undefined,
    debug: {
      latestStatus: deploymentStatus || undefined,
      latestUrl: url || undefined,
      deploymentId: deploymentId || undefined,
    },
  };
}

type ManagedDeploymentAction = 'deploy' | 'redeploy' | 'rollback';

function mapToolActionToRuntimeAction(action: AltusManagedDeploymentToolName): ManagedDeploymentAction {
  if (action === 'rollback_application_deployment') {
    return 'rollback';
  }
  if (action === 'redeploy_application') {
    return 'redeploy';
  }
  return 'deploy';
}

export class AltusManagedDeploymentToolService {
  constructor(
    private readonly deps: {
      inspectBaseline: typeof inspectTaskSessionDeploymentTemplate;
      resolveSession: typeof resolveTaskSessionRecord;
      buildDeploymentResponse: typeof buildTaskSessionDeploymentResponse;
      executeDeploymentAction: typeof executeTaskSessionDeploymentAction;
      getErrorMessage: typeof getTaskSessionDeploymentErrorMessage;
    } = {
      inspectBaseline: inspectTaskSessionDeploymentTemplate,
      resolveSession: resolveTaskSessionRecord,
      buildDeploymentResponse: buildTaskSessionDeploymentResponse,
      executeDeploymentAction: executeTaskSessionDeploymentAction,
      getErrorMessage: getTaskSessionDeploymentErrorMessage,
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

  async execute(input: {
    action: AltusManagedDeploymentToolName;
    sessionId: string;
    userId: string;
    sandboxId: string;
    workspaceRoot: string;
    notes?: string;
  }): Promise<AltusManagedDeploymentToolResult> {
    const session = await this.deps.resolveSession(input.sessionId);
    if (!session) {
      return buildFatalResult(input.action, '当前会话不存在，暂时无法执行部署。');
    }

    if (input.action === 'get_application_deployment_status') {
      try {
        const panel = await this.deps.buildDeploymentResponse({
          userId: input.userId,
          session,
          resolvedOrchestratorSessionId: input.sandboxId,
        });
        return buildSuccessResult({
          action: input.action,
          panel,
          fallbackSummary: panel.message || '已获取当前部署状态。',
        });
      } catch (error) {
        return buildFatalResult(input.action, '当前还无法获取部署状态。', {
          debug: {
            rawError: this.deps.getErrorMessage(error),
          },
        });
      }
    }

    if (input.action !== 'rollback_application_deployment') {
      const baseline = await this.inspectBaseline({
        sandboxId: input.sandboxId,
        workspaceRoot: input.workspaceRoot,
      });
      if (baseline.status !== 'ready') {
        return buildRepairResult(input.action, baseline);
      }
    }

    try {
      const result = await this.deps.executeDeploymentAction({
        action: mapToolActionToRuntimeAction(input.action),
        taskSessionId: input.sessionId,
        userId: input.userId,
        session,
        workspacePath: input.workspaceRoot,
        resolvedOrchestratorSessionId: input.sandboxId,
      });
      return buildSuccessResult({
        action: input.action,
        panel: result.panel,
      });
    } catch (error) {
      const latestBaseline =
        input.action === 'rollback_application_deployment'
          ? null
          : await this.inspectBaseline({
              sandboxId: input.sandboxId,
              workspaceRoot: input.workspaceRoot,
            }).catch(() => null);
      const rawError = this.deps.getErrorMessage(error);
      const classified = classifyRailwayDeploymentError(rawError);
      if (classified.bindingState === 'repair_required') {
        return buildResourceBindingRepairResult(input.action, rawError, latestBaseline);
      }
      if (latestBaseline && latestBaseline.status !== 'ready') {
        return buildRepairResult(input.action, latestBaseline, rawError);
      }
      return buildFatalResult(
        input.action,
        input.action === 'redeploy_application'
          ? '重新发布暂未完成，内部调试信息已记录。'
          : input.action === 'rollback_application_deployment'
            ? '当前还无法回滚部署，内部调试信息已记录。'
            : '发布暂未完成，内部调试信息已记录。',
        {
          baseline: latestBaseline || undefined,
          debug: {
            rawError,
            baselineStatus: latestBaseline?.status,
            baselineErrors: latestBaseline?.errors,
          },
        }
      );
    }
  }
}

export const altusManagedDeploymentToolService = new AltusManagedDeploymentToolService();
