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
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function buildAnalyticsBootstrapSnippet() {
  return `${ANALYTICS_BOOTSTRAP_MARKER_START}
<script>
(function () {
  var enabled = String('%VITE_ANALYTICS_ENABLED%' || 'true').trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].indexOf(enabled) >= 0) return;
  var endpoint = String('%VITE_ANALYTICS_HOST%' || '%VITE_ANALYTICS_ENDPOINT%' || '').trim().replace(/\\/+$/, '');
  var websiteId = String('%VITE_ANALYTICS_WEBSITE_ID%' || '').trim();
  var tag = String('%VITE_ANALYTICS_TAG%' || '').trim();
  if (!endpoint || !websiteId) return;
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
  sourceDir: string
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
  const nextHtml = injectBeforeBodyClose(html, buildAnalyticsBootstrapSnippet());
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
