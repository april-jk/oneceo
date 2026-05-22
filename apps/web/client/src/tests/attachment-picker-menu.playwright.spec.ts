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

test('attachment picker supports skill and local imports', async ({ page }) => {
  await page.route('**/api/task-creation/skills', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: EXPECTED_SKILL_NAMES.map((name, index) => ({
          sourceType: 'platform',
          skillId: `skill-${index + 1}`,
          revisionId: `rev-${index + 1}`,
          slug: `skill-${index + 1}`,
          name,
          description: `${name} description`,
          category: 'tool',
          revisionNumber: 1,
          resourceSummary: {
            totalCount: 0,
            referenceCount: 0,
            templateCount: 0,
            paths: [],
          },
        })),
      }),
    });
  });

  await page.goto(WEB_URL);
  await expect(page.getByRole('button', { name: '添加附件' })).toBeVisible();

  await page.getByRole('button', { name: '添加附件' }).click();
  await expect(page.getByRole('menuitem', { name: /使用技能/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /从本地文件添加/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /从云端添加/ })).toHaveCount(0);

  await page.getByRole('menuitem', { name: /使用技能/ }).hover();
  await page.getByRole('menuitem', { name: /需求拆解/ }).click();
  await expect(page.getByRole('button', { name: '移除附件 需求拆解' })).toBeVisible();

  await page.getByRole('button', { name: '添加附件' }).click();
  await page.getByRole('menuitem', { name: /使用技能/ }).hover();
  for (const name of EXPECTED_SKILL_NAMES) {
    await expect(page.getByRole('menuitem', { name: new RegExp(name) })).toBeVisible();
  }
  await page.getByRole('menuitem', { name: /PPT 办公/ }).click();
  await expect(page.getByRole('button', { name: '移除附件 PPT 办公' })).toBeVisible();

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '添加附件' }).click();
  await page.getByRole('menuitem', { name: /从本地文件添加/ }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(LOCAL_FILE);

  await expect(page.getByRole('button', { name: '移除附件 logo.png' })).toBeVisible();
  await expect(page.locator('button[aria-label^="移除附件 "]')).toHaveCount(3);
});
