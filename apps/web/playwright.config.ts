import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["client/src/tests/**/*.playwright.spec.ts"],
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    headless: true,
    locale: "zh-CN",
  },
});
