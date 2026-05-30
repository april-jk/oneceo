export type SupportedSeoLanguage = "zh" | "en";

type LocalizedSeoCopy = {
  title: string;
  description: string;
  siteName: string;
};

const DEFAULT_SITE_ORIGIN = "https://oneceo.ai";

const SEO_COPY: Record<SupportedSeoLanguage, LocalizedSeoCopy> = {
  zh: {
    title: "oneceo | AI Agent 任务执行与部署指挥台",
    description:
      "oneceo 是面向执行与交付的 AI Agent 平台，帮助团队把需求拆解、任务推进、产物生成、站点部署与运行复核收进同一条工作链路。",
    siteName: "oneceo",
  },
  en: {
    title: "oneceo | AI agent control tower for execution and deployment",
    description:
      "oneceo is an AI agent platform for planning, execution, deliverables, deployment, and operational review in one accountable workflow.",
    siteName: "oneceo",
  },
};

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function normalizeSeoLanguage(
  value: string | null | undefined,
): SupportedSeoLanguage {
  const normalized = (value || "").trim().toLowerCase();
  return normalized.startsWith("zh") ? "zh" : "en";
}

export function getDefaultSeoCopy(
  language: string | null | undefined,
): LocalizedSeoCopy {
  return SEO_COPY[normalizeSeoLanguage(language)];
}

export function resolveSiteOrigin(explicitOrigin?: string | null): string {
  const normalized = trimTrailingSlash((explicitOrigin || "").trim());
  return normalized || DEFAULT_SITE_ORIGIN;
}

export function buildAbsoluteUrl(origin: string, pathname = "/"): string {
  return new URL(pathname, `${resolveSiteOrigin(origin)}/`).toString();
}

export function isIndexablePath(pathname: string): boolean {
  return pathname === "/";
}

export function buildRobotsTxt(origin: string): string {
  const canonicalOrigin = resolveSiteOrigin(origin);
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /socket.io/",
    "",
    `Sitemap: ${buildAbsoluteUrl(canonicalOrigin, "/sitemap.xml")}`,
  ].join("\n");
}

export function buildSitemapXml(origin: string): string {
  const canonicalOrigin = resolveSiteOrigin(origin);
  const homepage = buildAbsoluteUrl(canonicalOrigin, "/");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url>",
    `    <loc>${homepage}</loc>`,
    "    <changefreq>daily</changefreq>",
    "    <priority>1.0</priority>",
    "  </url>",
    "</urlset>",
  ].join("\n");
}

export function buildStructuredData(
  origin: string,
  language: string | null | undefined,
): Array<Record<string, unknown>> {
  const canonicalOrigin = resolveSiteOrigin(origin);
  const copy = getDefaultSeoCopy(language);
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: copy.siteName,
      url: buildAbsoluteUrl(canonicalOrigin, "/"),
      logo: buildAbsoluteUrl(canonicalOrigin, "/logo.png"),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: copy.siteName,
      url: buildAbsoluteUrl(canonicalOrigin, "/"),
      description: copy.description,
      inLanguage: normalizeSeoLanguage(language),
    },
  ];
}
