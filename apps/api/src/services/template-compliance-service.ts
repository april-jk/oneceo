import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEPLOYMENT_TEMPLATE_ANALYTICS_ENTRY_RELATIVE_PATHS } from './deployment-template-bootstrap-service';

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

async function findFilesByExtension(
  rootDir: string,
  extension: string,
  limit = 200
): Promise<string[]> {
  const results: string[] = [];
  const queue = [rootDir];
  while (queue.length > 0 && results.length < limit) {
    const current = queue.shift();
    if (!current) continue;
    let entries: Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean }> = [];
    try {
      entries = (await readdir(current, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        path: join(current, entry.name),
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
      }));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (results.length >= limit) break;
      if (entry.isDirectory) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === 'dist' ||
          entry.name === 'build'
        ) {
          continue;
        }
        queue.push(entry.path);
        continue;
      }
      if (entry.isFile && entry.path.endsWith(extension)) {
        results.push(entry.path);
      }
    }
  }
  return results;
}

async function findTemplateFiles(
  sourceDir: string,
  extensions: readonly string[],
  limit = 80
): Promise<string[]> {
  const templateRoots = [
    join(sourceDir, 'templates'),
    join(sourceDir, 'app/templates'),
    join(sourceDir, 'views'),
    join(sourceDir, 'app/views'),
    join(sourceDir, 'src/main/resources/templates'),
    join(sourceDir, 'src/main/resources/static'),
  ];
  const results: string[] = [];
  const seen = new Set<string>();
  for (const root of templateRoots) {
    for (const extension of extensions) {
      if (results.length >= limit) {
        return results;
      }
      const matches = await findFilesByExtension(root, extension, Math.max(1, limit - results.length));
      for (const filePath of matches) {
        if (seen.has(filePath)) continue;
        seen.add(filePath);
        results.push(filePath);
        if (results.length >= limit) {
          return results;
        }
      }
    }
  }
  return results;
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

function inferBuildOutputDir(packageJson: Record<string, unknown>): string {
  const scripts = asObject(packageJson.scripts);
  const buildCommand = asText(scripts.build);
  if (buildCommand.includes('dist/public')) return 'dist/public';
  return 'dist';
}

async function inferHealthcheckPath(sourceDir: string): Promise<string> {
  const candidates = [
    join(sourceDir, 'server.ts'),
    join(sourceDir, 'server.js'),
    join(sourceDir, 'server.cjs'),
    join(sourceDir, 'server/index.ts'),
    join(sourceDir, 'server/index.js'),
    join(sourceDir, 'server/index.cjs'),
    join(sourceDir, 'src/server/index.ts'),
    join(sourceDir, 'src/server/index.js'),
    join(sourceDir, 'src/server/index.cjs'),
  ];
  const contents = await Promise.all(candidates.map((file) => readTextIfExists(file)));
  for (const content of contents) {
    if (!content) continue;
    if (content.includes('/api/system/health')) return '/api/system/health';
    if (content.includes('/health')) return '/health';
  }
  const phpEntrypoints = [
    join(sourceDir, 'index.php'),
    join(sourceDir, 'public/index.php'),
  ];
  if ((await Promise.all(phpEntrypoints.map((filePath) => exists(filePath)))).some(Boolean)) {
    return '/';
  }
  return '/api/system/health';
}

function looksLikePhpManifest(manifest: OneCeoDeploymentManifest): boolean {
  const stack = asText(manifest.stack).toLowerCase();
  const framework = asText(manifest.runtime.framework).toLowerCase();
  const startCommand = asText(manifest.start.command).toLowerCase();
  return (
    stack.includes('php') ||
    framework.includes('php') ||
    startCommand.startsWith('php ') ||
    startCommand.startsWith('php-s')
  );
}

function looksLikeJavaManifest(manifest: OneCeoDeploymentManifest): boolean {
  const stack = asText(manifest.stack).toLowerCase();
  const framework = asText(manifest.runtime.framework).toLowerCase();
  const startCommand = asText(manifest.start.command).toLowerCase();
  return (
    stack.includes('java') ||
    stack.includes('spring') ||
    framework.includes('java') ||
    framework.includes('spring') ||
    startCommand.includes('java -jar')
  );
}

async function detectBrokenEjsLayoutBodyUsage(
  sourceDir: string,
  packageJson: Record<string, unknown> | null
): Promise<string | null> {
  if (!packageJson || !hasDependency(packageJson, 'ejs')) {
    return null;
  }
  const ejsFiles = await findFilesByExtension(sourceDir, '.ejs');
  const layoutTemplateWithBody = (
    await Promise.all(
      ejsFiles.map(async (filePath) => ({
        filePath,
        content: await readTextIfExists(filePath),
      }))
    )
  ).find((entry) => /<%-\s*body\s*%>|<%=\s*body\s*%>/.test(entry.content));
  if (!layoutTemplateWithBody) {
    return null;
  }

  const hasLayoutDependency =
    hasDependency(packageJson, 'express-ejs-layouts') || hasDependency(packageJson, 'ejs-mate');
  const serverCandidates = [
    join(sourceDir, 'server.ts'),
    join(sourceDir, 'server.js'),
    join(sourceDir, 'server.cjs'),
    join(sourceDir, 'server/index.ts'),
    join(sourceDir, 'server/index.js'),
    join(sourceDir, 'server/index.cjs'),
    join(sourceDir, 'src/server/index.ts'),
    join(sourceDir, 'src/server/index.js'),
    join(sourceDir, 'src/server/index.cjs'),
    join(sourceDir, 'src/index.ts'),
    join(sourceDir, 'src/index.js'),
    join(sourceDir, 'app.ts'),
    join(sourceDir, 'app.js'),
  ];
  const serverContents = await Promise.all(serverCandidates.map((filePath) => readTextIfExists(filePath)));
  const hasLayoutWiring =
    hasLayoutDependency ||
    serverContents.some(
      (content) =>
        content.includes('express-ejs-layouts') ||
        content.includes('ejs-mate') ||
        content.includes('app.use(expressLayouts)') ||
        content.includes("app.set('layout'") ||
        content.includes('app.set("layout"')
    );
  if (hasLayoutWiring) {
    return null;
  }

  return layoutTemplateWithBody.filePath.replace(`${sourceDir}/`, '');
}

function buildDefaultManifest(input: {
  packageJson: Record<string, unknown>;
  healthcheckPath: string;
}): OneCeoDeploymentManifest {
  const scripts = asObject(input.packageJson.scripts);

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
      database: false,
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
  const templateCandidates = await findTemplateFiles(sourceDir, ['.html', '.ejs', '.jinja', '.jinja2', '.j2']);
  const candidates = [
    join(sourceDir, 'client/src/main.tsx'),
    join(sourceDir, 'client/src/main.ts'),
    join(sourceDir, 'src/main.tsx'),
    join(sourceDir, 'src/main.ts'),
    ...DEPLOYMENT_TEMPLATE_ANALYTICS_ENTRY_RELATIVE_PATHS.map((relativePath) =>
      join(sourceDir, relativePath)
    ),
    ...templateCandidates,
  ];
  const contents = await Promise.all(candidates.map((file) => readTextIfExists(file)));
  return contents.some(
    (content) =>
      content.includes('ONECEO_ANALYTICS:START') ||
      content.includes('window.__ONECEO_ANALYTICS__') ||
      content.includes('window.ONECEO_ANALYTICS_CONFIG') ||
      content.includes('OneCEO Analytics') ||
      content.includes('data-oneceo-analytics') ||
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
  const healthcheckPath = await inferHealthcheckPath(sourceDir);
  const existingManifest = await readJsonFile(manifestPath);
  if (!packageJson && !existingManifest) {
    throw new Error('部署前检查失败：缺少 package.json 或 oneceo.manifest.json');
  }

  const fallbackManifest = packageJson
    ? buildDefaultManifest({
        packageJson,
        healthcheckPath,
      })
    : normalizeManifest(
        existingManifest || {},
        {
          templateVersion: '1.0.0',
          appType: 'web_app',
          stack: 'generic_script_http_api_dbless',
          build: {
            command: 'echo "oneceo app ready"',
            outputDir: '.',
          },
          start: {
            command: '',
            portEnv: 'PORT',
          },
          healthcheck: {
            path: healthcheckPath,
          },
          features: {
            analytics: true,
            userTracking: true,
            database: false,
            auth: 'optional',
            objectStorage: false,
          },
          runtime: {
            framework: 'generic',
            transport: 'http',
          },
        }
      );
  const generatedManifest = !existingManifest;
  const manifest = normalizeManifest(existingManifest || {}, fallbackManifest);
  if (
    looksLikePhpManifest(manifest) &&
    healthcheckPath === '/' &&
    manifest.healthcheck.path !== '/'
  ) {
    manifest.healthcheck.path = '/';
    warnings.push('检测到 PHP 站点入口且未提供显式健康检查路由，已将 manifest 健康检查标准化为 /');
  }
  if (looksLikeJavaManifest(manifest) && manifest.healthcheck.path !== '/') {
    manifest.healthcheck.path = '/';
    warnings.push('检测到 Java/Spring Boot 站点，已将 Railway 健康检查标准化为 /，避免框架控制器注解差异阻断上线');
  }

  const scripts = asObject(packageJson?.scripts);
  const buildCommandDetected = packageJson
    ? Boolean(asText(scripts.build))
    : Boolean(asText(manifest.build.command));
  const startCommandDetected = packageJson
    ? Boolean(asText(scripts.start))
    : Boolean(asText(manifest.start.command));
  if (!buildCommandDetected) {
    errors.push(
      packageJson
        ? '缺少 package.json scripts.build，当前项目不具备标准构建入口'
        : '缺少可推导的 build command，当前项目不具备标准构建入口'
    );
  }
  if (!startCommandDetected) {
    errors.push(
      packageJson
        ? '缺少 package.json scripts.start，当前项目不具备标准启动入口'
        : '缺少可推导的 start command，当前项目不具备标准启动入口'
    );
  }

  if (generatedManifest) {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
    warnings.push('缺少 oneceo.manifest.json，已按平台默认契约自动补齐');
  }

  if (manifest.features.database === 'railway_postgres') {
    const databaseDependencyDetected = packageJson
      ? hasDependency(packageJson, 'pg') || hasDependency(packageJson, 'drizzle-orm')
      : null;
    if (!databaseDependencyDetected) {
      errors.push(
        packageJson
          ? 'manifest 声明 database=railway_postgres，但项目未检测到 pg / drizzle-orm 依赖'
          : 'manifest 声明 database=railway_postgres，但当前无 package.json 可校验数据库依赖'
      );
    }
  }

  const analyticsEntryDetected = await detectAnalyticsEntry(sourceDir);
  if (!analyticsEntryDetected) {
    errors.push('未检测到 OneCEO analytics bootstrap 或显式 analytics 注入入口');
  }

  const brokenEjsLayoutPath = await detectBrokenEjsLayoutBodyUsage(sourceDir, packageJson);
  if (brokenEjsLayoutPath) {
    errors.push(
      `检测到 EJS 布局模板 ${brokenEjsLayoutPath} 使用 <%- body %>，但项目未检测到 express-ejs-layouts / ejs-mate 布局接入；继续部署会导致 body is not defined`
    );
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
          ? packageJson
            ? hasDependency(packageJson, 'pg') || hasDependency(packageJson, 'drizzle-orm')
            : null
          : null,
    },
    warnings,
    errors,
  };
}
