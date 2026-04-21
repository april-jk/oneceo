import { expect, request as playwrightRequest, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

import { bootstrapSharedAuthenticatedUser } from "./playwright-auth";

const WEB_URL = process.env.PLAYWRIGHT_WEB_URL || "http://127.0.0.1:3001";
const API_URL = process.env.PLAYWRIGHT_API_URL || WEB_URL;

type ProjectSummary = {
  id: string;
  name: string;
};

type SessionSummary = {
  id: string;
  title?: string;
};

test.describe.configure({ timeout: 180_000 });

function uniqueToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createApiContextFromBrowser(context: BrowserContext) {
  const storageState = await context.storageState();
  return playwrightRequest.newContext({
    baseURL: API_URL,
    storageState,
  });
}

async function createProject(
  api: APIRequestContext,
  input: { name: string; description?: string },
) {
  const response = await api.post("/api/task-creation/projects", {
    data: {
      name: input.name,
      description: input.description || "",
      altusProjectMemory: null,
    },
  });
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as { data?: ProjectSummary };
  expect(payload.data?.id).toBeTruthy();
  return payload.data as ProjectSummary;
}

async function createDraftSession(api: APIRequestContext, title: string) {
  const response = await api.post("/api/task-creation/sessions/draft", {
    data: { title },
  });
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as { data?: SessionSummary };
  expect(payload.data?.id).toBeTruthy();
  return payload.data as SessionSummary;
}

async function assignSessionToProject(
  api: APIRequestContext,
  input: { sessionId: string; projectId: string; projectName: string },
) {
  const response = await api.post(`/api/task-creation/sessions/${encodeURIComponent(input.sessionId)}/project`, {
    data: {
      projectId: input.projectId,
      projectName: input.projectName,
    },
  });
  expect(response.ok()).toBe(true);
}

async function deleteSession(api: APIRequestContext, sessionId: string) {
  await api.delete(`/api/task-creation/sessions/${encodeURIComponent(sessionId)}`);
}

async function deleteProject(api: APIRequestContext, projectId: string) {
  await api.delete(`/api/task-creation/projects/${encodeURIComponent(projectId)}`);
}

async function openAllTasksDialog(page: Page) {
  await page.getByRole("button", { name: /所有任务|All tasks/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function closeAllTasksDialog(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
}

async function extractRelativeSessionOrder(page: Page, titles: string[]) {
  const dialog = page.getByRole("dialog");
  const rows = dialog.locator("button");
  const texts = await rows.evaluateAll((nodes) =>
    nodes
      .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean),
  );
  return texts
    .map((text) => titles.find((title) => text.includes(title)) || null)
    .filter((value): value is string => Boolean(value));
}

test("sidebar keeps session order stable when clicking project or session", async ({ browser }) => {
  const token = uniqueToken();
  const projectName = `Sidebar Order Project ${token}`;
  const olderSessionTitle = `Sidebar Order Older ${token}`;
  const newerSessionTitle = `Sidebar Order Newer ${token}`;

  const context = await bootstrapSharedAuthenticatedUser(browser, WEB_URL);
  const page = await context.newPage();
  const api = await createApiContextFromBrowser(context);

  let projectId = "";
  let olderSessionId = "";
  let newerSessionId = "";

  try {
    const project = await createProject(api, {
      name: projectName,
      description: `Playwright sidebar ordering verification ${token}`,
    });
    projectId = project.id;

    const olderSession = await createDraftSession(api, olderSessionTitle);
    olderSessionId = olderSession.id;
    await page.waitForTimeout(1100);
    const newerSession = await createDraftSession(api, newerSessionTitle);
    newerSessionId = newerSession.id;

    await assignSessionToProject(api, {
      sessionId: olderSessionId,
      projectId,
      projectName,
    });

    await page.goto(`${WEB_URL}/home`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("aside")).toContainText(projectName);
    await expect(page.locator("aside")).toContainText(olderSessionTitle);
    await expect(page.locator("aside")).toContainText(newerSessionTitle);

    await openAllTasksDialog(page);
    const baselineOrder = await extractRelativeSessionOrder(page, [
      newerSessionTitle,
      olderSessionTitle,
    ]);
    expect(baselineOrder).toHaveLength(2);
    expect(new Set(baselineOrder)).toEqual(new Set([newerSessionTitle, olderSessionTitle]));
    await closeAllTasksDialog(page);

    await page.locator("aside").getByRole("button", { name: projectName }).click();
    await expect(page).toHaveURL(new RegExp(`/project/${projectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

    await openAllTasksDialog(page);
    const orderAfterProjectClick = await extractRelativeSessionOrder(page, [
      newerSessionTitle,
      olderSessionTitle,
    ]);
    expect(orderAfterProjectClick).toEqual(baselineOrder);
    await closeAllTasksDialog(page);

    await page.locator("aside").getByRole("button", { name: newerSessionTitle }).click();
    await expect(page).toHaveURL(new RegExp(`/session/${newerSessionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

    await openAllTasksDialog(page);
    const orderAfterSessionClick = await extractRelativeSessionOrder(page, [
      newerSessionTitle,
      olderSessionTitle,
    ]);
    expect(orderAfterSessionClick).toEqual(baselineOrder);
    await closeAllTasksDialog(page);
  } finally {
    if (newerSessionId) {
      await deleteSession(api, newerSessionId).catch(() => undefined);
    }
    if (olderSessionId) {
      await deleteSession(api, olderSessionId).catch(() => undefined);
    }
    if (projectId) {
      await deleteProject(api, projectId).catch(() => undefined);
    }
    await api.dispose();
    await context.close();
  }
});
