import path from 'node:path';
import { expect, test } from '@playwright/test';

const WEB_URL = 'http://127.0.0.1:3000';
const LOCAL_FILE = path.resolve(import.meta.dirname, '../../public/logo.png');
const EXPECTED_SKILL_NAMES = [
  '需求拆解',
  '实施计划',
  '测试检查清单',
  'PPT 办公',
  'Word 办公',
  'Excel 办公',
];

test('attachment picker supports cloud, skill, and local imports', async ({ page }) => {
  await page.goto(WEB_URL);
  await expect(page.getByRole('button', { name: '添加附件' })).toBeVisible();

  await page.getByRole('button', { name: '添加附件' }).click();
  await expect(page.getByRole('menuitem', { name: /从云端添加/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /使用技能/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /从本地文件添加/ })).toBeVisible();

  await page.getByRole('menuitem', { name: /从云端添加/ }).hover();
  await page.getByRole('menuitem', { name: /网站 从网页链接直接下载文件/ }).click();
  await page.getByTestId('remote-attachment-url-input').fill(`${WEB_URL}/logo.png`);
  await page.getByRole('button', { name: '添加文件', exact: true }).click();
  await expect(page.getByRole('button', { name: '移除附件 logo.png' })).toBeVisible();

  await page.getByRole('button', { name: '添加附件' }).click();
  await page.getByRole('menuitem', { name: /使用技能/ }).hover();
  await page.getByRole('menuitem', { name: /需求拆解/ }).click();
  await expect(page.getByRole('button', { name: '移除附件 需求拆解' })).toBeVisible();

  await page.getByRole('button', { name: '添加附件' }).click();
  await page.getByRole('menuitem', { name: /使用技能/ }).hover();
  for (const name of EXPECTED_SKILL_NAMES) {
    await expect(page.getByRole('menuitem', { name: new RegExp(name) })).toBeVisible();
  }
  await expect(page.getByRole('menuitem', { name: /PPT 办公/ })).toBeVisible();
  await page.getByRole('menuitem', { name: /PPT 办公/ }).click();
  await expect(page.getByRole('button', { name: '移除附件 PPT 办公' })).toBeVisible();

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '添加附件' }).click();
  await page.getByRole('menuitem', { name: /从本地文件添加/ }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(LOCAL_FILE);

  await expect(page.getByRole('button', { name: '移除附件 logo.png' })).toHaveCount(2);
  await expect(page.locator('button[aria-label^="移除附件 "]')).toHaveCount(4);
});
