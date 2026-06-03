import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ACCOUNT_FILE = path.resolve(__dirname, 'playwright-test-account.json');

export function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function generatedPassword() {
  return `OneceoE2E-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readOptionalAccount(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export async function loadPlaywrightTestAccount({
  filePath = DEFAULT_ACCOUNT_FILE,
  fallbackEmail = '',
  fallbackPassword = '',
  displayName = 'Playwright Test User',
  allowTestAliases = false,
  requireCredentials = true,
} = {}) {
  const parsed = await readOptionalAccount(filePath);
  const email =
    (allowTestAliases ? asText(process.env.TEST_EMAIL) : '') ||
    asText(process.env.ONECEO_E2E_USER_EMAIL) ||
    asText(parsed.email) ||
    asText(fallbackEmail);
  const password =
    (allowTestAliases ? asText(process.env.TEST_PASSWORD) : '') ||
    asText(process.env.ONECEO_E2E_USER_PASSWORD) ||
    asText(parsed.password) ||
    asText(fallbackPassword);
  const account = {
    email,
    password,
    displayName:
      asText(process.env.ONECEO_E2E_USER_DISPLAY_NAME) ||
      asText(parsed.displayName) ||
      asText(displayName),
    filePath,
  };
  if (requireCredentials && (!account.email || !account.password)) {
    throw new Error(
      `Playwright test account requires ONECEO_E2E_USER_EMAIL/ONECEO_E2E_USER_PASSWORD or a local ignored account file: ${filePath}. Copy playwright-test-account.example.json to create one.`,
    );
  }
  return account;
}
