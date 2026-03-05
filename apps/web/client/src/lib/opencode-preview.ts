import type { AgentMessage } from "@/hooks/useTaskCreationAgent";

export type PreviewDiffItem = {
  id: string;
  title: string;
  diff?: string;
  files?: StructuredFileDiff[];
  source?: string;
  createdAt?: string | null;
};

export type StructuredFileDiff = {
  file: string;
  before: string;
  after: string;
  additions?: number;
  deletions?: number;
  status?: "added" | "deleted" | "modified";
};

type OpencodeEventInfo = {
  eventType: string;
  event: Record<string, unknown>;
  properties: Record<string, unknown>;
  part: Record<string, unknown>;
  partType: string;
  toolName: string;
};

function parseStructString(value: string): Record<string, unknown> {
  const text = value.trim();
  if (!text.startsWith("@{") || !text.endsWith("}")) {
    return {};
  }
  const body = text.slice(2, -1);
  const result: Record<string, unknown> = {};
  for (const rawPart of body.split(";")) {
    const part = rawPart.trim();
    if (!part) continue;
    const eqIndex = part.indexOf("=");
    if (eqIndex <= 0) {
      result[part] = true;
      continue;
    }
    const key = part.slice(0, eqIndex).trim();
    const val = part.slice(eqIndex + 1).trim();
    if (!key) continue;
    result[key] = val;
  }
  return result;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    const parsed = parseStructString(value);
    if (Object.keys(parsed).length > 0) return parsed;
  }
  return {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRawString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringifySafe(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function asStructuredDiff(value: unknown): StructuredFileDiff[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : null))
    .filter(Boolean) as Record<string, unknown>[];
  if (items.length === 0) return [];
  const mapped = items
    .map((item) => {
      const file = asText(item.file);
      const before = asRawString(item.before);
      const after = asRawString(item.after);
      if (!file) return null;
      const statusRaw = asText(item.status).toLowerCase();
      const status =
        statusRaw === "added" || statusRaw === "deleted" || statusRaw === "modified"
          ? (statusRaw as StructuredFileDiff["status"])
          : undefined;
      const additions = Number(item.additions);
      const deletions = Number(item.deletions);
      return {
        file,
        before,
        after,
        additions: Number.isFinite(additions) ? additions : undefined,
        deletions: Number.isFinite(deletions) ? deletions : undefined,
        status,
      } satisfies StructuredFileDiff;
    })
    .filter(Boolean) as StructuredFileDiff[];
  return mapped.filter(isStructuredDiffMeaningful);
}

function isStructuredDiffMeaningful(item: StructuredFileDiff): boolean {
  if (!item.file) return false;
  const before = (item.before || "").trim();
  const after = (item.after || "").trim();
  const additions = Number(item.additions) || 0;
  const deletions = Number(item.deletions) || 0;
  if (additions > 0 || deletions > 0) return true;
  if (!before && !after) return false;
  if (before === after && !item.status) return false;
  if ((item.status === "added" || item.status === "deleted") && !before && !after) return false;
  return true;
}

function isEmptyDiffText(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return trimmed === "[]" || trimmed === "{}" || trimmed === "null";
}

function extractSessionDiff(metadata: Record<string, unknown>, info: OpencodeEventInfo): StructuredFileDiff[] | string | null {
  const rawPayload = toRecord(metadata.rawPayload);
  const event = info.event;
  const eventProps = toRecord(event.properties);

  const candidates = [
    info.properties?.diff,
    eventProps.diff,
    rawPayload.diff,
    toRecord(rawPayload.event).diff,
    toRecord(toRecord(rawPayload.event).properties).diff,
    toRecord(rawPayload.data).diff,
  ];

  for (const candidate of candidates) {
    const structured = asStructuredDiff(candidate);
    if (structured && structured.length > 0) return structured;
    const text = asText(candidate);
    if (text && !isEmptyDiffText(text)) return text;
  }

  return null;
}

function getOpencodeEventInfo(metadata: Record<string, unknown>): OpencodeEventInfo {
  const rawPayload = toRecord(metadata.rawPayload);
  const eventFromMeta = toRecord(metadata.event);
  const eventFromPayload = toRecord(rawPayload.event);
  const event = Object.keys(eventFromMeta).length > 0 ? eventFromMeta : eventFromPayload;
  const eventType = asText(metadata.eventType) || asText(event.type);
  const properties = toRecord(event.properties);
  const part = toRecord(properties.part);
  const partType = (asText(part.type) || asText(properties.type)).toLowerCase();
  const toolName = asText(part.tool) || asText(part.name) || asText(properties.tool);
  return {
    eventType,
    event,
    properties,
    part,
    partType,
    toolName,
  };
}

