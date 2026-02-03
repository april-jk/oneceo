import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n"; // 导入 i18n 配置

createRoot(document.getElementById("root")!).render(<App />);
