export const MAX_ATTACHMENT_COUNT = 8;
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const DEFAULT_ATTACHMENT_PROMPT = "请查看我添加的附件，并基于附件内容继续处理。";

export type PendingAttachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  file: File;
};

export type UploadedTaskAttachment = {
  name: string;
  path: string;
  size: number;
  mimeType?: string;
  uploadedAt?: string;
};

let pendingDraftFiles: File[] = [];

function buildAttachmentId(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
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
  const display = value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1);
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
    if (file.size > MAX_ATTACHMENT_SIZE) {
      rejected.push(`${file.name} 超过 10 MB 限制`);
      continue;
    }
    if (next.length >= MAX_ATTACHMENT_COUNT) {
      rejected.push(`最多只能添加 ${MAX_ATTACHMENT_COUNT} 个附件`);
      break;
    }
    next.push({
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

export function appendAttachmentsToPrompt(
  text: string,
  uploaded: UploadedTaskAttachment[]
): string {
  if (!uploaded.length) return text;
  const lines = uploaded.map((item) => `- ${item.path}${item.name ? ` (${item.name})` : ""}`);
  return `${text}\n\n已添加以下附件，可直接在工作区中访问：\n${lines.join("\n")}`;
}

export function stashPendingDraftAttachments(files: File[]) {
  pendingDraftFiles = [...files];
}

export function consumePendingDraftAttachments(): File[] {
  const result = [...pendingDraftFiles];
  pendingDraftFiles = [];
  return result;
}
