import { randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { WebSocket } from 'ws';

const DEFAULT_ASR_HTTP_ENDPOINT =
  'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';
const DEFAULT_ASR_WS_RESOURCE_IDS = [
  'volc.bigasr.sauc.duration',
  'volc.bigasr.sauc.concurrent',
  'volc.seedasr.sauc.duration',
  'volc.seedasr.sauc.concurrent',
];
const DEFAULT_ASR_HTTP_RESOURCE_ID = 'volc.bigasr.auc_turbo';

export type VolcengineSpeechConfig = {
  asrAppId: string;
  asrAccessToken: string;
  asrSecretKey?: string;
  asrEndpoint: string;
};

export type VolcengineSpeechTranscript = {
  text: string;
  confidence?: number;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSpeechEndpoint(
  value: string | undefined,
  fallback: string,
): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return /^(https?|wss?):\/\//i.test(trimmed) ? trimmed : fallback;
}

export function loadVolcengineSpeechConfigFromEnv():
  | VolcengineSpeechConfig
  | null {
  const asrAppId =
    asText(process.env.ONECEO_VOLCENGINE_ASR_APP_ID) ||
    asText(process.env.VOLCENGINE_ASR_APP_ID);
  const asrAccessToken =
    asText(process.env.ONECEO_VOLCENGINE_ASR_ACCESS_TOKEN) ||
    asText(process.env.VOLCENGINE_ASR_ACCESS_TOKEN);

  if (!asrAppId || !asrAccessToken) {
    return null;
  }

  return {
    asrAppId,
    asrAccessToken,
    asrSecretKey:
      asText(process.env.ONECEO_VOLCENGINE_ASR_SECRET_KEY) ||
      asText(process.env.VOLCENGINE_ASR_SECRET_KEY) ||
      undefined,
    asrEndpoint: normalizeSpeechEndpoint(
      asText(process.env.ONECEO_VOLCENGINE_ASR_ENDPOINT) ||
        asText(process.env.VOLCENGINE_ASR_ENDPOINT) ||
        undefined,
      DEFAULT_ASR_HTTP_ENDPOINT,
    ),
  };
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function isWebSocketEndpoint(endpoint: string): boolean {
  return /^wss?:\/\//i.test(endpoint);
}

function parseWavePcmS16Le(input: Uint8Array): Uint8Array {
  if (input.length < 12) {
    return input;
  }

  const riff = String.fromCharCode(...input.slice(0, 4));
  const wave = String.fromCharCode(...input.slice(8, 12));
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    return input;
  }

  let offset = 12;
  while (offset + 8 <= input.length) {
    const chunkHeader = input.slice(offset, offset + 8);
    if (chunkHeader.length < 8) {
      break;
    }
    const chunkId = String.fromCharCode(
      chunkHeader[0] ?? 0,
      chunkHeader[1] ?? 0,
      chunkHeader[2] ?? 0,
      chunkHeader[3] ?? 0,
    );
    const chunkSize =
      (chunkHeader[4] ?? 0) |
      ((chunkHeader[5] ?? 0) << 8) |
      ((chunkHeader[6] ?? 0) << 16) |
      ((chunkHeader[7] ?? 0) << 24);
    const dataOffset = offset + 8;
    if (chunkId === 'data' && dataOffset + chunkSize <= input.length) {
      return input.slice(dataOffset, dataOffset + chunkSize);
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }

  return input;
}

function createProtocolHeader(
  messageType: number,
  flags: number,
  serialization: number,
  compression: number,
): Uint8Array {
  return Uint8Array.from([
    0x11,
    ((messageType & 0x0f) << 4) | (flags & 0x0f),
    ((serialization & 0x0f) << 4) | (compression & 0x0f),
    0x00,
  ]);
}

function createWsFrame(
  header: Uint8Array,
  payload: Uint8Array,
  sequence?: number,
): Uint8Array {
  const extraBytes = sequence === undefined ? 0 : 4;
  const frame = new Uint8Array(header.length + extraBytes + 4 + payload.length);
  frame.set(header, 0);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  let offset = header.length;
  if (sequence !== undefined) {
    view.setInt32(offset, sequence, false);
    offset += 4;
  }
  view.setUint32(offset, payload.length, false);
  offset += 4;
  frame.set(payload, offset);
  return frame;
}

function decodeWsJsonPayload(
  payload: Uint8Array,
  compression: number,
): Record<string, unknown> {
  const bytes =
    compression === 1 ? gunzipSync(Buffer.from(payload)) : Buffer.from(payload);
  return JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
}

function extractAsrResult(
  payload: Record<string, unknown>,
): VolcengineSpeechTranscript | null {
  const result = payload.result as
    | {
        text?: string;
        utterances?: Array<{
          words?: Array<{ confidence?: number }>;
        }>;
      }
    | undefined;
  const text = result?.text?.trim();
  if (!text) return null;

  const confidence = result?.utterances?.[0]?.words?.[0]?.confidence;
  return {
    text,
    confidence: Number.isFinite(confidence) ? confidence : undefined,
  };
}

class VolcengineSpeechService {
  constructor(private readonly config: VolcengineSpeechConfig) {}

  async transcribeAudio(
    audioBytes: Uint8Array,
    userId = 'oneceo-task-creation',
  ): Promise<VolcengineSpeechTranscript> {
    if (isWebSocketEndpoint(this.config.asrEndpoint)) {
      return this.transcribeAudioWithWs(audioBytes, userId);
    }
    return this.transcribeAudioWithHttp(audioBytes, userId);
  }

  private async transcribeAudioWithHttp(
    audioBytes: Uint8Array,
    userId: string,
  ): Promise<VolcengineSpeechTranscript> {
    const sharedHeaders = {
      'Content-Type': 'application/json',
      'X-Api-Resource-Id': DEFAULT_ASR_HTTP_RESOURCE_ID,
      'X-Api-Request-Id': randomUUID(),
      'X-Api-Sequence': '-1',
    };
    const requestBody = JSON.stringify({
      user: { uid: userId },
      audio: { data: toBase64(audioBytes) },
      request: { model_name: 'bigmodel' },
    });

    const authVariants: Array<Record<string, string>> = [
      {
        'X-Api-App-Key': this.config.asrAppId,
        'X-Api-Access-Key': this.config.asrAccessToken,
      },
    ];
    if (this.config.asrSecretKey) {
      authVariants.push({
        'X-Api-Key': this.config.asrSecretKey,
      });
    }

    const errors: string[] = [];
    for (const authHeaders of authVariants) {
      const response = await fetch(this.config.asrEndpoint, {
        method: 'POST',
        headers: {
          ...sharedHeaders,
          ...authHeaders,
        },
        body: requestBody,
      });

      const statusCode = response.headers.get('X-Api-Status-Code');
      const statusMessage = response.headers.get('X-Api-Message');
      if (!response.ok || statusCode !== '20000000') {
        const authLabel = 'X-Api-Key' in authHeaders ? 'x-api-key' : 'legacy';
        errors.push(
          `${authLabel}${statusCode ? ` (${statusCode})` : ''}${statusMessage ? `: ${statusMessage}` : ''}`,
        );
        continue;
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const transcript = extractAsrResult(payload);
      if (!transcript) {
        throw new Error('Volcengine ASR returned empty text');
      }
      return transcript;
    }

    throw new Error(
      `Volcengine ASR failed${errors.length > 0 ? `: ${errors.join(' | ')}` : ''}`,
    );
  }

  private async transcribeAudioWithWs(
    audioBytes: Uint8Array,
    userId: string,
  ): Promise<VolcengineSpeechTranscript> {
    const pcmBytes = parseWavePcmS16Le(audioBytes);
    const requestPayload = gzipSync(
      Buffer.from(
        JSON.stringify({
          user: { uid: userId },
          audio: {
            format: 'pcm',
            codec: 'raw',
            rate: 16000,
            bits: 16,
            channel: 1,
            language: 'zh-CN',
          },
          request: {
            model_name: 'bigmodel',
            enable_itn: true,
            enable_punc: true,
            enable_ddc: false,
            show_utterances: true,
            result_type: 'full',
          },
        }),
        'utf8',
      ),
    );

    const fullClientHeader = createProtocolHeader(0x1, 0x0, 0x1, 0x1);
    const audioOnlyFinalHeader = createProtocolHeader(0x2, 0x2, 0x0, 0x1);
    const audioPayload = gzipSync(Buffer.from(pcmBytes));

    const errors: string[] = [];
    for (const resourceId of DEFAULT_ASR_WS_RESOURCE_IDS) {
      try {
        const connectId = randomUUID();
        const result = await new Promise<VolcengineSpeechTranscript>(
          (resolve, reject) => {
            const ws = new WebSocket(this.config.asrEndpoint, {
              headers: {
                'X-Api-App-Key': this.config.asrAppId,
                'X-Api-Access-Key': this.config.asrAccessToken,
                'X-Api-Resource-Id': resourceId,
                'X-Api-Connect-Id': connectId,
              },
            });

            let settled = false;
            let sentAudio = false;
            const finish = (callback: () => void) => {
              if (settled) return;
              settled = true;
              try {
                ws.close();
              } catch {}
              callback();
            };

            ws.once('error', (error) => {
              finish(() =>
                reject(
                  new Error(
                    `${resourceId}: ${error instanceof Error ? error.message : String(error)}`,
                  ),
                ),
              );
            });

            ws.once('open', () => {
              ws.send(createWsFrame(fullClientHeader, requestPayload));
            });

            ws.on('message', (data) => {
              const bytes = Buffer.isBuffer(data)
                ? new Uint8Array(data)
                : typeof data === 'string'
                  ? new Uint8Array(Buffer.from(data))
                  : new Uint8Array(data as ArrayBuffer);
              if (bytes.length < 8) {
                return;
              }

              const byte0 = bytes[0];
              const byte1 = bytes[1];
              const byte2 = bytes[2];
              if (
                byte0 === undefined ||
                byte1 === undefined ||
                byte2 === undefined
              ) {
                return;
              }

              const version = byte0 >> 4;
              const headerSize = (byte0 & 0x0f) * 4;
              const messageType = byte1 >> 4;
              const flags = byte1 & 0x0f;
              const compression = byte2 & 0x0f;
              if (version !== 1 || headerSize > bytes.length) {
                return;
              }

              const view = new DataView(
                bytes.buffer,
                bytes.byteOffset,
                bytes.byteLength,
              );

              if (messageType === 0x9) {
                let offset = headerSize;
                if (flags === 0x1 || flags === 0x3) {
                  offset += 4;
                }
                const payloadSize = view.getUint32(offset, false);
                offset += 4;
                const payload = bytes.slice(offset, offset + payloadSize);
                const json = decodeWsJsonPayload(payload, compression);
                if (!sentAudio) {
                  sentAudio = true;
                  ws.send(createWsFrame(audioOnlyFinalHeader, audioPayload));
                }
                const extracted = extractAsrResult(json);
                if (extracted && flags === 0x3) {
                  finish(() => resolve(extracted));
                }
                return;
              }

              if (messageType === 0xf) {
                const errorCode = view.getUint32(headerSize, false);
                const payloadSize = view.getUint32(headerSize + 4, false);
                const payload = bytes.slice(
                  headerSize + 8,
                  headerSize + 8 + payloadSize,
                );
                let message = '';
                try {
                  message = JSON.stringify(
                    decodeWsJsonPayload(payload, compression),
                  );
                } catch {
                  message = Buffer.from(payload).toString('utf8');
                }
                finish(() =>
                  reject(
                    new Error(
                      `${resourceId}: ${errorCode}${message ? ` ${message}` : ''}`,
                    ),
                  ),
                );
              }
            });

            ws.once('close', () => {
              if (!settled) {
                settled = true;
                reject(
                  new Error(
                    `${resourceId}: websocket closed before final ASR result`,
                  ),
                );
              }
            });
          },
        );

        return result;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    throw new Error(
      `Volcengine ASR failed${errors.length > 0 ? `: ${errors.join(' | ')}` : ''}`,
    );
  }
}

let cachedService: VolcengineSpeechService | null | undefined;

export function getVolcengineSpeechService(): VolcengineSpeechService | null {
  if (cachedService !== undefined) {
    return cachedService;
  }
  const config = loadVolcengineSpeechConfigFromEnv();
  cachedService = config ? new VolcengineSpeechService(config) : null;
  return cachedService;
}

export function resetVolcengineSpeechServiceForTest(): void {
  cachedService = undefined;
}
