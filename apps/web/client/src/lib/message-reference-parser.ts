import type {
  TaskCreationPlatformSkill,
  TaskCreationUploadedAttachment,
} from "@/lib/task-creation-client";

const ATTACHED_LINE_REGEX = /^\[Attached:\s*(.*?)\s*->\s*(.*?)\]$/i;

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function parseAttachmentLine(line: string): TaskCreationUploadedAttachment | null {
  const match = line.match(ATTACHED_LINE_REGEX);
  if (!match) return null;
  const name = asText(match[1]);
  const path = asText(match[2]);
  if (!name && !path) return null;
  return {
    name: name || path.split("/").pop() || "",
    path: path || name,
    size: 0,
  };
}

function normalizeAttachment(
  value: unknown,
): TaskCreationUploadedAttachment | null {
  const item = toRecord(value);
  const name = asText(item.name);
  const path = asText(item.path);
  if (!name && !path) return null;
  return {
    name: name || path.split("/").pop() || "",
    path: path || name,
    size:
      typeof item.size === "number" && Number.isFinite(item.size)
        ? item.size
        : Number(String(item.size || 0)) || 0,
    mimeType: asText(item.mimeType) || undefined,
    uploadedAt: asText(item.uploadedAt) || undefined,
    attachmentKind: "uploaded_file",
  };
}

function normalizeSkill(value: unknown): TaskCreationPlatformSkill | null {
  const item = toRecord(value);
  const skillId = asText(item.skillId);
  const revisionId = asText(item.revisionId);
  const name = asText(item.name);
  if (!skillId || !revisionId || !name) return null;
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
    const key = `${item.skillId}|${item.revisionId}`;
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
