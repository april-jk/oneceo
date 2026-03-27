import { randomUUID } from 'node:crypto';
import { asText, truncate } from './altus-managed-shared';

export const TASK_ATTACHMENT_DIR = 'uploads';
export const TASK_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const TASK_ATTACHMENT_MAX_COUNT = 8;
export const TASK_ATTACHMENT_CONTEXT_CHAR_LIMIT = 12_000;
export const TASK_ATTACHMENT_TOTAL_CONTEXT_CHAR_LIMIT = 36_000;

const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'mdx',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'xml',
  'yaml',
  'yml',
  'log',
  'rtf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'pdf',
  'odt',
  'ods',
  'odp',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
  'tif',
  'tiff',
  'heic',
  'heif',
  'sql',
  'ini',
  'cfg',
  'conf',
  'toml',
  'env',
  'sh',
  'py',
  'js',
  'jsx',
  'ts',
  'tsx',
  'css',
  'scss',
  'less',
  'html',
  'htm',
]);

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/pdf',
  'application/rtf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/x-sh',
  'application/sql',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
]);

const ALLOWED_ATTACHMENT_MIME_PREFIXES = ['text/', 'image/'];

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'mdx',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'xml',
  'yaml',
  'yml',
  'log',
  'sql',
  'ini',
  'cfg',
  'conf',
  'toml',
  'env',
  'sh',
  'py',
  'js',
  'jsx',
  'ts',
  'tsx',
  'css',
  'scss',
  'less',
  'html',
  'htm',
]);

const TEXT_ATTACHMENT_MIME_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/sql',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
]);

export type TaskAttachmentUpload = {
  name: string;
  mimeType?: string;
  size: number;
  buffer: Buffer;
};

export type TaskAttachmentRecord = {
  name: string;
  path: string;
  size: number;
  mimeType?: string;
  uploadedAt: string;
};

export type TaskAttachmentContextRecord = {
  name: string;
  path: string;
  size: number;
  mimeType?: string;
  excerpt: string;
  truncated: boolean;
  extractedAt: string;
  extraction: 'utf8_text';
};

function getAttachmentExtension(input: string): string {
  const normalized = (input || '').trim().toLowerCase();
  const base = normalized.split(/[\\/]/).pop() || '';
  const dotIndex = base.lastIndexOf('.');
  if (dotIndex < 0) return '';
  return base.slice(dotIndex + 1);
}

export function sanitizeAttachmentName(input: string): string {
  const raw = input.split(/[\\/]/).pop() || 'attachment';
  const normalized = raw.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized.slice(0, 120) || 'attachment';
}

