import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { platformSkillDAO } from '../src/db/dao';
import { platformSkillService } from '../src/services/platform-skill-service';
import { skillObjectStorageService } from '../src/services/skill-object-storage-service';

afterEach(() => {
  mock.reset();
  (platformSkillService as any).seeded = false;
});

test('ensureSeeded does not overwrite existing admin-managed skill governance', async () => {
  const updateMetadataMock = mock.method(platformSkillDAO, 'updateSkillMetadata', async () => {
    throw new Error('should_not_overwrite_admin_managed_governance');
  });
  const createMock = mock.method(platformSkillDAO, 'createSkillWithRevision', async () => {
    throw new Error('all_seed_skills_should_exist_in_this_test');
  });
  mock.method(platformSkillDAO, 'getSkillBySlug', async (slug: string) => ({
    id: `skill-${slug}`,
    slug,
    name: slug,
    description: slug,
    category: 'deployment',
    status: 'active',
    metadataJson: {
      systemRole: 'admin_custom_role',
      adminManaged: true,
      required: false,
      autoActivation: {
        enabled: false,
        triggers: ['admin-custom'],
        toolNames: ['admin_custom_tool'],
      },
    },
    publishedRevisionId: `rev-${slug}`,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:00:00.000Z'),
  }) as any);

  await platformSkillService.ensureSeeded();

  assert.equal(updateMetadataMock.mock.callCount(), 0);
  assert.equal(createMock.mock.callCount(), 0);
});

test('listPublicSkills returns resourceSummary without exposing resource bodies', async () => {
  (platformSkillService as any).seeded = true;
  mock.method(platformSkillDAO, 'countSkills', async () => 1);
  mock.method(platformSkillDAO, 'listPublishedActiveSkills', async () => [
    {
      id: 'skill-1',
      slug: 'office-ppt',
      name: 'PPT 办公',
      description: '创建专业演示文稿',
      category: 'office',
      status: 'active',
      metadataJson: {
        systemRole: 'ppt_builder',
        adminManaged: true,
        required: false,
        autoActivation: {
          enabled: false,
          triggers: [],
          toolNames: [],
        },
      },
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
  assert.equal(skills[0]?.governance.systemRole, 'ppt_builder');
  assert.equal(skills[0]?.governance.adminManaged, true);
  assert.equal(skills[0]?.governance.autoActivation.enabled, false);
  assert.deepEqual(skills[0]?.governance.autoActivation.toolNames, []);
  assert.deepEqual(skills[0]?.resourceSummary.paths, [
    'references/slide-structure-guide.md',
    'templates/business-deck-outline.md',
  ]);
  assert.equal((skills[0] as any).contentMarkdown, undefined);
});

test('getRevisionResource returns exact resource payload for selected revision', async () => {
  (platformSkillService as any).seeded = true;
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
  (platformSkillService as any).seeded = true;
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
  (platformSkillService as any).seeded = true;
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

test('archiveSkill rejects required governance skill', async () => {
  (platformSkillService as any).seeded = true;
  mock.method(platformSkillDAO, 'getSkill', async () => ({
    id: 'skill-deploy',
    slug: 'deployment-orchestrator',
    name: '部署编排',
    description: '部署 skill',
    category: 'deployment',
    status: 'active',
    metadataJson: {
      systemRole: 'deployment_orchestrator',
      adminManaged: true,
      required: true,
      autoActivation: {
        enabled: true,
        triggers: ['deploy'],
        toolNames: ['deploy_application'],
      },
    },
    publishedRevisionId: 'rev-1',
    createdAt: new Date('2026-04-18T00:00:00.000Z'),
    updatedAt: new Date('2026-04-18T00:00:00.000Z'),
  }) as any);

  await assert.rejects(() => platformSkillService.archiveSkill('skill-deploy'), /系统必需 skill 不允许归档/);
});

test('ensureSeeded repairs missing governance column before reading seeded skills', async () => {
  let firstRead = true;
  (platformSkillService as any).seeded = false;
  const ensureSchemaMock = mock.method(
    platformSkillService as any,
    'ensureGovernanceSchemaReady',
    async () => undefined
  );
  mock.method(platformSkillDAO, 'getSkillBySlug', async (slug: string) => {
    if (firstRead) {
      firstRead = false;
      const error = new Error('column "metadata_json" does not exist') as Error & { code?: string };
      error.code = '42703';
      throw error;
    }
    return {
      id: `skill-${slug}`,
      slug,
      name: slug,
      description: `${slug} description`,
      category: 'general',
      status: 'active',
      metadataJson: {},
      publishedRevisionId: null,
      createdAt: new Date('2026-04-18T00:00:00.000Z'),
      updatedAt: new Date('2026-04-18T00:00:00.000Z'),
    } as any;
  });
  mock.method(platformSkillDAO, 'updateSkillMetadata', async () => undefined as any);
  mock.method(platformSkillDAO, 'createSkillWithRevision', async () => {
    throw new Error('should not create seeded skill when read succeeds after repair');
  });
  mock.method(platformSkillDAO, 'listSkills', async () => []);

  const skills = await platformSkillService.listAdminSkills();

  assert.deepEqual(skills, []);
  assert.equal(ensureSchemaMock.mock.callCount(), 1);
  assert.equal(firstRead, false);
});

test('importSkillFolder creates new skill using layered import payload', async () => {
  (platformSkillService as any).seeded = true;
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
  (platformSkillService as any).seeded = true;
  mock.method(platformSkillDAO, 'countSkills', async () => 1);
  mock.method(platformSkillDAO, 'getSkill', async () => ({
    id: 'skill-1',
    slug: 'office-ppt',
    name: 'Office PPT',
    description: 'original',
    category: 'general',
    status: 'active',
    metadataJson: {},
    publishedRevisionId: 'rev-1',
    createdAt: new Date('2026-03-29T00:00:00.000Z'),
    updatedAt: new Date('2026-03-29T00:00:00.000Z'),
  }) as any);
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
