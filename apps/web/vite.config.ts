import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";

const plugins = [react(), tailwindcss(), jsxLocPlugin()];

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function splitEnvList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueHosts(hosts: string[]): string[] {
  return Array.from(new Set(hosts.filter(Boolean)));
}

function hostFromUrl(value: string | undefined): string {
  if (!value) return "";
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

export default defineConfig(({ mode }) => {
  const envDir = path.resolve(import.meta.dirname, "..");
  const env = loadEnv(mode, envDir, "");
  const apiTarget = trimTrailingSlash(
    env.WEB_BFF_API_TARGET || env.ONECEO_API_URL || "http://localhost:4000"
  );
  const allowedHosts = uniqueHosts([
    "oneceo.ai",
    "www.oneceo.ai",
    "localhost",
    "127.0.0.1",
    hostFromUrl(env.FRONTEND_URL),
    hostFromUrl(env.ONECEO_API_PUBLIC_URL),
    ...splitEnvList(env.WEB_DEV_ALLOWED_HOSTS),
  ]);

  return {
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "client", "src"),
        "@shared": path.resolve(import.meta.dirname, "shared"),
        "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      },
    },
    envDir,
    root: path.resolve(import.meta.dirname, "client"),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port: 3000,
      strictPort: true,
      host: true,
      allowedHosts,
      fs: {
        strict: true,
        deny: ["**/.*"],
        allow: [".."]
      },
      hmr: {
        clientPort: 3000,
      },
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
        },
        "/ws/task-creation": {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
        },
        "/socket.io": {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
