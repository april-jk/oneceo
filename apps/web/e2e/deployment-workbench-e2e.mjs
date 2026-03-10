import { chromium } from '@playwright/test';

const WEB_BASE_URL = process.env.ONECEO_WEB_BASE_URL || 'http://127.0.0.1:3000';
const SESSION_ID =
  process.env.ONECEO_E2E_SESSION_ID || '35a80bc5-3292-48c0-a997-5296662fbb13';
const USER_ID =
  process.env.ONECEO_E2E_USER_ID || '9ca8d7ac-aa7a-41ae-a7cd-9dd5e1254111';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1480, height: 960 },
  });
  const page = await context.newPage();

  await page.addInitScript((userId) => {
    window.localStorage.setItem('oneceo_client_user_id', userId);
  }, USER_ID);

  try {
    await page.goto(`${WEB_BASE_URL}/session/${SESSION_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
    await page.waitForLoadState('networkidle', { timeout: 120000 });

    const showPreviewButton = page.getByRole('button', { name: '显示预览' });
    if (await showPreviewButton.count()) {
      await showPreviewButton.click();
    }

    const preview = page.locator('aside').filter({ hasText: '内容预览' }).first();
    await preview.waitFor({ state: 'visible', timeout: 30000 });

    await preview.getByRole('button', { name: '部署' }).first().click();
    await preview.getByRole('button', { name: '数据库' }).click();

    await preview.getByRole('button', { name: /game_scores/ }).waitFor({ state: 'visible', timeout: 120000 });
    await preview.getByRole('button', { name: /game_scores/ }).click();
    await preview.locator('tbody').getByText('Ava').first().waitFor({ state: 'visible', timeout: 120000 });
    await preview.locator('button').filter({ hasText: '设置' }).last().click();
    await preview.getByText('switchback.proxy.rlwy.net', { exact: true }).waitFor({
      state: 'visible',
      timeout: 120000,
    });

    await preview.getByRole('button', { name: '仪表盘' }).click();
    await preview.getByRole('button', { name: '站点数据' }).click({ force: true });
    await preview.getByText('分析').waitFor({ state: 'visible', timeout: 30000 });
    await preview.getByText('没有数据').first().waitFor({ state: 'visible', timeout: 30000 });

    await preview.getByRole('button', { name: '部署数据' }).click({ force: true });
    await preview.getByText('当前线上版本', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
    await preview.getByText('最近版本轨迹', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });

    console.log(
      JSON.stringify({
        sessionId: SESSION_ID,
        databaseTablesVisible: true,
        databaseConnectionVisible: true,
        dashboardDeploymentsVisible: true,
        dashboardSiteVisible: true,
        result: 'success',
      })
    );
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('[deployment-workbench-e2e] failure', error);
  process.exit(1);
});
