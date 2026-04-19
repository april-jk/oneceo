import '../src/config/env';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appUserDAO } from '../src/db/dao';
import { hashPassword } from '../src/utils/auth-password';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function loadDefaultAccount() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const filePath = path.join(rootDir, 'apps/web/e2e/playwright-test-account.json');
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    filePath,
    email: asText(parsed.email),
    password: asText(parsed.password),
    displayName: asText(parsed.displayName) || 'Playwright Test User',
  };
}

async function main() {
  const defaults = await loadDefaultAccount();
  const email = asText(process.env.ONECEO_E2E_USER_EMAIL) || defaults.email;
  const password = asText(process.env.ONECEO_E2E_USER_PASSWORD) || defaults.password;
  const displayName = asText(process.env.ONECEO_E2E_USER_DISPLAY_NAME) || defaults.displayName;

  if (!email || !password) {
    throw new Error('playwright_test_user_missing_credentials');
  }

  const passwordHash = await hashPassword(password);
  let user = await appUserDAO.getByEmail(email);
  if (!user) {
    user = await appUserDAO.create({
      email,
      passwordHash,
      displayName,
    });
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
