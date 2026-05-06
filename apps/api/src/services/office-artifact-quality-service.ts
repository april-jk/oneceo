import { inflateRawSync } from 'node:zlib';
import path from 'node:path';

export type OfficeArtifactKind = 'docx' | 'xlsx';

export type OfficeManifestStatus = 'found' | 'missing' | 'invalid' | 'not_required';

export type OfficeArtifactQualityReport = {
  kind: OfficeArtifactKind;
  artifactPath: string;
  manifestPath?: string;
  passed: boolean;
  errors: string[];
  warnings: string[];
  metrics: Record<string, number | string | boolean>;
  manifestStatus: OfficeManifestStatus;
};

type ZipEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

type ValidateOfficeArtifactInput = {
  kind: OfficeArtifactKind;
  artifactPath: string;
  bytes: Buffer;
  manifestPath?: string;
  manifestBytes?: Buffer | null;
  requireManifest?: boolean;
};

const MIN_OFFICE_FILE_BYTES = 512;
const PLACEHOLDER_PATTERN = /\b(TODO|TBD)\b|lorem ipsum|示例文本|待补充|占位符/i;
const URL_PATTERN = /https?:\/\/[^\s<>"')]+/gi;
const DOCX_COMPACT_ARCHETYPES = new Set(['meeting_memo', 'external_statement']);
const XLSX_LIGHTWEIGHT_ARCHETYPES = new Set(['input_form']);
const XLSX_STANDARD_ARCHETYPES = new Set(['learning_plan', 'data_summary']);

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripXmlTags(value: string): string {
  return decodeXmlText(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  const signature = 0x06054b50;
  const minOffset = Math.max(0, bytes.length - 0xffff - 22);
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === signature) return offset;
  }
  return -1;
}

function readZipEntries(bytes: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(bytes);
  if (eocdOffset < 0) {
    throw new Error('zip_eocd_missing');
  }
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = bytes.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('zip_central_directory_invalid');
    }
    const compressionMethod = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const fileNameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localHeaderOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');
    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function extractZipEntry(bytes: Buffer, entries: ZipEntry[], entryName: string): Buffer | null {
  const entry = entries.find((item) => item.name === entryName);
  if (!entry) return null;
  const offset = entry.localHeaderOffset;
  if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`zip_local_header_invalid:${entryName}`);
  }
  const fileNameLength = bytes.readUInt16LE(offset + 26);
  const extraLength = bytes.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return Buffer.from(compressed);
  if (entry.compressionMethod === 8) return inflateRawSync(compressed);
  throw new Error(`zip_compression_unsupported:${entry.compressionMethod}:${entryName}`);
}

function parseManifest(input: { bytes?: Buffer | null; required: boolean }) {
  if (!input.bytes) {
    return {
      status: input.required ? 'missing' as const : 'not_required' as const,
      manifest: null as Record<string, unknown> | null,
    };
  }
  try {
    const parsed = JSON.parse(input.bytes.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { status: 'invalid' as const, manifest: null };
    }
    return { status: 'found' as const, manifest: parsed as Record<string, unknown> };
  } catch {
    return { status: 'invalid' as const, manifest: null };
  }
}

function addManifestErrors(report: OfficeArtifactQualityReport, required: boolean) {
  if (!required) return;
  if (report.manifestStatus === 'missing') {
    report.errors.push('manifest_missing');
  } else if (report.manifestStatus === 'invalid') {
    report.errors.push('manifest_invalid');
  }
}

function resolveDocxThresholds(manifest: Record<string, unknown> | null) {
  const archetype = asText(manifest?.contentArchetype);
  if (DOCX_COMPACT_ARCHETYPES.has(archetype)) {
    return {
      minParagraphCount: 2,
      minCharacterCount: 20,
      minHeadingLikeParagraphCount: 1,
    };
  }
  if (archetype) {
    return {
      minParagraphCount: 3,
      minCharacterCount: 120,
      minHeadingLikeParagraphCount: 2,
    };
  }
  return {
    minParagraphCount: 2,
    minCharacterCount: 60,
    minHeadingLikeParagraphCount: 1,
  };
}

function resolveXlsxMinimumEffectiveCellCount(manifest: Record<string, unknown> | null) {
  const archetype = asText(manifest?.contentArchetype);
  if (XLSX_LIGHTWEIGHT_ARCHETYPES.has(archetype)) return 2;
  if (XLSX_STANDARD_ARCHETYPES.has(archetype)) return 4;
  if (archetype) return 6;
  return 4;
}

