import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { platformSkillImportJobService } from '../src/services/platform-skill-import-job-service';
import { platformSkillService } from '../src/services/platform-skill-service';

afterEach(() => {
  mock.reset();
});

test('import job reports per-file success after backend import completes', async () => {
  mock.method(platformSkillService, 'parseFolderImport', () => ({
    rootFolderName: 'minimax-pdf',
    slug: 'minimax-pdf',
    name: 'MiniMax PDF',
    discoveryDescription: 'pdf skill',
    activationSummary: 'summary',
    entry: {
      entryName: 'MiniMax PDF',
      entryDescription: 'pdf skill',
      bodyMarkdown: '# Skill',
    },
    files: [
      {
        relativePath: 'scripts/render_body.py',
        nodeType: 'file',
        resourceKind: 'script',
        storageTarget: 'object_storage',
        processingState: 'pending',
        sizeBytes: 20,
      },
    ],
    resources: [],
    warnings: [],
  }) as any);

  mock.method(platformSkillService, 'importSkillFolder', async (input: any) => {
    input.onFileProgress?.({
      relativePath: 'scripts/render_body.py',
      processingState: 'processing',
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    input.onFileProgress?.({
      relativePath: 'scripts/render_body.py',
      processingState: 'success',
    });
    return {
      mode: 'create',
      preview: {
        rootFolderName: 'minimax-pdf',
        slug: 'minimax-pdf',
      },
      skill: {
        id: 'skill-1',
      },
      revision: {
        id: 'rev-1',
      },
    } as any;
  });

  const job = await platformSkillImportJobService.start({
    rootFolderName: 'minimax-pdf',
    files: [
      {
        relativePath: 'SKILL.md',
        content: '# Skill',
      },
    ],
    createdBy: 'admin_management',
  });

  assert.equal(job.status, 'pending');
  assert.equal(job.files[0]?.processingState, 'pending');

  await new Promise((resolve) => setTimeout(resolve, 60));
  const completed = platformSkillImportJobService.get(job.jobId);

  assert.ok(completed);
  assert.equal(completed?.status, 'completed');
  assert.equal(completed?.files[0]?.processingState, 'success');
  assert.equal(completed?.result?.mode, 'create');
});

test('import job marks pending files failed when backend import throws', async () => {
  mock.method(platformSkillService, 'parseFolderImport', () => ({
    rootFolderName: 'minimax-pdf',
    slug: 'minimax-pdf',
    name: 'MiniMax PDF',
    discoveryDescription: 'pdf skill',
    activationSummary: 'summary',
    entry: {
      entryName: 'MiniMax PDF',
      entryDescription: 'pdf skill',
      bodyMarkdown: '# Skill',
    },
    files: [
      {
        relativePath: 'scripts/render_body.py',
        nodeType: 'file',
        resourceKind: 'script',
        storageTarget: 'object_storage',
        processingState: 'pending',
        sizeBytes: 20,
      },
    ],
    resources: [],
    warnings: [],
  }) as any);

  mock.method(platformSkillService, 'importSkillFolder', async (input: any) => {
    input.onFileProgress?.({
      relativePath: 'scripts/render_body.py',
      processingState: 'processing',
    });
    throw new Error('upload failed');
  });

  const job = await platformSkillImportJobService.start({
    rootFolderName: 'minimax-pdf',
    files: [
      {
        relativePath: 'SKILL.md',
        content: '# Skill',
      },
    ],
    createdBy: 'admin_management',
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  const failed = platformSkillImportJobService.get(job.jobId);

  assert.ok(failed);
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.files[0]?.processingState, 'failed');
  assert.match(failed?.files[0]?.error || '', /upload failed/);
});
