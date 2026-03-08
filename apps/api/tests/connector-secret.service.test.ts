import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { connectorSecretService } from '../src/services/connector-secret-service';

const originalKey = process.env.CONNECTOR_SECRET_KEY;

beforeEach(() => {
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-connector-secret';
});

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.CONNECTOR_SECRET_KEY;
  } else {
    process.env.CONNECTOR_SECRET_KEY = originalKey;
  }
});

test('connector secret service encrypts and decrypts JSON payloads', () => {
  const encrypted = connectorSecretService.encrypt({
    accessToken: 'token-123456',
    scope: 'repo',
  });
  assert.ok(encrypted);
  const decrypted = connectorSecretService.decryptJson<{
    accessToken: string;
    scope: string;
  }>(encrypted);
  assert.deepEqual(decrypted, {
    accessToken: 'token-123456',
    scope: 'repo',
  });
});

test('connector secret service handles empty payloads and summarizes secrets', () => {
  assert.equal(connectorSecretService.encrypt(null), null);
  assert.equal(connectorSecretService.decryptToString(null), null);
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
