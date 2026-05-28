import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const requireFromWeb = createRequire(new URL('../../../web/package.json', import.meta.url));
const { chromium } = requireFromWeb('@playwright/test');

const baseUrl = process.env.ADMIN_MANAGEMENT_BASE_URL || 'http://127.0.0.1:9310';
const loginName = process.env.ONECEO_ADMIN_E2E_LOGIN || process.env.ONECEO_ADMIN_BOOTSTRAP_LOGIN || 'admin66';
const password = process.env.ONECEO_ADMIN_E2E_PASSWORD || process.env.ONECEO_ADMIN_BOOTSTRAP_PASSWORD || 'cdiSSj@qq.2123comccc';

async function loginIfNeeded(page) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  // 检查是否需要登录
  const loginButton = page.getByRole('button', { name: '登录' });
  if (await loginButton.isVisible().catch(() => false)) {
    console.log('Login required, filling credentials...');
    await page.getByRole('textbox', { name: '登录名' }).fill(loginName);
    await page.getByRole('textbox', { name: '密码' }).fill(password);
    await loginButton.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    console.log('Login completed');
  } else {
    console.log('Already logged in');
  }
}

async function assertVisibleText(page, text) {
  await assert.doesNotReject(() => page.getByText(text, { exact: false }).first().waitFor({ timeout: 8000 }));
}

async function run() {
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.accept());

  try {
    await loginIfNeeded(page);
    // 直接导航到计费管理页面
    await page.goto(`${baseUrl}/?section=billing`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // 验证计费管理页面加载 - 查找页面标题
    const pageContent = await page.content();
    console.log('Page loaded, checking for billing section...');

    // 点击激活码管理标签
    const activationTab = page.locator('button:has-text("激活码管理")');
    if (await activationTab.isVisible().catch(() => false)) {
      await activationTab.click();
      await page.waitForTimeout(2000);
    } else {
      console.log('Activation code tab not found, trying to find it in the page...');
      // 截图用于调试
      await page.screenshot({ path: '/tmp/admin-billing-debug.png' });
      console.log('Debug screenshot saved to /tmp/admin-billing-debug.png');
      
      // 检查所有按钮
      const allButtons = await page.locator('button').allTextContents();
      console.log('All buttons:', allButtons.join(' | '));
    }

    // 验证激活码管理页面元素
    await assertVisibleText(page, '激活码管理');
    await assertVisibleText(page, '新建激活码');
    await assertVisibleText(page, '刷新');

    // 验证统计卡片
    await assertVisibleText(page, '总数');
    await assertVisibleText(page, '未使用');
    await assertVisibleText(page, '已使用');
    await assertVisibleText(page, '已禁用');
    await assertVisibleText(page, '已过期');
    await assertVisibleText(page, '总积分');

    // 验证筛选栏 - 检查select元素
    const filterSelect = page.locator('select.filter-select');
    if (await filterSelect.isVisible().catch(() => false)) {
      console.log('Filter select found');
    }

    // 创建激活码
    await page.locator('button:has-text("新建激活码")').click();
    await page.waitForTimeout(500);

    // 填写表单
    const creditsInput = page.locator('input[placeholder="输入积分数量"]');
    await creditsInput.fill('100');

    const quantityInput = page.locator('input[placeholder="1-100"]');
    await quantityInput.fill('1');

    // 点击创建
    await page.getByRole('button', { name: '创建' }).click();
    await page.waitForTimeout(1000);

    // 验证创建成功
    await assertVisibleText(page, '创建成功');

    // 验证激活码出现在列表中
    await assertVisibleText(page, '100');

    // 点击详情按钮
    const detailButtons = page.locator('button:has-text("详情")');
    if (await detailButtons.count() > 0) {
      await detailButtons.first().click();
      await page.waitForTimeout(1000);

      // 验证详情弹窗
      await assertVisibleText(page, '激活码详情');
      await assertVisibleText(page, '积分数量');

      // 关闭详情 - 点击弹窗中的关闭按钮
      await page.locator('[role="dialog"] button:has-text("关闭")').click();
    }

    console.log('[admin-activation-code-smoke] All checks passed!');
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error('[admin-activation-code-smoke] failed:', error);
  process.exitCode = 1;
});
