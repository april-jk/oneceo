type UmamiTracker = {
  track?: (eventName?: string, data?: Record<string, string | number | boolean>) => void;
};

declare global {
  interface Window {
    umami?: UmamiTracker;
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function mountPlatformAnalyticsScript() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  const enabled = String(import.meta.env.VITE_ANALYTICS_ENABLED || "true")
    .trim()
    .toLowerCase();
  if (["0", "false", "no", "off"].includes(enabled)) {
    return;
  }
  const endpoint = String(
    import.meta.env.VITE_ANALYTICS_HOST ||
      import.meta.env.VITE_ANALYTICS_ENDPOINT ||
      "",
  )
    .trim()
    .replace(/\/+$/, "");
  const websiteId = String(import.meta.env.VITE_ANALYTICS_WEBSITE_ID || "").trim();
  const tag = String(import.meta.env.VITE_ANALYTICS_TAG || "").trim();
  if (!endpoint || !websiteId || !isUuid(websiteId)) {
    return;
  }
  if (window.location.protocol === "https:" && !endpoint.startsWith("https://")) {
    console.warn("[ANALYTICS] Skip insecure endpoint on HTTPS page:", endpoint);
    return;
  }
  if (document.querySelector(`script[data-website-id="${websiteId}"]`)) {
    return;
  }
  const script = document.createElement("script");
  script.defer = true;
  script.src = `${endpoint}/script.js`;
  script.setAttribute("data-website-id", websiteId);
  script.setAttribute("data-host-url", endpoint);
  script.setAttribute("data-origin", "oneceo-platform");
  if (tag) {
    script.setAttribute("data-tag", tag);
  }
  document.body.appendChild(script);
}

export function trackPlatformEvent(
  eventName: string,
  data?: Record<string, string | number | boolean>,
) {
  if (typeof window === "undefined") return;
  const safeName = eventName.trim().slice(0, 50);
  if (!safeName) return;
  window.umami?.track?.(safeName, data);
}
