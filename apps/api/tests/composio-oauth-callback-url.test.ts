import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { resolveComposioOauthCallbackUrl } from '../src/services/user-connector-service';

const originalCallbackBaseUrl = process.env.COMPOSIO_OAUTH_CALLBACK_BASE_URL;
const originalFrontendUrl = process.env.FRONTEND_URL;

afterEach(() => {
  if (originalCallbackBaseUrl === undefined) {
    delete process.env.COMPOSIO_OAUTH_CALLBACK_BASE_URL;
  } else {
    process.env.COMPOSIO_OAUTH_CALLBACK_BASE_URL = originalCallbackBaseUrl;
  }
  if (originalFrontendUrl === undefined) {
    delete process.env.FRONTEND_URL;
  } else {
    process.env.FRONTEND_URL = originalFrontendUrl;
  }
});

test('Composio OAuth callback uses COMPOSIO_OAUTH_CALLBACK_BASE_URL and fixed connector path', () => {
  process.env.COMPOSIO_OAUTH_CALLBACK_BASE_URL = 'https://preview.oneceo.ai';
  process.env.FRONTEND_URL = 'https://ignored.oneceo.ai';

  const callbackUrl = resolveComposioOauthCallbackUrl(
    'github',
    'http://localhost:3000/github/callback?settings=open&connector=github&targetSessionId=session-1'
  );

  assert.equal(
    callbackUrl.toString(),
    'https://preview.oneceo.ai/github/callback?settings=open&connector=github&targetSessionId=session-1'
  );
});

test('Composio OAuth callback falls back to FRONTEND_URL when dedicated base is unset', () => {
  delete process.env.COMPOSIO_OAUTH_CALLBACK_BASE_URL;
  process.env.FRONTEND_URL = 'http://oneceo.ai:3000';

  const callbackUrl = resolveComposioOauthCallbackUrl(
    'figma',
    'http://localhost:3000/figma/callback?settings=open&connector=figma'
  );

  assert.equal(
    callbackUrl.toString(),
    'http://oneceo.ai:3000/figma/callback?settings=open&connector=figma'
  );
});

test('Composio OAuth callback supports Google Super fixed connector path', () => {
  process.env.COMPOSIO_OAUTH_CALLBACK_BASE_URL = 'https://preview.oneceo.ai';

  const callbackUrl = resolveComposioOauthCallbackUrl(
    'google_super',
    'http://localhost:3000/google-super/callback?settings=open&connector=google_super&targetSessionId=session-google-1'
  );

  assert.equal(
    callbackUrl.toString(),
    'https://preview.oneceo.ai/google-super/callback?settings=open&connector=google_super&targetSessionId=session-google-1'
  );
});
