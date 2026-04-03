import { promises as fs } from 'node:fs';
import path from 'node:path';

type LogLevel = 'info' | 'error';

const logFilePath = path.resolve(process.cwd(), 'data', 'connector-debug.log');

function serializePayload(payload: unknown): string {
  try {
    return JSON.stringify(payload);
  } catch (error) {
    return JSON.stringify({
      serializationError: error instanceof Error ? error.message : String(error),
    });
  }
}

export function writeConnectorDebugLog(tag: string, payload: Record<string, unknown>, level: LogLevel = 'info') {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${tag} ${serializePayload(payload)}\n`;
  if (level === 'error') {
    console.error(tag, payload);
  } else {
    console.info(tag, payload);
  }
  void fs.mkdir(path.dirname(logFilePath), { recursive: true })
    .then(() => fs.appendFile(logFilePath, line, 'utf8'))
    .catch(() => {
      // best effort logging only
    });
}

export function getConnectorDebugLogPath() {
  return logFilePath;
}
