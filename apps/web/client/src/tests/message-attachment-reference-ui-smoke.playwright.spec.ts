import { expect, request as playwrightRequest, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WEB_URL = "http://localhost:3000";
const API_URL = "http://localhost:4000";
test.describe.configure({ timeout: 120_000 });

function uniqueToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function bootstrapAuthenticatedUser(browser: import("@playwright/test").Browser, token: string) {
  const api = await playwrightRequest.newContext({ baseURL: API_URL });
  try {
    const response = await api.post("/api/auth/register", {
      data: {
        displayName: `playwright-ui-${token}`,
        email: `playwright-ui-${token}@example.com`,
        password: "playwright-ui-123",
      },
    });
    expect(response.ok()).toBe(true);
    const storageState = await api.storageState();
    return await browser.newContext({ storageState });
  } finally {
    await api.dispose();
  }
}

async function ensureManagedMode(page: Page) {
  await page.goto(WEB_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("altus_mode", "managed");
    localStorage.removeItem("task_creation_session_id");
  });
  await page.goto(WEB_URL, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("textbox", { name: "Type your message here..." })).toBeVisible();
}

test("ui smoke: attachment picker and message reference block", async ({ browser }, testInfo) => {
  const token = uniqueToken();
  const context = await bootstrapAuthenticatedUser(browser, token);
  const page = await context.newPage();
  const screenshotDir = testInfo.outputPath("issue26-ui-smoke");
  mkdirSync(screenshotDir, { recursive: true });
  const fileName = `issue26-ui-${token}.txt`;
  const filePath = join(screenshotDir, fileName);
  writeFileSync(filePath, `issue26 ui smoke file: ${token}\n`, "utf8");

  try {
    await ensureManagedMode(page);

    await page.getByTestId("attachment-picker-trigger").click();
    const menu = page.getByTestId("attachment-picker-menu");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("使用技能");
    await expect(menu).toContainText("从本地文件添加");
    await menu.screenshot({ path: join(screenshotDir, "01-attachment-picker-menu.png") });

    await page.locator('input[type="file"]').setInputFiles(filePath);
    await expect(page.getByText(fileName, { exact: false }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await page.locator('textarea[placeholder="Type your message here..."]').fill(`ui smoke ${token}`);
    await expect(page.getByText(fileName, { exact: false }).first()).toBeVisible();
    const sendButton = page.locator("button").filter({ has: page.locator("svg.lucide-send") }).first();
    await expect(sendButton).toBeEnabled();
    await page
      .locator("div")
      .filter({ has: page.locator('textarea[placeholder="Type your message here..."]') })
      .first()
      .screenshot({ path: join(screenshotDir, "02-composer-with-attachment-chip.png") });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("textbox", { name: "Type your message here..." })).toBeVisible();
    await page.screenshot({ path: join(screenshotDir, "03-after-reload-home.png"), fullPage: true });
  } finally {
    await context.close();
  }
});
