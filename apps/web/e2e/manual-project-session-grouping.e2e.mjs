import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..", "..");
const WEB_BASE_URL = process.env.ONECEO_WEB_BASE_URL || "http://oneceo.ai:3000";
const API_BASE_URL = process.env.ONECEO_API_BASE_URL || WEB_BASE_URL;
const TEST_ACCOUNT_FILE = path.resolve(__dirname, "playwright-test-account.json");
const REPORT_STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const REPORT_DIR = path.resolve(
  ROOT_DIR,
  "apps/web/test-results/manual-project-session-grouping",
  REPORT_STAMP,
);

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadAccount() {
  const raw = await readFile(TEST_ACCOUNT_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return {
    email: asText(parsed.email),
    password: asText(parsed.password),
    displayName: asText(parsed.displayName) || "Playwright Test User",
  };
}

async function loginOrRegister(account) {
  const loginPayload = JSON.stringify({
    email: account.email,
    password: account.password,
  });

  let response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: loginPayload,
  });

  if (!response.ok) {
    const registerResponse = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: account.email,
        password: account.password,
        displayName: account.displayName,
      }),
    });

    if (!registerResponse.ok && registerResponse.status !== 409) {
      const text = await registerResponse.text();
      throw new Error(`register failed: ${registerResponse.status} ${text}`);
    }

    response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: loginPayload,
    });
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`login failed: ${response.status} ${text}`);
  }

  const rawSetCookie = response.headers.get("set-cookie") || "";
  const matched = rawSetCookie.match(/(?:^|,\s*)app_session_id=([^;,\s]+)/);
  if (!matched?.[1]) {
    throw new Error("missing app_session_id cookie in login response");
  }
  return matched[1];
}

