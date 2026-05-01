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
import {
  createDeploymentFlowSnapshot,
  reduceDeploymentFlow,
  type DeploymentFlowSnapshot,
} from './deployment-flow-reducer-service';
import {
  inspectTaskSessionProjectProfile,
  type TaskSessionProjectProfile,
} from './task-session-project-profile-service';
import { platformDeploymentAccountService } from './platform-deployment-account-service';
import { projectStorageResourceService } from './project-storage-resource-service';
import { taskSessionResourceDeclarationService } from './task-session-resource-declaration-service';

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
  | 'resource_binding'
  | 'deployment_pending'
  | 'deployment_failed';

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
  sourceProfileVersion?: string;
  expectedRuntimeFamily?: TaskSessionProjectProfile['runtimeFamily'];
};

export type AltusManagedDeploymentToolResult = {
  action: AltusManagedDeploymentToolName;
  phase: 'completed' | 'repair_required' | 'failed';
  status: 'success' | 'retryable_repair_required' | 'fatal_error';
  summary: string;
  bindingState?: string;
  deploymentStatus?: string;
  url?: string;
  deploymentId?: string;
  repair?: AltusManagedDeploymentToolRepair;
  baseline?: DeploymentTemplateBaselineData;
  projectProfile?: TaskSessionProjectProfile;
  deploymentFlow?: DeploymentFlowSnapshot;
  debug?: AltusManagedDeploymentDebug;
};

type ManagedDeploymentInternalAction = 'deploy' | 'redeploy' | 'status' | 'rollback';

type ManagedDeploymentToolInputSchema = {
  action: ManagedDeploymentInternalAction;
  sessionId: string;
  workspaceRoot: string;
  sourceProfileVersion?: string;
  expectedRuntimeFamily?: TaskSessionProjectProfile['runtimeFamily'];
  repairPolicy: 'none' | 'safe_template_adapt' | 'skill_repair_then_retry';
  reason?: string;
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
  rawError?: string,
  extra?: {
    projectProfile?: TaskSessionProjectProfile;
    deploymentFlow?: DeploymentFlowSnapshot;
  }
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
    projectProfile: extra?.projectProfile,
    deploymentFlow: extra?.deploymentFlow,
    debug: {
      rawError: asText(rawError) || undefined,
      baselineStatus: baseline.status,
      baselineErrors: baseline.errors,
    },
  };
}

function buildResourceRequirementRepairResult(
  action: AltusManagedDeploymentToolName,
  baseline: DeploymentTemplateBaselineData,
  requirement: 'database' | 'storage',
  source: 'manifest' | 'session_declaration' | 'manifest_and_session_declaration',
  extra?: {
    projectProfile?: TaskSessionProjectProfile;
    deploymentFlow?: DeploymentFlowSnapshot;
  }
): AltusManagedDeploymentToolResult {
  const checks =
    requirement === 'database'
      ? ['database_resource_missing']
      : ['object_storage_resource_missing'];
  const suggestedActions =
    requirement === 'database'
      ? [
          '先调用 ensure_project_database，为当前项目创建或修复 Railway Postgres',
          '数据库资源 ready 后，再重新调用 deploy_application 或 redeploy_application',
        ]
      : [
          '先调用 ensure_project_storage_bucket，为当前项目创建或修复 Railway Bucket',
          '存储桶资源 ready 后，再重新调用 deploy_application 或 redeploy_application',
        ];
  return {
    action,
    phase: 'repair_required',
    status: 'retryable_repair_required',
    summary:
      requirement === 'database'
        ? source === 'manifest'
          ? '当前 manifest 已明确声明需要数据库，但当前项目还没有就绪的 Railway Postgres 资源。'
          : source === 'manifest_and_session_declaration'
            ? '当前 manifest 与当前会话都已明确声明需要数据库，但当前项目还没有就绪的 Railway Postgres 资源。'
          : '当前会话已显式声明需要数据库，但当前项目还没有就绪的 Railway Postgres 资源。'
        : source === 'manifest'
          ? '当前 manifest 已明确声明需要对象存储，但当前项目还没有就绪的 Railway Bucket 资源。'
          : source === 'manifest_and_session_declaration'
            ? '当前 manifest 与当前会话都已明确声明需要对象存储，但当前项目还没有就绪的 Railway Bucket 资源。'
          : '当前会话已显式声明需要对象存储，但当前项目还没有就绪的 Railway Bucket 资源。',
    repair: {
      category: 'deployment_configuration',
      checks,
      suggestedActions,
    },
    baseline,
    projectProfile: extra?.projectProfile,
    deploymentFlow: extra?.deploymentFlow,
    debug: {
      baselineStatus: baseline.status,
      baselineErrors: baseline.errors,
    },
  };
}

