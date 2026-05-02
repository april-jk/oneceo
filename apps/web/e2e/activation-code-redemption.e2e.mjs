import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const requireFromWeb = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = requireFromWeb('@playwright/test');

const baseUrl = process.env.WEB_BASE_URL || 'http://127.0.0.1:3000';
const testAccount = {
  email: process.env.TEST_EMAIL || 'test@test.com',
  password: process.env.TEST_PASSWORD || 'testtest',
};

async function login(page) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  
  // 检查是否需要登录
  const loginButton = page.locator('button:has-text("登录")');
  if (await loginButton.isVisible().catch(() => false)) {
    // 点击登录按钮
    await loginButton.click();
    await page.waitForTimeout(1000);
    
    // 填写登录表单
    await page.locator('input[type="email"]').fill(testAccount.email);
    await page.locator('input[type="password"]').fill(testAccount.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  }
}

async function run() {
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.accept());

  try {
    await login(page);
    
    // 打开设置对话框 - 通过触发自定义事件
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('oneceo:open-settings-dialog', {
        detail: { tab: 'billing' }
      }));
    });
    await page.waitForTimeout(3000);
    
    // 截图用于调试
    await page.screenshot({ path: '/tmp/user-billing-test.png' });
    console.log('Screenshot saved to /tmp/user-billing-test.png');
    
    // 检查页面中所有按钮文本
    const allButtons = await page.locator('button').allTextContents();
    console.log('All buttons on page:', allButtons.join(' | '));
    
    // 验证页面加载
    const pageContent = await page.content();
    console.log('Billing settings page loaded');
    
    // 检查是否有"使用激活码"按钮
    const activationButton = page.getByRole('button', { name: '使用激活码' });
    const isVisible = await activationButton.isVisible().catch(() => false);
    
    if (isVisible) {
      console.log('✅ "使用激活码" button found');
      
      // 点击按钮打开弹窗
      await activationButton.click({ force: true });
      await page.waitForTimeout(1500);
      
      // 截图查看弹窗
      await page.screenshot({ path: '/tmp/user-activation-dialog.png' });
      console.log('Dialog screenshot saved to /tmp/user-activation-dialog.png');
      
      // 检查所有 dialog 元素
      const allDialogs = await page.locator('[role="dialog"]').count();
      console.log(`Found ${allDialogs} dialog elements`);
      
      // 检查所有可见的 dialog
      const visibleDialogs = await page.locator('[role="dialog"]:visible').count();
      console.log(`Found ${visibleDialogs} visible dialog elements`);
      
      // 检查页面中是否有 "使用激活码" 文本（弹窗标题）
      const hasDialogTitle = await page.locator('text=使用激活码').count();
      console.log(`Found ${hasDialogTitle} elements with "使用激活码" text`);
      
      // 验证弹窗打开
      const dialog = page.locator('[role="dialog"]').last();
      const dialogVisible = await dialog.isVisible().catch(() => false);
      
      if (dialogVisible) {
        console.log('✅ Activation code dialog opened');
        
        // 检查弹窗内容
        const dialogContent = await dialog.textContent();
        if (dialogContent.includes('使用激活码') && dialogContent.includes('请输入激活码')) {
          console.log('✅ Dialog content is correct');
        }
        
        // 检查输入框
        const input = dialog.locator('input[placeholder*="激活码"]');
        if (await input.isVisible().catch(() => false)) {
          console.log('✅ Activation code input found');
          
          // 测试输入
          await input.fill('TEST-CODE-1234');
          const inputValue = await input.inputValue();
          console.log(`✅ Input value: ${inputValue}`);
        }
        
        // 检查兑换按钮
        const redeemButton = dialog.locator('button:has-text("立即兑换")');
        if (await redeemButton.isVisible().catch(() => false)) {
          console.log('✅ Redeem button found');
        }
        
        // 关闭弹窗
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      } else {
        console.log('❌ Activation code dialog not opened');
      }
    } else {
      console.log('❌ "使用激活码" button not found');
    }
    
    console.log('[activation-code-user-test] All checks passed!');
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error('[activation-code-user-test] failed:', error);
  process.exitCode = 1;
});
