import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { officeArtifactQualityService } from '../src/services/office-artifact-quality-service';

function zip(entries: Record<string, string>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const compressed = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt32LE(0, 34);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

function docxBytes(paragraphs?: string[]) {
  const content = paragraphs || [
    'AI 履约平台商业计划书',
    '执行摘要',
    '本计划面向企业 AI 项目管理场景，提供任务拆解、执行跟踪、交付验证和审计治理能力。',
    '市场机会',
    '目标客户需要更稳定的智能体执行闭环，并要求所有交付物可复核、可下载、可追踪。',
    '实施计划',
    '第一阶段完成核心工作流，第二阶段完善质量门，第三阶段接入组织级审计。',
    '参考资料 https://example.com/report',
  ];
  const body = content
    .map((paragraph) => `<w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p>`)
    .join('');
  return zip({
    '[Content_Types].xml': '<Types></Types>',
    'docProps/core.xml':
      '<core>alpha-001 beta-002 gamma-003 delta-004 epsilon-005 zeta-006 eta-007 theta-008 iota-009 kappa-010 lambda-011 mu-012 nu-013 xi-014 omicron-015 pi-016 rho-017 sigma-018 tau-019 upsilon-020 phi-021 chi-022 psi-023 omega-024</core>',
    'word/document.xml': `<w:document><w:body>${body}</w:body></w:document>`,
  });
}

function xlsxBytes(options?: { formulas?: boolean; sourceSheet?: boolean }) {
  const formulas = options?.formulas !== false;
  const sourceSheet = options?.sourceSheet !== false;
  const workbookSheets = [
    '<sheet name="Summary" sheetId="1" r:id="rId1"/>',
    sourceSheet ? '<sheet name="Sources" sheetId="2" r:id="rId2"/>' : '',
  ].join('');
  const summaryFormula = formulas ? '<c r="B3"><f>SUM(B1:B2)</f><v>30</v></c>' : '<c r="B3"><v>30</v></c>';
  const entries: Record<string, string> = {
    '[Content_Types].xml': '<Types></Types>',
    'xl/workbook.xml': `<workbook><sheets>${workbookSheets}</sheets></workbook>`,
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row><c r="A1"><v>10</v></c><c r="B1"><v>20</v></c>${summaryFormula}<c r="A4" t="s"><v>0</v></c></row></sheetData></worksheet>`,
    'xl/sharedStrings.xml': '<sst><si><t>https://example.com/source</t></si></sst>',
  };
  if (sourceSheet) {
    entries['xl/worksheets/sheet2.xml'] = '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><v>2026</v></c></row></sheetData></worksheet>';
  }
  return zip(entries);
}

function xlsxInlineStringBytes() {
  return zip({
    '[Content_Types].xml': '<Types></Types>',
    'xl/workbook.xml': '<workbook><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/worksheets/sheet1.xml': [
      '<worksheet><sheetData>',
      '<row r="1"><c r="A1" t="inlineStr"><is><t>项目</t></is></c><c r="B1" t="inlineStr"><is><t>说明</t></is></c></row>',
      '<row r="2"><c r="A2" t="inlineStr"><is><t>OneCEO</t></is></c><c r="B2" t="inlineStr"><is><t>https://example.com/source</t></is></c></row>',
      '</sheetData></worksheet>',
    ].join(''),
  });
}

function xlsxMinimalFormBytes() {
  return zip({
    '[Content_Types].xml': '<Types></Types>',
    'xl/workbook.xml': '<workbook><sheets><sheet name="Input" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>姓名</t></is></c><c r="B1" t="inlineStr"><is><t>张三</t></is></c></row></sheetData></worksheet>',
  });
}
test('validateOfficeArtifact passes DOCX with manifest and readable structure', () => {
  const report = officeArtifactQualityService.validateOfficeArtifact({
    kind: 'docx',
    artifactPath: 'outputs/final.docx',
    bytes: docxBytes(),
    manifestPath: 'outputs/document_manifest.json',
    manifestBytes: Buffer.from(
      JSON.stringify({
        artifactType: 'docx',
        fileName: 'final.docx',
        contentArchetype: 'business_plan',
        stylePack: 'formal_executive',
        sectionCount: 3,
        sourcePreservationRequired: true,
      }),
    ),
  });

  assert.equal(report.passed, true);
  assert.equal(report.manifestStatus, 'found');
  assert.equal(report.metrics.urlCount, 1);
  assert.equal(report.errors.length, 0);
});

test('validateOfficeArtifact accepts DOCX without manifest when file structure is valid', () => {
  const report = officeArtifactQualityService.validateOfficeArtifact({
    kind: 'docx',
    artifactPath: 'outputs/final.docx',
    bytes: docxBytes(),
  });

  assert.equal(report.passed, true);
  assert.equal(report.manifestStatus, 'not_required');
});

test('validateOfficeArtifact allows compact meeting memo DOCX structures', () => {
  const report = officeArtifactQualityService.validateOfficeArtifact({
    kind: 'docx',
    artifactPath: 'outputs/final.docx',
    bytes: docxBytes(['会议纪要', '今日完成预算评审与职责分工，结论为下周进入执行。']),
    manifestPath: 'outputs/document_manifest.json',
    manifestBytes: Buffer.from(
      JSON.stringify({
        artifactType: 'docx',
        fileName: 'final.docx',
        contentArchetype: 'meeting_memo',
        stylePack: 'formal_executive',
        sectionCount: 2,
      }),
    ),
  });

  assert.equal(report.passed, true);
  assert.equal(report.errors.length, 0);
});

test('validateOfficeArtifact still rejects undersized business plan DOCX bodies', () => {
  const report = officeArtifactQualityService.validateOfficeArtifact({
    kind: 'docx',
    artifactPath: 'outputs/final.docx',
    bytes: docxBytes(['商业计划书', '这是一个很短的说明。']),
    manifestPath: 'outputs/document_manifest.json',
    manifestBytes: Buffer.from(
      JSON.stringify({
        artifactType: 'docx',
        fileName: 'final.docx',
        contentArchetype: 'business_plan',
        stylePack: 'formal_executive',
        sectionCount: 4,
      }),
    ),
  });

  assert.equal(report.passed, false);
  assert.ok(report.errors.includes('docx_effective_body_missing'));
});

test('validateOfficeArtifact passes XLSX with formulas and source evidence', () => {
  const report = officeArtifactQualityService.validateOfficeArtifact({
    kind: 'xlsx',
    artifactPath: 'outputs/final.xlsx',
    bytes: xlsxBytes(),
    manifestPath: 'outputs/workbook_manifest.json',
    manifestBytes: Buffer.from(
      JSON.stringify({
        artifactType: 'xlsx',
        fileName: 'final.xlsx',
        contentArchetype: 'budget_tracker',
        sheetCount: 2,
        requiresFormulas: true,
        requiresSourceSheet: true,
      }),
    ),
  });

  assert.equal(report.passed, true);
  assert.equal(report.metrics.sheetCount, 2);
  assert.equal(report.metrics.formulaCellCount, 1);
  assert.equal(report.metrics.urlCount, 2);
});

test('validateOfficeArtifact fails XLSX when required formulas are absent', () => {
  const report = officeArtifactQualityService.validateOfficeArtifact({
    kind: 'xlsx',
    artifactPath: 'outputs/final.xlsx',
    bytes: xlsxBytes({ formulas: false }),
    manifestPath: 'outputs/workbook_manifest.json',
    manifestBytes: Buffer.from(
      JSON.stringify({
        artifactType: 'xlsx',
        fileName: 'final.xlsx',
        contentArchetype: 'budget_tracker',
        sheetCount: 2,
        requiresFormulas: true,
        requiresSourceSheet: true,
      }),
    ),
  });

  assert.equal(report.passed, false);
  assert.ok(report.errors.includes('xlsx_required_formulas_missing'));
});

test('validateOfficeArtifact counts inline strings as effective XLSX cells', () => {
  const report = officeArtifactQualityService.validateOfficeArtifact({
    kind: 'xlsx',
    artifactPath: 'outputs/final.xlsx',
    bytes: xlsxInlineStringBytes(),
    requireManifest: false,
  });

  assert.equal(report.passed, true);
  assert.equal(report.manifestStatus, 'not_required');
  assert.equal(report.metrics.nonEmptyCellCount, 4);
  assert.equal(report.metrics.urlCount, 1);
});

test('validateOfficeArtifact still flags invalid manifest only when explicitly required', () => {
  const report = officeArtifactQualityService.validateOfficeArtifact({
    kind: 'docx',
    artifactPath: 'outputs/final.docx',
    bytes: docxBytes(),
    manifestPath: 'outputs/document_manifest.json',
    manifestBytes: Buffer.from('{'),
    requireManifest: true,
  });

  assert.equal(report.passed, false);
  assert.equal(report.manifestStatus, 'invalid');
  assert.ok(report.errors.includes('manifest_invalid'));
});

test('validateOfficeArtifact allows lightweight input form XLSX layouts', () => {
  const report = officeArtifactQualityService.validateOfficeArtifact({
    kind: 'xlsx',
    artifactPath: 'outputs/final.xlsx',
    bytes: xlsxMinimalFormBytes(),
    manifestPath: 'outputs/workbook_manifest.json',
    manifestBytes: Buffer.from(
      JSON.stringify({
        artifactType: 'xlsx',
        fileName: 'final.xlsx',
        contentArchetype: 'input_form',
        sheetCount: 1,
        requiresFormulas: false,
        requiresSourceSheet: false,
      }),
    ),
  });

  assert.equal(report.passed, true);
  assert.equal(report.errors.length, 0);
});
