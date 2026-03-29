import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { platformSkillDAO } from '../src/db/dao';
import { platformSkillService } from '../src/services/platform-skill-service';
import { skillObjectStorageService } from '../src/services/skill-object-storage-service';

afterEach(() => {
  mock.reset();
  (platformSkillService as any).seeded = false;
});

test('listPublicSkills returns resourceSummary without exposing resource bodies', async () => {
  mock.method(platformSkillDAO, 'countSkills', async () => 1);
  mock.method(platformSkillDAO, 'listPublishedActiveSkills', async () => [
    {
      id: 'skill-1',
      slug: 'office-ppt',
      name: 'PPT 办公',
      description: '创建专业演示文稿',
      category: 'office',
      status: 'active',
      publishedRevisionId: 'rev-1',
      createdAt: new Date('2026-03-29T00:00:00.000Z'),
      updatedAt: new Date('2026-03-29T00:00:00.000Z'),
    },
  ] as any);
  mock.method(platformSkillDAO, 'getRevision', async () => ({
    id: 'rev-1',
    skillId: 'skill-1',
    revisionNumber: 3,
    slugSnapshot: 'office-ppt',
    nameSnapshot: 'PPT 办公',
    descriptionSnapshot: '创建专业演示文稿',
    categorySnapshot: 'office',
    bodyMarkdown: '# Skill Brief',
    publishedAt: new Date('2026-03-29T00:00:00.000Z'),
    createdBy: 'seed',
    createdAt: new Date('2026-03-29T00:00:00.000Z'),
  }) as any);
  mock.method(platformSkillDAO, 'listRevisionResourceIndexes', async () => []);
  mock.method(platformSkillDAO, 'getRevisionResourceBody', async () => null);
  mock.method(platformSkillDAO, 'getRevisionResource', async () => ({
    id: 'res-1',
    revisionId: 'rev-1',
    resourcePath: 'references/slide-structure-guide.md',
    resourceType: 'reference',
    contentMarkdown: '# Ref',
    createdAt: new Date('2026-03-29T00:00:00.000Z'),
  }) as any);
  mock.method(platformSkillDAO, 'listRevisionResources', async () => [
    {
      id: 'res-1',
      revisionId: 'rev-1',
      resourcePath: 'references/slide-structure-guide.md',
      resourceType: 'reference',
      contentMarkdown: '# Ref',
      createdAt: new Date('2026-03-29T00:00:00.000Z'),
    },
    {
      id: 'res-2',
      revisionId: 'rev-1',
      resourcePath: 'templates/business-deck-outline.md',
      resourceType: 'template',
      contentMarkdown: '# Template',
      createdAt: new Date('2026-03-29T00:00:00.000Z'),
    },
  ] as any);

  const skills = await platformSkillService.listPublicSkills();

  assert.equal(skills.length, 1);
  assert.equal(skills[0]?.resourceSummary.totalCount, 2);
  assert.equal(skills[0]?.resourceSummary.referenceCount, 1);
  assert.equal(skills[0]?.resourceSummary.templateCount, 1);
  assert.deepEqual(skills[0]?.resourceSummary.paths, [
    'references/slide-structure-guide.md',
    'templates/business-deck-outline.md',
  ]);
  assert.equal((skills[0] as any).contentMarkdown, undefined);
});

test('getRevisionResource returns exact resource payload for selected revision', async () => {
  mock.method(platformSkillDAO, 'countSkills', async () => 1);
  mock.method(platformSkillDAO, 'getSkill', async () => ({
    id: 'skill-1',
    slug: 'office-ppt',
    name: 'PPT 办公',
    description: '创建专业演示文稿',
    category: 'office',
    status: 'active',
    publishedRevisionId: 'rev-1',
    createdAt: new Date('2026-03-29T00:00:00.000Z'),
    updatedAt: new Date('2026-03-29T00:00:00.000Z'),
  }) as any);
  mock.method(platformSkillDAO, 'getRevision', async () => ({
    id: 'rev-1',
    skillId: 'skill-1',
    revisionNumber: 3,
    slugSnapshot: 'office-ppt',
    nameSnapshot: 'PPT 办公',
    descriptionSnapshot: '创建专业演示文稿',
    categorySnapshot: 'office',
    bodyMarkdown: '# Skill Brief',
    publishedAt: new Date('2026-03-29T00:00:00.000Z'),
    createdBy: 'seed',
    createdAt: new Date('2026-03-29T00:00:00.000Z'),
  }) as any);
  mock.method(platformSkillDAO, 'listRevisionResourceIndexes', async () => []);
  mock.method(platformSkillDAO, 'getRevisionResourceBody', async () => null);
  mock.method(platformSkillDAO, 'getRevisionResource', async () => ({
    id: 'res-1',
    revisionId: 'rev-1',
    resourcePath: 'references/slide-structure-guide.md',
    resourceType: 'reference',
    contentMarkdown: '# Ref',
    createdAt: new Date('2026-03-29T00:00:00.000Z'),
  }) as any);
  mock.method(platformSkillDAO, 'listRevisionResources', async () => [
    {
      id: 'res-1',
      revisionId: 'rev-1',
      resourcePath: 'references/slide-structure-guide.md',
      resourceType: 'reference',
      contentMarkdown: '# Ref',
      createdAt: new Date('2026-03-29T00:00:00.000Z'),
    },
  ] as any);

  const result = await platformSkillService.getRevisionResource(
    'skill-1',
    'rev-1',
    'references/slide-structure-guide.md'
  );

  assert.equal(result.resource.resourcePath, 'references/slide-structure-guide.md');
  assert.equal(result.resource.resourceType, 'reference');
  assert.equal(result.resource.contentMarkdown, '# Ref');
});

