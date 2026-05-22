import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { APP_SESSION_COOKIE_NAMES } from '../utils/auth-session';
import { readCookieValuesFromHeaderByNames } from '../utils/http-cookie';
import { appAuthService } from './app-auth-service';
import { loadVolcengineSpeechConfigFromEnv } from './volcengine-speech-service';

const ASR_PROXY_PATH = '/ws/task-creation/voice/asr';
const ASR_UPSTREAM_URL =
  'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
const DEFAULT_ASR_RESOURCE_ID = 'volc.seedasr.sauc.duration';

function readEnvText(key: string): string {
  return String(process.env[key] || '').trim();
}

function resolveAsrResourceId(): string {
  return (
    readEnvText('ONECEO_VOLCENGINE_ASR_RESOURCE_ID') ||
    readEnvText('VOLCENGINE_ASR_RESOURCE_ID') ||
    DEFAULT_ASR_RESOURCE_ID
  );
}

function normalizeCloseCode(code: number): number {
  if (code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 && code !== 1015) {
    return code;
  }
  return 1011;
}

function closeSocket(ws: WebSocket, code: number, reason: string): void {
  if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) {
    return;
  }
  try {
    ws.close(code, reason);
  } catch {
    ws.terminate();
  }
}

async function resolveAuthenticatedUserId(req: IncomingMessage): Promise<string | null> {
  const cookieHeader = typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
  const sessionTokens = readCookieValuesFromHeaderByNames(
    cookieHeader,
    APP_SESSION_COOKIE_NAMES,
  );
  for (const sessionToken of sessionTokens) {
    const resolved = await appAuthService.resolveUserBySessionToken(sessionToken);
    const userId = typeof resolved?.user?.id === 'string' ? resolved.user.id.trim() : '';
    if (userId) {
      return userId;
    }
  }
  return null;
}

export class VolcengineAsrWebSocketProxyService {
  private wss: WebSocketServer | null = null;

  initialize(): void {
    if (this.wss) {
      return;
    }
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (client, req) => {
      void this.handleConnection(client, req);
    });
    this.wss.on('error', (error) => {
      console.error('[VOICE_ASR_WS_PROXY_ERROR]', error);
    });
  }

  handleUpgrade(
    req: IncomingMessage,
    socket: Parameters<WebSocketServer['handleUpgrade']>[1],
    head: Parameters<WebSocketServer['handleUpgrade']>[2],
  ): boolean {
    const pathname = new URL(req.url || '', 'http://localhost').pathname;
    if (pathname !== ASR_PROXY_PATH) {
      return false;
    }

    if (!this.wss) {
      socket.destroy();
      return true;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss?.emit('connection', ws, req);
    });
    return true;
  }

  close(): void {
    const wss = this.wss;
    if (!wss) {
      return;
    }
    this.wss = null;
    for (const client of wss.clients) {
      closeSocket(client, 1001, 'server_shutdown');
    }
    wss.close();
  }

  private async handleConnection(client: WebSocket, req: IncomingMessage): Promise<void> {
    const pendingClientMessages: RawData[] = [];
    let upstream: WebSocket | null = null;
    let upstreamOpen = false;

    const closeUpstream = () => {
      if (
        upstream &&
        (upstream.readyState === WebSocket.OPEN ||
          upstream.readyState === WebSocket.CONNECTING)
      ) {
        closeSocket(upstream, 1000, 'client_closed');
      }
    };

    client.on('message', (data) => {
      if (upstreamOpen && upstream?.readyState === WebSocket.OPEN) {
        upstream.send(data);
        return;
      }
      pendingClientMessages.push(data);
    });
    client.once('close', closeUpstream);
    client.once('error', closeUpstream);

    const userId = await resolveAuthenticatedUserId(req);
    if (!userId) {
      closeSocket(client, 1008, 'authentication_required');
      return;
    }
    if (client.readyState !== WebSocket.OPEN) {
      return;
    }

    const config = loadVolcengineSpeechConfigFromEnv();
    if (!config) {
      closeSocket(client, 1011, 'voice_asr_unconfigured');
      return;
    }

    upstream = new WebSocket(ASR_UPSTREAM_URL, {
      headers: {
        'X-Api-App-Key': config.asrAppId,
        'X-Api-Access-Key': config.asrAccessToken,
        'X-Api-Resource-Id': resolveAsrResourceId(),
        'X-Api-Connect-Id': randomUUID(),
      },
    });

    upstream.once('open', () => {
      upstreamOpen = true;
      for (const message of pendingClientMessages.splice(0)) {
        if (!upstream || upstream.readyState !== WebSocket.OPEN) {
          break;
        }
        upstream.send(message);
      }
    });

    upstream.on('message', (data) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });

    upstream.once('error', (error) => {
      console.error('[VOICE_ASR_WS_UPSTREAM_ERROR]', userId, error);
      closeSocket(client, 1011, 'voice_asr_upstream_error');
    });

    upstream.once('close', (code, reason) => {
      const message = reason.length > 0 ? reason.toString('utf8') : 'voice_asr_closed';
      closeSocket(client, normalizeCloseCode(code), message);
    });
  }
}

export const volcengineAsrWebSocketProxyService =
  new VolcengineAsrWebSocketProxyService();