function validateDocx(input: ValidateOfficeArtifactInput): OfficeArtifactQualityReport {
  const required = input.requireManifest !== false;
  const { status, manifest } = parseManifest({ bytes: input.manifestBytes, required });
  const report: OfficeArtifactQualityReport = {
    kind: 'docx',
    artifactPath: input.artifactPath,
    manifestPath: input.manifestPath,
    passed: false,
    errors: [],
    warnings: [],
    metrics: {},
    manifestStatus: status,
  };
  addManifestErrors(report, required);

  if (!input.artifactPath.toLowerCase().endsWith('.docx')) {
    report.errors.push('docx_extension_invalid');
  }
  if (input.bytes.length < MIN_OFFICE_FILE_BYTES) {
    report.errors.push('docx_file_too_small');
  }

  try {
    const entries = readZipEntries(input.bytes);
    const documentXml = extractZipEntry(input.bytes, entries, 'word/document.xml');
    if (!documentXml) {
      report.errors.push('docx_document_xml_missing');
    } else {
      const thresholds = resolveDocxThresholds(manifest);
      const xml = documentXml.toString('utf8');
      const paragraphs = Array.from(xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g))
        .map((match) => stripXmlTags(match[0]))
        .filter(Boolean);
      const fullText = paragraphs.join('\n');
      const headingLikeParagraphCount = paragraphs.filter((paragraph) =>
        /^(#{1,6}\s+)?(\d+[\).、]\s*)?[\u4e00-\u9fa5A-Za-z].{0,42}$/.test(paragraph)
      ).length;
      const urlCount = (fullText.match(URL_PATTERN) || []).length;
      report.metrics.paragraphCount = paragraphs.length;
      report.metrics.headingLikeParagraphCount = headingLikeParagraphCount;
      report.metrics.urlCount = urlCount;
      report.metrics.characterCount = fullText.length;

      if (
        paragraphs.length < thresholds.minParagraphCount ||
        fullText.length < thresholds.minCharacterCount
      ) {
        report.errors.push('docx_effective_body_missing');
      }
      if (headingLikeParagraphCount < thresholds.minHeadingLikeParagraphCount) {
        report.warnings.push('docx_heading_hierarchy_weak');
      }
      if (PLACEHOLDER_PATTERN.test(fullText)) {
        report.errors.push('docx_placeholder_text_found');
      }

      const sourceRequired = manifest?.sourcePreservationRequired === true;
      if (sourceRequired && urlCount < 1) {
        report.errors.push('docx_required_sources_missing');
      }
      const declaredSectionCount = Number(manifest?.sectionCount || 0);
      if (declaredSectionCount > 0 && headingLikeParagraphCount + 1 < Math.max(2, declaredSectionCount - 1)) {
        report.warnings.push('docx_declared_section_count_not_observed');
      }
    }
  } catch (error) {
    report.errors.push(`docx_unreadable:${error instanceof Error ? error.message : String(error)}`);
  }

  report.passed = report.errors.length === 0;
  return report;
}

