import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { taskCreationSessionDAO, userSkillDAO } from '../src/db/dao';
import { platformSkillService } from '../src/services/platform-skill-service';
import { userSkillService } from '../src/services/user-skill-service';

afterEach(() => {
  mock.reset();
});

test('user can enable platform skill and list it as available', async () => {
  mock.method(platformSkillService, 'listPublicSkills', async () => [
    {
      sourceType: 'platform',
      skillId: 'skill-1',
      revisionId: 'rev-1',
      slug: 'office-ppt',
      name: 'PPT 办公',
      description: '创建专业演示文稿',
      category: 'office',
      revisionNumber: 3,
      resourceSummary: {
        totalCount: 1,
        referenceCount: 1,
        templateCount: 0,
        paths: ['references/guide.md'],
      },
    },
  ] as any);
  mock.method(platformSkillService, 'getAdminSkill', async () => ({
    id: 'skill-1',
    slug: 'office-ppt',
  }) as any);
  let enabled = false;
  mock.method(userSkillDAO, 'listPlatformBindings', async () =>
    enabled
      ? [
          {
            id: 'binding-1',
            userId: 'user-1',
            platformSkillId: 'skill-1',
            enabled: true,
          },
        ]
      : []
  );
  const upsertMock = mock.method(userSkillDAO, 'upsertPlatformBinding', async () => ({
    id: 'binding-1',
    userId: 'user-1',
    platformSkillId: 'skill-1',
    enabled: true,
  }) as any);
  mock.method(userSkillDAO, 'listCustomSkills', async () => []);

  await userSkillService.enablePlatformSkill('user-1', 'skill-1');
  enabled = true;
  const settings = await userSkillService.listSettings('user-1');

  assert.equal(upsertMock.mock.callCount(), 1);
  assert.equal(settings.availableSkills.length, 1);
  assert.equal(settings.availableSkills[0]?.skillId, 'skill-1');
});

test('user can create custom skill and resolve it for task usage', async () => {
  mock.method(taskCreationSessionDAO, 'getSession', async () => ({
    id: 'session-1',
    userId: 'user-1',
  }) as any);
  mock.method(userSkillDAO, 'getCustomSkillBySlug', async () => null);
  const createMock = mock.method(userSkillDAO, 'createCustomSkill', async (input: any) => ({
    id: 'custom-1',
    ...input,
    updatedAt: new Date('2026-03-29T00:00:00.000Z'),
  }) as any);
  const replaceDocsMock = mock.method(userSkillDAO, 'replaceCustomSkillDocuments', async () => []);
  mock.method(userSkillDAO, 'getCustomSkill', async (_userId: string, skillId: string) => ({
    id: skillId,
    userId: 'user-1',
    slug: 'my-custom-skill',
    name: '我的技能',
    description: '自定义说明',
    category: 'general',
    status: 'active',
    bodyMarkdown: '# Custom Body',
    updatedAt: new Date('2026-03-29T00:00:00.000Z'),
  }) as any);
  mock.method(userSkillDAO, 'listCustomSkillDocuments', async () => [
    {
      id: 'doc-1',
      customSkillId: 'custom-1',
      documentKey: 'guide',
      documentPath: 'references/guide.md',
      title: 'Guide',
      summary: 'Read this guide when needed',
      bodyMarkdown: '# Guide',
      sortOrder: 0,
      createdAt: new Date('2026-03-29T00:00:00.000Z'),
      updatedAt: new Date('2026-03-29T00:00:00.000Z'),
    },
  ] as any);

  const created = await userSkillService.createCustomSkill('user-1', {
    slug: 'my-custom-skill',
    name: '我的技能',
    description: '自定义说明',
    category: 'general',
    bodyMarkdown: '# Custom Body',
    documents: [
      {
        documentPath: 'references/guide.md',
        title: 'Guide',
        summary: 'Read this guide when needed',
        bodyMarkdown: '# Guide',
      },
    ],
  });

  const resolved = await userSkillService.resolveSelectionsForSession('session-1', [
    {
      sourceType: 'custom',
      skillId: created.id,
      revisionId: created.id,
    },
  ]);

  assert.equal(createMock.mock.callCount(), 1);
  assert.equal(replaceDocsMock.mock.callCount(), 1);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.sourceType, 'custom');
  assert.match(resolved[0]?.renderedMarkdown || '', /Custom Body/);
  assert.equal(resolved[0]?.resourceSummary?.totalCount, 1);
});

