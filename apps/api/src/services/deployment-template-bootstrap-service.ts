import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

const ANALYTICS_BOOTSTRAP_MARKER_START = '<!-- ONECEO_ANALYTICS:START -->';
const ANALYTICS_BOOTSTRAP_MARKER_END = '<!-- ONECEO_ANALYTICS:END -->';
export const DEPLOYMENT_TEMPLATE_HTML_ENTRY_RELATIVE_PATHS = [
  'client/index.html',
  'index.html',
  'templates/index.html',
  'templates/base.html',
  'templates/layout.html',
  'templates/main.html',
  'templates/home.html',
  'app/templates/index.html',
  'app/templates/base.html',
  'app/templates/layout.html',
  'app/templates/main.html',
  'app/templates/home.html',
  'src/main/resources/templates/index.html',
  'src/main/resources/templates/base.html',
  'src/main/resources/templates/layout.html',
  'src/main/resources/templates/main.html',
  'src/main/resources/templates/home.html',
  'src/main/resources/static/index.html',
] as const;

export const DEPLOYMENT_TEMPLATE_SERVER_RENDERED_ENTRY_RELATIVE_PATHS = [
  'views/layouts/main.ejs',
  'views/layout.ejs',
  'views/index.ejs',
  'views/main.ejs',
  'views/home.ejs',
  'app/views/layouts/main.ejs',
  'app/views/layout.ejs',
  'app/views/index.ejs',
  'app/views/main.ejs',
  'app/views/home.ejs',
] as const;

export const DEPLOYMENT_TEMPLATE_PHP_ENTRY_RELATIVE_PATHS = [
  'index.php',
  'public/index.php',
] as const;

export const DEPLOYMENT_TEMPLATE_ANALYTICS_ENTRY_RELATIVE_PATHS = [
  ...DEPLOYMENT_TEMPLATE_HTML_ENTRY_RELATIVE_PATHS,
  ...DEPLOYMENT_TEMPLATE_SERVER_RENDERED_ENTRY_RELATIVE_PATHS,
  ...DEPLOYMENT_TEMPLATE_PHP_ENTRY_RELATIVE_PATHS,
  'public/index.html',
] as const;

export type DeploymentTemplateBootstrapReport = {
  analyticsInjected: boolean;
  analyticsTargetPath?: string;
  warnings: string[];
  errors: string[];
};

export type DeploymentTemplateAnalyticsConfig = {
  enabled?: boolean;
  host?: string;
  endpoint?: string;
  websiteId?: string;
  tag?: string;
  publicDomain?: string;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const TEMPLATE_SCAN_DIRECTORY_RELATIVE_PATHS = [
  'templates',
  'app/templates',
  'views',
  'app/views',
  'src/main/resources/templates',
  'src/main/resources/static',
] as const;

const TEMPLATE_SCAN_FILE_SUFFIXES = ['.html', '.ejs', '.jinja', '.jinja2', '.j2'] as const;

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function rankTemplateCandidate(path: string): number {
  const fileName = basename(path).toLowerCase();
  if (fileName === 'index.php') return 0;
  if (fileName === 'base.html' || fileName === 'layout.html' || fileName === 'main.ejs') return 0;
  if (fileName.startsWith('layout.') || fileName.startsWith('base.') || fileName.startsWith('main.'))
    return 1;
  if (fileName.startsWith('index.') || fileName.startsWith('home.')) return 2;
  return 10;
}

async function findHtmlEntryPaths(sourceDir: string): Promise<string[]> {
  const resolvedCandidates: string[] = [];
  const seen = new Set<string>();

  const rememberCandidate = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    resolvedCandidates.push(path);
  };

  for (const relativePath of DEPLOYMENT_TEMPLATE_ANALYTICS_ENTRY_RELATIVE_PATHS) {
    const candidate = join(sourceDir, relativePath);
    if (await exists(candidate)) {
      rememberCandidate(candidate);
    }
  }

  const scannedCandidates: string[] = [];
  const queue: string[] = [];
  for (const relativePath of TEMPLATE_SCAN_DIRECTORY_RELATIVE_PATHS) {
    const candidateDir = join(sourceDir, relativePath);
    if (await exists(candidateDir)) {
      queue.push(candidateDir);
    }
  }

  while (queue.length > 0 && scannedCandidates.length < 64) {
    const currentDir = queue.shift();
    if (!currentDir) continue;
    let entries: Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }> = [];
    try {
      entries = await readdir(currentDir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (
        entry.isFile() &&
        TEMPLATE_SCAN_FILE_SUFFIXES.some((suffix) => entry.name.toLowerCase().endsWith(suffix))
      ) {
        scannedCandidates.push(entryPath);
      }
    }
  }

  scannedCandidates
    .sort((left, right) => {
      const scoreDiff = rankTemplateCandidate(left) - rankTemplateCandidate(right);
      if (scoreDiff !== 0) return scoreDiff;
      return normalizeRelativePath(relative(sourceDir, left)).localeCompare(
        normalizeRelativePath(relative(sourceDir, right))
      );
    })
    .forEach(rememberCandidate);

  return resolvedCandidates;
}