function buildResourceBindingRepairResult(
  action: AltusManagedDeploymentToolName,
  rawError: string,
  baseline?: DeploymentTemplateBaselineData | null,
  extra?: {
    projectProfile?: TaskSessionProjectProfile;
    deploymentFlow?: DeploymentFlowSnapshot;
  }
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
    projectProfile: extra?.projectProfile,
    deploymentFlow: extra?.deploymentFlow,
    debug: {
      rawError,
      baselineStatus: baseline?.status,
      baselineErrors: baseline?.errors,
    },
  };
}

function buildPendingResult(
  action: AltusManagedDeploymentToolName,
  panel: RailwayDeploymentPanelData,
  extra?: {
    projectProfile?: TaskSessionProjectProfile;
    deploymentFlow?: DeploymentFlowSnapshot;
  }
): AltusManagedDeploymentToolResult {
  const deploymentStatus = asText(panel.latestStatus);
  const url = asText(panel.latestStaticUrl || panel.latestUrl);
  const bindingState = asText(panel.bindingState);
  const waitingForPublicReadiness = bindingState === 'public_settling';
  return {
    action,
    phase: 'repair_required',
    status: 'retryable_repair_required',
    bindingState: bindingState || undefined,
    summary:
      (waitingForPublicReadiness
        ? '发布完成，正在等待公网生效。'
        : panel.message) ||
      (deploymentStatus
        ? `部署仍在进行中，当前状态 ${deploymentStatus}。`
        : '部署仍在进行中，后台正在同步最新状态。'),
    deploymentStatus: deploymentStatus || undefined,
    url: url || undefined,
    deploymentId: asText(panel.deploymentId) || undefined,
    repair: {
      category: 'deployment_pending',
      checks: [bindingState || 'provisioning', deploymentStatus || 'unknown'].filter(Boolean),
      suggestedActions: [
        '继续调用 get_application_deployment_status，直到 bindingState=ready 且部署状态不再是 BUILDING/DEPLOYING/INITIALIZING/QUEUED/WAITING',
        '在 deployment_pending 阶段不要继续修改工作区文件，除非后续返回新的模板或配置修复项',
      ],
    },
    projectProfile: extra?.projectProfile,
    deploymentFlow: extra?.deploymentFlow,
    debug: {
      latestStatus: deploymentStatus || undefined,
      latestUrl: url || undefined,
      deploymentId: asText(panel.deploymentId) || undefined,
    },
  };
}

const DEPLOYMENT_FAILED_STATUSES = new Set(['failed', 'crashed', 'removed']);
const DEPLOYMENT_PENDING_BINDING_STATES = new Set(['provisioning', 'public_settling']);

function normalizeDeploymentStatus(value: unknown): string {
  return asText(value).toLowerCase();
}

function hasPublicAccessFailureText(value: unknown): boolean {
  const text = asText(value).toLowerCase();
  if (!text) return false;
  return (
    text.includes('公网访问验证失败') ||
    text.includes('公网地址尚未就绪') ||
    text.includes('application not found') ||
    text.includes('public access') ||
    text.includes('public reachability') ||
    text.includes('-> 404')
  );
}

function hasPublicAccessFailureMarker(panel: RailwayDeploymentPanelData): boolean {
  return hasPublicAccessFailureText([
    panel.message,
    panel.providerErrorMessage,
    panel.latestUrl,
    panel.latestStaticUrl,
  ]
    .map((item) => asText(item))
    .filter(Boolean)
    .join('\n'));
}

function isDeploymentFailedPanel(panel: RailwayDeploymentPanelData): boolean {
  const status = normalizeDeploymentStatus(panel.latestStatus);
  return DEPLOYMENT_FAILED_STATUSES.has(status) || hasPublicAccessFailureMarker(panel);
}

