import { expect, test } from "@playwright/test";
import { bootstrapSharedAuthenticatedUser } from "./playwright-auth";

const WEB_URL = process.env.PLAYWRIGHT_WEB_URL || "http://127.0.0.1:3000";

function uniqueToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test("account avatar upload and remove refreshes user menu avatar", async ({ browser }) => {
  const token = uniqueToken();
  const context = await bootstrapSharedAuthenticatedUser(browser, WEB_URL);
  const page = await context.newPage();
  const calls: string[] = [];

  await page.route("**/api/auth/avatar/upload", async (route) => {
    calls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          user: {
            id: `user-${token}`,
            email: `avatar-${token}@example.com`,
            displayName: `Avatar User ${token}`,
            avatarUrl: `https://example.com/avatar-uploaded-${token}.png`,
            avatarSource: "manual",
          },
        },
      }),
    });
  });
  await page.route("**/api/auth/avatar", async (route) => {
    calls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          user: {
            id: `user-${token}`,
            email: `avatar-${token}@example.com`,
            displayName: `Avatar User ${token}`,
            avatarUrl: null,
            avatarSource: "default",
          },
        },
      }),
    });
  });

  await page.goto(`${WEB_URL}/home`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("oneceo:open-settings-dialog", {
        detail: { tab: "account" },
      }),
    );
  });

  await expect(page.getByRole("button", { name: /编辑资料|Edit profile/i })).toBeVisible();
  await page.getByRole("button", { name: /编辑资料|Edit profile/i }).click();
  await expect(page.getByText(/账户详情|Account details/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /更换头像|Change avatar/i })).toBeVisible();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /更换头像|Change avatar/i }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from("avatar"),
  });

  await expect(page.getByText(/头像已更新|Avatar updated/i)).toBeVisible();

  await page.getByRole("button", { name: /移除头像|Remove avatar/i }).click();
  await expect(page.getByText(/头像已移除|Avatar removed/i)).toBeVisible();
  expect(calls.some((item) => item.includes("/api/auth/avatar/upload"))).toBe(true);
  expect(calls.some((item) => item.endsWith("/api/auth/avatar"))).toBe(true);
  await context.close();
});
