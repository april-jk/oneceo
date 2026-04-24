import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n"; // 导入 i18n 配置
import { installApiFetchCredentials } from "./lib/auth-client";
import { mountPlatformAnalyticsScript } from "./lib/platform-analytics";

installApiFetchCredentials();
mountPlatformAnalyticsScript();

createRoot(document.getElementById("root")!).render(<App />);
