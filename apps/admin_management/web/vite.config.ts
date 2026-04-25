import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发代理优先读取完整目标地址，其次用 host/port 组合，默认转发到本地管理后台 API。
const apiProxyTarget =
  (process.env.ADMIN_MANAGEMENT_API_PROXY_TARGET as string | undefined) ??
    (process.env.VITE_API_PROXY_TARGET as string | undefined) ??
    `http://${
      process.env.ADMIN_MANAGEMENT_API_PROXY_HOST ||
      process.env.VITE_API_HOST ||
      "127.0.0.1"
    }:${
      process.env.ADMIN_MANAGEMENT_PORT || process.env.VITE_API_PORT || "9310"
    }`;

// 管理后台前端开发服务器端口，默认使用 5174。
const webPort = Number(
  process.env.ADMIN_MANAGEMENT_WEB_PORT || process.env.VITE_DEV_PORT || 5174,
);

// 前端优先读取专用的 Web host；未单独配置时回退到后台 bind host，最后默认监听全部网卡。
const webHost = process.env.ADMIN_MANAGEMENT_WEB_HOST?.trim() ||
  process.env.ADMIN_MANAGEMENT_BIND_HOST?.trim() ||
  "0.0.0.0";

export default defineConfig({
  // 统一从仓库上层目录读取共享环境变量，避免只读取当前 web 目录。
  envDir: path.resolve(__dirname, "..", ".."),
  // 将当前 web 目录作为 Vite 项目根目录。
  root: path.resolve(__dirname),
  plugins: [react()],
  server: {
    host: webHost,
    port: webPort,
    strictPort: true,
    proxy: {
      // 本地开发时将前端接口请求转发到管理后台 API，避免跨域并保持路径不变。
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      // 健康检查同样走后端代理，便于本地排查服务状态。
      "/health": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    // 构建产物固定输出到 web/dist，发布前会先清空旧文件。
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react") || id.includes("react-dom")) return "vendor-react";
          if (id.includes("recharts") || id.includes("d3-")) return "vendor-charts";
          if (id.includes("@radix-ui") || id.includes("lucide-react")) return "vendor-ui";
          return undefined;
        },
      },
    },
  },
});
