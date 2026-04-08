import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n"; // 导入 i18n 配置
import { installApiFetchCredentials } from "./lib/auth-client";

function mountAnalyticsScript() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  const endpoint = String(import.meta.env.VITE_ANALYTICS_ENDPOINT || "").trim().replace(/\/+$/, "");
  const websiteId = String(import.meta.env.VITE_ANALYTICS_WEBSITE_ID || "").trim();
  if (!endpoint || !websiteId) {
    return;
  }
  if (window.location.protocol === "https:" && !endpoint.startsWith("https://")) {
    console.warn("[ANALYTICS] Skip insecure endpoint on HTTPS page:", endpoint);
    return;
  }
  const script = document.createElement("script");
  script.defer = true;
  script.src = `${endpoint}/umami`;
  script.setAttribute("data-website-id", websiteId);
  script.setAttribute("data-origin", "runtime-inject");
  document.body.appendChild(script);
}

installApiFetchCredentials();
mountAnalyticsScript();

createRoot(document.getElementById("root")!).render(<App />);
