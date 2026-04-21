import { expect, test } from "@playwright/test";
import { bootstrapSharedAuthenticatedUser } from "./playwright-auth";
import { composerTextarea } from "./playwright-locators";

const WEB_URL = "http://oneceo.ai:3000";
const API_URL = "http://oneceo.ai:3000";
test.describe.configure({ timeout: 120_000 });

function uniqueToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test("issue40: changes preview tab keeps state after refresh", async ({
  browser,
}) => {
  const token = uniqueToken();
  const context = await bootstrapSharedAuthenticatedUser(browser, WEB_URL);
  const page = await context.newPage();
  try {
    await page.goto(WEB_URL, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("altus_mode", "sandbox");
      localStorage.setItem("altus_executor", "opencode");
      localStorage.removeItem("task_creation_session_id");
    });
    await page.goto(WEB_URL, { waitUntil: "domcontentloaded" });

    const composer = composerTextarea(page);
    await expect(composer).toBeVisible();
    await composer.fill(`issue40 preview state test ${token}`);
    await composer.press("Enter");
    await expect(page).toHaveURL(/\/session\//, { timeout: 60_000 });

    const previewToggle = page.getByRole("button", {
      name: /显示预览|收起预览/,
    });
    await expect(previewToggle).toBeVisible();
    if ((await previewToggle.innerText()).includes("显示预览")) {
      await previewToggle.click();
    }
    await expect(
      page.getByRole("button", { name: "收起预览" }),
    ).toBeVisible();

    const changesTab = page
      .locator("button")
      .filter({ hasText: /^更改$/ })
      .first();
    await expect(changesTab).toBeVisible();
    await changesTab.click();
    await expect(changesTab).toHaveClass(/font-semibold/);

    await page.reload({ waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/session\//, { timeout: 60_000 });
    await expect(
      page.getByRole("button", { name: "收起预览" }),
    ).toBeVisible();
    await expect(
      page.locator("button").filter({ hasText: /^更改$/ }).first(),
    ).toHaveClass(/font-semibold/);
  } finally {
    await context.close();
  }
});
