import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { e2bConnector } from '../connectors/e2b-connector';
import { DEPLOYMENT_TEMPLATE_ANALYTICS_ENTRY_RELATIVE_PATHS } from './deployment-template-bootstrap-service';
import {
  detectOneCeoOfficialWebTemplate,
  ensureTemplateCompliance,
  type OneCeoOfficialWebTemplateReport,
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

export type TaskSessionProjectProfile = {
  version: '1.0';
  sessionId?: string;
  runtimeGeneration?: number;
  updatedAt: string;
  artifactType: 'web_app' | 'api_service' | 'static_site' | 'script' | 'unknown';
  runtimeFamily: 'static' | 'frontend_dist' | 'node' | 'python' | 'php' | 'java' | 'unknown';
  templateFamily: 'oneceo_official_vite_node_shell' | 'legacy_or_custom' | 'unknown';
  deployability: 'ready' | 'repairable' | 'blocked' | 'not_deployable' | 'unknown';
  entrypoints: Array<{ path: string; kind: 'html' | 'server' | 'template' | 'config' }>;
  commands: {
    build?: string;
    start?: string;
    preview?: string;
  };
  healthcheckPath?: string;
  analyticsStatus: 'workspace' | 'platform_injectable' | 'runtime_injectable' | 'unsafe' | 'missing' | 'unknown';
  configFiles: {
    manifest?: boolean;
    railwayJson?: boolean;
    packageJson?: boolean;
    requirementsTxt?: boolean;
    pyprojectToml?: boolean;
    composerJson?: boolean;
    pomXml?: boolean;
    gradle?: boolean;
  };
  evidence: Array<{
    source: 'file_scan' | 'manifest' | 'package_json' | 'preview' | 'compliance' | 'skill';
    message: string;
    path?: string;
  }>;
};

type ProjectFileIndex = {
  files: Set<string>;
  packageJson: Record<string, unknown> | null;
  manifest: Record<string, unknown> | null;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(path: string): Promise<Record<string, unknown> | null> {
  if (!(await exists(path))) return null;
  try {
    return asObject(JSON.parse(await readFile(path, 'utf-8')));
  } catch {
    return null;
  }
}

async function listProjectFiles(sourceDir: string, limit = 400): Promise<Set<string>> {
  const files = new Set<string>();
  const queue = [sourceDir];
  while (queue.length > 0 && files.size < limit) {
    const currentDir = queue.shift();
    if (!currentDir) continue;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (files.size >= limit) break;
      if (EXPORT_EXCLUDES.includes(entry.name) || entry.name.startsWith('.')) continue;
      const entryPath = join(currentDir, entry.name);
      const relativePath = relative(sourceDir, entryPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (['dist', 'build', 'target', '.next'].includes(entry.name) && currentDir !== sourceDir) {
          continue;
        }
        queue.push(entryPath);
        continue;
      }
      if (entry.isFile()) {
        files.add(relativePath);
      }
    }
  }
  return files;
}

async function buildFileIndex(sourceDir: string): Promise<ProjectFileIndex> {
  return {
    files: await listProjectFiles(sourceDir),
    packageJson: await readJsonIfExists(join(sourceDir, 'package.json')),
    manifest: await readJsonIfExists(join(sourceDir, 'oneceo.manifest.json')),
  };
}

function hasAny(files: Set<string>, paths: string[]) {
  return paths.some((path) => files.has(path));
}

function hasDependency(packageJson: Record<string, unknown> | null, name: string) {
  if (!packageJson) return false;
  return Boolean(
    asText(asObject(packageJson.dependencies)[name]) ||
      asText(asObject(packageJson.devDependencies)[name])
  );
}

function pickCommand(packageJson: Record<string, unknown> | null, key: string) {
  return asText(asObject(packageJson?.scripts)[key]) || undefined;
}

function inferRuntimeFamily(index: ProjectFileIndex): TaskSessionProjectProfile['runtimeFamily'] {
  const manifestRuntime = asText(asObject(index.manifest?.runtime).framework).toLowerCase();
  if (manifestRuntime.includes('php')) return 'php';
  if (manifestRuntime.includes('fastapi') || manifestRuntime.includes('flask') || manifestRuntime.includes('python')) {
    return 'python';
  }
  if (manifestRuntime.includes('frontend_dist') || manifestRuntime.includes('vite')) return 'frontend_dist';
  if (manifestRuntime.includes('static')) return 'static';
  if (manifestRuntime.includes('node') || manifestRuntime.includes('next')) return 'node';

  if (hasAny(index.files, ['index.php', 'public/index.php'])) return 'php';
  if (
    hasAny(index.files, ['requirements.txt', 'pyproject.toml', 'main.py', 'app.py', 'server.py', 'manage.py'])
  ) {
    return 'python';
  }
  if (hasAny(index.files, ['pom.xml', 'build.gradle', 'build.gradle.kts'])) return 'java';
  if (index.packageJson) {
    if (
      hasDependency(index.packageJson, 'vite') ||
      hasDependency(index.packageJson, 'react') ||
      hasDependency(index.packageJson, 'vue') ||
      hasDependency(index.packageJson, 'svelte')
    ) {
      return 'frontend_dist';
    }
    return 'node';
  }
  if (index.files.has('index.html')) return 'static';
  return 'unknown';
}

function inferArtifactType(
  runtimeFamily: TaskSessionProjectProfile['runtimeFamily'],
  index: ProjectFileIndex
): TaskSessionProjectProfile['artifactType'] {
  if (runtimeFamily === 'static') return 'static_site';
  if (runtimeFamily === 'frontend_dist' || runtimeFamily === 'php') return 'web_app';
  if (runtimeFamily === 'python' || runtimeFamily === 'node' || runtimeFamily === 'java') {
    const startCommand = pickCommand(index.packageJson, 'start') || asText(asObject(index.manifest?.start).command);
    return startCommand || runtimeFamily !== 'node' ? 'web_app' : 'script';
  }
  return 'unknown';
}

function collectEntrypoints(index: ProjectFileIndex): TaskSessionProjectProfile['entrypoints'] {
  const result: TaskSessionProjectProfile['entrypoints'] = [];
  const remember = (path: string, kind: TaskSessionProjectProfile['entrypoints'][number]['kind']) => {
    if (index.files.has(path)) result.push({ path, kind });
  };
  for (const path of ['index.html', 'public/index.html', 'client/index.html']) remember(path, 'html');
  for (const path of ['server.js', 'index.js', 'app.js', 'main.py', 'app.py', 'server.py', 'index.php', 'public/index.php']) {
    remember(path, 'server');
  }
  for (const path of ['oneceo.manifest.json', 'railway.json', 'package.json', 'requirements.txt', 'pyproject.toml', 'composer.json', 'pom.xml', 'build.gradle', 'build.gradle.kts']) {
    remember(path, 'config');
  }
  for (const path of DEPLOYMENT_TEMPLATE_ANALYTICS_ENTRY_RELATIVE_PATHS) {
    if (path.includes('templates/') || path.includes('views/')) remember(path, 'template');
  }
  return result;
}

function inferAnalyticsStatus(
  index: ProjectFileIndex,
  compliance?: TemplateComplianceReport | null
): TaskSessionProjectProfile['analyticsStatus'] {
  if (compliance?.checks.analyticsEntryDetected) return 'workspace';
  if (hasAny(index.files, DEPLOYMENT_TEMPLATE_ANALYTICS_ENTRY_RELATIVE_PATHS as unknown as string[])) {
    if (hasAny(index.files, ['index.php', 'public/index.php'])) return 'platform_injectable';
    return 'platform_injectable';
  }
  if (index.packageJson && (hasDependency(index.packageJson, 'vite') || hasDependency(index.packageJson, 'next'))) {
    return 'runtime_injectable';
  }
  if (hasAny(index.files, ['index.php', 'public/index.php'])) return 'unsafe';
  return 'missing';
}

function inferTemplateFamily(
  runtimeFamily: TaskSessionProjectProfile['runtimeFamily'],
  officialTemplate: OneCeoOfficialWebTemplateReport
): TaskSessionProjectProfile['templateFamily'] {
  if (officialTemplate.matched) {
    return officialTemplate.templateFamily;
  }
  if (runtimeFamily === 'unknown') {
    return 'unknown';
  }
  return 'legacy_or_custom';
}

function buildEvidence(
  index: ProjectFileIndex,
  runtimeFamily: TaskSessionProjectProfile['runtimeFamily'],
  officialTemplate: OneCeoOfficialWebTemplateReport,
  compliance?: TemplateComplianceReport | null
): TaskSessionProjectProfile['evidence'] {
  const evidence: TaskSessionProjectProfile['evidence'] = [
    {
      source: 'file_scan',
      message: `detected runtimeFamily=${runtimeFamily}`,
    },
  ];
  if (index.packageJson) {
    evidence.push({ source: 'package_json', message: 'package.json detected', path: 'package.json' });
  }
  if (index.manifest) {
    evidence.push({ source: 'manifest', message: 'oneceo.manifest.json detected', path: 'oneceo.manifest.json' });
  }
  if (officialTemplate.matched) {
    evidence.push({
      source: 'file_scan',
      message: `detected templateFamily=${officialTemplate.templateFamily}`,
    });
  }
  if (compliance) {
    evidence.push({
      source: 'compliance',
      message: compliance.ok ? 'template compliance ready' : `template compliance failed: ${compliance.errors.join('; ')}`,
      path: compliance.manifestPath,
    });
  }
  return evidence;
}

export async function buildTaskSessionProjectProfileFromDirectory(
  sourceDir: string,
  options?: {
    sessionId?: string;
    runtimeGeneration?: number;
    compliance?: TemplateComplianceReport | null;
  }
): Promise<TaskSessionProjectProfile> {
  const index = await buildFileIndex(sourceDir);
  const runtimeFamily = inferRuntimeFamily(index);
  const officialTemplate = await detectOneCeoOfficialWebTemplate({
    sourceDir,
    packageJson: index.packageJson,
  });
  const compliance =
    options?.compliance === undefined
      ? await ensureTemplateCompliance(sourceDir).catch(() => null)
      : options.compliance;
  const buildCommand =
    pickCommand(index.packageJson, 'build') || asText(asObject(index.manifest?.build).command) || undefined;
  const startCommand =
    pickCommand(index.packageJson, 'start') || asText(asObject(index.manifest?.start).command) || undefined;
  const deployability: TaskSessionProjectProfile['deployability'] =
    compliance?.ok
      ? 'ready'
      : runtimeFamily === 'unknown'
        ? 'unknown'
        : runtimeFamily === 'node' && !startCommand
          ? 'not_deployable'
          : 'repairable';
  return {
    version: '1.0',
    sessionId: options?.sessionId,
    runtimeGeneration: options?.runtimeGeneration,
    updatedAt: new Date().toISOString(),
    artifactType: inferArtifactType(runtimeFamily, index),
    runtimeFamily,
    templateFamily: inferTemplateFamily(runtimeFamily, officialTemplate),
    deployability,
    entrypoints: collectEntrypoints(index),
    commands: {
      build: buildCommand,
      start: startCommand,
      preview: pickCommand(index.packageJson, 'preview') || pickCommand(index.packageJson, 'dev'),
    },
    healthcheckPath: asText(asObject(index.manifest?.healthcheck).path) || compliance?.manifest.healthcheck.path || undefined,
    analyticsStatus: inferAnalyticsStatus(index, compliance),
    configFiles: {
      manifest: index.files.has('oneceo.manifest.json'),
      railwayJson: index.files.has('railway.json'),
      packageJson: index.files.has('package.json'),
      requirementsTxt: index.files.has('requirements.txt'),
      pyprojectToml: index.files.has('pyproject.toml'),
      composerJson: index.files.has('composer.json'),
      pomXml: index.files.has('pom.xml'),
      gradle: index.files.has('build.gradle') || index.files.has('build.gradle.kts'),
    },
    evidence: buildEvidence(index, runtimeFamily, officialTemplate, compliance),
  };
}

async function extractArchive(archivePath: string, outputDir: string) {
  try {
    await execFile('tar', ['-xzf', archivePath, '-C', outputDir], {
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error: any) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    throw new Error(stderr || '解压项目画像归档失败');
  }
}

async function exportWorkspaceToLocalDirectory(
  orchestratorSessionId: string,
  workspaceRoot: string
): Promise<string> {
  const sandboxArchivePath = `/tmp/oneceo-project-profile-${Date.now()}.tar.gz`;
  const excludeArgs = EXPORT_EXCLUDES.map((item) => `--exclude=${item}`).join(' ');
  const command = [
    `test -d ${shellEscape(workspaceRoot)}`,
    `tar -czf ${shellEscape(sandboxArchivePath)} ${excludeArgs} -C ${shellEscape(workspaceRoot)} .`,
  ].join(' && ');

  await e2bConnector.runCommand(orchestratorSessionId, command, {
    timeoutMs: 3 * 60 * 1000,
  });
  const archiveBytes = await e2bConnector.readFile(orchestratorSessionId, sandboxArchivePath);
  await e2bConnector.runCommand(orchestratorSessionId, `rm -f ${shellEscape(sandboxArchivePath)}`, {
    timeoutMs: 30 * 1000,
  }).catch(() => undefined);

  const localTempDir = await mkdtemp(join(tmpdir(), 'oneceo-project-profile-'));
  const archivePath = join(localTempDir, 'workspace.tar.gz');
  await writeFile(archivePath, Buffer.from(archiveBytes));
  await extractArchive(archivePath, localTempDir);
  await rm(archivePath, { force: true });
  return localTempDir;
}

export async function inspectTaskSessionProjectProfile(input: {
  sessionId?: string;
  orchestratorSessionId: string;
  workspaceRoot: string;
  runtimeGeneration?: number;
}): Promise<TaskSessionProjectProfile> {
  const normalizedSessionId = asText(input.orchestratorSessionId);
  const normalizedWorkspaceRoot = asText(input.workspaceRoot);
  if (!normalizedSessionId || !normalizedWorkspaceRoot) {
    return {
      version: '1.0',
      sessionId: input.sessionId,
      runtimeGeneration: input.runtimeGeneration,
      updatedAt: new Date().toISOString(),
      artifactType: 'unknown',
      runtimeFamily: 'unknown',
      templateFamily: 'unknown',
      deployability: 'blocked',
      entrypoints: [],
      commands: {},
      analyticsStatus: 'unknown',
      configFiles: {},
      evidence: [{ source: 'file_scan', message: 'workspace missing' }],
    };
  }
  const sourceDir = await exportWorkspaceToLocalDirectory(normalizedSessionId, normalizedWorkspaceRoot);
  try {
    return await buildTaskSessionProjectProfileFromDirectory(sourceDir, {
      sessionId: input.sessionId,
      runtimeGeneration: input.runtimeGeneration,
    });
  } finally {
    await rm(sourceDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