test('getRevisionResource downloads object storage resource when layered index points to r2', async () => {
  mock.method(platformSkillDAO, 'countSkills', async () => 1);
  mock.method(platformSkillDAO, 'getSkill', async () => ({
    id: 'skill-1',
    slug: 'minimax-pdf',
    name: 'MiniMax PDF',
    description: 'pdf skill',
    category: 'office',
    status: 'active',
    publishedRevisionId: 'rev-1',
    createdAt: new Date('2026-03-29T00:00:00.000Z'),
    updatedAt: new Date('2026-03-29T00:00:00.000Z'),
  }) as any);
  mock.method(platformSkillDAO, 'getRevision', async () => ({
    id: 'rev-1',
    skillId: 'skill-1',
    revisionNumber: 1,
    slugSnapshot: 'minimax-pdf',
    nameSnapshot: 'MiniMax PDF',
    descriptionSnapshot: 'pdf skill',
    categorySnapshot: 'office',
    bodyMarkdown: '# Skill Brief',
    createdAt: new Date('2026-03-29T00:00:00.000Z'),
  }) as any);
  mock.method(platformSkillDAO, 'listRevisionResourceIndexes', async () => [
    {
      id: 'res-index-1',
      revisionId: 'rev-1',
      resourceKey: 'script_1_render-body',
      resourcePath: 'scripts/render_body.py',
      resourceKind: 'reference',
      contentStorage: 'object_storage',
      mimeType: 'text/x-python',
      storagePath: 'r2://unit-test/skills/platform/minimax-pdf/create/hash/scripts/render_body.py',
      storageLocatorJson: { objectKey: 'skills/platform/minimax-pdf/create/hash/scripts/render_body.py' },
      title: 'render_body.py',
      summary: 'render body',
      loadStage: 'on_demand',
      sortOrder: 0,
      createdAt: new Date('2026-03-29T00:00:00.000Z'),
      updatedAt: new Date('2026-03-29T00:00:00.000Z'),
    },
  ] as any);
  mock.method(platformSkillDAO, 'getRevisionResourceBody', async () => null);
  mock.method(platformSkillDAO, 'listRevisionResourceChunks', async () => []);
  mock.method(skillObjectStorageService, 'downloadTextResource', async () => 'print("render")');

  const result = await platformSkillService.getRevisionResource('skill-1', 'rev-1', 'scripts/render_body.py');

  assert.equal(result.resource.resourcePath, 'scripts/render_body.py');
  assert.equal(result.resource.contentMarkdown, 'print("render")');
});

test('renderRevisionById prefers layered entry body when available', async () => {
  mock.method(platformSkillDAO, 'countSkills', async () => 1);
  mock.method(platformSkillDAO, 'getSkill', async () => ({
    id: 'skill-1',
    slug: 'office-ppt',
    name: 'PPT 办公',
    description: '创建专业演示文稿',
    category: 'office',
    status: 'active',
    publishedRevisionId: 'rev-1',
    createdAt: new Date('2026-03-29T00:00:00.000Z'),
    updatedAt: new Date('2026-03-29T00:00:00.000Z'),
  }) as any);
  mock.method(platformSkillDAO, 'getRevision', async () => ({
    id: 'rev-1',
    skillId: 'skill-1',
    revisionNumber: 3,
    slugSnapshot: 'office-ppt',
    nameSnapshot: 'PPT 办公',
    descriptionSnapshot: '创建专业演示文稿',
    categorySnapshot: 'office',
    bodyMarkdown: '# Legacy Body',
    publishedAt: new Date('2026-03-29T00:00:00.000Z'),
    createdBy: 'seed',
    createdAt: new Date('2026-03-29T00:00:00.000Z'),
  }) as any);
  mock.method(platformSkillDAO, 'getRevisionEntry', async () => ({
    id: 'entry-1',
    revisionId: 'rev-1',
    entryName: 'PPT 办公',
    entryDescription: '创建专业演示文稿',
    bodyMarkdown: '# Layered Body',
  }) as any);

  const rendered = await platformSkillService.renderRevisionById('skill-1', 'rev-1');

  assert.match(rendered.renderedMarkdown, /Layered Body/);
  assert.doesNotMatch(rendered.renderedMarkdown, /Legacy Body/);
});