test('user can resolve enabled platform skill for managed runtime usage', async () => {
  mock.method(taskCreationSessionDAO, 'getSession', async () => ({
    id: 'session-1',
    userId: 'user-1',
  }) as any);
  mock.method(platformSkillService, 'resolveSkillSelections', async () => [
    {
      skill: {
        id: 'skill-1',
        slug: 'office-ppt',
        name: 'PPT 办公',
        description: '创建专业演示文稿',
        category: 'office',
        status: 'active',
      },
      revision: {
        id: 'rev-1',
        skillId: 'skill-1',
        revisionNumber: 3,
        slugSnapshot: 'office-ppt',
      },
      renderedMarkdown: '# Skill Brief',
      signature: 'sig-1',
      resources: [],
      resourceSummary: {
        totalCount: 1,
        referenceCount: 1,
        templateCount: 0,
        paths: ['references/guide.md'],
      },
    },
  ] as any);
  mock.method(userSkillDAO, 'getPlatformBinding', async () => ({
    id: 'binding-1',
    userId: 'user-1',
    platformSkillId: 'skill-1',
    enabled: true,
  }) as any);

  const resolved = await userSkillService.resolveSelectionsForSession('session-1', [
    {
      sourceType: 'platform',
      skillId: 'skill-1',
      revisionId: 'rev-1',
    },
  ]);

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.sourceType, 'platform');
  assert.equal(resolved[0]?.skillId, 'skill-1');
  assert.match(resolved[0]?.renderedMarkdown || '', /Skill Brief/);
});

test('listSettings backfills missing required platform bindings for existing users', async () => {
  mock.method(platformSkillService, 'listPublicSkills', async () => [
    {
      sourceType: 'platform',
      skillId: 'skill-deploy',
      revisionId: 'rev-deploy',
      slug: 'deployment-orchestrator',
      name: '部署编排',
      description: '自动处理部署工作流',
      category: 'deployment',
      revisionNumber: 1,
      resourceSummary: null,
      governance: {
        systemRole: 'deployment_orchestrator',
        adminManaged: true,
        required: true,
        autoActivation: {
          enabled: true,
          triggers: ['deploy'],
          toolNames: ['deploy_application'],
        },
      },
    },
    {
      sourceType: 'platform',
      skillId: 'skill-office',
      revisionId: 'rev-office',
      slug: 'office-ppt',
      name: 'PPT 办公',
      description: '创建专业演示文稿',
      category: 'office',
      revisionNumber: 1,
      resourceSummary: null,
      governance: {
        systemRole: null,
        adminManaged: false,
        required: false,
        autoActivation: {
          enabled: false,
          triggers: [],
          toolNames: [],
        },
      },
    },
  ] as any);
  let bindings = [
    {
      id: 'binding-office',
      userId: 'user-1',
      platformSkillId: 'skill-office',
      enabled: true,
    },
  ];
  mock.method(userSkillDAO, 'listPlatformBindings', async () => bindings as any);
  const upsertMock = mock.method(userSkillDAO, 'upsertPlatformBinding', async (input: any) => {
    bindings = [
      ...bindings,
      {
        id: 'binding-deploy',
        userId: input.userId,
        platformSkillId: input.platformSkillId,
        enabled: input.enabled,
      },
    ];
    return bindings[bindings.length - 1] as any;
  });
  mock.method(userSkillDAO, 'listCustomSkills', async () => []);

  const settings = await userSkillService.listSettings('user-1');

  assert.equal(upsertMock.mock.callCount(), 1);
  assert.equal(settings.availableSkills.some((item) => item.skillId === 'skill-deploy'), true);
});
