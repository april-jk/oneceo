function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return null;
}

export function asTimelineCursor(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (value instanceof Date) {
    return Math.floor(value.getTime());
  }
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return null;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
    const parsedDate = Date.parse(raw);
    if (Number.isFinite(parsedDate) && parsedDate > 0) {
      return Math.floor(parsedDate);
    }
  }
  return null;
}

export function normalizeRuntimeGenerationValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return null;
}

export function resolveOpencodePartId(metadataRaw: unknown): string {
  const metadata = pickRecord(metadataRaw);
  const explicit = asText(metadata.partId) || asText(metadata.streamKey);
  if (explicit) {
    return explicit;
  }
  const rawPayload = pickRecord(metadata.rawPayload);
  const eventFromMeta = pickRecord(metadata.event);
  const eventFromPayload = pickRecord(rawPayload.event);
  const event = Object.keys(eventFromMeta).length > 0 ? eventFromMeta : eventFromPayload;
  const properties = pickRecord(event.properties);
  const part = pickRecord(properties.part);
  return asText(part.id) || asText(part.callID) || asText(properties.partId) || asText(properties.callID);
}

export function normalizeMessageTimelineMetadata(
  metadataRaw: unknown,
  createdAt: unknown,
  seed: number
): Record<string, unknown> {
  const metadata = { ...pickRecord(metadataRaw) };
  const timestamp = asTimelineCursor(metadata.timestamp) ?? asTimelineCursor(createdAt) ?? Date.now();
  metadata.timestamp = timestamp;

  const existingSeq = asPositiveInt(metadata.sessionEventSeq);
  if (existingSeq !== null) {
    metadata.sessionEventSeq = existingSeq;
    return metadata;
  }

  const tail = Math.abs(seed || 0) % 1000;
  const candidate = timestamp * 1000 + tail;
  metadata.sessionEventSeq = Number.isSafeInteger(candidate) && candidate > 0 ? candidate : timestamp;
  return metadata;
}

export function resolveMessageTimelineCursor(message: { metadata?: unknown; createdAt?: unknown }): number {
  const metadata = pickRecord(message?.metadata);
  const sessionEventSeq = asPositiveInt(metadata.sessionEventSeq);
  if (sessionEventSeq !== null) return sessionEventSeq;

  const timelineCursor = asTimelineCursor(metadata.timelineCursor);
  if (timelineCursor !== null) return timelineCursor;

  const metadataTimestamp = asTimelineCursor(metadata.timestamp);
  if (metadataTimestamp !== null) return metadataTimestamp;

  const createdAtTs = asTimelineCursor(message?.createdAt);
  if (createdAtTs !== null) return createdAtTs;
  return 0;
}

export function buildTimelineMessageKey(input: {
  id?: string | number | null;
  messageType?: string | null;
  metadata?: unknown;
  createdAt?: unknown;
}): string {
  const metadata = pickRecord(input.metadata);
  const explicit = asText(metadata.messageKey);
  if (explicit) {
    return explicit;
  }

  const messageType = asText(input.messageType) || 'message';
  const runtimeGeneration = normalizeRuntimeGenerationValue(metadata.runtimeGeneration);
  const generationSegment = runtimeGeneration ?? 'na';
  const sessionEventSeq = asPositiveInt(metadata.sessionEventSeq);
  const timelineCursor =
    asTimelineCursor(metadata.timelineCursor) ??
    sessionEventSeq ??
    asTimelineCursor(metadata.timestamp) ??
    asTimelineCursor(input.createdAt) ??
    0;

  if (metadata.runtimeGenerationBoundary === true) {
    return `boundary:${generationSegment}:${timelineCursor || 'na'}`;
  }

  const opencodeSessionId = asText(metadata.opencodeSessionId);
  const partId = resolveOpencodePartId(metadata);
  if (opencodeSessionId && partId) {
    return `stream:${generationSegment}:${opencodeSessionId}:${partId}`;
  }

  if (sessionEventSeq !== null) {
    return `runtime:${generationSegment}:${sessionEventSeq}:${messageType}`;
  }

  const id = input.id !== undefined && input.id !== null ? String(input.id).trim() : '';
  if (id) {
    return id.startsWith('db:') || id.startsWith('boundary:') || id.startsWith('stream:') || id.startsWith('runtime:')
      ? id
      : `db:${id}`;
  }

  return `runtime:${generationSegment}:${timelineCursor || 'na'}:${messageType}`;
}
