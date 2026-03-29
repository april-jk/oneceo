import type {
  TaskCreationPlatformSkill,
  TaskCreationUploadedAttachment,
} from "@/lib/task-creation-client";

export const MAX_ATTACHMENT_COUNT = 8;
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const DEFAULT_ATTACHMENT_PROMPT =
  "请查看我添加的附件，并基于附件内容继续处理。";
export const ATTACHMENT_ACCEPT = [
  ".txt",
  ".md",
  ".markdown",
  ".mdx",
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".xml",
  ".yaml",
  ".yml",
  ".log",
  ".rtf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".pdf",
  ".odt",
  ".ods",
  ".odp",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
  ".sql",
  ".ini",
  ".cfg",
  ".conf",
  ".toml",
  ".env",
  ".sh",
  ".py",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".htm",
].join(",");

export type PendingUploadedAttachment = {
  kind: "file";
  id: string;
  name: string;
  size: number;
  type: string;
  file: File;
};

export type PendingPlatformSkill = TaskCreationPlatformSkill & {
  kind: "skill";
  id: string;
};

export type PendingAttachment = PendingUploadedAttachment | PendingPlatformSkill;

let pendingDraftAttachments: PendingAttachment[] = [];

const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "mdx",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "xml",
  "yaml",
  "yml",
  "log",
  "rtf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "pdf",
  "odt",
  "ods",
  "odp",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "tif",
  "tiff",
  "heic",
  "heif",
  "sql",
  "ini",
  "cfg",
  "conf",
  "toml",
  "env",
  "sh",
  "py",
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "scss",
  "less",
  "html",
  "htm",
]);

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/pdf",
  "application/rtf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/x-sh",
  "application/sql",
]);

const ALLOWED_ATTACHMENT_MIME_PREFIXES = ["text/", "image/"];

function buildAttachmentId(file: File) {
  return `file:${file.name}:${file.size}:${file.lastModified}`;
}

function buildSkillId(skill: TaskCreationPlatformSkill) {
  return `skill:${skill.skillId}:${skill.revisionId}`;
}

function getAttachmentExtension(filename: string): string {
  const normalized = (filename || "").trim().toLowerCase();
  const base = normalized.split(/[\\/]/).pop() || "";
  const dotIndex = base.lastIndexOf(".");
  if (dotIndex < 0) return "";
  return base.slice(dotIndex + 1);
}

export function isSupportedAttachmentFile(
  file: Pick<File, "name" | "type">
): boolean {
  const extension = getAttachmentExtension(file.name);
  if (extension && ALLOWED_ATTACHMENT_EXTENSIONS.has(extension)) {
    return true;
  }
  const mimeType = (file.type || "").trim().toLowerCase();
  if (!mimeType) return false;
  if (ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) {
    return true;
  }
  return ALLOWED_ATTACHMENT_MIME_PREFIXES.some((prefix) =>
    mimeType.startsWith(prefix)
  );
}

export function getUnsupportedAttachmentMessage(filename: string): string {
  return `${filename} 格式不支持，仅允许文本、文档和图片类附件`;
}

export function formatAttachmentSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const display =
    value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${display} ${units[unitIndex]}`;
}

export function mergePendingAttachments(
  current: PendingAttachment[],
  incoming: File[]
): { attachments: PendingAttachment[]; rejected: string[] } {
  const next = [...current];
  const rejected: string[] = [];
  const existing = new Set(
    current
      .filter((item): item is PendingUploadedAttachment => item.kind === "file")
      .map((item) => item.id)
  );

  for (const file of incoming) {
    const id = buildAttachmentId(file);
    if (existing.has(id)) continue;
    if (!isSupportedAttachmentFile(file)) {
      rejected.push(getUnsupportedAttachmentMessage(file.name));
      continue;
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      rejected.push(`${file.name} 超过 10 MB 限制`);
      continue;
    }
    if (next.filter((item) => item.kind === "file").length >= MAX_ATTACHMENT_COUNT) {
      rejected.push(`最多只能添加 ${MAX_ATTACHMENT_COUNT} 个附件`);
      break;
    }
    next.push({
      kind: "file",
      id,
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      file,
    });
    existing.add(id);
  }

  return { attachments: next, rejected };
}

export function mergePendingPlatformSkills(
  current: PendingAttachment[],
  incoming: TaskCreationPlatformSkill[]
): PendingAttachment[] {
  const merged = [...current];
  const existing = new Set(
    current
      .filter((item): item is PendingPlatformSkill => item.kind === "skill")
      .map((item) => item.id)
  );

  for (const skill of incoming) {
    const id = buildSkillId(skill);
    if (existing.has(id)) continue;
    merged.push({
      kind: "skill",
      id,
      ...skill,
    });
    existing.add(id);
  }

  return merged;
}

export function partitionPendingAttachments(current: PendingAttachment[]): {
  uploadableAttachments: PendingUploadedAttachment[];
  selectedSkills: TaskCreationPlatformSkill[];
} {
  const uploadableAttachments: PendingUploadedAttachment[] = [];
  const selectedSkills: TaskCreationPlatformSkill[] = [];

  for (const item of current) {
    if (item.kind === "skill") {
      selectedSkills.push({
        skillId: item.skillId,
        revisionId: item.revisionId,
        slug: item.slug,
        name: item.name,
        description: item.description,
        category: item.category,
        revisionNumber: item.revisionNumber,
        resourceSummary: item.resourceSummary,
      });
      continue;
    }
    uploadableAttachments.push(item);
  }

  return {
    uploadableAttachments,
    selectedSkills,
  };
}

export function appendAttachmentsToPrompt(
  text: string,
  attachments: TaskCreationUploadedAttachment[]
): string {
  if (!attachments.length) return text;

  const lines = attachments.map(
    (item) => `- ${item.path}${item.name ? ` (${item.name})` : ""}`
  );
  return [text, `已添加以下附件，可直接在工作区中访问：\n${lines.join("\n")}`]
    .filter(Boolean)
    .join("\n\n");
}

export function stashPendingDraftAttachments(attachments: PendingAttachment[]) {
  pendingDraftAttachments = [...attachments];
}

export function consumePendingDraftAttachments(): PendingAttachment[] {
  const result = [...pendingDraftAttachments];
  pendingDraftAttachments = [];
  return result;
}
