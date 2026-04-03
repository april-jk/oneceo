import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(nodeScrypt);
const KEY_LENGTH = 64;

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function hashPassword(password: string): Promise<string> {
  const normalized = asText(password);
  if (!normalized) {
    throw new Error('密码不能为空');
  }
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(normalized, salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const normalized = asText(password);
  const encoded = asText(passwordHash);
  const [algorithm, salt, storedHex] = encoded.split(':');
  if (algorithm !== 'scrypt' || !salt || !storedHex || !normalized) {
    return false;
  }
  const derived = (await scrypt(normalized, salt, KEY_LENGTH)) as Buffer;
  const stored = Buffer.from(storedHex, 'hex');
  if (stored.length !== derived.length) {
    return false;
  }
  return timingSafeEqual(stored, derived);
}