async function injectAnalyticsBootstrapIntoPath(
  path: string,
  analyticsConfig?: DeploymentTemplateAnalyticsConfig
): Promise<boolean> {
  const html = await readFile(path, 'utf-8');
  const allowAppend = !path.toLowerCase().endsWith('.php');
  const nextHtml = injectBeforeBodyClose(html, buildAnalyticsBootstrapSnippet(analyticsConfig), {
    allowAppend,
  });
  if (!nextHtml) {
    throw new Error(`HTML 入口 ${asText(path)} 内容异常，无法注入 analytics bootstrap`);
  }
  if (nextHtml === html) {
    return false;
  }
  await writeFile(path, nextHtml, 'utf-8');
  return true;
}

function buildAnalyticsBootstrapSnippet(config?: DeploymentTemplateAnalyticsConfig) {
  const runtimeConfig = {
    enabled: config?.enabled !== false && Boolean(asText(config?.host || config?.endpoint) && asText(config?.websiteId)),
    host: asText(config?.host),
    endpoint: asText(config?.endpoint || config?.host),
    websiteId: asText(config?.websiteId),
    tag: asText(config?.tag),
    publicDomain: asText(config?.publicDomain),
  };
  return `${ANALYTICS_BOOTSTRAP_MARKER_START}
<script>
window.__ONECEO_ANALYTICS__ = Object.freeze(${JSON.stringify(runtimeConfig)});
(function () {
  var config = window.__ONECEO_ANALYTICS__ || {};
  var readValue = function (value) {
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return typeof value === 'string' ? value.trim() : '';
  };
  var enabled = readValue(config.enabled).toLowerCase();
  if (!enabled) enabled = 'false';
  if (['0', 'false', 'no', 'off'].indexOf(enabled) >= 0) return;
  var endpoint = readValue(config.host) || readValue(config.endpoint);
  var websiteId = readValue(config.websiteId);
  var tag = readValue(config.tag);
  if (!endpoint || !websiteId) return;
  endpoint = endpoint.replace(/\\/+$/, '');
  if (window.location.protocol === 'https:' && endpoint.indexOf('https://') !== 0) return;
  if (document.querySelector('script[data-oneceo-analytics=\"runtime\"]')) return;
  var script = document.createElement('script');
  script.defer = true;
  script.src = endpoint + '/script.js';
  script.setAttribute('data-website-id', websiteId);
  script.setAttribute('data-host-url', endpoint);
  script.setAttribute('data-oneceo-analytics', 'runtime');
  if (tag) script.setAttribute('data-tag', tag);
  document.body.appendChild(script);
})();
</script>
${ANALYTICS_BOOTSTRAP_MARKER_END}`;
}

function injectBeforeBodyClose(
  html: string,
  snippet: string,
  options?: {
    allowAppend?: boolean;
  }
): string | null {
  const markerStartIndex = html.indexOf(ANALYTICS_BOOTSTRAP_MARKER_START);
  if (markerStartIndex >= 0) {
    const markerEndIndex = html.indexOf(ANALYTICS_BOOTSTRAP_MARKER_END, markerStartIndex);
    if (markerEndIndex < 0) {
      return null;
    }
    const replaceEndIndex = markerEndIndex + ANALYTICS_BOOTSTRAP_MARKER_END.length;
    return `${html.slice(0, markerStartIndex)}${snippet}${html.slice(replaceEndIndex)}`;
  }
  const bodyCloseIndex = html.lastIndexOf('</body>');
  if (bodyCloseIndex >= 0) {
    return `${html.slice(0, bodyCloseIndex)}${snippet}\n${html.slice(bodyCloseIndex)}`;
  }
  const htmlCloseIndex = html.lastIndexOf('</html>');
  if (htmlCloseIndex >= 0) {
    return `${html.slice(0, htmlCloseIndex)}${snippet}\n${html.slice(htmlCloseIndex)}`;
  }
  if (options?.allowAppend !== false && html.trim()) {
    return `${html}\n${snippet}\n`;
  }
  return null;
}

export async function ensureDeploymentTemplateBootstrap(
  sourceDir: string,
  options?: {
    analyticsConfig?: DeploymentTemplateAnalyticsConfig;
  }
): Promise<DeploymentTemplateBootstrapReport> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const htmlEntryPaths = await findHtmlEntryPaths(sourceDir);
  if (htmlEntryPaths.length === 0) {
    errors.push('未找到 HTML 入口文件，无法注入默认 analytics bootstrap');
    return {
      analyticsInjected: false,
      warnings,
      errors,
    };
  }

  const failedTargets: string[] = [];
  let injectedCount = 0;
  for (const htmlEntryPath of htmlEntryPaths) {
    try {
      if (await injectAnalyticsBootstrapIntoPath(htmlEntryPath, options?.analyticsConfig)) {
        injectedCount += 1;
      }
    } catch (error) {
      failedTargets.push(asText(error instanceof Error ? error.message : htmlEntryPath));
    }
  }

  if (failedTargets.length === htmlEntryPaths.length) {
    errors.push(...failedTargets);
    return {
      analyticsInjected: false,
      analyticsTargetPath: htmlEntryPaths[0],
      warnings,
      errors,
    };
  }

  const analyticsInjected = injectedCount > 0;
  if (analyticsInjected) {
    warnings.push(
      injectedCount === 1
        ? '已自动注入 OneCEO analytics bootstrap 到 HTML 入口'
        : `已自动注入 OneCEO analytics bootstrap 到 ${injectedCount} 个模板入口`
    );
  }
  if (failedTargets.length > 0) {
    warnings.push(`部分模板入口注入失败，已跳过 ${failedTargets.length} 个文件`);
  }

  return {
    analyticsInjected,
    analyticsTargetPath: htmlEntryPaths[0],
    warnings,
    errors,
  };
}
