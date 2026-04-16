import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { connectorSecretService } from '../src/services/connector-secret-service';

const originalGenericKey = process.env.CONNECTOR_SECRET_KEY;
const originalNotionKey = process.env.NOTION_CONNECTOR_SECRET_KEY;
const originalSlackKey = process.env.SLACK_CONNECTOR_SECRET_KEY;
const originalSupabaseKey = process.env.SUPABASE_CONNECTOR_SECRET_KEY;

beforeEach(() => {
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-generic-secret';
  process.env.NOTION_CONNECTOR_SECRET_KEY = 'unit-test-notion-secret';
  process.env.SLACK_CONNECTOR_SECRET_KEY = 'unit-test-slack-secret';
  process.env.SUPABASE_CONNECTOR_SECRET_KEY = 'unit-test-supabase-secret';
});

afterEach(() => {
  if (originalGenericKey === undefined) {
    delete process.env.CONNECTOR_SECRET_KEY;
  } else {
    process.env.CONNECTOR_SECRET_KEY = originalGenericKey;
  }
  if (originalNotionKey === undefined) {
    delete process.env.NOTION_CONNECTOR_SECRET_KEY;
  } else {
    process.env.NOTION_CONNECTOR_SECRET_KEY = originalNotionKey;
  }
  if (originalSlackKey === undefined) {
    delete process.env.SLACK_CONNECTOR_SECRET_KEY;
  } else {
    process.env.SLACK_CONNECTOR_SECRET_KEY = originalSlackKey;
  }
  if (originalSupabaseKey === undefined) {
    delete process.env.SUPABASE_CONNECTOR_SECRET_KEY;
  } else {
    process.env.SUPABASE_CONNECTOR_SECRET_KEY = originalSupabaseKey;
  }
});

test('connector secret service encrypts and decrypts JSON payloads for slack', () => {
  const encrypted = connectorSecretService.encrypt(
    {
      accessToken: 'token-123456',
      scope: 'channels:history',
    },
    'slack'
  );
  assert.ok(encrypted);
  const decrypted = connectorSecretService.decryptJson<{
    accessToken: string;
    scope: string;
  }>(encrypted, 'slack');
  assert.deepEqual(decrypted, {
    accessToken: 'token-123456',
    scope: 'channels:history',
  });
});

test('connector secret service keeps notion and slack keys isolated', () => {
  const notionCiphertext = connectorSecretService.encrypt({ accessToken: 'notion-token' }, 'notion');
  assert.ok(notionCiphertext);

  assert.throws(
    () => connectorSecretService.decryptJson(notionCiphertext, 'slack'),
    /Unsupported state or unable to authenticate data|Unexpected token|connector secret ciphertext is invalid/
  );

  const decrypted = connectorSecretService.decryptJson<{ accessToken: string }>(notionCiphertext, 'notion');
  assert.equal(decrypted?.accessToken, 'notion-token');
});

test('connector secret service falls back to generic connector key', () => {
  delete process.env.NOTION_CONNECTOR_SECRET_KEY;
  const encrypted = connectorSecretService.encrypt({ accessToken: 'generic-token' }, 'notion');
  assert.ok(encrypted);

  const decrypted = connectorSecretService.decryptJson<{ accessToken: string }>(encrypted, 'notion');
  assert.equal(decrypted?.accessToken, 'generic-token');
});

test('connector secret service handles empty payloads and summarizes secrets', () => {
  assert.equal(connectorSecretService.encrypt(null, 'slack'), null);
  assert.equal(connectorSecretService.decryptToString(null, 'slack'), null);
  assert.equal(
    connectorSecretService.summarize({ accessToken: 'abcd1234' }),
    '***1234'
  );
  assert.match(
    connectorSecretService.summarize({
      dsn: 'postgresql://user:pass@db.example.com:5432/prod',
    }) || '',
    /db\.example\.com/
  );
});

test('connector secret service uses dedicated supabase key', () => {
  const encrypted = connectorSecretService.encrypt({ accessToken: 'sbp-token' }, 'supabase');
  assert.ok(encrypted);

  delete process.env.SUPABASE_CONNECTOR_SECRET_KEY;
  assert.throws(
    () => connectorSecretService.decryptJson(encrypted, 'supabase'),
    /Unsupported state or unable to authenticate data|SUPABASE_CONNECTOR_SECRET_KEY is required to process connector secrets/
  );
});