function buildDeploymentFailedRepairResult(
  action: AltusManagedDeploymentToolName,
  panel: RailwayDeploymentPanelData,
  extra?: {
    projectProfile?: TaskSessionProjectProfile;
    deploymentFlow?: DeploymentFlowSnapshot;
  }
): AltusManagedDeploymentToolResult {
  const deploymentStatus = asText(panel.latestStatus) || 'unknown';
  const url = asText(panel.latestStaticUrl || panel.latestUrl);
  const checks = [
    deploymentStatus,
    asText(panel.bindingState),
    asText(panel.providerErrorCode),
    hasPublicAccessFailureMarker(panel) ? 'public_access_failed' : '',
  ].filter(Boolean);
  return {
    action,
    phase: 'repair_required',
    status: 'retryable_repair_required',
    summary:
      panel.message ||
      `线上部署未成功，当前状态 ${deploymentStatus}。Altus 需要先根据部署状态和公网访问结果修复后再重试发布。`,
    deploymentStatus: deploymentStatus === 'unknown' ? undefined : deploymentStatus,
    url: url || undefined,
    deploymentId: asText(panel.deploymentId) || undefined,
    repair: {
      category: 'deployment_failed',
      checks,
      suggestedActions: [
        '读取部署状态、部署日志和公网访问结果，先定位启动命令、端口、健康检查或入口文件问题',
        '修复工作区或部署配置后，重新调用 deploy_application 或 redeploy_application',
        '只有公网地址可访问且部署状态为 SUCCESS 后，才允许完成部署任务',
      ],
    },
    projectProfile: extra?.projectProfile,
    deploymentFlow: extra?.deploymentFlow,
    debug: {
      latestStatus: deploymentStatus === 'unknown' ? undefined : deploymentStatus,
      latestUrl: url || undefined,
      deploymentId: asText(panel.deploymentId) || undefined,
      rawError: asText(panel.providerErrorMessage || panel.message) || undefined,
    },
  };
}

