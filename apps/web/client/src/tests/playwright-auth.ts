import { execFile as execFileCb } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  type Browser,
  type BrowserContext,
} from "@playwright/test";

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
  const raw = await readFile(TEST_ACCOUNT_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return {
    email: asText(process.env.ONECEO_E2E_USER_EMAIL) || asText(parsed.email),
    password: asText(process.env.ONECEO_E2E_USER_PASSWORD) || asText(parsed.password),
    displayName:
      asText(process.env.ONECEO_E2E_USER_DISPLAY_NAME) ||
      asText(parsed.displayName) ||
      "Playwright Test User",
  };
}

let ensureUserPromise: Promise<void> | null = null;

async function ensureSharedPlaywrightUser() {
  if (!ensureUserPromise) {
    ensureUserPromise = (async () => {
      const account = await loadTestAccount();
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
    })();
  }
  await ensureUserPromise;
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
      throw new Error(`browser login failed: ${loginResult.status} ${JSON.stringify(loginResult.payload)}`);
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
