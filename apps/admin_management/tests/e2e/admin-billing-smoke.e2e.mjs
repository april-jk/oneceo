import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const requireFromWeb = createRequire(new URL('../../../web/package.json', import.meta.url));
const { chromium } = requireFromWeb('@playwright/test');

const baseUrl = process.env.ADMIN_MANAGEMENT_BASE_URL || 'http://127.0.0.1:9310';
const loginName = process.env.ONECEO_ADMIN_E2E_LOGIN || process.env.ONECEO_ADMIN_BOOTSTRAP_LOGIN || 'admin';
const password = process.env.ONECEO_ADMIN_E2E_PASSWORD || process.env.ONECEO_ADMIN_BOOTSTRAP_PASSWORD || 'admin123';
const allowMutations = process.env.ONECEO_E2E_ALLOW_BILLING_MUTATIONS === 'true';

async function loginIfNeeded(page) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  const loginNameInput = page.getByRole('textbox', { name: '登录名' });
  if (await loginNameInput.isVisible().catch(() => false)) {
    await loginNameInput.fill(loginName);
    await page.getByRole('textbox', { name: '密码' }).fill(password);
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /计费管理/ }).waitFor({ timeout: 8000 });
  }
}

async function assertVisibleText(page, text) {
  await assert.doesNotReject(() => page.getByText(text, { exact: false }).first().waitFor({ timeout: 8000 }));
}

async function assertExactVisibleText(page, text) {
  await assert.doesNotReject(() => page.getByText(text, { exact: true }).first().waitFor({ timeout: 8000 }));
}

async function run() {
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.accept());

  try {
    await loginIfNeeded(page);
    await page.goto(`${baseUrl}/?section=billing`, { waitUntil: 'networkidle' });

    await assertVisibleText(page, '计费管理');
    await assertVisibleText(page, '用户积分');
    await assertVisibleText(page, '定价配置');
    await assertVisibleText(page, '平台统计');
    await assertVisibleText(page, '使用明细');

    await page.getByRole('button', { name: '定价配置' }).click();
    await assertVisibleText(page, '积分兑换');
    await assertVisibleText(page, '1 credit = ¥0.01');
    await assertVisibleText(page, '100 credits = ¥1.00');
    await assertVisibleText(page, '平台 margin');
    await assertExactVisibleText(page, '25%');
    await assertVisibleText(page, 'OpenAI 缓存');
    await assertVisibleText(page, '命中 50%');
    await assertVisibleText(page, 'Anthropic 缓存');
    await assertVisibleText(page, '命中 10%');
    await assertVisibleText(page, '创建 125%');
    assert.equal(await page.getByText('未加载').count(), 0, 'billing meta should be loaded');
    await assertVisibleText(page, 'qwen3-max-2026-01-23');

    if (allowMutations) {
      const model = `billing-smoke-${Date.now()}`;
      try {
        await page.getByRole('button', { name: '+ 新建定价' }).click();
        await page.getByRole('textbox', { name: '模型名称' }).fill(model);
        await page.getByRole('spinbutton', { name: /输入单价/ }).fill('2');
        await page.getByRole('spinbutton', { name: /输出单价/ }).fill('3');
        await page.getByRole('button', { name: '创建定价' }).click();
        await assertVisibleText(page, '定价已创建');
        await assertVisibleText(page, model);
      } finally {
        const activeRow = page.locator('tr').filter({ hasText: model }).filter({ hasText: '生效中' }).first();
        if (await activeRow.isVisible().catch(() => false)) {
          await activeRow.getByRole('button', { name: '停用' }).click();
          await assertVisibleText(page, '定价已停用');
        }
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error('[admin-billing-smoke] failed:', error);
  process.exitCode = 1;
});
