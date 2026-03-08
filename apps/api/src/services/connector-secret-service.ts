import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const SECRET_VERSION = 'v1';
const DEV_FALLBACK_KEY = 'oneceo-local-connector-secret-key';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toBase64Url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

export class ConnectorSecretService {
  private resolveKey(): Buffer {
    const configured = asText(process.env.CONNECTOR_SECRET_KEY);
    if (configured) {
      return createHash('sha256').update(configured).digest();
    }
    const nodeEnv = asText(process.env.NODE_ENV).toLowerCase();
    if (nodeEnv === 'production') {
      throw new Error('CONNECTOR_SECRET_KEY 未配置，无法处理连接器密文');
    }
    return createHash('sha256').update(DEV_FALLBACK_KEY).digest();
  }

  encrypt(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    if (!payload) return null;
    const key = this.resolveKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      SECRET_VERSION,
      toBase64Url(iv),
      toBase64Url(authTag),
      toBase64Url(ciphertext),
    ].join('.');
  }

  decryptToString(ciphertext: string | null | undefined): string | null {
    const raw = asText(ciphertext);
    if (!raw) return null;
    const [version, ivRaw, tagRaw, bodyRaw] = raw.split('.');
    if (version !== SECRET_VERSION || !ivRaw || !tagRaw || !bodyRaw) {
      throw new Error('连接器密文格式无效');
    }
    const key = this.resolveKey();
    const decipher = createDecipheriv('aes-256-gcm', key, fromBase64Url(ivRaw));
    decipher.setAuthTag(fromBase64Url(tagRaw));
    const plaintext = Buffer.concat([
      decipher.update(fromBase64Url(bodyRaw)),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  decryptJson<T>(ciphertext: string | null | undefined): T | null {
    const raw = this.decryptToString(ciphertext);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  summarize(secret: unknown): string | null {
    if (!secret || typeof secret !== 'object') return null;
    const record = secret as Record<string, unknown>;
    const token = asText(record.accessToken || record.token || record.password);
    if (token) {
      const tail = token.slice(-4) || '****';
      return `***${tail}`;
    }
    const dsn = asText(record.dsn || record.connectionString);
    if (dsn) {
      try {
        const url = new URL(dsn);
        const dbName = url.pathname.replace(/^\/+/, '') || 'database';
        return `${url.protocol}//${url.hostname}/${dbName}`;
      } catch {
        return 'configured';
      }
    }
    return 'configured';
  }
}

export const connectorSecretService = new ConnectorSecretService();
