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

export type PendingAttachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  file: File;
  attachmentKind?: "uploaded_file" | "inline_skill";
  inlineContent?: string;
  templateId?: string;
};

export type UploadedTaskAttachment = {
  name: string;
  path: string;
  size: number;
  mimeType?: string;
  uploadedAt?: string;
  attachmentKind?: "uploaded_file" | "inline_skill";
  inlineContent?: string;
  templateId?: string;
};

type SkillAttachmentFileMeta = {
  templateId: string;
  templateName: string;
  content: string;
};

const SKILL_ATTACHMENT_META_KEY = "__oneceoSkillAttachmentMeta";

let pendingDraftFiles: File[] = [];

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
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function readSkillAttachmentFileMeta(file: File): SkillAttachmentFileMeta | null {
  const raw = (file as File & {
    [SKILL_ATTACHMENT_META_KEY]?: SkillAttachmentFileMeta;
  })[SKILL_ATTACHMENT_META_KEY];
  if (!raw || typeof raw !== "object") return null;
  const templateId =
    typeof raw.templateId === "string" ? raw.templateId.trim() : "";
  const templateName =
    typeof raw.templateName === "string" ? raw.templateName.trim() : "";
  const content = typeof raw.content === "string" ? raw.content : "";
  if (!templateId || !templateName || !content) return null;
  return {
    templateId,
    templateName,
    content,
  };
}

function getAttachmentExtension(filename: string): string {
  const normalized = (filename || "").trim().toLowerCase();
  const base = normalized.split(/[\\/]/).pop() || "";
  const dotIndex = base.lastIndexOf(".");
  if (dotIndex < 0) return "";
  return base.slice(dotIndex + 1);
}

export function tagSkillAttachmentFile(
  file: File,
  input: {
    templateId: string;
    templateName: string;
    content: string;
  }
): File {
  (file as File & {
    [SKILL_ATTACHMENT_META_KEY]?: SkillAttachmentFileMeta;
  })[SKILL_ATTACHMENT_META_KEY] = {
    templateId: input.templateId.trim(),
    templateName: input.templateName.trim(),
    content: input.content,
  };
  return file;
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
  const existing = new Set(current.map((item) => item.id));

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
    if (next.length >= MAX_ATTACHMENT_COUNT) {
      rejected.push(`最多只能添加 ${MAX_ATTACHMENT_COUNT} 个附件`);
      break;
    }
    const skillMeta = readSkillAttachmentFileMeta(file);
    next.push({
      id,
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      file,
      attachmentKind: skillMeta ? "inline_skill" : "uploaded_file",
      inlineContent: skillMeta?.content,
      templateId: skillMeta?.templateId,
    });
    existing.add(id);
  }

  return { attachments: next, rejected };
}

export function partitionPendingAttachments(current: PendingAttachment[]): {
  uploadableAttachments: PendingAttachment[];
  inlinePromptAttachments: UploadedTaskAttachment[];
} {
  const uploadableAttachments: PendingAttachment[] = [];
  const inlinePromptAttachments: UploadedTaskAttachment[] = [];

  for (const item of current) {
    if (item.attachmentKind === "inline_skill" && item.inlineContent) {
      inlinePromptAttachments.push({
        name: item.name,
        path: `inline-skill:${item.templateId || item.id}`,
        size: item.size,
        mimeType: item.type || "text/markdown",
        attachmentKind: "inline_skill",
        inlineContent: item.inlineContent,
        templateId: item.templateId,
      });
      continue;
    }
    uploadableAttachments.push(item);
  }

  return {
    uploadableAttachments,
    inlinePromptAttachments,
  };
}

export function appendAttachmentsToPrompt(
  text: string,
  attachments: UploadedTaskAttachment[]
): string {
  if (!attachments.length) return text;

  const sections = [text];
  const workspaceAttachments = attachments.filter((item) => !item.inlineContent);
  const inlineSkillAttachments = attachments.filter((item) => item.inlineContent);

  if (workspaceAttachments.length > 0) {
    const lines = workspaceAttachments.map(
      (item) => `- ${item.path}${item.name ? ` (${item.name})` : ""}`
    );
    sections.push(
      `已添加以下附件，可直接在工作区中访问：\n${lines.join("\n")}`
    );
  }

  if (inlineSkillAttachments.length > 0) {
    const blocks = inlineSkillAttachments.map((item) => {
      const title = item.name || item.templateId || "Skill Brief";
      return [`### ${title}`, item.inlineContent || ""].join("\n\n");
    });
    sections.push(
      [
        "以下 skill 说明已经直接附加到当前消息，请直接遵循这些说明执行，不要再尝试从工作区或 `.attachments` 中读取这些 skill 文件：",
        ...blocks,
      ].join("\n\n")
    );
  }

  return sections.filter(Boolean).join("\n\n");
}

export function stashPendingDraftAttachments(files: File[]) {
  pendingDraftFiles = [...files];
}

export function consumePendingDraftAttachments(): File[] {
  const result = [...pendingDraftFiles];
  pendingDraftFiles = [];
  return result;
}
