import { useEffect } from "react";
import {
  buildAbsoluteUrl,
  buildStructuredData,
  getDefaultSeoCopy,
  isIndexablePath,
  normalizeSeoLanguage,
} from "../../../shared/site-seo";

type PageSeoOptions = {
  language: string;
  pathname: string;
};

function ensureMeta(
  selector: string,
  factory: () => HTMLMetaElement,
): HTMLMetaElement {
  const existing = document.head.querySelector<HTMLMetaElement>(selector);
  if (existing) return existing;
  const node = factory();
  document.head.appendChild(node);
  return node;
}

function ensureLink(
  selector: string,
  factory: () => HTMLLinkElement,
): HTMLLinkElement {
  const existing = document.head.querySelector<HTMLLinkElement>(selector);
  if (existing) return existing;
  const node = factory();
  document.head.appendChild(node);
  return node;
}

function ensureStructuredDataNode(): HTMLScriptElement {
  const existing = document.head.querySelector<HTMLScriptElement>(
    "#oneceo-structured-data",
  );
  if (existing) return existing;
  const script = document.createElement("script");
  script.id = "oneceo-structured-data";
  script.type = "application/ld+json";
  document.head.appendChild(script);
  return script;
}

function resolveCurrentOrigin(): string {
  if (typeof window === "undefined") {
    return "https://oneceo.ai";
  }
  return window.location.origin || "https://oneceo.ai";
}

function applyPageSeo({ language, pathname }: PageSeoOptions) {
  const normalizedLanguage = normalizeSeoLanguage(language);
  const origin = resolveCurrentOrigin();
  const copy = getDefaultSeoCopy(normalizedLanguage);
  const indexable = isIndexablePath(pathname);
  const robots = indexable
    ? "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"
    : "noindex,nofollow";
  const canonicalUrl = buildAbsoluteUrl(origin, pathname || "/");
  const ogType = indexable ? "website" : "article";
  const twitterCard = indexable ? "summary_large_image" : "summary";

  document.title = copy.title;
  document.documentElement.lang = normalizedLanguage;

  ensureMeta('meta[name="description"]', () => {
    const meta = document.createElement("meta");
    meta.name = "description";
    return meta;
  }).content = copy.description;

  ensureMeta('meta[name="robots"]', () => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    return meta;
  }).content = robots;

  ensureMeta('meta[name="googlebot"]', () => {
    const meta = document.createElement("meta");
    meta.name = "googlebot";
    return meta;
  }).content = robots;

  ensureMeta('meta[property="og:title"]', () => {
    const meta = document.createElement("meta");
    meta.setAttribute("property", "og:title");
    return meta;
  }).content = copy.title;

  ensureMeta('meta[property="og:description"]', () => {
    const meta = document.createElement("meta");
    meta.setAttribute("property", "og:description");
    return meta;
  }).content = copy.description;

  ensureMeta('meta[property="og:type"]', () => {
    const meta = document.createElement("meta");
    meta.setAttribute("property", "og:type");
    return meta;
  }).content = ogType;

  ensureMeta('meta[property="og:url"]', () => {
    const meta = document.createElement("meta");
    meta.setAttribute("property", "og:url");
    return meta;
  }).content = canonicalUrl;

  ensureMeta('meta[property="og:site_name"]', () => {
    const meta = document.createElement("meta");
    meta.setAttribute("property", "og:site_name");
    return meta;
  }).content = copy.siteName;

  ensureMeta('meta[property="og:locale"]', () => {
    const meta = document.createElement("meta");
    meta.setAttribute("property", "og:locale");
    return meta;
  }).content = normalizedLanguage === "zh" ? "zh_CN" : "en_US";

  ensureMeta('meta[property="og:image"]', () => {
    const meta = document.createElement("meta");
    meta.setAttribute("property", "og:image");
    return meta;
  }).content = buildAbsoluteUrl(origin, "/logo.png");

  ensureMeta('meta[name="twitter:card"]', () => {
    const meta = document.createElement("meta");
    meta.name = "twitter:card";
    return meta;
  }).content = twitterCard;

  ensureMeta('meta[name="twitter:title"]', () => {
    const meta = document.createElement("meta");
    meta.name = "twitter:title";
    return meta;
  }).content = copy.title;

  ensureMeta('meta[name="twitter:description"]', () => {
    const meta = document.createElement("meta");
    meta.name = "twitter:description";
    return meta;
  }).content = copy.description;

  ensureMeta('meta[name="twitter:image"]', () => {
    const meta = document.createElement("meta");
    meta.name = "twitter:image";
    return meta;
  }).content = buildAbsoluteUrl(origin, "/logo.png");

  ensureLink('link[rel="canonical"]', () => {
    const link = document.createElement("link");
    link.rel = "canonical";
    return link;
  }).href = canonicalUrl;

  const structuredData = ensureStructuredDataNode();
  structuredData.textContent = JSON.stringify(
    indexable ? buildStructuredData(origin, normalizedLanguage) : [],
  );
}

export function usePageSeo(options: PageSeoOptions) {
  useEffect(() => {
    applyPageSeo(options);
  }, [options.language, options.pathname]);
}
