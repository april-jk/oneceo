import { expect, request as playwrightRequest, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bootstrapSharedAuthenticatedUser } from "./playwright-auth";
import { composerTextarea } from "./playwright-locators";

const WEB_URL = "http://oneceo.ai:3000";
const API_URL = "http://oneceo.ai:3000";
const SESSION_URL_TIMEOUT_MS = 20_000;

type SkillSettingsPayload = {
  data?: {
    platformCatalog?: Array<{
      skillId: string;
      name: string;
      enabled?: boolean;
    }>;
    availableSkills?: Array<{
      skillId: string;
      revisionId: string;
      name: string;
    }>;
  };
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

async function ensureManagedMode(page: Page) {
  await page.goto(WEB_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("altus_mode", "managed");
    localStorage.removeItem("task_creation_session_id");
  });
  await page.goto(WEB_URL, { waitUntil: "domcontentloaded" });
  await expect(composerTextarea(page)).toBeVisible();
}

async function ensureAtLeastOneSkill(context: BrowserContext) {
  const api = await createApiContextFromBrowser(context);
  try {
    const settingsResponse = await api.get("/api/task-creation/settings/skills");
    expect(settingsResponse.ok()).toBe(true);
    const settings = (await settingsResponse.json()) as SkillSettingsPayload;
    const available = settings.data?.availableSkills || [];
    if (available.length > 0) {
      return available[0]!.name;
    }
    const firstPlatformSkill = settings.data?.platformCatalog?.[0];
    expect(firstPlatformSkill?.skillId).toBeTruthy();
    const enableResponse = await api.post(
      `/api/task-creation/settings/skills/platform/${encodeURIComponent(firstPlatformSkill!.skillId)}/enable`,
      { data: {} },
    );
    expect(enableResponse.ok()).toBe(true);
    const nextSettingsResponse = await api.get("/api/task-creation/settings/skills");
    expect(nextSettingsResponse.ok()).toBe(true);
    const nextSettings = (await nextSettingsResponse.json()) as SkillSettingsPayload;
    const nextAvailable = nextSettings.data?.availableSkills || [];
    expect(nextAvailable.length).toBeGreaterThan(0);
    return nextAvailable[0]!.name;
  } finally {
    await api.dispose();
  }
}

async function openFreshComposer(page: Page) {
  await page.goto(WEB_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("altus_mode", "managed");
    localStorage.removeItem("task_creation_session_id");
  });
  await page.goto(WEB_URL, { waitUntil: "domcontentloaded" });
  await expect(composerTextarea(page)).toBeVisible();
}

async function attachSkill(page: Page, skillName: string) {
  await page.getByTestId("attachment-picker-trigger").click();
  const menu = page.getByTestId("attachment-picker-menu");
  await expect(menu).toBeVisible();
  await menu.getByText("使用技能").hover();
  await page.getByText(skillName, { exact: false }).click();
}

async function attachLocalFile(page: Page, filePath: string, fileName: string) {
  await page.locator('input[type="file"]').setInputFiles(filePath);
  await expect(page.getByText(fileName, { exact: false }).first()).toBeVisible();
}

async function sendMessage(page: Page, text: string) {
  const textbox = composerTextarea(page);
  await textbox.fill(text);
  await textbox.press("Enter");
  await expect(page).toHaveURL(/\/session\//, { timeout: SESSION_URL_TIMEOUT_MS });
}

function userBubble(page: Page, text: string) {
  return page.locator('[data-message-key]').filter({ hasText: text }).last();
}

test("issue #26 message attachment reference visuals", async ({ browser }, testInfo) => {
  const token = uniqueToken();
  const context = await bootstrapSharedAuthenticatedUser(browser, WEB_URL);
  const page = await context.newPage();
  const screenshotDir = testInfo.outputPath("issue26-reference-visuals");
  mkdirSync(screenshotDir, { recursive: true });
  const attachmentFileName = `issue26-reference-${token}.txt`;
  const attachmentFilePath = join(screenshotDir, attachmentFileName);
  writeFileSync(attachmentFilePath, `issue26 reference attachment token: ${token}\n`, "utf8");

  try {
    const skillName = await ensureAtLeastOneSkill(context);
    await ensureManagedMode(page);

    const skillOnlyText = `issue26 skill only ${token}`;
    await openFreshComposer(page);
    await attachSkill(page, skillName);
    await sendMessage(page, skillOnlyText);
    const skillBubble = userBubble(page, skillOnlyText);
    await expect(skillBubble).toContainText("已附加");
    await expect(skillBubble).toContainText("Skills");
    await expect(skillBubble).toContainText(skillName);
    await expect(skillBubble).not.toContainText("附件");
    await skillBubble.screenshot({ path: join(screenshotDir, "01-skill-only.png") });

    const attachmentOnlyText = `issue26 attachment only ${token}`;
    await openFreshComposer(page);
    await attachLocalFile(page, attachmentFilePath, attachmentFileName);
    await sendMessage(page, attachmentOnlyText);
    const attachmentBubble = userBubble(page, attachmentOnlyText);
    await expect(attachmentBubble).toContainText("已附加");
    await expect(attachmentBubble).toContainText("附件");
    await expect(attachmentBubble).toContainText(attachmentFileName);
    await expect(attachmentBubble).not.toContainText("Skills");
    await attachmentBubble.screenshot({ path: join(screenshotDir, "02-attachment-only.png") });

    const bothText = `issue26 skills and attachment ${token}`;
    await openFreshComposer(page);
    await attachSkill(page, skillName);
    await attachLocalFile(page, attachmentFilePath, attachmentFileName);
    await sendMessage(page, bothText);
    const bothBubble = userBubble(page, bothText);
    await expect(bothBubble).toContainText("已附加");
    await expect(bothBubble).toContainText("Skills 与附件");
    await expect(bothBubble).toContainText("Skills");
    await expect(bothBubble).toContainText("附件");
    await expect(bothBubble).toContainText(skillName);
    await expect(bothBubble).toContainText(attachmentFileName);
    await bothBubble.screenshot({ path: join(screenshotDir, "03-skills-and-attachment.png") });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(bothBubble).toContainText("Skills 与附件");
    await expect(bothBubble).toContainText(skillName);
    await expect(bothBubble).toContainText(attachmentFileName);
    await bothBubble.screenshot({ path: join(screenshotDir, "04-after-reload.png") });
  } finally {
    await context.close();
  }
});