function extractSharedStrings(bytes: Buffer, entries: ZipEntry[]) {
  const sharedStringsXml = extractZipEntry(bytes, entries, 'xl/sharedStrings.xml');
  if (!sharedStringsXml) return [];
  return Array.from(sharedStringsXml.toString('utf8').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((match) =>
    decodeXmlText(match[1] || '')
  );
}

function countSheetMetrics(sheetXml: string, sharedStrings: string[]) {
  const cellMatches = Array.from(sheetXml.matchAll(/<c\b[^>]*>[\s\S]*?<\/c>/g));
  let nonEmptyCellCount = 0;
  let formulaCellCount = 0;
  let urlCount = 0;

  for (const match of cellMatches) {
    const cellXml = match[0];
    if (/<f\b/.test(cellXml)) formulaCellCount += 1;
    const sharedValue = asText((cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/) || [])[1]);
    const inlineValue = asText(
      decodeXmlText(
        Array.from(cellXml.matchAll(/<is\b[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/g))
          .map((item) => item[1] || '')
          .join(' ')
      )
    );
    const hasEffectiveValue = Boolean(sharedValue || inlineValue);
    if (hasEffectiveValue) nonEmptyCellCount += 1;

    if (/t="s"/.test(cellXml)) {
      const shared = sharedStrings[Number(sharedValue)];
      if (shared) {
        urlCount += (shared.match(URL_PATTERN) || []).length;
      }
    } else {
      const effectiveValue = inlineValue || sharedValue;
      urlCount += (effectiveValue.match(URL_PATTERN) || []).length;
    }
  }

  return { nonEmptyCellCount, formulaCellCount, urlCount };
}

function validateXlsx(input: ValidateOfficeArtifactInput): OfficeArtifactQualityReport {
  const required = input.requireManifest !== false;
  const { status, manifest } = parseManifest({ bytes: input.manifestBytes, required });
  const report: OfficeArtifactQualityReport = {
    kind: 'xlsx',
    artifactPath: input.artifactPath,
    manifestPath: input.manifestPath,
    passed: false,
    errors: [],
    warnings: [],
    metrics: {},
    manifestStatus: status,
  };
  addManifestErrors(report, required);

  if (!input.artifactPath.toLowerCase().endsWith('.xlsx')) {
    report.errors.push('xlsx_extension_invalid');
  }
  if (input.bytes.length < MIN_OFFICE_FILE_BYTES) {
    report.errors.push('xlsx_file_too_small');
  }

  try {
    const entries = readZipEntries(input.bytes);
    const workbookXml = extractZipEntry(input.bytes, entries, 'xl/workbook.xml');
    if (!workbookXml) {
      report.errors.push('xlsx_workbook_xml_missing');
    }
    const sheetEntries = entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name));
    const sharedStrings = extractSharedStrings(input.bytes, entries);
    let formulaCellCount = 0;
    let nonEmptyCellCount = 0;
    let urlCount = 0;
    for (const sheetEntry of sheetEntries) {
      const sheet = extractZipEntry(input.bytes, entries, sheetEntry.name);
      if (!sheet) continue;
      const metrics = countSheetMetrics(sheet.toString('utf8'), sharedStrings);
      formulaCellCount += metrics.formulaCellCount;
      nonEmptyCellCount += metrics.nonEmptyCellCount;
      urlCount += metrics.urlCount;
    }

    report.metrics.sheetCount = sheetEntries.length;
    report.metrics.formulaCellCount = formulaCellCount;
    report.metrics.nonEmptyCellCount = nonEmptyCellCount;
    report.metrics.urlCount = urlCount;

    if (sheetEntries.length < 1) {
      report.errors.push('xlsx_worksheet_missing');
    }
    if (nonEmptyCellCount < resolveXlsxMinimumEffectiveCellCount(manifest)) {
      report.errors.push('xlsx_effective_cells_missing');
    }

    const requiresFormulas = manifest?.requiresFormulas === true;
    if (requiresFormulas && formulaCellCount < 1) {
      report.errors.push('xlsx_required_formulas_missing');
    } else if (!requiresFormulas && formulaCellCount < 1) {
      report.warnings.push('xlsx_formula_cells_missing');
    }

    const declaredSheetCount = Number(manifest?.sheetCount || 0);
    if (declaredSheetCount > 0 && sheetEntries.length < declaredSheetCount) {
      report.errors.push('xlsx_declared_sheet_count_not_observed');
    }

    const requiresSourceSheet = manifest?.requiresSourceSheet === true;
    const workbookText = workbookXml?.toString('utf8') || '';
    const hasSourceNamedSheet = /name="[^"]*(Sources|Source|来源|参考|说明)[^"]*"/i.test(workbookText);
    if (requiresSourceSheet && !hasSourceNamedSheet && urlCount < 1) {
      report.errors.push('xlsx_required_sources_missing');
    }
    if (sheetEntries.length === 1 && declaredSheetCount > 1) {
      report.errors.push('xlsx_single_flat_sheet_for_structured_workbook');
    }
  } catch (error) {
    report.errors.push(`xlsx_unreadable:${error instanceof Error ? error.message : String(error)}`);
  }

  report.passed = report.errors.length === 0;
  return report;
}

export class OfficeArtifactQualityService {
  validateOfficeArtifact(input: ValidateOfficeArtifactInput): OfficeArtifactQualityReport {
    return input.kind === 'docx' ? validateDocx(input) : validateXlsx(input);
  }

  resolveManifestRelativePath(artifactPath: string, kind: OfficeArtifactKind): string {
    const directory = path.posix.dirname(artifactPath);
    const manifestName = kind === 'docx' ? 'document_manifest.json' : 'workbook_manifest.json';
    return directory === '.' ? manifestName : path.posix.join(directory, manifestName);
  }
}

export const officeArtifactQualityService = new OfficeArtifactQualityService();
