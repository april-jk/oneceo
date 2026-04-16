import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { e2bConnector } from '../connectors/e2b-connector';
import {
  pushDirectoryToManagedRepository,
  type ManagedDeploymentRepository,
} from './platform-managed-github-repo-service';
import {
  ensureDeploymentTemplateBootstrap,
  type DeploymentTemplateBootstrapReport,
} from './deployment-template-bootstrap-service';
import {
  ensureTemplateCompliance,
  type OneCeoDeploymentManifest,
  type TemplateComplianceReport,
} from './template-compliance-service';

const execFile = promisify(execFileCallback);

const EXPORT_EXCLUDES = [
  '.git',
  '.opencode',
  'node_modules',
  '.cache',
  '.pnpm-store',
  '.idea',
  '.vscode',
];

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export type DeploymentTemplateBaselineData = {
  status: 'ready' | 'needs_attention' | 'unavailable';
  checkedAt: string;
  workspaceDetected: boolean;
  analyticsMode: 'workspace' | 'platform_injected' | 'missing' | 'unknown';
  manifestGenerated: boolean;
  manifestPath?: string;
  templateVersion?: string;
  buildCommand?: string;
  startCommand?: string;
  healthcheckPath?: string;
  features?: OneCeoDeploymentManifest['features'];
  checks: {
    build: boolean | null;
    start: boolean | null;
    analytics: boolean | null;
    healthcheck: boolean | null;
    database: boolean | null;
  };
  warnings: string[];
  errors: string[];
};

export type DeploymentWorkspacePublishReport = {
  bootstrap: DeploymentTemplateBootstrapReport;
  compliance: TemplateComplianceReport;
  baseline: DeploymentTemplateBaselineData;
};

export function buildDeploymentTemplateBaseline(input: {
  workspaceDetected: boolean;
  bootstrap?: DeploymentTemplateBootstrapReport | null;
  compliance?: TemplateComplianceReport | null;
  extraErrors?: string[];
}): DeploymentTemplateBaselineData {
  const bootstrap = input.bootstrap || null;
  const compliance = input.compliance || null;
  const errors = [
    ...(bootstrap?.errors || []),
    ...(compliance?.errors || []),
    ...(input.extraErrors || []).map((item) => asText(item)).filter(Boolean),
  ];
  const warnings = [
    ...(bootstrap?.warnings || []),
    ...(compliance?.warnings || []),
  ];
  const analyticsMode: DeploymentTemplateBaselineData['analyticsMode'] =
    bootstrap?.analyticsInjected
      ? 'platform_injected'
      : compliance?.checks.analyticsEntryDetected
        ? 'workspace'
        : compliance
          ? 'missing'
          : 'unknown';

  return {
    status: !input.workspaceDetected
      ? 'unavailable'
      : errors.length > 0
        ? 'needs_attention'
        : compliance
          ? 'ready'
          : 'unavailable',
    checkedAt: new Date().toISOString(),
    workspaceDetected: input.workspaceDetected,
    analyticsMode,
    manifestGenerated: Boolean(compliance?.generatedManifest),
    manifestPath: compliance?.manifestPath,
    templateVersion: compliance?.manifest.templateVersion,
    buildCommand: compliance?.manifest.build.command,
    startCommand: compliance?.manifest.start.command,
    healthcheckPath: compliance?.manifest.healthcheck.path,
    features: compliance?.manifest.features,
    checks: {
      build: compliance?.checks.buildCommandDetected ?? null,
      start: compliance?.checks.startCommandDetected ?? null,
      analytics: compliance?.checks.analyticsEntryDetected ?? null,
      healthcheck: compliance?.checks.healthcheckRouteDetected ?? null,
      database: compliance?.checks.databaseDependencyDetected ?? null,
    },
    warnings,
    errors,
  };
}