test('importSkillFolder creates new skill using layered import payload', async () => {
  mock.method(platformSkillDAO, 'countSkills', async () => 1);
  mock.method(platformSkillDAO, 'getSkillBySlug', async () => null);
  const uploadMock = mock.method(skillObjectStorageService, 'uploadTextResource', async () => ({
    objectKey: 'skills/platform/office-ppt/create/hash/scripts/render_body.py',
    storagePath: 'r2://unit-test/skills/platform/office-ppt/create/hash/scripts/render_body.py',
    storageLocatorJson: {
      provider: 'r2',
      bucket: 'unit-test',
      objectKey: 'skills/platform/office-ppt/create/hash/scripts/render_body.py',
      mimeType: 'text/x-python',
    },
  }));
  const createMock = mock.method(platformSkillDAO, 'createSkillWithRevision', async (input: any) => ({
    skill: {
      id: 'skill-1',
      slug: input.skill.slug,
      name: input.skill.name,
      description: input.skill.description,
      category: input.skill.category,
      status: 'active',
      publishedRevisionId: 'rev-1',
      updatedAt: new Date('2026-03-29T00:00:00.000Z'),
    },
    revision: {
      id: 'rev-1',
      skillId: 'skill-1',
      revisionNumber: 1,
      slugSnapshot: input.revision.slugSnapshot,
      nameSnapshot: input.revision.nameSnapshot,
      descriptionSnapshot: input.revision.descriptionSnapshot,
      categorySnapshot: input.revision.categorySnapshot,
      bodyMarkdown: input.revision.bodyMarkdown,
      publishedAt: new Date('2026-03-29T00:00:00.000Z'),
      createdAt: new Date('2026-03-29T00:00:00.000Z'),
    },
  }) as any);

  const result = await platformSkillService.importSkillFolder({
    rootFolderName: 'office-ppt',
    files: [
      {
        relativePath: 'SKILL.md',
        content: ['---', 'name: Office PPT', 'description: Build presentation decks', '---', '', '# Skill Brief'].join('\n'),
      },
      {
        relativePath: 'scripts/render_body.py',
        content: 'print("render")',
      },
    ],
    createdBy: 'admin_management',
  });

  assert.equal(result.mode, 'create');
  assert.equal(uploadMock.mock.callCount(), 1);
  assert.equal(createMock.mock.callCount(), 1);
  assert.equal(createMock.mock.calls[0]?.arguments[0]?.layeredImport?.resources?.[0]?.resourceKind, 'script');
  assert.equal(createMock.mock.calls[0]?.arguments[0]?.layeredImport?.resources?.[0]?.contentStorage, 'object_storage');
  assert.equal(createMock.mock.calls[0]?.arguments[0]?.resources?.length, 0);
});

test('importSkillFolder can publish a new revision for an existing admin skill', async () => {
  mock.method(platformSkillDAO, 'countSkills', async () => 1);
  const updateMock = mock.method(platformSkillDAO, 'createPublishedRevision', async (_skillId: string, input: any) => ({
    skill: {
      id: 'skill-1',
      slug: 'office-ppt',
      name: input.name,
      description: input.description,
      category: input.category,
      status: 'active',
      publishedRevisionId: 'rev-2',
      updatedAt: new Date('2026-03-29T00:00:00.000Z'),
    },
    revision: {
      id: 'rev-2',
      skillId: 'skill-1',
      revisionNumber: 2,
      slugSnapshot: 'office-ppt',
      nameSnapshot: input.name,
      descriptionSnapshot: input.description,
      categorySnapshot: input.category,
      bodyMarkdown: input.bodyMarkdown,
      publishedAt: new Date('2026-03-29T00:00:00.000Z'),
      createdAt: new Date('2026-03-29T00:00:00.000Z'),
    },
  }) as any);

  const result = await platformSkillService.importSkillFolder({
    skillId: 'skill-1',
    rootFolderName: 'office-ppt',
    files: [
      {
        relativePath: 'SKILL.md',
        content: ['---', 'name: Office PPT v2', 'description: Updated deck workflow', '---', '', '# Updated Body'].join('\n'),
      },
      {
        relativePath: 'templates/outline.md',
        content: '# Template',
      },
    ],
    createdBy: 'admin_management',
  });

  assert.equal(result.mode, 'revision');
  assert.equal(updateMock.mock.callCount(), 1);
  assert.equal(updateMock.mock.calls[0]?.arguments[0], 'skill-1');
  assert.equal(updateMock.mock.calls[0]?.arguments[1]?.layeredImport?.resources?.[0]?.resourceKind, 'template');
});
