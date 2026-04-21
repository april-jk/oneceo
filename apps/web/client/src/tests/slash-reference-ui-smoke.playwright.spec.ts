import { expect, test, type Page } from "@playwright/test";

const WEB_URL = process.env.PLAYWRIGHT_WEB_URL || "http://127.0.0.1:3000";
const CORS_HEADERS = {
  "access-control-allow-origin": WEB_URL,
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-requested-with,x-user-id,x-app-user-id",
};

function uniqueToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function openManagedInput(page: Page) {
  await page.goto(`${WEB_URL}/new-task`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("altus_mode", "managed");
    localStorage.removeItem("task_creation_session_id");
  });
  await page.goto(`${WEB_URL}/new-task`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("textarea").first()).toBeVisible();
}

test("slash suggestions and token chip placement smoke", async ({ page }) => {
  const token = uniqueToken();
  try {
    await page.route("**/api/auth/me", async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: CORS_HEADERS });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          data: {
            user: {
              id: `playwright-user-${token}`,
              email: `playwright-${token}@example.com`,
              displayName: "Playwright User",
            },
          },
        }),
      });
    });
    await page.route("**/api/task-creation/skills", async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: CORS_HEADERS });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: CORS_HEADERS,
        body: JSON.stringify({
          data: [
            {
              sourceType: "platform",
              skillId: "minimax-pdf",
              revisionId: "rev1",
              slug: "minimax-pdf",
              name: "minimax-pdf",
              description: "",
              category: "tool",
              revisionNumber: 1,
            },
          ],
        }),
      });
    });
    await page.route("**/api/connectors/me", async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: CORS_HEADERS });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: CORS_HEADERS,
        body: JSON.stringify({
          data: {
            catalog: [
              {
                key: "github",
                category: "custom_mcp",
                name: "GitHub MCP",
                description: "",
                icon: "",
                authMode: "none",
                available: true,
                configFields: [],
                activityMatcherVerified: true,
              },
              {
                key: "notion",
                category: "custom_mcp",
                name: "Notion MCP",
                description: "",
                icon: "",
                authMode: "none",
                available: true,
                configFields: [],
                activityMatcherVerified: true,
              },
            ],
            profiles: [
              {
                profileId: "p1",
                connectorKey: "github",
                profileName: "github default",
                authMode: "none",
                authStatus: "authorized",
                config: {},
                isDefault: true,
              },
              {
                profileId: "p2",
                connectorKey: "notion",
                profileName: "notion default",
                authMode: "none",
                authStatus: "not_configured",
                config: {},
                isDefault: true,
              },
            ],
          },
        }),
      });
    });

    await openManagedInput(page);

    const textarea = page.locator("textarea").first();
    await textarea.fill("/mini");
    await expect(page.getByRole("button", { name: /minimax-pdf/ })).toBeVisible();

    await page.keyboard.press("Enter");

    const skillTokenChip = page.getByRole("button", { name: /skill minimax-pdf/i });
    await expect(skillTokenChip).toBeVisible();
    await expect(page.getByLabel("移除附件 minimax-pdf")).toHaveCount(0);
    await expect(page).toHaveURL(/\/new-task/);

    await textarea.fill("/github");
    await expect(page.getByRole("button", { name: /GitHub MCP/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Notion MCP/ })).toHaveCount(0);
  } finally {
    await page.unroute("**/api/auth/me");
    await page.unroute("**/api/task-creation/skills");
    await page.unroute("**/api/connectors/me");
  }
});
