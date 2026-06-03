import { expect, test } from "@playwright/test";
import { loadPlaywrightTestAccount } from "./playwright-auth";

const WEB_BASE_URL = process.env.ONECEO_WEB_BASE_URL || "http://oneceo.ai:3000";

test("cross-site form post cannot establish a login session", async ({ browser }) => {
  const account = await loadPlaywrightTestAccount();
  const context = await browser.newContext();
  const page = await context.newPage();
  const attackPageHtml = `
    <html>
      <body>
        <form id="attack" method="POST" action="${WEB_BASE_URL}/api/auth/login">
          <input type="hidden" name="email" value="${account.email}">
          <input type="hidden" name="password" value="${account.password}">
        </form>
        <script>document.getElementById('attack').submit();</script>
      </body>
    </html>
  `;

  await page.goto(`data:text/html,${encodeURIComponent(attackPageHtml)}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForURL(/\/api\/auth\/login(?:$|[?#])/, { timeout: 10_000 });

  const sessionPayload = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    return response.json();
  });

  expect(sessionPayload?.data?.authenticated).toBe(false);
  const cookies = await context.cookies();
  expect(cookies.some((item) => item.name === "app_session_v2_id")).toBe(false);

  await context.close();
});

test("cross-site JSON fetch cannot bypass the login boundary", async ({ browser }) => {
  const account = await loadPlaywrightTestAccount();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("data:text/html,<html><body>csrf-test</body></html>", {
    waitUntil: "domcontentloaded",
  });

  const result = await page.evaluate(
    async ({ email, password, baseUrl }) => {
      try {
        const response = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email,
            password,
          }),
        });
        return {
          ok: true,
          status: response.status,
          type: response.type,
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      email: account.email,
      password: account.password,
      baseUrl: WEB_BASE_URL,
    },
  );

  expect(result.ok).toBe(false);

  await page.goto(`${WEB_BASE_URL}/login?redirect=%2Fhome`, { waitUntil: "domcontentloaded" });
  const sessionPayload = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    return response.json();
  });

  expect(sessionPayload?.data?.authenticated).toBe(false);
  const cookies = await context.cookies();
  expect(cookies.some((item) => item.name === "app_session_v2_id")).toBe(false);

  await context.close();
});
