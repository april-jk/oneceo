import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { taskSessionDeliverableArtifactDAO } from '../src/db/dao';
import { e2bConnector } from '../src/connectors/e2b-connector';
import { TaskSessionDeliverableService } from '../src/services/task-session-deliverable-service';

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

function docxBytes() {
  const paragraphs = [
    '正式报告',
    '摘要',
    '这是一份用于测试交付物质量门的正式文档，包含足够正文、章节和来源。',
    '分析',
    '平台需要在上传前识别缺失 manifest 的 Office 文件，避免坏交付物流入下载链路。',
    '结论',
    '该质量门应阻断不合格产物，并保留可诊断错误信息 https://example.com/source',
  ];
  return zip({
    '[Content_Types].xml': '<Types></Types>',
    'word/document.xml': `<w:document><w:body>${paragraphs
      .map((paragraph) => `<w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p>`)
      .join('')}</w:body></w:document>`,
  });
}

function xlsxBytes() {
  return zip({
    '[Content_Types].xml': '<Types></Types>',
    'xl/workbook.xml': '<workbook><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/worksheets/sheet1.xml':
      '<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>项目</t></is></c><c r="B1" t="inlineStr"><is><t>OneCEO</t></is></c></row></sheetData></worksheet>',
  });
}

test('persistManagedRunDeliverables archives directory attachments before upload', async () => {
  class TestDeliverableService extends TaskSessionDeliverableService {
    uploaded: Array<{ storageKey: string; bytes: Buffer }> = [];

    protected override async uploadDeliverable(storageKey: string, bytes: Buffer): Promise<void> {
      this.uploaded.push({ storageKey, bytes });
    }
  }

  const service = new TestDeliverableService();
  const commands: string[] = [];
  const previousEnv = {
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  };

  process.env.R2_BUCKET_NAME = 'test-bucket';
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';

  mock.method(e2bConnector, 'runCommand', async (_sandboxId: string, command: string) => {
    commands.push(command);
    if (command.includes("printf 'directory'")) {
      return { stdout: 'directory', stderr: '', exitCode: 0 } as any;
    }
    return { stdout: '', stderr: '', exitCode: 0 } as any;
  });
  mock.method(e2bConnector, 'readFile', async (_sandboxId: string, filePath: string) => {
    assert.match(filePath, /oneceo-deliverable-.*\.tar\.gz$/);
    return Uint8Array.from(Buffer.from('archived-directory-bytes'));
  });
  mock.method(taskSessionDeliverableArtifactDAO, 'createMany', async (records: any[]) =>
    records.map((record, index) => ({
      id: `artifact-${index + 1}`,
      ...record,
      createdAt: new Date('2026-04-22T00:00:00.000Z'),
    })),
  );

  try {
    const result = await service.persistManagedRunDeliverables({
      sessionId: 'session-1',
      runId: 'run-1',
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace',
      attachments: [
        {
          path: 'acrylic-export-website',
          name: 'acrylic-export-website.zip',
          mimeType: 'application/zip',
        },
      ],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.path, 'acrylic-export-website');
    assert.equal(result[0]?.name, 'acrylic-export-website.tar.gz');
    assert.equal(result[0]?.mimeType, 'application/gzip');
    assert.equal(service.uploaded.length, 1);
    assert.equal(service.uploaded[0]?.bytes.toString('utf8'), 'archived-directory-bytes');
    assert.ok(commands.some((command) => command.includes("tar -czf '")));
    assert.ok(commands.some((command) => command.includes("'acrylic-export-website'")));
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (typeof value === 'string') {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
    mock.restoreAll();
  }
});

test('persistManagedRunDeliverables allows DOCX attachments without required manifest', async () => {
  class TestDeliverableService extends TaskSessionDeliverableService {
    uploaded: Array<{ storageKey: string; bytes: Buffer }> = [];

    protected override async uploadDeliverable(storageKey: string, bytes: Buffer): Promise<void> {
      this.uploaded.push({ storageKey, bytes });
    }
  }

  const service = new TestDeliverableService();
  const previousEnv = {
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  };

  process.env.R2_BUCKET_NAME = 'test-bucket';
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';

  mock.method(e2bConnector, 'runCommand', async () => ({ stdout: 'file', stderr: '', exitCode: 0 }) as any);
  mock.method(e2bConnector, 'readFile', async (_sandboxId: string, filePath: string) => {
    if (filePath.endsWith('/outputs/final.docx')) {
      return Uint8Array.from(docxBytes());
    }
    throw new Error('file_not_found');
  });
  mock.method(taskSessionDeliverableArtifactDAO, 'createMany', async (records: any[]) =>
    records.map((record, index) => ({
      id: `artifact-${index + 1}`,
      ...record,
      createdAt: new Date('2026-04-22T00:00:00.000Z'),
    })),
  );

  try {
    const result = await service.persistManagedRunDeliverables({
      sessionId: 'session-1',
      runId: 'run-1',
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace',
      attachments: [
        {
          path: 'outputs/final.docx',
          name: 'final.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      ],
    });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.path, 'outputs/final.docx');
    assert.equal(service.uploaded.length, 1);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (typeof value === 'string') {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
    mock.restoreAll();
  }
});

test('persistManagedRunDeliverables persists xlsx/docx/pdf/pptx deliverables in one run', async () => {
  class TestDeliverableService extends TaskSessionDeliverableService {
    uploaded: Array<{ storageKey: string; bytes: Buffer }> = [];

    protected override async uploadDeliverable(storageKey: string, bytes: Buffer): Promise<void> {
      this.uploaded.push({ storageKey, bytes });
    }
  }

  const service = new TestDeliverableService();
  const previousEnv = {
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  };

  process.env.R2_BUCKET_NAME = 'test-bucket';
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';

  mock.method(e2bConnector, 'runCommand', async () => ({ stdout: 'file', stderr: '', exitCode: 0 }) as any);
  mock.method(e2bConnector, 'readFile', async (_sandboxId: string, filePath: string) => {
    if (filePath.endsWith('/outputs/final.xlsx')) {
      return Uint8Array.from(xlsxBytes());
    }
    if (filePath.endsWith('/outputs/final.docx')) {
      return Uint8Array.from(docxBytes());
    }
    if (filePath.endsWith('/outputs/final.pdf')) {
      return Uint8Array.from(Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n', 'utf8'));
    }
    if (filePath.endsWith('/outputs/final.pptx')) {
      return Uint8Array.from(
        zip({
          '[Content_Types].xml': '<Types></Types>',
          'ppt/presentation.xml': '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"></p:presentation>',
        }),
      );
    }
    throw new Error(`unexpected_file_path:${filePath}`);
  });
  mock.method(taskSessionDeliverableArtifactDAO, 'createMany', async (records: any[]) =>
    records.map((record, index) => ({
      id: `artifact-${index + 1}`,
      ...record,
      createdAt: new Date('2026-05-06T00:00:00.000Z'),
    })),
  );

  try {
    const result = await service.persistManagedRunDeliverables({
      sessionId: 'session-batch',
      runId: 'run-batch',
      sandboxId: 'sandbox-batch',
      workspaceRoot: '/workspace',
      attachments: [
        { path: 'outputs/final.xlsx', name: 'final.xlsx' },
        { path: 'outputs/final.docx', name: 'final.docx' },
        { path: 'outputs/final.pdf', name: 'final.pdf' },
        { path: 'outputs/final.pptx', name: 'final.pptx' },
      ],
    });

    assert.equal(result.length, 4);
    assert.equal(service.uploaded.length, 4);
    assert.deepEqual(
      result.map((item) => item.name).sort(),
      ['final.docx', 'final.pdf', 'final.pptx', 'final.xlsx'].sort(),
    );
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (typeof value === 'string') {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
    mock.restoreAll();
  }
});
