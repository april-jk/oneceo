import { createHash } from 'node:crypto';

export type SkillImportFileInput = {
  relativePath: string;
  content: string;
};

export type SkillImportPreview = {
  rootFolderName: string;
  slug: string;
  name: string;
  discoveryDescription: string;
  activationSummary: string;
  entry: {
    entryName: string;
    entryDescription: string;
    bodyMarkdown: string;
  };
  files: Array<{
    relativePath: string;
    nodeType: 'file';
    resourceKind: 'reference' | 'template' | 'example' | 'script';
    storageTarget: 'database' | 'object_storage';
    processingState: 'pending';
    sizeBytes: number;
  }>;
  resources: Array<{
    resourceKey: string;
    resourcePath: string;
    resourceKind: 'reference' | 'template' | 'example' | 'script';
    contentStorage?: 'database' | 'object_storage';
    mimeType?: string;
    storagePath?: string;
    storageLocatorJson?: Record<string, unknown> | null;
    title: string;
    summary: string;
    contentFormat: 'markdown' | 'text' | 'json';
    contentMode: 'inline' | 'chunked';
    fullTextHash: string;
    contentSize: number;
    chunks: Array<{
      chunkIndex: number;
      chunkRole: 'summary' | 'body';
      chunkSummary: string;
      contentText: string;
      tokenEstimate: number;
    }>;
  }>;
  warnings: string[];
};

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSlug(value: string) {
  return asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizePath(value: string) {
  const normalized = asText(value).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    throw new Error('导入文件路径非法');
  }
  return normalized;
}

function inferResourceKind(path: string): 'reference' | 'template' | 'example' | 'script' {
  if (path.startsWith('templates/')) return 'template';
  if (path.startsWith('examples/')) return 'example';
  if (path.startsWith('scripts/')) return 'script';
  return 'reference';
}

function inferContentFormat(path: string): 'markdown' | 'text' | 'json' {
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md') || path.endsWith('.markdown') || path === 'SKILL.md') return 'markdown';
  return 'text';
}

function inferStorageTarget(path: string): 'database' | 'object_storage' {
  const normalized = asText(path).toLowerCase();
  if (
    normalized.endsWith('.md') ||
    normalized.endsWith('.markdown') ||
    normalized.endsWith('.txt') ||
    normalized.endsWith('.rst') ||
    normalized.endsWith('.adoc')
  ) {
    return 'database';
  }
  return 'object_storage';
}

function summarizeText(value: string, limit = 80) {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit)}...`;
}

function tokenEstimate(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}

function splitChunks(content: string) {
  const normalized = content.trim();
  if (normalized.length <= 2400) {
    return [
      {
        chunkIndex: 0,
        chunkRole: 'body' as const,
        chunkSummary: summarizeText(normalized, 120),
        contentText: normalized,
        tokenEstimate: tokenEstimate(normalized),
      },
    ];
  }

  const chunks: Array<{
    chunkIndex: number;
    chunkRole: 'summary' | 'body';
    chunkSummary: string;
    contentText: string;
    tokenEstimate: number;
  }> = [];
  chunks.push({
    chunkIndex: 0,
    chunkRole: 'summary',
    chunkSummary: summarizeText(normalized, 120),
    contentText: normalized.slice(0, 600),
    tokenEstimate: tokenEstimate(normalized.slice(0, 600)),
  });

  let index = 1;
  for (let offset = 0; offset < normalized.length; offset += 2400) {
    const slice = normalized.slice(offset, offset + 2400);
    chunks.push({
      chunkIndex: index,
      chunkRole: 'body',
      chunkSummary: summarizeText(slice, 120),
      contentText: slice,
      tokenEstimate: tokenEstimate(slice),
    });
    index += 1;
  }
  return chunks;
}

function parseFrontmatter(content: string) {
  const trimmed = content.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith('---\n')) {
    return {
      frontmatter: {} as Record<string, string>,
      body: trimmed.trim(),
    };
  }
  const endIndex = trimmed.indexOf('\n---\n', 4);
  if (endIndex < 0) {
    return {
      frontmatter: {} as Record<string, string>,
      body: trimmed.trim(),
    };
  }
  const header = trimmed.slice(4, endIndex).split('\n');
  const frontmatter: Record<string, string> = {};
  for (const line of header) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key) continue;
    frontmatter[key] = value;
  }
  return {
    frontmatter,
    body: trimmed.slice(endIndex + 5).trim(),
  };
}

export class PlatformSkillImportService {
  parseFolderImport(input: {
    rootFolderName?: string;
    files: SkillImportFileInput[];
  }): SkillImportPreview {
    const rootFolderName = asText(input.rootFolderName) || 'imported-skill';
    const inputFiles = Array.isArray(input.files) ? input.files : [];
    const normalizedFiles = inputFiles.map((item) => ({
      relativePath: normalizePath(item.relativePath),
      content: String(item.content ?? ''),
    }));

    const skillFile = normalizedFiles.find((item) => item.relativePath === 'SKILL.md');
    if (!skillFile) {
      throw new Error('导入文件夹缺少 SKILL.md');
    }

    const warnings: string[] = [];
    const parsedSkill = parseFrontmatter(skillFile.content);
    const entryName = asText(parsedSkill.frontmatter.name) || rootFolderName;
    const entryDescription = asText(parsedSkill.frontmatter.description);
    const slug = normalizeSlug(entryName || rootFolderName);
    if (!slug) {
      throw new Error('无法从导入内容解析有效 slug');
    }

    const bodyMarkdown = parsedSkill.body;
    if (!bodyMarkdown) {
      throw new Error('SKILL.md 正文不能为空');
    }

    const nonEntryFiles = normalizedFiles.filter((item) => item.relativePath !== 'SKILL.md');
    const fileNodes = nonEntryFiles.map((item) => ({
      relativePath: item.relativePath,
      nodeType: 'file' as const,
      resourceKind: inferResourceKind(item.relativePath),
      storageTarget: inferStorageTarget(item.relativePath),
      processingState: 'pending' as const,
      sizeBytes: Buffer.byteLength(item.content, 'utf8'),
    }));

    const resources = nonEntryFiles.map((item, index) => {
        const resourceKind = inferResourceKind(item.relativePath);
        const contentFormat = inferContentFormat(item.relativePath);
        const chunks = splitChunks(item.content);
        const title = item.relativePath.split('/').pop() || item.relativePath;
        const summary = summarizeText(item.content, 120);
        if (resourceKind === 'script') {
          warnings.push(`脚本资源 ${item.relativePath} 将存入对象存储，运行时按需下载到 sandbox`);
        }
        return {
          resourceKey: `${resourceKind}_${index + 1}_${normalizeSlug(title.replace(/\.[^.]+$/, ''))}`,
          resourcePath: item.relativePath,
          resourceKind,
          title,
          summary,
          contentFormat,
          contentMode: item.content.length > 2400 ? ('chunked' as const) : ('inline' as const),
          fullTextHash: createHash('sha256').update(item.content).digest('hex'),
          contentSize: Buffer.byteLength(item.content, 'utf8'),
          chunks,
        };
      });

    return {
      rootFolderName,
      slug,
      name: entryName,
      discoveryDescription: entryDescription || summarizeText(bodyMarkdown, 120),
      activationSummary: summarizeText(bodyMarkdown, 180),
      entry: {
        entryName,
        entryDescription,
        bodyMarkdown,
      },
      files: fileNodes,
      resources,
      warnings,
    };
  }
}

export const platformSkillImportService = new PlatformSkillImportService();
