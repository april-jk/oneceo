import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ANALYTICS_BOOTSTRAP_MARKER_START = '<!-- ONECEO_ANALYTICS:START -->';
const ANALYTICS_BOOTSTRAP_MARKER_END = '<!-- ONECEO_ANALYTICS:END -->';

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

async function findHtmlEntryPath(sourceDir: string): Promise<string | null> {
  const candidates = [
    join(sourceDir, 'client/index.html'),
    join(sourceDir, 'index.html'),
    join(sourceDir, 'public/index.html'),
    join(sourceDir, 'templates/index.html'),
    join(sourceDir, 'app/templates/index.html'),
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return null;
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
  var domain = readValue(config.publicDomain);
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
  if (domain) script.setAttribute('data-domains', domain);
  document.body.appendChild(script);
})();
</script>
${ANALYTICS_BOOTSTRAP_MARKER_END}`;
}

function injectBeforeBodyClose(html: string, snippet: string): string | null {
  if (html.includes(ANALYTICS_BOOTSTRAP_MARKER_START)) {
    return html;
  }
  const bodyCloseIndex = html.lastIndexOf('</body>');
  if (bodyCloseIndex >= 0) {
    return `${html.slice(0, bodyCloseIndex)}${snippet}\n${html.slice(bodyCloseIndex)}`;
  }
  const htmlCloseIndex = html.lastIndexOf('</html>');
  if (htmlCloseIndex >= 0) {
    return `${html.slice(0, htmlCloseIndex)}${snippet}\n${html.slice(htmlCloseIndex)}`;
  }
  if (html.trim()) {
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
  const htmlEntryPath = await findHtmlEntryPath(sourceDir);
  if (!htmlEntryPath) {
    errors.push('未找到 HTML 入口文件，无法注入默认 analytics bootstrap');
    return {
      analyticsInjected: false,
      warnings,
      errors,
    };
  }

  const html = await readFile(htmlEntryPath, 'utf-8');
  const nextHtml = injectBeforeBodyClose(
    html,
    buildAnalyticsBootstrapSnippet(options?.analyticsConfig)
  );
  if (!nextHtml) {
    errors.push(`HTML 入口 ${asText(htmlEntryPath)} 内容异常，无法注入 analytics bootstrap`);
    return {
      analyticsInjected: false,
      analyticsTargetPath: htmlEntryPath,
      warnings,
      errors,
    };
  }

  const analyticsInjected = nextHtml !== html;
  if (analyticsInjected) {
    await writeFile(htmlEntryPath, nextHtml, 'utf-8');
    warnings.push('已自动注入 OneCEO analytics bootstrap 到 HTML 入口');
  }

  return {
    analyticsInjected,
    analyticsTargetPath: htmlEntryPath,
    warnings,
    errors,
  };
}