export function isAllowedAttachmentFile(input: { name: string; mimeType?: string }): boolean {
  const extension = getAttachmentExtension(input.name);
  if (extension && ALLOWED_ATTACHMENT_EXTENSIONS.has(extension)) {
    return true;
  }
  const mimeType = (input.mimeType || '').trim().toLowerCase();
  if (!mimeType) return false;
  if (ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) {
    return true;
  }
  return ALLOWED_ATTACHMENT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

function isTextAttachment(input: { name: string; mimeType?: string }): boolean {
  const extension = getAttachmentExtension(input.name);
  if (extension && TEXT_ATTACHMENT_EXTENSIONS.has(extension)) {
    return true;
  }
  const mimeType = (input.mimeType || '').trim().toLowerCase();
  if (!mimeType) return false;
  if (mimeType.startsWith('text/')) {
    return true;
  }
  return TEXT_ATTACHMENT_MIME_TYPES.has(mimeType);
}

function normalizeUtf8Text(buffer: Buffer): string {
  return buffer.toString('utf8').replace(/\u0000/g, '').trim();
}

function createStoredAttachmentPath(name: string): string {
  const safeName = sanitizeAttachmentName(name);
  return `${TASK_ATTACHMENT_DIR}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
}

export function buildAttachmentReferenceLines(attachments: TaskAttachmentRecord[]): string[] {
  return attachments.map((item) => `[Attached: ${item.name} -> ${item.path}]`);
}

export function appendAttachmentReferencesToContent(
  content: string,
  attachments: TaskAttachmentRecord[]
): string {
  const normalizedContent = asText(content);
  if (attachments.length === 0) {
    return normalizedContent;
  }
  const referenceBlock = buildAttachmentReferenceLines(attachments).join('\n');
  return normalizedContent ? `${normalizedContent}\n\n${referenceBlock}` : referenceBlock;
}

export function buildAttachmentContextRecords(
  attachments: TaskAttachmentRecord[],
  uploads: TaskAttachmentUpload[]
): TaskAttachmentContextRecord[] {
  const results: TaskAttachmentContextRecord[] = [];
  let totalChars = 0;

  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    const upload = uploads[index];
    if (!attachment || !upload || !isTextAttachment(upload)) {
      continue;
    }
    const rawText = normalizeUtf8Text(upload.buffer);
    if (!rawText) {
      continue;
    }

    const remainingChars = TASK_ATTACHMENT_TOTAL_CONTEXT_CHAR_LIMIT - totalChars;
    if (remainingChars <= 0) {
      break;
    }

    const limit = Math.min(TASK_ATTACHMENT_CONTEXT_CHAR_LIMIT, remainingChars);
    const excerpt = truncate(rawText, limit).trim();
    if (!excerpt) {
      continue;
    }

    results.push({
      name: attachment.name,
      path: attachment.path,
      size: attachment.size,
      mimeType: attachment.mimeType,
      excerpt,
      truncated: excerpt.length < rawText.length,
      extractedAt: new Date().toISOString(),
      extraction: 'utf8_text',
    });
    totalChars += excerpt.length;
  }

  return results;
}

export function buildAttachmentContextPrompt(contexts: TaskAttachmentContextRecord[]): string {
  if (contexts.length === 0) return '';
  const blocks = contexts.map((item) => {
    const suffix = item.truncated ? '\n...[truncated attachment excerpt]' : '';
    return [
      `Attachment: ${item.name}`,
      `Path: ${item.path}`,
      `Mime: ${item.mimeType || 'application/octet-stream'}`,
      'Excerpt:',
      `${item.excerpt}${suffix}`,
    ].join('\n');
  });
  return [
    'The session includes uploaded attachments. Use the workspace path as the source of truth.',
    'When an attachment excerpt is included below, treat it as a convenience preview and re-open the file in the workspace before making risky edits.',
    '',
    ...blocks,
  ].join('\n\n');
}

export function normalizeAttachmentUpload(input: TaskAttachmentUpload): TaskAttachmentUpload {
  const name = asText(input.name) || 'attachment';
  const mimeType = asText(input.mimeType) || 'application/octet-stream';
  if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
    throw new Error(`附件 ${name} 内容为空`);
  }
  if (input.buffer.length > TASK_ATTACHMENT_MAX_BYTES) {
    throw new Error(`附件 ${name} 超过 10 MB 限制`);
  }
  if (!isAllowedAttachmentFile({ name, mimeType })) {
    throw new Error(`附件 ${name} 格式不支持，仅允许文本、文档和图片类附件`);
  }
  return {
    name,
    mimeType,
    size: input.buffer.length,
    buffer: input.buffer,
  };
}

export function normalizeAttachmentUploads(inputs: TaskAttachmentUpload[]): TaskAttachmentUpload[] {
  if (inputs.length > TASK_ATTACHMENT_MAX_COUNT) {
    throw new Error(`最多只能添加 ${TASK_ATTACHMENT_MAX_COUNT} 个附件`);
  }
  return inputs.map((item) => normalizeAttachmentUpload(item));
}

export function createStoredAttachmentRecords(inputs: TaskAttachmentUpload[]): TaskAttachmentRecord[] {
  const uploadedAt = new Date().toISOString();
  return inputs.map((item) => ({
    name: item.name,
    path: createStoredAttachmentPath(item.name),
    size: item.size,
    mimeType: item.mimeType,
    uploadedAt,
  }));
}