function pickTimestamp(metadata: Record<string, unknown>, event: Record<string, unknown>) {
  const candidates = [
    metadata.at,
    metadata.timestamp,
    metadata.time,
    metadata.createdAt,
    event.at,
    event.timestamp,
    event.time,
    event.createdAt,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function extractToolPayload(part: Record<string, unknown>) {
  const toolState = toRecord(part.state);
  const rawInput = toolState.input ?? part.input;
  const input =
    typeof rawInput === "string" && rawInput.trim()
      ? { command: rawInput }
      : toRecord(rawInput);
  const metaInfo = toRecord(toolState.metadata);
  return { toolState, rawInput, input, metaInfo };
}

function resolveDiffOutput(
  toolName: string,
  rawInput: unknown,
  input: Record<string, unknown>,
  output: string
): string {
  if (output) return output;
  const lower = toolName.toLowerCase();
  if (lower === "apply_patch") {
    if (typeof rawInput === "string") return rawInput;
    return asText(input.patch) || asText(input.diff) || "";
  }
  return "";
}

function getFilename(path: string): string {
  if (!path) return "";
  const normalized = path.replace(/\\+/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

function extractFileFromApplyPatch(diffText: string): string | null {
  const match = diffText.match(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$/m);
  if (match && match[1]) return match[1].trim();
  return null;
}

function extractFileFromUnifiedDiff(diffText: string): string | null {
  const gitMatch = diffText.match(/^diff --git a\/(.+?) b\/(.+)$/m);
  if (gitMatch && gitMatch[2]) return gitMatch[2].trim();
  const plusMatch = diffText.match(/^\+\+\+\s+b\/(.+)$/m);
  if (plusMatch && plusMatch[1]) return plusMatch[1].trim();
  return null;
}

function splitUnifiedDiffText(diffText: string) {
  const lines = diffText.split("\n");
  const blocks: { text: string; file?: string | null }[] = [];
  let current: string[] = [];
  lines.forEach((line) => {
    if (line.startsWith("diff --git") && current.length > 0) {
      const text = current.join("\n");
      blocks.push({ text, file: extractFileFromUnifiedDiff(text) });
      current = [];
    }
    current.push(line);
  });
  if (current.length > 0) {
    const text = current.join("\n");
    blocks.push({ text, file: extractFileFromUnifiedDiff(text) });
  }
  return blocks;
}

function splitApplyPatchText(diffText: string) {
  const lines = diffText.split("\n");
  const blocks: { text: string; file?: string | null }[] = [];
  let current: string[] = [];
  const startRegex = /^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+/;
  lines.forEach((line) => {
    if (startRegex.test(line) && current.length > 0) {
      const text = current.join("\n");
      blocks.push({ text, file: extractFileFromApplyPatch(text) });
      current = [];
    }
    current.push(line);
  });
  if (current.length > 0) {
    const text = current.join("\n");
    blocks.push({ text, file: extractFileFromApplyPatch(text) });
  }
  return blocks;
}

function buildDiffTitle(
  payload: StructuredFileDiff[] | string | null,
  source: string,
  index: number
): string {
  if (Array.isArray(payload) && payload.length > 0) {
    if (payload.length === 1) {
      return `文件: ${getFilename(payload[0].file) || payload[0].file}`;
    }
    return `修改 ${payload.length} 个文件`;
  }
  if (typeof payload === "string" && payload.trim()) {
    const byApply = extractFileFromApplyPatch(payload);
    if (byApply) return `文件: ${getFilename(byApply)}`;
    const byUnified = extractFileFromUnifiedDiff(payload);
    if (byUnified) return `文件: ${getFilename(byUnified)}`;
  }
  if (source === "apply_patch") return "补丁";
  if (source === "session.diff") return "Diff";
  return `Diff ${index + 1}`;
}

type DiffPayload =
  | { kind: "structured"; files: StructuredFileDiff[] }
  | { kind: "text"; text: string }
  | { kind: "none" };

function buildDiffSignature(payload: DiffPayload): string | null {
  if (payload.kind === "structured") {
    if (payload.files.length === 0) return null;
    try {
      return `structured:${JSON.stringify(payload.files)}`;
    } catch {
      return `structured:${payload.files.map((file) => file.file).join("|")}`;
    }
  }
  if (payload.kind === "text") {
    const trimmed = payload.text.trim();
    if (!trimmed) return null;
    return `text:${trimmed}`;
  }
  return null;
}

export function extractDiffPayload(metadata: Record<string, unknown>): DiffPayload {
  const info = getOpencodeEventInfo(metadata);
  const { toolName, eventType, properties, event, part } = info;
  const { rawInput, input } = extractToolPayload(part);
  const toolOutput = asText(toRecord(part.state).output) || asText(properties.output);
  const output = resolveDiffOutput(toolName, rawInput, input, toolOutput);
  const lower = toolName.toLowerCase();

  if (lower === "apply_patch" && output && !isEmptyDiffText(output)) {
    return { kind: "text", text: output };
  }

  if (eventType === "session.diff") {
    const diffPayload = extractSessionDiff(metadata, info);
    if (Array.isArray(diffPayload)) {
      return diffPayload.length > 0
        ? { kind: "structured", files: diffPayload }
        : { kind: "none" };
    }
    const diffText =
      typeof diffPayload === "string"
        ? diffPayload
        : asText(properties.diff) || stringifySafe(properties.diff);
    if (
      diffText &&
      !isEmptyDiffText(diffText) &&
      !diffText.startsWith("[OpenCode]") &&
      !diffText.startsWith("[Tool]")
    ) {
      return { kind: "text", text: diffText };
    }
  }

  return { kind: "none" };
}

export function buildPreviewItems(messages: AgentMessage[]) {
  const diffItems: PreviewDiffItem[] = [];
  const seenDiffs = new Set<string>();

  messages.forEach((message, index) => {
    if (message.type !== "opencode_event") return;
    const metadata = toRecord(message.metadata);
    const info = getOpencodeEventInfo(metadata);
    const { toolName, eventType, properties, event, part } = info;

    const { rawInput, input } = extractToolPayload(part);
    const toolOutput = asText(toRecord(part.state).output) || asText(properties.output);
    let output = resolveDiffOutput(toolName, rawInput, input, toolOutput);
    const createdAt = pickTimestamp(metadata, event);
    const idBase = `${index}-${eventType || "event"}-${toolName || "tool"}`;

    if (toolName) {
      const lower = toolName.toLowerCase();
      if (lower === "apply_patch" && output) {
        const payload = extractDiffPayload(metadata);
        if (payload.kind === "none") {
          return;
        }
        const signature = buildDiffSignature(payload);
        if (signature && seenDiffs.has(signature)) {
          return;
        }
        if (signature) {
          seenDiffs.add(signature);
        }
        const blocks = splitApplyPatchText(output);
        if (blocks.length > 1) {
          blocks.forEach((block, blockIndex) => {
            const title = buildDiffTitle(block.text, "apply_patch", diffItems.length);
            diffItems.push({
              id: `diff-${idBase}-${blockIndex}`,
              title,
              diff: block.text,
              source: "apply_patch",
              createdAt,
            });
          });
        } else {
          const title = buildDiffTitle(output, "apply_patch", diffItems.length);
          diffItems.push({
            id: `diff-${idBase}-0`,
            title,
            diff: output,
            source: "apply_patch",
            createdAt,
          });
        }
      }
    }

    if (eventType === "session.diff") {
      const payload = extractDiffPayload(metadata);
      const signature = buildDiffSignature(payload);
      if (signature && seenDiffs.has(signature)) {
        return;
      }
      if (signature) {
        seenDiffs.add(signature);
      }
      if (payload.kind === "structured") {
        payload.files.forEach((file, fileIndex) => {
          const title = buildDiffTitle([file], "session.diff", diffItems.length);
          diffItems.push({
            id: `diff-${idBase}-${fileIndex}`,
            title,
            files: [file],
            source: "session.diff",
            createdAt,
          });
        });
        return;
      }
      if (payload.kind === "text") {
        const diffText = payload.text;
        const blocks = splitUnifiedDiffText(diffText);
        if (blocks.length > 1) {
          blocks.forEach((block, blockIndex) => {
            const title = buildDiffTitle(block.text, "session.diff", diffItems.length);
            diffItems.push({
              id: `diff-${idBase}-${blockIndex}`,
              title,
              diff: block.text,
              source: "session.diff",
              createdAt,
            });
          });
        } else {
          const title = buildDiffTitle(diffText, "session.diff", diffItems.length);
          diffItems.push({
            id: `diff-${idBase}-0`,
            title,
            diff: diffText,
            source: "session.diff",
            createdAt,
          });
        }
      }
    }
  });

  return { diffItems };
}
