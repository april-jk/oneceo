import { execFile as execFileCb } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { type Browser, type BrowserContext, type Page } from "@playwright/test";

const execFile = promisify(execFileCb);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, "..", "..", "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..");
const TEST_ACCOUNT_FILE = path.resolve(WEB_ROOT, "e2e", "playwright-test-account.json");

type TestAccount = {
  email: string;
  password: string;
  displayName: string;
};

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function loadTestAccount(): Promise<TestAccount> {
  let parsed: Partial<TestAccount> = {};
  try {
    const raw = await readFile(TEST_ACCOUNT_FILE, "utf8");
    parsed = JSON.parse(raw) as Partial<TestAccount>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const account = {
    email: asText(process.env.ONECEO_E2E_USER_EMAIL) || asText(parsed.email),
    password: asText(process.env.ONECEO_E2E_USER_PASSWORD) || asText(parsed.password),
    displayName:
      asText(process.env.ONECEO_E2E_USER_DISPLAY_NAME) ||
      asText(parsed.displayName) ||
      "Playwright Test User",
  };
  if (!account.email || !account.password) {
    throw new Error(
      "Playwright test account requires ONECEO_E2E_USER_EMAIL and ONECEO_E2E_USER_PASSWORD or a local ignored e2e/playwright-test-account.json override copied from playwright-test-account.example.json",
    );
  }
  return account;
}

export const loadPlaywrightTestAccount = loadTestAccount;

let ensureUserPromise: Promise<void> | null = null;

async function ensureSharedPlaywrightUser() {
  if (ensureUserPromise) {
    return ensureUserPromise;
  }
  ensureUserPromise = (async () => {
    const account = await loadTestAccount();
    try {
      await execFile(
        "pnpm",
        ["--filter", "api", "exec", "tsx", "scripts/ensure-playwright-test-user.ts"],
        {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            ONECEO_E2E_USER_EMAIL: account.email,
            ONECEO_E2E_USER_PASSWORD: account.password,
            ONECEO_E2E_USER_DISPLAY_NAME: account.displayName,
          },
          maxBuffer: 1024 * 1024,
        },
      );
    } catch (error) {
      console.warn("[playwright-auth] ensure user script failed, continue with browser bootstrap", error);
    }
  })();
  return ensureUserPromise;
}

async function bootstrapWithRegisterFallback(
  page: Page,
  account: TestAccount,
) {
  const registerResult = await page.evaluate(
    async ({ email, password, displayName }) => {
      const sendCodeResponse = await fetch("/api/auth/register/send-code", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });
      const sendCodePayload = await sendCodeResponse.json().catch(() => null);
      if (!sendCodeResponse.ok) {
        return {
          ok: false,
          step: "send-code",
          status: sendCodeResponse.status,
          payload: sendCodePayload,
        };
      }

      const registerResponse = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
          displayName,
          verificationCode: "000000",
        }),
      });
      const registerPayload = await registerResponse.json().catch(() => null);
      return {
        ok: registerResponse.ok,
        step: "register",
        status: registerResponse.status,
        payload: registerPayload,
      };
    },
    {
      email: account.email,
      password: account.password,
      displayName: account.displayName,
    },
  );
  if (!registerResult.ok) {
    throw new Error(`register fallback failed: ${registerResult.status} ${JSON.stringify(registerResult.payload)}`);
  }

  const retryLogin = await page.evaluate(
    async ({ email, password }) => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json().catch(() => null);
      return {
        ok: response.ok,
        status: response.status,
        payload,
      };
    },
    {
      email: account.email,
      password: account.password,
    },
  );
  if (!retryLogin.ok) {
    throw new Error(`browser login failed after register bootstrap: ${retryLogin.status} ${JSON.stringify(retryLogin.payload)}`);
  }
}

export async function bootstrapSharedAuthenticatedUser(
  browser: Browser,
  webBaseUrl: string,
): Promise<BrowserContext> {
  await ensureSharedPlaywrightUser();
  const account = await loadTestAccount();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${webBaseUrl}/login`, { waitUntil: "domcontentloaded" });
    const loginResult = await page.evaluate(
      async ({ email, password }) => {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        });
        const payload = await response.json().catch(() => null);
        return {
          ok: response.ok,
          status: response.status,
          payload,
        };
      },
      {
        email: account.email,
        password: account.password,
      },
    );
    if (!loginResult.ok) {
      await bootstrapWithRegisterFallback(page, account);
    }

    const meResult = await page.evaluate(async () => {
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });
      const payload = await response.json().catch(() => null);
      return {
        ok: response.ok,
        status: response.status,
        payload,
      };
    });
    if (!meResult.ok) {
      throw new Error(`browser auth/me failed: ${meResult.status} ${JSON.stringify(meResult.payload)}`);
    }
    await page.goto(`${webBaseUrl}/home`, { waitUntil: "domcontentloaded" });
    await page.locator('textarea[data-slot="textarea"]').first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
    return context;
  } catch (error) {
    await context.close();
    throw error;
  } finally {
    await page.close().catch(() => {});
  }
}
