import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type ManifestFeatures = {
  analytics: boolean;
  userTracking: boolean;
  database: 'railway_postgres' | false;
  auth: 'optional' | false;
  objectStorage: boolean;
};

export type OneCeoDeploymentManifest = {
  templateVersion: string;
  appType: 'web_app';
  stack: string;
  build: {
    command: string;
    outputDir: string;
  };
  start: {
    command: string;
    portEnv: 'PORT';
  };
  healthcheck: {
    path: string;
  };
  features: ManifestFeatures;
  runtime: {
    framework: string;
    transport: string;
  };
};

export type TemplateComplianceReport = {
  ok: boolean;
  generatedManifest: boolean;
  manifestPath: string;
  manifest: OneCeoDeploymentManifest;
  checks: {
    buildCommandDetected: boolean;
    startCommandDetected: boolean;
    analyticsEntryDetected: boolean;
    healthcheckRouteDetected: boolean;
    databaseDependencyDetected: boolean | null;
  };
  warnings: string[];
  errors: string[];
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const text = asText(value).toLowerCase();
  if (!text) return null;
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  return null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  if (!(await exists(path))) {
    return null;
  }
  const raw = await readFile(path, 'utf-8');
  return asObject(JSON.parse(raw));
}

async function readTextIfExists(path: string): Promise<string> {
  if (!(await exists(path))) {
    return '';
  }
  return readFile(path, 'utf-8');
}

function hasDependency(packageJson: Record<string, unknown>, name: string): boolean {
  const dependencies = asObject(packageJson.dependencies);
  const devDependencies = asObject(packageJson.devDependencies);
  return Boolean(asText(dependencies[name]) || asText(devDependencies[name]));
}

function inferStack(packageJson: Record<string, unknown>): string {
  const hasReact = hasDependency(packageJson, 'react');
  const hasVite = hasDependency(packageJson, 'vite');
  const hasExpress = hasDependency(packageJson, 'express');
  const hasTrpc =
    hasDependency(packageJson, '@trpc/server') || hasDependency(packageJson, '@trpc/client');
  const hasPg = hasDependency(packageJson, 'pg');
  const parts = [
    hasReact ? 'react' : 'web',
    hasVite ? 'vite' : 'node',
    hasExpress ? 'express' : 'http',
    hasTrpc ? 'trpc' : 'api',
    hasPg ? 'pg' : 'dbless',
  ];
  return parts.join('_');
}

function inferFramework(packageJson: Record<string, unknown>): string {
  if (hasDependency(packageJson, 'vite')) return 'vite';
  if (hasDependency(packageJson, 'next')) return 'next';
  if (hasDependency(packageJson, 'react')) return 'react';
  return 'node';
}

function inferTransport(packageJson: Record<string, unknown>): string {
  if (hasDependency(packageJson, '@trpc/server')) return 'trpc';
  if (hasDependency(packageJson, 'express')) return 'rest';
  return 'http';
}

function inferDatabaseFeature(packageJson: Record<string, unknown>): 'railway_postgres' | false {
  if (hasDependency(packageJson, 'pg') || hasDependency(packageJson, 'drizzle-orm')) {
    return 'railway_postgres';
  }
  return false;
}

function inferBuildOutputDir(packageJson: Record<string, unknown>): string {
  const scripts = asObject(packageJson.scripts);
  const buildCommand = asText(scripts.build);
  if (buildCommand.includes('dist/public')) return 'dist/public';
  return 'dist';
}

async function inferHealthcheckPath(sourceDir: string): Promise<string> {
  const candidates = [
    join(sourceDir, 'server/index.ts'),
    join(sourceDir, 'server/index.js'),
    join(sourceDir, 'src/server/index.ts'),
    join(sourceDir, 'src/server/index.js'),
  ];
  const contents = await Promise.all(candidates.map((file) => readTextIfExists(file)));
  for (const content of contents) {
    if (!content) continue;
    if (content.includes('/api/system/health')) return '/api/system/health';
    if (content.includes('/health')) return '/health';
  }
  return '/api/system/health';
}

function buildDefaultManifest(input: {
  packageJson: Record<string, unknown>;
  healthcheckPath: string;
}): OneCeoDeploymentManifest {
  const scripts = asObject(input.packageJson.scripts);
  const database = inferDatabaseFeature(input.packageJson);

  return {
    templateVersion: '1.0.0',
    appType: 'web_app',
    stack: inferStack(input.packageJson),
    build: {
      command: asText(scripts.build) || 'pnpm build',
      outputDir: inferBuildOutputDir(input.packageJson),
    },
    start: {
      command: asText(scripts.start) || 'node dist/index.js',
      portEnv: 'PORT',
    },
    healthcheck: {
      path: input.healthcheckPath,
    },
    features: {
      analytics: true,
      userTracking: true,
      database,
      auth: 'optional',
      objectStorage: false,
    },
    runtime: {
      framework: inferFramework(input.packageJson),
      transport: inferTransport(input.packageJson),
    },
  };
}