async function extractArchive(archivePath: string, outputDir: string) {
  try {
    await execFile('tar', ['-xzf', archivePath, '-C', outputDir], {
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error: any) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    throw new Error(stderr || '解压部署归档失败');
  }
}

async function exportWorkspaceToLocalDirectory(
  orchestratorSessionId: string,
  workspaceRoot: string
): Promise<string> {
  const normalizedSessionId = asText(orchestratorSessionId);
  const normalizedWorkspaceRoot = asText(workspaceRoot);
  if (!normalizedSessionId || !normalizedWorkspaceRoot) {
    throw new Error('缺少工作区信息，无法导出部署源码');
  }

  const sandboxArchivePath = `/tmp/oneceo-deployment-source-${Date.now()}.tar.gz`;
  const excludeArgs = EXPORT_EXCLUDES.map((item) => `--exclude=${item}`).join(' ');
  const command = [
    `test -d ${shellEscape(normalizedWorkspaceRoot)}`,
    `tar -czf ${shellEscape(sandboxArchivePath)} ${excludeArgs} -C ${shellEscape(normalizedWorkspaceRoot)} .`,
  ].join(' && ');

  await e2bConnector.runCommand(normalizedSessionId, command, {
    timeoutMs: 3 * 60 * 1000,
  });

  const archiveBytes = await e2bConnector.readFile(normalizedSessionId, sandboxArchivePath);
  await e2bConnector.runCommand(normalizedSessionId, `rm -f ${shellEscape(sandboxArchivePath)}`, {
    timeoutMs: 30 * 1000,
  }).catch(() => undefined);

  const localTempDir = await mkdtemp(join(tmpdir(), 'oneceo-deployment-src-'));
  const archivePath = join(localTempDir, 'workspace.tar.gz');
  await writeFile(archivePath, Buffer.from(archiveBytes));
  await extractArchive(archivePath, localTempDir);
  await rm(archivePath, { force: true });
  return localTempDir;
}

export async function publishTaskSessionWorkspaceToRepository(input: {
  orchestratorSessionId: string;
  workspaceRoot: string;
  repository: ManagedDeploymentRepository;
  sessionId: string;
}): Promise<DeploymentWorkspacePublishReport> {
  const sourceDir = await exportWorkspaceToLocalDirectory(input.orchestratorSessionId, input.workspaceRoot);
  try {
    const bootstrap = await ensureDeploymentTemplateBootstrap(sourceDir);
    if (bootstrap.warnings.length > 0) {
      console.warn('[DEPLOYMENT_TEMPLATE_BOOTSTRAP_WARNINGS]', {
        sessionId: input.sessionId,
        warnings: bootstrap.warnings,
        analyticsTargetPath: bootstrap.analyticsTargetPath,
      });
    }
    if (bootstrap.errors.length > 0) {
      throw new Error(`部署模板注入失败：${bootstrap.errors.join('；')}`);
    }
    const compliance = await ensureTemplateCompliance(sourceDir);
    if (compliance.warnings.length > 0) {
      console.warn('[DEPLOYMENT_TEMPLATE_COMPLIANCE_WARNINGS]', {
        sessionId: input.sessionId,
        warnings: compliance.warnings,
        manifestPath: compliance.manifestPath,
        generatedManifest: compliance.generatedManifest,
      });
    }
    if (!compliance.ok) {
      throw new Error(`部署前检查失败：${compliance.errors.join('；')}`);
    }
    await pushDirectoryToManagedRepository(input.repository, sourceDir, {
      commitMessage: `chore: deploy session ${input.sessionId} ${new Date().toISOString()}`,
    });
    return {
      bootstrap,
      compliance,
      baseline: buildDeploymentTemplateBaseline({
        workspaceDetected: true,
        bootstrap,
        compliance,
      }),
    };
  } finally {
    await rm(sourceDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function inspectTaskSessionDeploymentTemplate(input: {
  orchestratorSessionId: string;
  workspaceRoot: string;
}): Promise<DeploymentTemplateBaselineData> {
  const normalizedSessionId = asText(input.orchestratorSessionId);
  const normalizedWorkspaceRoot = asText(input.workspaceRoot);
  if (!normalizedSessionId || !normalizedWorkspaceRoot) {
    return buildDeploymentTemplateBaseline({
      workspaceDetected: false,
      extraErrors: ['未找到可检查的工作区'],
    });
  }

  const sourceDir = await exportWorkspaceToLocalDirectory(
    normalizedSessionId,
    normalizedWorkspaceRoot
  );
  try {
    const bootstrap = await ensureDeploymentTemplateBootstrap(sourceDir);
    try {
      const compliance = await ensureTemplateCompliance(sourceDir);
      return buildDeploymentTemplateBaseline({
        workspaceDetected: true,
        bootstrap,
        compliance,
      });
    } catch (error: any) {
      return buildDeploymentTemplateBaseline({
        workspaceDetected: true,
        bootstrap,
        extraErrors: [error?.message || '模板检查失败'],
      });
    }
  } finally {
    await rm(sourceDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