function buildDeploymentFailedRepairResultFromError(
  action: AltusManagedDeploymentToolName,
  rawError: string,
  baseline?: DeploymentTemplateBaselineData | null,
  extra?: {
    projectProfile?: TaskSessionProjectProfile;
    deploymentFlow?: DeploymentFlowSnapshot;
  }
): AltusManagedDeploymentToolResult {
  return {
    action,
    phase: 'repair_required',
    status: 'retryable_repair_required',
    summary:
      rawError ||
      '线上部署未成功，Altus 需要先根据部署状态和公网访问结果修复后再重试发布。',
    repair: {
      category: 'deployment_failed',
      checks: ['public_access_failed'],
      suggestedActions: [
        '读取部署状态、部署日志和公网访问结果，先定位启动命令、端口、健康检查或入口文件问题',
        '修复工作区或部署配置后，重新调用 deploy_application 或 redeploy_application',
        '只有公网地址可访问且部署状态为 SUCCESS 后，才允许完成部署任务',
      ],
    },
    baseline: baseline || undefined,
    projectProfile: extra?.projectProfile,
    deploymentFlow: extra?.deploymentFlow,
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
  projectProfile?: TaskSessionProjectProfile;
  deploymentFlow?: DeploymentFlowSnapshot;
}): AltusManagedDeploymentToolResult {
  const deploymentStatus = asText(input.panel.latestStatus);
  const url = asText(input.panel.latestStaticUrl || input.panel.latestUrl);
  const deploymentId = asText(input.panel.deploymentId);

  if (input.action === 'get_application_deployment_status') {
    return {
      action: input.action,
      phase: 'completed',
      status: 'success',
      bindingState: asText(input.panel.bindingState) || undefined,
      summary: input.fallbackSummary || input.panel.message || '已获取当前部署状态。',
      deploymentStatus: deploymentStatus || undefined,
      url: url || undefined,
      deploymentId: deploymentId || undefined,
      projectProfile: input.projectProfile,
      deploymentFlow: input.deploymentFlow,
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
    bindingState: asText(input.panel.bindingState) || undefined,
    summary: summaryParts.join('，') || input.fallbackSummary || input.panel.message || '部署完成',
    deploymentStatus: deploymentStatus || undefined,
    url: url || undefined,
    deploymentId: deploymentId || undefined,
    projectProfile: input.projectProfile,
    deploymentFlow: input.deploymentFlow,
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

function mapToolActionToSchemaAction(action: AltusManagedDeploymentToolName): ManagedDeploymentInternalAction {
  if (action === 'rollback_application_deployment') return 'rollback';
  if (action === 'redeploy_application') return 'redeploy';
  if (action === 'get_application_deployment_status') return 'status';
  return 'deploy';
}

export class AltusManagedDeploymentToolService {
  constructor(
    private readonly deps: {
      inspectBaseline: typeof inspectTaskSessionDeploymentTemplate;
      inspectProjectProfile?: typeof inspectTaskSessionProjectProfile;
      resolveSession: typeof resolveTaskSessionRecord;
      buildDeploymentResponse: typeof buildTaskSessionDeploymentResponse;
      executeDeploymentAction: typeof executeTaskSessionDeploymentAction;
      getErrorMessage: typeof getTaskSessionDeploymentErrorMessage;
      getProjectAccount?: typeof platformDeploymentAccountService.getProjectAccount;
      getStorageStatus?: typeof projectStorageResourceService.getStatus;
      getResourceDeclarations?: typeof taskSessionResourceDeclarationService.getSessionResourceDeclarations;
    } = {
      inspectBaseline: inspectTaskSessionDeploymentTemplate,
      inspectProjectProfile: inspectTaskSessionProjectProfile,
      resolveSession: resolveTaskSessionRecord,
      buildDeploymentResponse: buildTaskSessionDeploymentResponse,
      executeDeploymentAction: executeTaskSessionDeploymentAction,
      getErrorMessage: getTaskSessionDeploymentErrorMessage,
      getProjectAccount: platformDeploymentAccountService.getProjectAccount.bind(
        platformDeploymentAccountService
      ),
      getStorageStatus: projectStorageResourceService.getStatus.bind(projectStorageResourceService),
      getResourceDeclarations:
        taskSessionResourceDeclarationService.getSessionResourceDeclarations.bind(
          taskSessionResourceDeclarationService
        ),
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

  private async inspectProjectProfile(input: {
    sessionId: string;
    sandboxId: string;
    workspaceRoot: string;
  }) {
    if (!this.deps.inspectProjectProfile) {
      throw new Error('project_profile_inspector_unavailable');
    }
    return this.deps.inspectProjectProfile({
      sessionId: input.sessionId,
      orchestratorSessionId: input.sandboxId,
      workspaceRoot: input.workspaceRoot,
    });
  }

  private buildInputSchema(input: {
    action: AltusManagedDeploymentToolName;
    sessionId: string;
    workspaceRoot: string;
    notes?: string;
    projectProfile?: TaskSessionProjectProfile;
  }): ManagedDeploymentToolInputSchema {
    return {
      action: mapToolActionToSchemaAction(input.action),
      sessionId: input.sessionId,
      workspaceRoot: input.workspaceRoot,
      sourceProfileVersion: input.projectProfile?.version,
      expectedRuntimeFamily: input.projectProfile?.runtimeFamily,
      repairPolicy:
        input.action === 'get_application_deployment_status'
          ? 'none'
          : input.projectProfile?.deployability === 'ready'
            ? 'safe_template_adapt'
            : 'skill_repair_then_retry',
      reason: asText(input.notes) || undefined,
    };
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

    const projectProfile = await this.inspectProjectProfile(input).catch(() => undefined);
    const schema = this.buildInputSchema({
      action: input.action,
      sessionId: input.sessionId,
      workspaceRoot: input.workspaceRoot,
      notes: input.notes,
      projectProfile,
    });
    let deploymentFlow = reduceDeploymentFlow(createDeploymentFlowSnapshot(), {
      type: 'PROFILE_READY',
      profile: projectProfile || {
        version: '1.0',
        sessionId: input.sessionId,
        updatedAt: new Date().toISOString(),
        artifactType: 'unknown',
        runtimeFamily: 'unknown',
        deployability: 'unknown',
        entrypoints: [],
        commands: {},
        analyticsStatus: 'unknown',
        configFiles: {},
        evidence: [{ source: 'file_scan', message: 'project profile unavailable' }],
      },
    });

    if (input.action === 'get_application_deployment_status') {
      try {
        const panel = await this.deps.buildDeploymentResponse({
          userId: input.userId,
          session,
          resolvedOrchestratorSessionId: input.sandboxId,
        });
        if (
          panel.activeDeploymentPending ||
          DEPLOYMENT_PENDING_BINDING_STATES.has(asText(panel.bindingState))
        ) {
          deploymentFlow = reduceDeploymentFlow(deploymentFlow, {
            type: 'PROVIDER_STATUS',
            status: asText(panel.latestStatus) || 'pending',
            url: asText(panel.latestStaticUrl || panel.latestUrl) || undefined,
          });
          return buildPendingResult(input.action, panel, { projectProfile, deploymentFlow });
        }
        if (isDeploymentFailedPanel(panel)) {
          deploymentFlow = reduceDeploymentFlow(deploymentFlow, {
            type: 'PROVIDER_STATUS',
            status: asText(panel.latestStatus) || 'FAILED',
            url: asText(panel.latestStaticUrl || panel.latestUrl) || undefined,
          });
          return buildDeploymentFailedRepairResult(input.action, panel, { projectProfile, deploymentFlow });
        }
        deploymentFlow = reduceDeploymentFlow(deploymentFlow, {
          type: 'PUBLIC_ACCESS_VERIFIED',
          statusCode: 200,
          url: asText(panel.latestStaticUrl || panel.latestUrl) || '',
        });
        return buildSuccessResult({
          action: input.action,
          panel,
          fallbackSummary: panel.message || '已获取当前部署状态。',
          projectProfile,
          deploymentFlow,
        });
      } catch (error) {
        deploymentFlow = reduceDeploymentFlow(deploymentFlow, {
          type: 'TERMINAL_FAILURE',
          reason: this.deps.getErrorMessage(error),
        });
        return buildFatalResult(input.action, '当前还无法获取部署状态。', {
          projectProfile,
          deploymentFlow,
          debug: {
            rawError: this.deps.getErrorMessage(error),
            sourceProfileVersion: schema.sourceProfileVersion,
            expectedRuntimeFamily: schema.expectedRuntimeFamily,
          },
        });
      }
    }

    if (input.action !== 'rollback_application_deployment') {
      const baseline = await this.inspectBaseline({
        sandboxId: input.sandboxId,
        workspaceRoot: input.workspaceRoot,
      });
      deploymentFlow = reduceDeploymentFlow(deploymentFlow, {
        type: 'COMPLIANCE_READY',
        ok: baseline.status === 'ready',
        errors: baseline.errors,
      });
      if (baseline.status !== 'ready') {
        return buildRepairResult(input.action, baseline, undefined, { projectProfile, deploymentFlow });
      }
      const resourceDeclarations = this.deps.getResourceDeclarations
        ? await this.deps.getResourceDeclarations(input.sessionId).catch(() => ({
            database: null,
            storage: null,
          }))
        : { database: null, storage: null };
      const databaseRequiredByManifest = baseline.features?.database === 'railway_postgres';
      const databaseRequiredByDeclaration = Boolean(resourceDeclarations.database?.requested);
      if (databaseRequiredByManifest || databaseRequiredByDeclaration) {
        const account = this.deps.getProjectAccount
          ? await this.deps.getProjectAccount(input.userId, input.sessionId)
          : null;
        if (!account?.databaseServiceId) {
          deploymentFlow = reduceDeploymentFlow(deploymentFlow, {
            type: 'REPAIR_REQUIRED',
            category: 'deployment_configuration',
            checks: ['database_resource_missing'],
          });
          return buildResourceRequirementRepairResult(
            input.action,
            baseline,
            'database',
            databaseRequiredByManifest && databaseRequiredByDeclaration
              ? 'manifest_and_session_declaration'
              : databaseRequiredByManifest
                ? 'manifest'
                : 'session_declaration',
            {
              projectProfile,
              deploymentFlow,
            }
          );
        }
      }
      const storageRequiredByManifest = baseline.features?.objectStorage === true;
      const storageRequiredByDeclaration = Boolean(resourceDeclarations.storage?.requested);
      if (storageRequiredByManifest || storageRequiredByDeclaration) {
        const storageStatus = this.deps.getStorageStatus
          ? await this.deps.getStorageStatus(input.userId, input.sessionId)
          : ({ configured: false } as Awaited<ReturnType<typeof projectStorageResourceService.getStatus>>);
        if (!storageStatus.configured) {
          deploymentFlow = reduceDeploymentFlow(deploymentFlow, {
            type: 'REPAIR_REQUIRED',
            category: 'deployment_configuration',
            checks: ['object_storage_resource_missing'],
          });
          return buildResourceRequirementRepairResult(
            input.action,
            baseline,
            'storage',
            storageRequiredByManifest && storageRequiredByDeclaration
              ? 'manifest_and_session_declaration'
              : storageRequiredByManifest
                ? 'manifest'
                : 'session_declaration',
            {
              projectProfile,
              deploymentFlow,
            }
          );
        }
      }
    }

    try {
      deploymentFlow = reduceDeploymentFlow(deploymentFlow, { type: 'ADAPTATION_DONE' });
      deploymentFlow = reduceDeploymentFlow(deploymentFlow, { type: 'PUBLISH_STARTED' });
      const result = await this.deps.executeDeploymentAction({
        action: mapToolActionToRuntimeAction(input.action),
        taskSessionId: input.sessionId,
        userId: input.userId,
        session,
        workspacePath: input.workspaceRoot,
        resolvedOrchestratorSessionId: input.sandboxId,
      });
      deploymentFlow = reduceDeploymentFlow(deploymentFlow, {
        type: 'PUBLISH_STARTED',
        deploymentId: asText(result.panel.deploymentId) || undefined,
      });
      if (
        result.panel.activeDeploymentPending ||
        DEPLOYMENT_PENDING_BINDING_STATES.has(asText(result.panel.bindingState))
      ) {
        deploymentFlow = reduceDeploymentFlow(deploymentFlow, {
          type: 'PROVIDER_STATUS',
          status: asText(result.panel.latestStatus) || 'pending',
          url: asText(result.panel.latestStaticUrl || result.panel.latestUrl) || undefined,
        });
        return buildPendingResult(input.action, result.panel, { projectProfile, deploymentFlow });
      }
      if (isDeploymentFailedPanel(result.panel)) {
        deploymentFlow = reduceDeploymentFlow(deploymentFlow, {
          type: 'PROVIDER_STATUS',
          status: asText(result.panel.latestStatus) || 'FAILED',
          url: asText(result.panel.latestStaticUrl || result.panel.latestUrl) || undefined,
        });
        return buildDeploymentFailedRepairResult(input.action, result.panel, { projectProfile, deploymentFlow });
      }
      deploymentFlow = reduceDeploymentFlow(deploymentFlow, {
        type: 'PUBLIC_ACCESS_VERIFIED',
        statusCode: 200,
        url: asText(result.panel.latestStaticUrl || result.panel.latestUrl) || '',
      });
      return buildSuccessResult({
        action: input.action,
        panel: result.panel,
        projectProfile,
        deploymentFlow,
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
      if (hasPublicAccessFailureText(rawError)) {
        deploymentFlow = reduceDeploymentFlow(deploymentFlow, {
          type: 'REPAIR_REQUIRED',
          category: 'deployment_failed',
          checks: ['public_access_failed'],
        });
        return buildDeploymentFailedRepairResultFromError(input.action, rawError, latestBaseline, {
          projectProfile,
          deploymentFlow,
        });
      }
      const classified = classifyRailwayDeploymentError(rawError);
      if (classified.bindingState === 'repair_required') {
        deploymentFlow = reduceDeploymentFlow(deploymentFlow, {
          type: 'REPAIR_REQUIRED',
          category: 'resource_binding',
          checks: [classified.code],
        });
        return buildResourceBindingRepairResult(input.action, rawError, latestBaseline, {
          projectProfile,
          deploymentFlow,
        });
      }
      if (latestBaseline && latestBaseline.status !== 'ready') {
        deploymentFlow = reduceDeploymentFlow(deploymentFlow, {
          type: 'COMPLIANCE_READY',
          ok: false,
          errors: latestBaseline.errors,
        });
        return buildRepairResult(input.action, latestBaseline, rawError, { projectProfile, deploymentFlow });
      }
      deploymentFlow = reduceDeploymentFlow(deploymentFlow, {
        type: 'TERMINAL_FAILURE',
        reason: rawError,
      });
      return buildFatalResult(
        input.action,
        input.action === 'redeploy_application'
          ? '重新发布暂未完成，内部调试信息已记录。'
          : input.action === 'rollback_application_deployment'
            ? '当前还无法回滚部署，内部调试信息已记录。'
            : '发布暂未完成，内部调试信息已记录。',
        {
          baseline: latestBaseline || undefined,
          projectProfile,
          deploymentFlow,
          debug: {
            rawError,
            baselineStatus: latestBaseline?.status,
            baselineErrors: latestBaseline?.errors,
            sourceProfileVersion: schema.sourceProfileVersion,
            expectedRuntimeFamily: schema.expectedRuntimeFamily,
          },
        }
      );
    }
  }
}

export const altusManagedDeploymentToolService = new AltusManagedDeploymentToolService();
