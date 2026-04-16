import type { AgentMessage } from "@/hooks/useTaskCreationAgent";

export type PreviewDiffItem = {
  id: string;
  title: string;
  diff?: string;
  files?: StructuredFileDiff[];
  source?: string;
  createdAt?: string | null;
  eventMessageKey?: string | null;
  relatedMessageKeys?: string[];
  eventIndex?: number;
  relatedEventIndexes?: number[];
  canonicalFile?: string | null;
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
    const text = value.trim();
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // fall through to PowerShell-style struct parser
      }
    }
    const parsed = parseStructString(value);
    if (Object.keys(parsed).length > 0) return parsed;
  }
  return {};
}

function parseJsonSafe(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

function normalizeDiffIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function computeStableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function uniqueMessageKeys(keys: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  keys.forEach((key) => {
    const trimmed = (key || "").trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    result.push(trimmed);
  });
  return result;
}

function resolveMetadataMessageKey(
  metadata: Record<string, unknown>,
  event: Record<string, unknown>,
  properties: Record<string, unknown>,
  part: Record<string, unknown>
): string {
  const rawPayload = toRecord(metadata.rawPayload);
  const rawEvent = toRecord(rawPayload.event);
  const rawEventProps = toRecord(rawEvent.properties);
  const rawPart = toRecord(rawEventProps.part);
  return (
    asText(metadata.messageKey) ||
    asText(toRecord(metadata.event).messageKey) ||
    asText(event.messageKey) ||
    asText(properties.messageKey) ||
    asText(part.messageKey) ||
    asText(rawPayload.messageKey) ||
    asText(rawEvent.messageKey) ||
    asText(rawEventProps.messageKey) ||
    asText(rawPart.messageKey)
  );
}

function resolveStableMessageKey(input: {
  message: AgentMessage;
  metadata: Record<string, unknown>;
  event: Record<string, unknown>;
  properties: Record<string, unknown>;
  part: Record<string, unknown>;
  fallbackParts: string[];
}): string {
  const direct =
    asText(input.message.messageKey) ||
    asText(input.message.id) ||
    resolveMetadataMessageKey(
      input.metadata,
      input.event,
      input.properties,
      input.part
    );
  if (direct) return direct;

  const fingerprint = [
    input.message.type,
    asText(input.message.content),
    asText(input.metadata.eventType),
    asText(input.metadata.turnId),
    asText(input.metadata.appServerMethod),
    asText(input.metadata.itemType),
    pickTimestamp(input.metadata, input.event) || "",
    ...input.fallbackParts,
    stringifySafe(input.part),
    stringifySafe(input.properties),
  ].join("|");
  return `fingerprint:${computeStableHash(fingerprint)}`;
}

function buildStableDiffId(
  source: string,
  parts: Array<string | number | null | undefined>
): string {
  const normalizedSource = normalizeDiffIdPart(source) || "diff";
  const digest = computeStableHash(
    parts
      .map((part) => {
        if (part === null || part === undefined) return "";
        return String(part).trim();
      })
      .join("|")
  );
  return `diff-${normalizedSource}-${digest}`;
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
    if (text) {
      const parsed = parseJsonSafe(text);
      const structuredFromText = asStructuredDiff(parsed);
      if (structuredFromText && structuredFromText.length > 0) {
        return structuredFromText;
      }
      if (!isEmptyDiffText(text)) return text;
    }
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

function extractCodexItem(metadata: Record<string, unknown>): Record<string, unknown> {
  return toRecord(toRecord(metadata.event).item);
}

function mapCodexFileChangeStatus(kind: string): StructuredFileDiff["status"] {
  const normalized = kind.trim().toLowerCase();
  if (normalized === "add" || normalized === "create" || normalized === "created") {
    return "added";
  }
  if (
    normalized === "delete" ||
    normalized === "deleted" ||
    normalized === "remove" ||
    normalized === "removed"
  ) {
    return "deleted";
  }
  return "modified";
}

function buildCodexFileChangeDiffs(metadata: Record<string, unknown>): StructuredFileDiff[] {
  const item = extractCodexItem(metadata);
  const metadataChanges = Array.isArray(metadata.fileChanges) ? metadata.fileChanges : [];
  const itemChanges = Array.isArray(item.changes) ? item.changes : [];
  const changes = metadataChanges.length > 0 ? metadataChanges : itemChanges;
  return changes.reduce<StructuredFileDiff[]>((acc, change) => {
    const record = toRecord(change);
    const file = asText(record.path);
    if (!file) return acc;
    acc.push({
      file,
      before: "",
      after: "",
      status: mapCodexFileChangeStatus(asText(record.kind)),
    });
    return acc;
  }, []);
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

const TOOL_DIFF_TEXT_LIMIT = 120_000;

function limitDiffText(value: string): string {
  if (value.length <= TOOL_DIFF_TEXT_LIMIT) return value;
  return value.slice(0, TOOL_DIFF_TEXT_LIMIT);
}

function countDiffLines(value: string): number {
  if (!value) return 0;
  return value.replace(/\r\n/g, "\n").split("\n").length;
}

function resolveToolFilePath(input: Record<string, unknown>, properties: Record<string, unknown>): string {
  return (
    asText(input.filePath) ||
    asText(input.path) ||
    asText(input.file) ||
    asText(input.target) ||
    asText(properties.file) ||
    asText(properties.path) ||
    asText(properties.target)
  );
}

function resolveToolStatus(toolState: Record<string, unknown>, properties: Record<string, unknown>): string {
  return (
    asText(toolState.status) ||
    asText(toolState.state) ||
    asText(properties.status) ||
    asText(properties.state)
  ).toLowerCase();
}

function shouldUseToolMutationSnapshot(status: string): boolean {
  if (!status) return true;
  return status === "completed" || status === "success" || status === "done";
}

function buildWriteEditStructuredDiff(
  toolName: string,
  toolState: Record<string, unknown>,
  input: Record<string, unknown>,
  properties: Record<string, unknown>
): StructuredFileDiff[] | null {
  const lower = toolName.toLowerCase();
  if (lower !== "write" && lower !== "edit") return null;
  const status = resolveToolStatus(toolState, properties);
  if (!shouldUseToolMutationSnapshot(status)) {
    return null;
  }

  const filePath = resolveToolFilePath(input, properties);
  if (!filePath) return null;

  const beforeRaw =
    asRawString(input.before) ||
    asRawString(input.oldString) ||
    asRawString(input.oldText);
  const afterRaw =
    asRawString(input.content) ||
    asRawString(input.after) ||
    asRawString(input.newString) ||
    asRawString(input.newText) ||
    asRawString(input.replace) ||
    asRawString(input.replacement);

  const before = limitDiffText(beforeRaw);
  const after = limitDiffText(afterRaw);
  if (!before && !after) return null;
  if (before === after) return null;

  let statusHint: StructuredFileDiff["status"];
  if (lower === "write" && !before && after) {
    statusHint = "added";
  } else if (!after && before) {
    statusHint = "deleted";
  } else {
    statusHint = "modified";
  }

  return [
    {
      file: filePath.replace(/\\+/g, "/"),
      before,
      after,
      additions: countDiffLines(after),
      deletions: countDiffLines(before),
      status: statusHint,
    },
  ];
}

function getFilename(path: string): string {
  if (!path) return "";
  const normalized = path.replace(/\\+/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

function normalizePath(path: string): string {
  return path.replace(/\\+/g, "/").replace(/^\.\/+/, "").toLowerCase();
}

function uniqueNormalizedPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  paths.forEach((path) => {
    const raw = path.trim();
    if (!raw) return;
    const normalized = normalizePath(raw);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(raw.replace(/\\+/g, "/"));
  });
  return result;
}

function pathMatches(hint: string, target: string): boolean {
  if (!hint || !target) return false;
  const hintNorm = normalizePath(hint);
  const targetNorm = normalizePath(target);
  return (
    hintNorm === targetNorm ||
    hintNorm.endsWith(`/${targetNorm}`) ||
    targetNorm.endsWith(`/${hintNorm}`)
  );
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

function extractFilePathsFromDiffText(diffText: string): string[] {
  if (!diffText.trim()) return [];
  const applyPatch = splitApplyPatchText(diffText)
    .map((block) => block.file || "")
    .filter(Boolean);
  const unified = splitUnifiedDiffText(diffText)
    .map((block) => block.file || "")
    .filter(Boolean);
  const singleApply = extractFileFromApplyPatch(diffText);
  const singleUnified = extractFileFromUnifiedDiff(diffText);
  const candidates = [
    ...applyPatch,
    ...unified,
    singleApply || "",
    singleUnified || "",
  ].filter(Boolean);
  return uniqueNormalizedPaths(candidates);
}

function collectToolFileHints(
  toolName: string,
  rawInput: unknown,
  input: Record<string, unknown>,
  output: string,
  properties: Record<string, unknown>
): string[] {
  const lower = toolName.toLowerCase();
  const directCandidates = [
    asText(input.filePath),
    asText(input.path),
    asText(input.file),
    asText(input.target),
    asText(properties.file),
    asText(properties.path),
    asText(properties.target),
  ].filter(Boolean);

  if (Array.isArray(input.files)) {
    input.files.forEach((item) => {
      if (typeof item === "string" && item.trim()) {
        directCandidates.push(item.trim());
      }
    });
  }

  if (lower !== "apply_patch") {
    return uniqueNormalizedPaths(directCandidates);
  }

  const patchCandidates: string[] = [];
  if (typeof rawInput === "string" && rawInput.trim()) {
    patchCandidates.push(rawInput);
  }
  const patchFromInput = asText(input.patch);
  if (patchFromInput) patchCandidates.push(patchFromInput);
  const diffFromInput = asText(input.diff);
  if (diffFromInput) patchCandidates.push(diffFromInput);
  if (output) patchCandidates.push(output);

  const fromPatch = patchCandidates.flatMap((text) => extractFilePathsFromDiffText(text));
  return uniqueNormalizedPaths([...directCandidates, ...fromPatch]);
}

function extractSessionDiffPaths(payload: StructuredFileDiff[] | string | null): string[] {
  if (Array.isArray(payload)) {
    return uniqueNormalizedPaths(payload.map((item) => item.file).filter(Boolean));
  }
  if (typeof payload === "string" && payload.trim()) {
    return extractFilePathsFromDiffText(payload);
  }
  return [];
}

type MutationCandidate = {
  messageIndex: number;
  messageKey: string;
  partId: string;
  toolName: string;
  fileHints: string[];
};

function upsertMutationCandidate(
  candidates: MutationCandidate[],
  byPartId: Map<string, MutationCandidate>,
  messageIndex: number,
  messageKey: string,
  partId: string,
  toolName: string,
  fileHints: string[]
) {
  const normalizedHints = uniqueNormalizedPaths(fileHints);
  if (partId && byPartId.has(partId)) {
    const existing = byPartId.get(partId)!;
    existing.messageIndex = Math.max(existing.messageIndex, messageIndex);
    existing.messageKey = messageKey || existing.messageKey;
    existing.toolName = toolName || existing.toolName;
    existing.fileHints = uniqueNormalizedPaths([...existing.fileHints, ...normalizedHints]);
    return;
  }

  const candidate: MutationCandidate = {
    messageIndex,
    messageKey,
    partId,
    toolName,
    fileHints: normalizedHints,
  };
  candidates.push(candidate);
  if (partId) {
    byPartId.set(partId, candidate);
  }
}

function pruneMutationCandidates(
  candidates: MutationCandidate[],
  byPartId: Map<string, MutationCandidate>,
  currentIndex: number,
  maxDistance = 260
) {
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const candidate = candidates[i];
    if (currentIndex - candidate.messageIndex <= maxDistance) continue;
    candidates.splice(i, 1);
    if (candidate.partId && byPartId.get(candidate.partId) === candidate) {
      byPartId.delete(candidate.partId);
    }
  }
}

function pickMutationCandidate(
  candidates: MutationCandidate[],
  sessionIndex: number,
  sessionPaths: string[]
): MutationCandidate | null {
  const recent = candidates.filter((candidate) => sessionIndex > candidate.messageIndex);
  if (recent.length === 0) return null;

  let bestCandidate: MutationCandidate | null = null;
  let bestScore = 0;
  recent.forEach((candidate) => {
    if (candidate.fileHints.length === 0 || sessionPaths.length === 0) return;
    const score = sessionPaths.reduce(
      (acc, sessionPath) =>
        acc + (candidate.fileHints.some((hint) => pathMatches(hint, sessionPath)) ? 1 : 0),
      0
    );
    if (score <= 0) return;
    if (
      !bestCandidate ||
      score > bestScore ||
      (score === bestScore && candidate.messageIndex > bestCandidate.messageIndex)
    ) {
      bestCandidate = candidate;
      bestScore = score;
    }
  });

  if (bestCandidate) return bestCandidate;
  if (sessionPaths.length === 0) {
    return recent[recent.length - 1] || null;
  }
  if (sessionPaths.length > 8) {
    return null;
  }

  return recent[recent.length - 1];
}

function inferToolNameFromContent(content: string): string {
  const text = content.trim();
  if (!text) return "";
  const bracket = text.match(/^\[Tool\]\s*([A-Za-z0-9._-]+)/i);
  if (bracket && bracket[1]) return bracket[1];
  const plain = text.match(/^Tool:\s*([A-Za-z0-9._-]+)/i);
  if (plain && plain[1]) return plain[1];
  return "";
}

function filterStructuredSessionDiff(
  files: StructuredFileDiff[],
  candidate: MutationCandidate
): StructuredFileDiff[] {
  if (candidate.fileHints.length === 0) {
    return files.length > 8 ? [] : files;
  }
  const matched = files.filter((file) =>
    candidate.fileHints.some((hint) => pathMatches(hint, file.file))
  );
  if (matched.length > 0) return matched;
  return files.length > 8 ? [] : files;
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
      const canonical = payload.files.map((file) => ({
        file: normalizePath(file.file || ""),
        before: file.before || "",
        after: file.after || "",
        status: file.status || "",
      }));
      return `structured:${JSON.stringify(canonical)}`;
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
  const { toolName, properties, part } = info;
  const { rawInput, input } = extractToolPayload(part);
  const toolOutput = asText(toRecord(part.state).output) || asText(properties.output);
  const output = resolveDiffOutput(toolName, rawInput, input, toolOutput);
  const lower = toolName.toLowerCase();

  if (lower === "apply_patch" && output && !isEmptyDiffText(output)) {
    return { kind: "text", text: output };
  }

  return { kind: "none" };
}

export function buildPreviewItems(messages: AgentMessage[]) {
  const diffItems: PreviewDiffItem[] = [];
  const seenDiffs = new Set<string>();
  const mutationCandidates: MutationCandidate[] = [];
  const mutationByPartId = new Map<string, MutationCandidate>();
  const codexTurnFilePaths = new Map<string, string[]>();
  const codexTurnLastDiffIndex = new Map<string, number>();
  const codexTurnHasDiff = new Set<string>();

  const mergeCodexTurnPath = (turnId: string, path: string) => {
    const normalizedTurnId = turnId.trim();
    const normalizedPath = path.trim();
    if (!normalizedTurnId || !normalizedPath) return;
    const existing = codexTurnFilePaths.get(normalizedTurnId) || [];
    if (existing.includes(normalizedPath)) return;
    codexTurnFilePaths.set(normalizedTurnId, [...existing, normalizedPath]);
  };

  messages.forEach((message) => {
    if (message.type !== "executor_event") return;
    const metadata = toRecord(message.metadata);
    if (asText(metadata.executor).toLowerCase() !== "codex") return;
    const item = extractCodexItem(metadata);
    const itemType =
      asText(metadata.itemType).toLowerCase() || asText(item.type).toLowerCase();
    const appServerMethod = asText(metadata.appServerMethod).toLowerCase();
    const turnId = asText(metadata.turnId);
    if (!turnId) return;

    if (appServerMethod === "turn/diff/updated") {
      codexTurnHasDiff.add(turnId);
    }

    if (itemType === "file_change" || itemType === "filechange") {
      const files = buildCodexFileChangeDiffs(metadata);
      files.forEach((file) => {
        if (file.file) mergeCodexTurnPath(turnId, file.file);
      });
      const metadataPaths = Array.isArray(metadata.filePaths)
        ? metadata.filePaths.map((value) => asText(value)).filter(Boolean)
        : [];
      metadataPaths.forEach((path) => mergeCodexTurnPath(turnId, path));
    }
  });

  messages.forEach((message, index) => {
    if (message.type === "executor_event") {
      const metadata = toRecord(message.metadata);
      if (asText(metadata.executor).toLowerCase() !== "codex") return;
      const item = extractCodexItem(metadata);
      const itemType =
        asText(metadata.itemType).toLowerCase() || asText(item.type).toLowerCase();
      const appServerMethod = asText(metadata.appServerMethod).toLowerCase();
      const turnId = asText(metadata.turnId);

      if (appServerMethod === "turn/diff/updated") {
        if (turnId) {
          codexTurnLastDiffIndex.set(turnId, index);
        }
      }
    }
  });

  messages.forEach((message, index) => {
    if (message.type === "executor_event") {
      const metadata = toRecord(message.metadata);
      if (asText(metadata.executor).toLowerCase() !== "codex") return;
      const event = toRecord(metadata.event);
      const properties = toRecord(event.properties);
      const part = toRecord(properties.part);
      const item = extractCodexItem(metadata);
      const itemType =
        asText(metadata.itemType).toLowerCase() || asText(item.type).toLowerCase();
      const appServerMethod = asText(metadata.appServerMethod).toLowerCase();
      const turnId = asText(metadata.turnId);
      const eventMessageKey = resolveStableMessageKey({
        message,
        metadata,
        event,
        properties,
        part,
        fallbackParts: [appServerMethod, turnId, itemType],
      });

      if (appServerMethod === "turn/diff/updated") {
        if (turnId && codexTurnLastDiffIndex.get(turnId) !== index) {
          return;
        }
        const diff = asText(metadata.diff);
        if (!isEmptyDiffText(diff)) {
          const turnPaths = turnId ? (codexTurnFilePaths.get(turnId) || []) : [];
          const titlePayload =
            turnPaths.length > 0
              ? turnPaths.map((file) => ({
                  file,
                  before: "",
                  after: "",
                  status: "modified" as const,
                }))
              : diff;
          const payload: DiffPayload = { kind: "text", text: diff };
          const signature = buildDiffSignature(payload);
          if (!signature || !seenDiffs.has(signature)) {
            if (signature) seenDiffs.add(signature);
            const canonicalFile =
              turnPaths.length === 1 ? normalizePath(turnPaths[0] || "") : null;
            diffItems.push({
              id: buildStableDiffId("codex.turn_diff", [
                eventMessageKey,
                turnId,
                canonicalFile || "",
                signature || "",
              ]),
              title: buildDiffTitle(titlePayload, "codex.turn_diff", diffItems.length),
              diff,
              source: "codex.turn_diff",
              createdAt: pickTimestamp(metadata, event),
              eventMessageKey,
              relatedMessageKeys: [eventMessageKey],
              eventIndex: index,
              relatedEventIndexes: [index],
              canonicalFile,
            });
          }
        }
      }

      if (itemType !== "file_change" && itemType !== "filechange") return;
      if (turnId && codexTurnHasDiff.has(turnId)) return;

      const files = buildCodexFileChangeDiffs(metadata);
      const metadataChanges = Array.isArray(metadata.fileChanges) ? metadata.fileChanges : [];
      const diffTexts = metadataChanges
        .map((change) => toRecord(change))
        .map((change) => asText(change.diff))
        .filter((value) => !isEmptyDiffText(value));

      if (files.length === 0 && diffTexts.length === 0) return;

      const latestDiffText = diffTexts.length > 0 ? diffTexts[diffTexts.length - 1] : "";
      if (latestDiffText) {
        const payload: DiffPayload = { kind: "text", text: latestDiffText };
        const signature = buildDiffSignature(payload);
        if (!signature || !seenDiffs.has(signature)) {
          if (signature) seenDiffs.add(signature);
          const titlePayload: StructuredFileDiff[] | string =
            files.length > 0 ? files : latestDiffText;
          const canonicalFile =
            files.length === 1 ? normalizePath(files[0]?.file || "") : null;
          diffItems.push({
            id: buildStableDiffId("codex.file_change", [
              eventMessageKey,
              turnId,
              canonicalFile || "",
              signature || "",
              "text",
            ]),
            title: buildDiffTitle(titlePayload, "codex.file_change", diffItems.length),
            diff: latestDiffText,
            source: "codex.file_change",
            createdAt: pickTimestamp(metadata, event),
            eventMessageKey,
            relatedMessageKeys: [eventMessageKey],
            eventIndex: index,
            relatedEventIndexes: [index],
            canonicalFile,
          });
        }
        return;
      }

      if (files.length === 0) return;

      const canonicalFile =
        files.length === 1 ? normalizePath(files[0]?.file || "") : null;
      diffItems.push({
        id: buildStableDiffId("codex.file_change", [
          eventMessageKey,
          turnId,
          canonicalFile || "",
          "structured",
        ]),
        title: buildDiffTitle(files, "codex.file_change", diffItems.length),
        files,
        source: "codex.file_change",
        createdAt: pickTimestamp(metadata, event),
        eventMessageKey,
        relatedMessageKeys: [eventMessageKey],
        eventIndex: index,
        relatedEventIndexes: [index],
        canonicalFile,
      });
      return;
    }

    if (message.type !== "opencode_event") return;
    const metadata = toRecord(message.metadata);
    const info = getOpencodeEventInfo(metadata);
    const fallbackToolName = inferToolNameFromContent(message.content || "");
    const toolName = info.toolName || fallbackToolName;
    const { eventType, properties, event, part } = info;

    const { rawInput, input } = extractToolPayload(part);
    const toolOutput = asText(toRecord(part.state).output) || asText(properties.output);
    const output = resolveDiffOutput(toolName, rawInput, input, toolOutput);
    const createdAt = pickTimestamp(metadata, event);
    const partId =
      asText(part.id) || asText(part.callID) || asText(properties.partId);
    const eventMessageKey = resolveStableMessageKey({
      message,
      metadata,
      event,
      properties,
      part,
      fallbackParts: [eventType, toolName, partId],
    });

    if (toolName) {
      const lower = toolName.toLowerCase();
      if (lower === "write" || lower === "edit" || lower === "apply_patch") {
        const fileHints = collectToolFileHints(toolName, rawInput, input, output, properties);
        upsertMutationCandidate(
          mutationCandidates,
          mutationByPartId,
          index,
          eventMessageKey,
          partId,
          lower,
          fileHints
        );
      }
    }

    if (toolName) {
      const lower = toolName.toLowerCase();
      if (lower === "write" || lower === "edit") {
        const structured = buildWriteEditStructuredDiff(lower, toRecord(part.state), input, properties);
        if (structured && structured.length > 0) {
          const payload: DiffPayload = { kind: "structured", files: structured };
          const signature = buildDiffSignature(payload);
          if (!signature || !seenDiffs.has(signature)) {
            if (signature) seenDiffs.add(signature);
            const canonicalFile =
              structured.length === 1 ? normalizePath(structured[0]?.file || "") : null;
            diffItems.push({
              id: buildStableDiffId(lower, [
                eventMessageKey,
                partId,
                canonicalFile || "",
                signature || "",
                "tool",
              ]),
              title: buildDiffTitle(structured, lower, diffItems.length),
              files: structured,
              source: lower,
              createdAt,
              eventMessageKey,
              relatedMessageKeys: [eventMessageKey],
              eventIndex: index,
              relatedEventIndexes: [index],
              canonicalFile,
            });
          }
        }
      }
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
            const canonicalFile =
              normalizePath(extractFileFromApplyPatch(block.text) || "") || null;
            diffItems.push({
              id: buildStableDiffId("apply_patch", [
                eventMessageKey,
                partId,
                blockIndex,
                canonicalFile || "",
                signature || "",
              ]),
              title,
              diff: block.text,
              source: "apply_patch",
              createdAt,
              eventMessageKey,
              relatedMessageKeys: [eventMessageKey],
              eventIndex: index,
              relatedEventIndexes: [index],
              canonicalFile,
            });
          });
        } else {
          const title = buildDiffTitle(output, "apply_patch", diffItems.length);
          const canonicalFile =
            normalizePath(extractFileFromApplyPatch(output) || "") || null;
          diffItems.push({
            id: buildStableDiffId("apply_patch", [
              eventMessageKey,
              partId,
              0,
              canonicalFile || "",
              signature || "",
            ]),
            title,
            diff: output,
            source: "apply_patch",
            createdAt,
            eventMessageKey,
            relatedMessageKeys: [eventMessageKey],
            eventIndex: index,
            relatedEventIndexes: [index],
            canonicalFile,
          });
        }
      }
    }

    if (eventType === "session.diff") {
      const payload = extractSessionDiff(metadata, info);
      if (!payload) {
        pruneMutationCandidates(mutationCandidates, mutationByPartId, index);
        return;
      }
      const sessionPaths = extractSessionDiffPaths(payload);
      const candidate = pickMutationCandidate(mutationCandidates, index, sessionPaths);
      if (!candidate) {
        pruneMutationCandidates(mutationCandidates, mutationByPartId, index);
        return;
      }

      if (Array.isArray(payload)) {
        const filteredFiles = filterStructuredSessionDiff(payload, candidate);
        if (filteredFiles.length === 0) {
          pruneMutationCandidates(mutationCandidates, mutationByPartId, index);
          return;
        }
        const diffPayload: DiffPayload = { kind: "structured", files: filteredFiles };
        const signature = buildDiffSignature(diffPayload);
        if (signature && seenDiffs.has(signature)) {
          pruneMutationCandidates(mutationCandidates, mutationByPartId, index);
          return;
        }
        if (signature) seenDiffs.add(signature);
        const title = buildDiffTitle(filteredFiles, "session.diff", diffItems.length);
        const canonicalFile =
          filteredFiles.length === 1 ? normalizePath(filteredFiles[0]?.file || "") : null;
        const relatedMessageKeys = uniqueMessageKeys([
          candidate.messageKey,
          eventMessageKey,
        ]);
        diffItems.push({
          id: buildStableDiffId("session.diff", [
            eventMessageKey,
            candidate.messageKey,
            partId,
            canonicalFile || "",
            signature || "",
            0,
          ]),
          title,
          files: filteredFiles,
          source: "session.diff",
          createdAt,
          eventMessageKey,
          relatedMessageKeys,
          eventIndex: index,
          relatedEventIndexes: [candidate.messageIndex, index],
          canonicalFile,
        });
      } else {
        const diffPayload: DiffPayload = { kind: "text", text: payload };
        const signature = buildDiffSignature(diffPayload);
        if (signature && seenDiffs.has(signature)) {
          pruneMutationCandidates(mutationCandidates, mutationByPartId, index);
          return;
        }
        if (signature) seenDiffs.add(signature);
        const blocks = splitUnifiedDiffText(payload);
        if (blocks.length > 1) {
          blocks.forEach((block, blockIndex) => {
            const title = buildDiffTitle(block.text, "session.diff", diffItems.length);
            const canonicalFile =
              normalizePath(extractFileFromUnifiedDiff(block.text) || "") || null;
            const relatedMessageKeys = uniqueMessageKeys([
              candidate.messageKey,
              eventMessageKey,
            ]);
            diffItems.push({
              id: buildStableDiffId("session.diff", [
                eventMessageKey,
                candidate.messageKey,
                partId,
                canonicalFile || "",
                signature || "",
                blockIndex,
              ]),
              title,
              diff: block.text,
              source: "session.diff",
              createdAt,
              eventMessageKey,
              relatedMessageKeys,
              eventIndex: index,
              relatedEventIndexes: [candidate.messageIndex, index],
              canonicalFile,
            });
          });
        } else {
          const title = buildDiffTitle(payload, "session.diff", diffItems.length);
          const canonicalFile =
            normalizePath(extractFileFromUnifiedDiff(payload) || "") || null;
          const relatedMessageKeys = uniqueMessageKeys([
            candidate.messageKey,
            eventMessageKey,
          ]);
          diffItems.push({
            id: buildStableDiffId("session.diff", [
              eventMessageKey,
              candidate.messageKey,
              partId,
              canonicalFile || "",
              signature || "",
              0,
            ]),
            title,
            diff: payload,
            source: "session.diff",
            createdAt,
            eventMessageKey,
            relatedMessageKeys,
            eventIndex: index,
            relatedEventIndexes: [candidate.messageIndex, index],
            canonicalFile,
          });
        }
      }
    }

    pruneMutationCandidates(mutationCandidates, mutationByPartId, index);

  });

  return { diffItems: collapseRecentCodexDiffItems(diffItems) };
}

function collapseRecentCodexDiffItems(items: PreviewDiffItem[]): PreviewDiffItem[] {
  const latestCodexIndexByFile = new Map<string, number>();

  items.forEach((item, index) => {
    const source = (item.source || "").toLowerCase();
    const canonicalFile = normalizePath(item.canonicalFile || "");
    if (!source.startsWith("codex.") || !canonicalFile) return;
    latestCodexIndexByFile.set(canonicalFile, index);
  });

  if (latestCodexIndexByFile.size === 0) return items;

  return items.filter((item, index) => {
    const source = (item.source || "").toLowerCase();
    const canonicalFile = normalizePath(item.canonicalFile || "");
    if (!source.startsWith("codex.") || !canonicalFile) return true;
    return latestCodexIndexByFile.get(canonicalFile) === index;
  });
}