async function apiRequest(pathname, { method = "GET", sessionToken, body } = {}) {
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(sessionToken ? { cookie: `app_session_id=${sessionToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed: ${response.status} ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

async function waitForText(page, text, scope = page, timeout = 30_000) {
  await scope.getByText(text, { exact: false }).first().waitFor({
    state: "visible",
    timeout,
  });
}

async function assertSidebarLayoutStable(sidebar) {
  const metrics = await sidebar.evaluate((aside) => {
    const viewport = aside.querySelector('[data-slot="scroll-area-viewport"]');
    const wrapper = viewport?.firstElementChild;
    const projectHeader = aside.querySelector(
      "div.mb-2.flex.min-w-0.items-center.justify-between.gap-2.px-3",
    );
    const plusButton = projectHeader?.querySelector("button");
    const asideRect = aside.getBoundingClientRect();
    const plusRect = plusButton?.getBoundingClientRect();

    return {
      asideWidth: asideRect.width,
      asideLeft: asideRect.left,
      asideRight: asideRect.right,
      asideScrollWidth: aside.scrollWidth,
      viewportWidth: viewport?.getBoundingClientRect().width ?? 0,
      viewportScrollWidth: viewport?.scrollWidth ?? 0,
      wrapperWidth: wrapper?.getBoundingClientRect().width ?? 0,
      wrapperScrollWidth: wrapper?.scrollWidth ?? 0,
      projectHeaderWidth: projectHeader?.getBoundingClientRect().width ?? 0,
      projectHeaderScrollWidth: projectHeader?.scrollWidth ?? 0,
      plusLeft: plusRect?.left ?? 0,
      plusRight: plusRect?.right ?? 0,
    };
  });

  const overflowLimit = metrics.asideWidth + 1;
  const hasOverflow =
    metrics.asideScrollWidth > overflowLimit ||
    metrics.viewportScrollWidth > overflowLimit ||
    metrics.wrapperScrollWidth > overflowLimit ||
    metrics.projectHeaderScrollWidth > metrics.projectHeaderWidth + 1;
  const plusOutOfView =
    metrics.plusLeft < metrics.asideLeft - 1 ||
    metrics.plusRight > metrics.asideRight + 1;

  if (hasOverflow || plusOutOfView) {
    throw new Error(`sidebar layout overflow detected: ${JSON.stringify(metrics)}`);
  }
}

async function assertProjectContentScrollReady(sidebar) {
  const metrics = await sidebar.evaluate((aside) => {
    const root = aside.querySelector('[data-sidebar-project-scroll="true"]');
    const viewport = root?.querySelector('[data-slot="scroll-area-viewport"]');
    if (!viewport) {
      return { missing: true };
    }

    viewport.scrollTop = 0;
    const before = viewport.scrollTop;
    viewport.scrollTop = viewport.scrollHeight;
    const after = viewport.scrollTop;

    return {
      missing: false,
      clientHeight: viewport.clientHeight,
      scrollHeight: viewport.scrollHeight,
      before,
      after,
    };
  });

  if (metrics.missing) {
    throw new Error("project scroll viewport missing");
  }

  if (metrics.scrollHeight < metrics.clientHeight) {
    return;
  }

  if (metrics.after <= metrics.before) {
    throw new Error(`project content did not scroll: ${JSON.stringify(metrics)}`);
  }
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });

  const account = await loadAccount();
  const sessionToken = await loginOrRegister(account);
  const suffix = uniqueSuffix();
  const sessionTitle = `PW超长普通项目归属会话标题用于验证侧边栏展开布局稳定性-${suffix}`;
  const projectName = `PW超长普通项目名称用于验证侧边栏展开不会撑坏布局-${suffix}`;
  const projectDescription = `Playwright 普通项目分组链路验证 ${suffix}`;

  const createSessionPayload = await apiRequest("/api/task-creation/sessions", {
    method: "POST",
    sessionToken,
    body: {
      title: sessionTitle,
    },
  });
  const sessionId = createSessionPayload?.data?.id;
  if (!sessionId) {
    throw new Error("session create returned empty id");
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  const result = {
    webBaseUrl: WEB_BASE_URL,
    apiBaseUrl: API_BASE_URL,
    sessionId,
    sessionTitle,
    projectName,
    reportDir: REPORT_DIR,
  };

  try {
    await page.goto(`${WEB_BASE_URL}/login?redirect=${encodeURIComponent("/home")}`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await page.locator("#login-email").fill(account.email);
    await page.locator("#login-password").fill(account.password);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/home", { timeout: 120_000 });
    await page.waitForLoadState("networkidle", { timeout: 120_000 });

    const sidebar = page.locator("aside").first();
    await waitForText(page, "项目", sidebar);
    await waitForText(page, "所有任务", sidebar);
    await sidebar.screenshot({
      path: path.join(REPORT_DIR, "01-sidebar-initial.png"),
    });

    await sidebar
      .locator("div.mb-2.flex.items-center.justify-between")
      .first()
      .getByRole("button")
      .click();

    const createDialog = page.getByRole("dialog").filter({ hasText: "新建项目" }).first();
    await createDialog.getByLabel("项目名称").fill(projectName);
    await createDialog.getByLabel("项目简介").fill(projectDescription);
    await createDialog.screenshot({
      path: path.join(REPORT_DIR, "02-create-project-dialog.png"),
    });
    await createDialog.getByRole("button", { name: "新建项目" }).last().click();

    await waitForText(page, projectName, sidebar, 30_000);
    await assertSidebarLayoutStable(sidebar);
    await assertProjectContentScrollReady(sidebar);
    await sidebar.screenshot({
      path: path.join(REPORT_DIR, "03-sidebar-project-created.png"),
    });

    await sidebar.getByRole("button", { name: "所有任务" }).click();
    const allTasksDialog = page.getByRole("dialog").filter({ hasText: "所有任务" }).first();
    await waitForText(page, sessionTitle, allTasksDialog, 30_000);
    await allTasksDialog.getByText(sessionTitle, { exact: false }).first().click({
      button: "right",
    });

    await page.getByRole("menuitem", { name: "移动到项目", exact: true }).hover();
    const moveProjectSubmenu = page
      .locator('[data-slot="context-menu-sub-content"]')
      .filter({ hasText: projectName })
      .last();
    await moveProjectSubmenu.getByRole("menuitem", { name: projectName, exact: true }).click();

    await allTasksDialog.getByRole("button", { name: "Close" }).click();
    await allTasksDialog.waitFor({ state: "hidden", timeout: 10_000 });

    const projectButton = sidebar.locator("button").filter({ hasText: projectName }).first();
    await sidebar.evaluate((aside, targetProjectName) => {
      const buttons = Array.from(aside.querySelectorAll("button"));
      const targetButton = buttons.find((button) =>
        button.textContent?.includes(targetProjectName),
      );
      if (!targetButton) {
        throw new Error(`project button not found: ${targetProjectName}`);
      }
      const projectRow = targetButton.closest("div.flex.items-center.gap-1");
      const toggleButton = projectRow?.querySelector("button");
      if (!(toggleButton instanceof HTMLElement)) {
        throw new Error(`project toggle not found: ${targetProjectName}`);
      }
      toggleButton.click();
    }, projectName);
    await sidebar
      .locator(`a[href="/session/${sessionId}?view=history"]`)
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await assertSidebarLayoutStable(sidebar);
    await assertProjectContentScrollReady(sidebar);
    await sidebar.screenshot({
      path: path.join(REPORT_DIR, "04-sidebar-project-expanded.png"),
    });

    await projectButton.click();
    await page.waitForURL(/\/project\//, { timeout: 30_000 });
    await waitForText(page, "项目会话");
    await waitForText(page, sessionTitle);
    const managerCreateButton = page.getByRole("button", { name: "创建经理" });
    if (await managerCreateButton.count()) {
      throw new Error("standard project page incorrectly rendered self-organized manager UI");
    }
    await page.screenshot({
      path: path.join(REPORT_DIR, "05-standard-project-detail.png"),
      fullPage: true,
    });

    await sidebar.getByRole("button", { name: "oneceo.ai", exact: true }).click();
    await page.waitForURL(/\/project\/1$/, { timeout: 30_000 });
    await page.getByRole("button", { name: "创建经理" }).waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.screenshot({
      path: path.join(REPORT_DIR, "06-self-organized-project-detail.png"),
      fullPage: true,
    });

    await writeFile(
      path.join(REPORT_DIR, "result.json"),
      JSON.stringify(
        {
          ...result,
          success: true,
          checked: [
            "create standard project from sidebar",
            "assign session to standard project from context menu",
            "keep project content in a dedicated vertical scroll region",
            "expand standard project in sidebar without horizontal overflow",
            "open standard project detail page",
            "verify standard project page does not render manager tree",
            "open self-organized preview project",
            "verify self-organized project still renders manager UI",
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    console.log(
      JSON.stringify({
        ...result,
        success: true,
      }),
    );
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch(async (error) => {
  try {
    await mkdir(REPORT_DIR, { recursive: true });
    await writeFile(
      path.join(REPORT_DIR, "result.json"),
      JSON.stringify(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    // ignore secondary report failures
  }

  console.error("[manual-project-session-grouping-e2e] failure", error);
  process.exit(1);
});
