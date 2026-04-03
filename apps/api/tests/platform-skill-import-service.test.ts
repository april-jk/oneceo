import assert from 'node:assert/strict';
import { test } from 'node:test';
import { platformSkillImportService } from '../src/services/platform-skill-import-service';

test('parseFolderImport extracts entry and chunked resources from skill folder', () => {
  const preview = platformSkillImportService.parseFolderImport({
    rootFolderName: 'office-ppt',
    files: [
      {
        relativePath: 'SKILL.md',
        content: [
          '---',
          'name: Office PPT',
          'description: Build presentation decks',
          '---',
          '',
          '# Skill Brief',
          '',
          'Use this skill to plan and create PPT content.',
        ].join('\n'),
      },
      {
        relativePath: 'references/guide.md',
        content: '# Guide\n\n' + 'A'.repeat(2600),
      },
      {
        relativePath: 'templates/outline.md',
        content: '# Outline\n\n- Intro\n- Body\n- Summary',
      },
    ],
  });

  assert.equal(preview.slug, 'office-ppt');
  assert.equal(preview.name, 'Office PPT');
  assert.equal(preview.entry.entryDescription, 'Build presentation decks');
  assert.equal(preview.resources.length, 2);
  assert.equal(preview.files.length, 2);
  assert.equal(preview.files[0]?.storageTarget, 'database');
  assert.equal(preview.resources[0]?.resourceKind, 'reference');
  assert.equal(preview.resources[0]?.contentMode, 'chunked');
  assert.equal(preview.resources[0]?.chunks[0]?.chunkRole, 'summary');
  assert.equal(preview.resources[1]?.resourceKind, 'template');
});

test('parseFolderImport warns when scripts are imported as text resources', () => {
  const preview = platformSkillImportService.parseFolderImport({
    rootFolderName: 'office-xlsx',
    files: [
      {
        relativePath: 'SKILL.md',
        content: '# Spreadsheet Skill',
      },
      {
        relativePath: 'scripts/cleanup.py',
        content: 'print("hello")',
      },
    ],
  });

  assert.equal(preview.resources.length, 1);
  assert.equal(preview.files[0]?.storageTarget, 'object_storage');
  assert.equal(preview.resources[0]?.resourceKind, 'script');
  assert.equal(preview.warnings.length, 1);
  assert.match(preview.warnings[0] || '', /脚本资源/);
});
