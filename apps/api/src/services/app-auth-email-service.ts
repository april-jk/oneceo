import net from 'node:net';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';

type AuthEmailPurpose = 'register';

type VerificationMailInput = {
  email: string;
  code: string;
  expiresInSeconds: number;
};

type AppAuthSmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  helloName: string;
};

type SmtpResponse = {
  code: number;
  lines: string[];
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveBoolean(value: unknown, fallback: boolean): boolean {
  const normalized = asText(value).toLowerCase();
  if (!normalized) return fallback;
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function resolveSmtpConfig(): AppAuthSmtpConfig {
  const host = asText(process.env.APP_AUTH_SMTP_HOST) || 'smtp.feishu.cn';
  const port = Number(asText(process.env.APP_AUTH_SMTP_PORT) || '465');
  const secure = resolveBoolean(process.env.APP_AUTH_SMTP_SECURE, port === 465);
  const username =
    asText(process.env.APP_AUTH_SMTP_USERNAME) ||
    asText(process.env.APP_AUTH_SMTP_USER) ||
    asText(process.env.APP_AUTH_SMTP_FROM_EMAIL);
  const password = asText(process.env.APP_AUTH_SMTP_PASSWORD);
  const fromEmail = asText(process.env.APP_AUTH_SMTP_FROM_EMAIL) || username;
  const fromName = asText(process.env.APP_AUTH_SMTP_FROM_NAME) || 'OneCEO';
  const helloName = asText(process.env.APP_AUTH_SMTP_HELLO_NAME) || 'oneceo.ai';

  if (!host || !port || Number.isNaN(port)) {
    throw new Error('未配置注册邮件 SMTP 服务地址');
  }
  if (!username || !password) {
    throw new Error('未配置注册邮件发件账号，请设置 APP_AUTH_SMTP_USERNAME 和 APP_AUTH_SMTP_PASSWORD');
  }
  if (!fromEmail) {
    throw new Error('未配置注册邮件发件邮箱，请设置 APP_AUTH_SMTP_FROM_EMAIL');
  }

  return {
    host,
    port,
    secure,
    username,
    password,
    fromEmail,
    fromName,
    helloName,
  };
}

function encodeBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function chunkBase64(value: string): string {
  return value.replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

function escapeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function buildPlainTextMessage(input: {
  fromEmail: string;
  fromName: string;
  toEmail: string;
  subject: string;
  body: string;
}): string {
  const headers = [
    `From: ${escapeHeader(input.fromName)} <${escapeHeader(input.fromEmail)}>`,
    `To: <${escapeHeader(input.toEmail)}>`,
    `Subject: ${escapeHeader(input.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@oneceo.ai>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${chunkBase64(encodeBase64(input.body))}\r\n`;
}

function buildRegisterVerificationBody(input: VerificationMailInput): { subject: string; body: string } {
  const expiresInMinutes = Math.max(1, Math.ceil(input.expiresInSeconds / 60));
  return {
    subject: 'OneCEO verification code',
    body: [
      'You are registering a OneCEO account.',
      '',
      `Verification code: ${input.code}`,
      `Expires in: ${expiresInMinutes} minutes`,
      '',
      'If you did not request this code, please ignore this email.',
      '',
      '你正在注册 OneCEO 账号。',
      '',
      `验证码：${input.code}`,
      `有效期：${expiresInMinutes} 分钟`,
      '',
      '如果这不是你的操作，请忽略这封邮件。',
    ].join('\n'),
  };
}

async function connectSocket(config: AppAuthSmtpConfig): Promise<net.Socket | tls.TLSSocket> {
  return await new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    if (config.secure) {
      const socket = tls.connect(
        {
          host: config.host,
          port: config.port,
          servername: config.host,
        },
        () => {
          socket.off('error', onError);
          resolve(socket);
        }
      );
      socket.once('error', onError);
      return;
    }

    const socket = net.createConnection(
      {
        host: config.host,
        port: config.port,
      },
      () => {
        socket.off('error', onError);
        resolve(socket);
      }
    );
    socket.once('error', onError);
  });
}

function createResponseReader(socket: net.Socket | tls.TLSSocket) {
  let buffer = '';
  let currentLines: string[] = [];
  let pendingResolver: ((value: SmtpResponse) => void) | null = null;
  let pendingRejector: ((reason?: unknown) => void) | null = null;
  const queued: SmtpResponse[] = [];

  const flushLine = (line: string) => {
    currentLines.push(line);
    const isTerminal = /^\d{3} /.test(line);
    if (!isTerminal) {
      return;
    }
    const response = {
      code: Number(line.slice(0, 3)),
      lines: currentLines,
    };
    currentLines = [];
    if (pendingResolver) {
      const resolve = pendingResolver;
      pendingResolver = null;
      pendingRejector = null;
      resolve(response);
      return;
    }
    queued.push(response);
  };

  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    while (true) {
      const lineBreakIndex = buffer.indexOf('\n');
      if (lineBreakIndex < 0) {
        break;
      }
      const line = buffer.slice(0, lineBreakIndex).replace(/\r$/, '');
      buffer = buffer.slice(lineBreakIndex + 1);
      if (line) {
        flushLine(line);
      }
    }
  };

  const onError = (error: Error) => {
    if (pendingRejector) {
      const reject = pendingRejector;
      pendingResolver = null;
      pendingRejector = null;
      reject(error);
    }
  };

  socket.on('data', onData);
  socket.on('error', onError);

  return {
    async read(): Promise<SmtpResponse> {
      if (queued.length > 0) {
        return queued.shift() as SmtpResponse;
      }
      return await new Promise<SmtpResponse>((resolve, reject) => {
        pendingResolver = resolve;
        pendingRejector = reject;
      });
    },
    dispose() {
      socket.off('data', onData);
      socket.off('error', onError);
    },
  };
}

async function writeLine(socket: net.Socket | tls.TLSSocket, command: string) {
  await new Promise<void>((resolve, reject) => {
    socket.write(`${command}\r\n`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function writeRaw(socket: net.Socket | tls.TLSSocket, data: string) {
  await new Promise<void>((resolve, reject) => {
    socket.write(data, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function assertResponse(response: SmtpResponse, expectedCodes: number[], context: string) {
  if (expectedCodes.includes(response.code)) {
    return;
  }
  throw new Error(`${context} failed: ${response.lines.join(' | ')}`);
}

function dotStuff(data: string): string {
  return data
    .replace(/\r?\n/g, '\r\n')
    .replace(/^\./gm, '..');
}

async function upgradeSocketToTls(
  socket: net.Socket | tls.TLSSocket,
  config: AppAuthSmtpConfig
): Promise<tls.TLSSocket> {
  return await new Promise((resolve, reject) => {
    const secureSocket = tls.connect(
      {
        socket,
        servername: config.host,
      },
      () => resolve(secureSocket)
    );
    secureSocket.once('error', reject);
  });
}

async function sendSmtpMail(config: AppAuthSmtpConfig, message: {
  toEmail: string;
  subject: string;
  body: string;
}): Promise<void> {
  let socket = await connectSocket(config);
  let reader = createResponseReader(socket);

  try {
    assertResponse(await reader.read(), [220], 'smtp greeting');
    await writeLine(socket, `EHLO ${config.helloName}`);
    assertResponse(await reader.read(), [250], 'smtp ehlo');

    if (!config.secure) {
      await writeLine(socket, 'STARTTLS');
      assertResponse(await reader.read(), [220], 'smtp starttls');
      reader.dispose();
      socket = await upgradeSocketToTls(socket, config);
      reader = createResponseReader(socket);
      await writeLine(socket, `EHLO ${config.helloName}`);
      assertResponse(await reader.read(), [250], 'smtp ehlo after tls');
    }

    await writeLine(socket, 'AUTH LOGIN');
    assertResponse(await reader.read(), [334], 'smtp auth login');
    await writeLine(socket, encodeBase64(config.username));
    assertResponse(await reader.read(), [334], 'smtp auth username');
    await writeLine(socket, encodeBase64(config.password));
    assertResponse(await reader.read(), [235], 'smtp auth password');

    await writeLine(socket, `MAIL FROM:<${config.fromEmail}>`);
    assertResponse(await reader.read(), [250], 'smtp mail from');
    await writeLine(socket, `RCPT TO:<${message.toEmail}>`);
    assertResponse(await reader.read(), [250, 251], 'smtp rcpt to');
    await writeLine(socket, 'DATA');
    assertResponse(await reader.read(), [354], 'smtp data');

    const payload = buildPlainTextMessage({
      fromEmail: config.fromEmail,
      fromName: config.fromName,
      toEmail: message.toEmail,
      subject: message.subject,
      body: message.body,
    });
    await writeRaw(socket, `${dotStuff(payload)}\r\n.\r\n`);
    assertResponse(await reader.read(), [250], 'smtp send');
    await writeLine(socket, 'QUIT');
    await reader.read().catch(() => null);
  } finally {
    reader.dispose();
    socket.destroy();
  }
}

export class AppAuthEmailService {
  async sendVerificationCode(purpose: AuthEmailPurpose, input: VerificationMailInput): Promise<void> {
    const config = resolveSmtpConfig();
    if (purpose !== 'register') {
      throw new Error('unsupported auth email purpose');
    }
    const message = buildRegisterVerificationBody(input);
    await sendSmtpMail(config, {
      toEmail: input.email,
      subject: message.subject,
      body: message.body,
    });
  }
}

export const appAuthEmailService = new AppAuthEmailService();
