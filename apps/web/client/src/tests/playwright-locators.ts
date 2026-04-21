import type { Page } from "@playwright/test";

export function composerTextarea(page: Page) {
  return page.locator('textarea[data-slot="textarea"]:not([disabled])').first();
}
