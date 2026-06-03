import '../src/config/env';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appUserDAO } from '../src/db/dao';
import { hashPassword } from '../src/utils/auth-password';
import { randomUUID } from 'node:crypto';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function loadDefaultAccount() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const filePath = path.join(rootDir, 'apps/web/e2e/playwright-test-account.json');
  let parsed: Record<string, unknown> = {};
  try {
    const raw = await readFile(filePath, 'utf8');
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  return {
    filePath,
    email: asText(parsed.email),
    password: asText(parsed.password),
    displayName: asText(parsed.displayName) || 'Playwright Test User',
  };
}

async function main() {
  const defaults = await loadDefaultAccount();
  const fallbackEmail = `playwright-${randomUUID()}@example.com`;
  const email = asText(process.env.ONECEO_E2E_USER_EMAIL) || defaults.email || fallbackEmail;
  const password = asText(process.env.ONECEO_E2E_USER_PASSWORD) || defaults.password;
  const displayName = asText(process.env.ONECEO_E2E_USER_DISPLAY_NAME) || defaults.displayName;

  if (!email || !password) {
    throw new Error(
      'playwright_test_user_missing_credentials: set ONECEO_E2E_USER_EMAIL/ONECEO_E2E_USER_PASSWORD or create local ignored apps/web/e2e/playwright-test-account.json from the example',
    );
  }

  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await appUserDAO.getByEmail(email);
  } catch (error) {
    console.warn('[PLAYWRIGHT_TEST_USER] getByEmail failed, creating a fresh account instead:', error);
    user = null;
  }
  if (!user) {
    try {
      user = await appUserDAO.create({
        email,
        passwordHash,
        displayName,
      });
    } catch (error) {
      console.warn('[PLAYWRIGHT_TEST_USER] create failed, retrying with a unique account:', error);
      user = await appUserDAO.create({
        email: fallbackEmail,
        passwordHash,
        displayName,
      });
    }
  } else {
    user =
      (await appUserDAO.updateById(String(user.id), {
        passwordHash,
        displayName,
        status: 'active',
      })) || user;
  }

  console.log(
    JSON.stringify({
      ok: true,
      filePath: defaults.filePath,
      email,
      password,
      displayName,
      userId: String(user.id),
    }),
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