function normalizeManifest(
  value: Record<string, unknown>,
  fallback: OneCeoDeploymentManifest
): OneCeoDeploymentManifest {
  const build = asObject(value.build);
  const start = asObject(value.start);
  const healthcheck = asObject(value.healthcheck);
  const features = asObject(value.features);
  const runtime = asObject(value.runtime);
  const databaseRaw = asText(features.database).toLowerCase();

  return {
    templateVersion: asText(value.templateVersion) || fallback.templateVersion,
    appType: 'web_app',
    stack: asText(value.stack) || fallback.stack,
    build: {
      command: asText(build.command) || fallback.build.command,
      outputDir: asText(build.outputDir) || fallback.build.outputDir,
    },
    start: {
      command: asText(start.command) || fallback.start.command,
      portEnv: 'PORT',
    },
    healthcheck: {
      path: asText(healthcheck.path) || fallback.healthcheck.path,
    },
    features: {
      analytics: asBoolean(features.analytics) ?? fallback.features.analytics,
      userTracking: asBoolean(features.userTracking) ?? fallback.features.userTracking,
      database: databaseRaw === 'railway_postgres' ? 'railway_postgres' : fallback.features.database,
      auth: asText(features.auth) === 'optional' ? 'optional' : fallback.features.auth,
      objectStorage: asBoolean(features.objectStorage) ?? fallback.features.objectStorage,
    },
    runtime: {
      framework: asText(runtime.framework) || fallback.runtime.framework,
      transport: asText(runtime.transport) || fallback.runtime.transport,
    },
  };
}

async function detectAnalyticsEntry(sourceDir: string): Promise<boolean> {
  const candidates = [
    join(sourceDir, 'client/src/main.tsx'),
    join(sourceDir, 'client/src/main.ts'),
    join(sourceDir, 'src/main.tsx'),
    join(sourceDir, 'src/main.ts'),
    join(sourceDir, 'client/index.html'),
    join(sourceDir, 'index.html'),
  ];
  const contents = await Promise.all(candidates.map((file) => readTextIfExists(file)));
  return contents.some(
    (content) =>
      content.includes('ONECEO_ANALYTICS:START') ||
      content.includes('VITE_ANALYTICS_') ||
      content.includes('data-website-id') ||
      content.includes('script.js')
  );
}

export async function ensureTemplateCompliance(sourceDir: string): Promise<TemplateComplianceReport> {
  const packageJsonPath = join(sourceDir, 'package.json');
  const manifestPath = join(sourceDir, 'oneceo.manifest.json');
  const warnings: string[] = [];
  const errors: string[] = [];

  const packageJson = await readJsonFile(packageJsonPath);
  if (!packageJson) {
    throw new Error('部署前检查失败：缺少 package.json');
  }

  const scripts = asObject(packageJson.scripts);
  const buildCommandDetected = Boolean(asText(scripts.build));
  const startCommandDetected = Boolean(asText(scripts.start));
  if (!buildCommandDetected) {
    errors.push('缺少 package.json scripts.build，当前项目不具备标准构建入口');
  }
  if (!startCommandDetected) {
    errors.push('缺少 package.json scripts.start，当前项目不具备标准启动入口');
  }

  const healthcheckPath = await inferHealthcheckPath(sourceDir);
  const fallbackManifest = buildDefaultManifest({
    packageJson,
    healthcheckPath,
  });
  const existingManifest = await readJsonFile(manifestPath);
  const generatedManifest = !existingManifest;
  const manifest = normalizeManifest(existingManifest || {}, fallbackManifest);

  if (generatedManifest) {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
    warnings.push('缺少 oneceo.manifest.json，已按平台默认契约自动补齐');
  }

  if (manifest.features.database === 'railway_postgres') {
    const databaseDependencyDetected =
      hasDependency(packageJson, 'pg') || hasDependency(packageJson, 'drizzle-orm');
    if (!databaseDependencyDetected) {
      errors.push('manifest 声明 database=railway_postgres，但项目未检测到 pg / drizzle-orm 依赖');
    }
  }

  const analyticsEntryDetected = await detectAnalyticsEntry(sourceDir);
  if (!analyticsEntryDetected) {
    errors.push('未检测到 OneCEO analytics bootstrap 或显式 analytics 注入入口');
  }

  const healthcheckSourceDetected = (await inferHealthcheckPath(sourceDir)) === manifest.healthcheck.path;
  if (!healthcheckSourceDetected) {
    warnings.push(`manifest 健康检查路径为 ${manifest.healthcheck.path}，但源码里暂未检测到同名路由`);
  }

  return {
    ok: errors.length === 0,
    generatedManifest,
    manifestPath,
    manifest,
    checks: {
      buildCommandDetected,
      startCommandDetected,
      analyticsEntryDetected,
      healthcheckRouteDetected: healthcheckSourceDetected,
      databaseDependencyDetected:
        manifest.features.database === 'railway_postgres'
          ? hasDependency(packageJson, 'pg') || hasDependency(packageJson, 'drizzle-orm')
          : null,
    },
    warnings,
    errors,
  };
}
