import type {
  TaskCreationPlatformSkill,
  TaskCreationUploadedAttachment,
} from "@/lib/task-creation-client";

const ATTACHED_LINE_REGEX = /^\[Attached:\s*(.*?)\s*->\s*(.*?)\]$/i;
const MOJIBAKE_HINT_REGEX = /[Ãâåçéèêëìíîïðñòóôõöøùúûüýþÿ]/;

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function parseAttachmentLine(line: string): TaskCreationUploadedAttachment | null {
  const match = line.match(ATTACHED_LINE_REGEX);
  if (!match) return null;
  const name = normalizeAttachmentName(asText(match[1]), asText(match[2]));
  const path = asText(match[2]);
  if (!name && !path) return null;
  return {
    name: name || extractReadableNameFromPath(path),
    path: path || name,
    size: Number.NaN,
  };
}

function extractReadableNameFromPath(path: string): string {
  const base = asText(path).split("/").pop() || "";
  if (!base) return "";
  return base.replace(/^\d{10,}-[a-f0-9]{6,}-/i, "");
}

function looksLikeMojibake(value: string): boolean {
  if (!value) return false;
  if (/[\u4e00-\u9fff]/.test(value)) return false;
  return MOJIBAKE_HINT_REGEX.test(value);
}

function decodeUtf8Mojibake(value: string): string {
  try {
    const bytes = Uint8Array.from(value, (char) => char.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
    return decoded || value;
  } catch {
    return value;
  }
}

function normalizeAttachmentName(name: string, path: string): string {
  const trimmed = asText(name);
  if (!trimmed) return extractReadableNameFromPath(path);
  const decoded = looksLikeMojibake(trimmed) ? decodeUtf8Mojibake(trimmed) : trimmed;
  if (decoded && !looksLikeMojibake(decoded)) {
    return decoded;
  }
  const fallback = extractReadableNameFromPath(path);
  return fallback || decoded || trimmed;
}

function normalizeAttachment(
  value: unknown,
): TaskCreationUploadedAttachment | null {
  const item = toRecord(value);
  const path = asText(item.path);
  const name = normalizeAttachmentName(asText(item.name), path);
  if (!name && !path) return null;
  const hasSize = Object.prototype.hasOwnProperty.call(item, "size");
  const parsedSize =
    typeof item.size === "number" && Number.isFinite(item.size)
      ? item.size
      : Number(String(item.size || ""));
  return {
    name: name || extractReadableNameFromPath(path),
    path: path || name,
    size: hasSize && Number.isFinite(parsedSize) ? parsedSize : Number.NaN,
    mimeType: asText(item.mimeType) || undefined,
    uploadedAt: asText(item.uploadedAt) || undefined,
    attachmentKind: "uploaded_file",
  };
}

function normalizeSkill(value: unknown): TaskCreationPlatformSkill | null {
  if (typeof value === "string") {
    const name = asText(value);
    if (!name) return null;
    const fallbackId = `legacy:${name}`;
    return {
      sourceType: "platform",
      skillId: fallbackId,
      revisionId: fallbackId,
      slug: name.toLowerCase().replace(/[^a-z0-9-_]+/g, "-"),
      name,
      description: "",
      category: "general",
      revisionNumber: null,
      resourceSummary: null,
    };
  }

  const item = toRecord(value);
  const skillId =
    asText(item.skillId) ||
    asText(item.skill_id) ||
    asText(item.id) ||
    asText(item.slug);
  const revisionId =
    asText(item.revisionId) ||
    asText(item.revision_id) ||
    asText(item.publishedRevisionId) ||
    skillId;
  const name =
    asText(item.name) ||
    asText(item.title) ||
    asText(item.displayName) ||
    asText(item.slug) ||
    skillId;
  if (!skillId || !name) return null;
  return {
    sourceType: asText(item.sourceType) === "custom" ? "custom" : "platform",
    skillId,
    revisionId,
    slug: asText(item.slug),
    name,
    description: asText(item.description),
    category: asText(item.category),
    revisionNumber:
      typeof item.revisionNumber === "number" && Number.isFinite(item.revisionNumber)
        ? item.revisionNumber
        : item.revisionNumber === null
          ? null
          : Number(String(item.revisionNumber || "")) || null,
    resourceSummary: null,
  };
}

function dedupeAttachments(
  attachments: TaskCreationUploadedAttachment[],
): TaskCreationUploadedAttachment[] {
  const seen = new Set<string>();
  const result: TaskCreationUploadedAttachment[] = [];
  for (const item of attachments) {
    const key = `${asText(item.path)}|${asText(item.name)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function dedupeSkills(skills: TaskCreationPlatformSkill[]): TaskCreationPlatformSkill[] {
  const seen = new Set<string>();
  const result: TaskCreationPlatformSkill[] = [];
  for (const item of skills) {
    const key = `${asText(item.skillId)}|${asText(item.revisionId) || asText(item.skillId)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function parseAttachmentReferencesFromText(
  text: string,
): TaskCreationUploadedAttachment[] {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const items: TaskCreationUploadedAttachment[] = [];
  for (const line of lines) {
    const parsed = parseAttachmentLine(line.trim());
    if (parsed) {
      items.push(parsed);
    }
  }
  return dedupeAttachments(items);
}

export function stripAttachmentReferencesFromText(text: string): string {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const kept = lines.filter((line) => !ATTACHED_LINE_REGEX.test(line.trim()));
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function resolveUserMessageReferences(input: {
  content: string;
  metadata: unknown;
}): {
  text: string;
  attachments: TaskCreationUploadedAttachment[];
  skills: TaskCreationPlatformSkill[];
} {
  const record = toRecord(input.metadata);
  const fallbackContent = String(input.content || "");
  const originalInput = asText(record.originalInput);
  const baseText = originalInput || fallbackContent;

  const metadataAttachments = (
    Array.isArray(record.attachments) ? record.attachments : []
  )
    .map(normalizeAttachment)
    .filter((item): item is TaskCreationUploadedAttachment => Boolean(item));
  const markerAttachments = parseAttachmentReferencesFromText(fallbackContent);

  const metadataSkills = (
    Array.isArray(record.skills) ? record.skills : []
  )
    .map(normalizeSkill)
    .filter((item): item is TaskCreationPlatformSkill => Boolean(item));
  const managedSkills = (
    Array.isArray(record.managedSkillContext) ? record.managedSkillContext : []
  )
    .map(normalizeSkill)
    .filter((item): item is TaskCreationPlatformSkill => Boolean(item));

  return {
    text: stripAttachmentReferencesFromText(baseText),
    attachments: dedupeAttachments([...metadataAttachments, ...markerAttachments]),
    skills: dedupeSkills([...metadataSkills, ...managedSkills]),
  };
}
