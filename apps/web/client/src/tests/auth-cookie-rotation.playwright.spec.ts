import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_ACCOUNT_FILE = path.resolve(__dirname, "..", "..", "..", "e2e", "playwright-test-account.json");
const WEB_BASE_URL = process.env.ONECEO_WEB_BASE_URL || "http://oneceo.ai:3000";

type TestAccount = {
  email: string;
  password: string;
};

async function loadTestAccount(): Promise<TestAccount> {
  const raw = await readFile(TEST_ACCOUNT_FILE, "utf8");
  const parsed = JSON.parse(raw) as Partial<TestAccount>;
  return {
    email: String(parsed.email || "").trim(),
    password: String(parsed.password || "").trim(),
  };
}

test("login still succeeds when a stale secure legacy session cookie is present", async ({ browser }) => {
  const account = await loadTestAccount();
  const context = await browser.newContext();
  const page = await context.newPage();

  await context.addCookies([
    {
      name: "app_session_id",
      value: "stale-secure-cookie",
      domain: "oneceo.ai",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      expires: Math.floor(Date.now() / 1000) + 3600,
    },
  ]);

  await page.goto(`${WEB_BASE_URL}/login?redirect=%2Fhome`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder(/邮箱|email/i).fill(account.email);
  await page.getByPlaceholder(/密码|password/i).fill(account.password);
  await page.getByRole("button", { name: /登录|sign in|log in/i }).click();

  await expect(page).toHaveURL(/\/home(?:$|[?#])/, { timeout: 15_000 });

  const sessionPayload = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    return response.json();
  });
  expect(sessionPayload?.data?.authenticated).toBe(true);

  const cookies = await context.cookies();
  expect(cookies.some((item) => item.name === "app_session_v2_id" && item.secure === false)).toBe(true);
  expect(cookies.some((item) => item.name === "app_session_v2_state" && item.value === "authenticated")).toBe(
    true,
  );

  await context.close();
});
