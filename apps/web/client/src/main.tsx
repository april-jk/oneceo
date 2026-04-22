import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n"; // 导入 i18n 配置
import { installApiFetchCredentials } from "./lib/auth-client";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function mountAnalyticsScript() {
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
  if (!endpoint || !websiteId) {
    return;
  }
  if (!isUuid(websiteId)) {
    return;
  }
  if (window.location.protocol === "https:" && !endpoint.startsWith("https://")) {
    console.warn("[ANALYTICS] Skip insecure endpoint on HTTPS page:", endpoint);
    return;
  }
  const script = document.createElement("script");
  script.defer = true;
  script.src = `${endpoint}/script.js`;
  script.setAttribute("data-website-id", websiteId);
  script.setAttribute("data-host-url", endpoint);
  script.setAttribute("data-origin", "runtime-inject");
  if (tag) {
    script.setAttribute("data-tag", tag);
  }
  document.body.appendChild(script);
}

installApiFetchCredentials();
mountAnalyticsScript();

createRoot(document.getElementById("root")!).render(<App />);
