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
      slug: 'ppt-workflow',
      name: 'PPT 工作流',
      description: 'PPT 子任务编排',
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
    slug: 'ppt-workflow',
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
        slug: 'ppt-workflow',
        name: 'PPT 工作流',
        description: 'PPT 子任务编排',
        category: 'office',
        status: 'active',
      },
      revision: {
        id: 'rev-1',
        skillId: 'skill-1',
        revisionNumber: 3,
        slugSnapshot: 'ppt-workflow',
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

test('user can enable and resolve ppt workflow platform skill for managed runtime usage', async () => {
  const pptWorkflowSkill = {
    sourceType: 'platform',
    skillId: 'skill-ppt-workflow',
    revisionId: 'rev-ppt-workflow',
    slug: 'ppt-workflow',
    name: 'PPT 工作流',
    description: '按竞品式子任务编排完成 PPT 生成前工作流',
    category: 'office',
    revisionNumber: 1,
    resourceSummary: {
      totalCount: 4,
      referenceCount: 3,
      templateCount: 1,
      paths: [
        'references/subtask-contracts.md',
        'references/visual-plan-guide.md',
        'references/preflight-checklist.md',
        'templates/render-instruction-draft.md',
      ],
    },
    governance: {
      systemRole: null,
      adminManaged: true,
      required: false,
      autoActivation: {
        enabled: false,
        triggers: [],
        toolNames: [],
      },
    },
  };
  mock.method(platformSkillService, 'listPublicSkills', async () => [pptWorkflowSkill] as any);
  mock.method(platformSkillService, 'getAdminSkill', async () => ({
    id: 'skill-ppt-workflow',
    slug: 'ppt-workflow',
  }) as any);
  let enabled = false;
  mock.method(userSkillDAO, 'listPlatformBindings', async () =>
    enabled
      ? [
          {
            id: 'binding-ppt-workflow',
            userId: 'user-1',
            platformSkillId: 'skill-ppt-workflow',
            enabled: true,
          },
        ]
      : []
  );
  mock.method(userSkillDAO, 'upsertPlatformBinding', async (input: any) => {
    enabled = input.enabled;
    return {
      id: 'binding-ppt-workflow',
      userId: input.userId,
      platformSkillId: input.platformSkillId,
      enabled: input.enabled,
    } as any;
  });
  mock.method(userSkillDAO, 'listCustomSkills', async () => []);
  mock.method(taskCreationSessionDAO, 'getSession', async () => ({
    id: 'session-1',
    userId: 'user-1',
  }) as any);
  mock.method(platformSkillService, 'resolveSkillSelections', async () => [
    {
      skill: {
        id: 'skill-ppt-workflow',
        slug: 'ppt-workflow',
        name: 'PPT 工作流',
        description: '按竞品式子任务编排完成 PPT 生成前工作流',
        category: 'office',
        status: 'active',
        metadataJson: pptWorkflowSkill.governance,
      },
      revision: {
        id: 'rev-ppt-workflow',
        skillId: 'skill-ppt-workflow',
        revisionNumber: 1,
        slugSnapshot: 'ppt-workflow',
      },
      renderedMarkdown: '# Skill Brief: PPT 子任务编排工作流\n\n当前阶段不调用 PPT 专用渲染器。',
      signature: 'sig-ppt-workflow',
      resources: [],
      resourceSummary: pptWorkflowSkill.resourceSummary,
    },
  ] as any);
  mock.method(userSkillDAO, 'getPlatformBinding', async () => ({
    id: 'binding-ppt-workflow',
    userId: 'user-1',
    platformSkillId: 'skill-ppt-workflow',
    enabled: true,
  }) as any);

  await userSkillService.enablePlatformSkill('user-1', 'skill-ppt-workflow');
  const settings = await userSkillService.listSettings('user-1');
  const resolved = await userSkillService.resolveSelectionsForSession('session-1', [
    {
      sourceType: 'platform',
      skillId: 'skill-ppt-workflow',
      revisionId: 'rev-ppt-workflow',
    },
  ]);

  assert.equal(settings.availableSkills.length, 1);
  assert.equal(settings.availableSkills[0]?.slug, 'ppt-workflow');
  assert.equal(settings.availableSkills[0]?.resourceSummary?.totalCount, 4);
  assert.equal(settings.availableSkills[0]?.governance?.adminManaged, true);
  assert.equal(settings.availableSkills[0]?.governance?.autoActivation.enabled, false);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.slug, 'ppt-workflow');
  assert.match(resolved[0]?.renderedMarkdown || '', /PPT 专用渲染器/);
  assert.equal(resolved[0]?.resourceSummary?.templateCount, 1);
  assert.equal(resolved[0]?.governance?.required, false);
});

test('listSettings backfills missing required and auto-activation platform bindings for existing users', async () => {
  mock.method(platformSkillService, 'listPublicSkills', async () => [
    {
      sourceType: 'platform',
      skillId: 'skill-office',
      revisionId: 'rev-office',
      slug: 'office-docx',
      name: 'Word 文档',
      description: '已有启用 skill',
      category: 'office',
      revisionNumber: 1,
      resourceSummary: null,
      governance: {
        systemRole: null,
        adminManaged: true,
        required: false,
        autoActivation: {
          enabled: false,
          triggers: [],
          toolNames: [],
        },
      },
    },
    {
      sourceType: 'platform',
      skillId: 'skill-ppt-workflow',
      revisionId: 'rev-ppt-workflow',
      slug: 'ppt-workflow',
      name: 'PPT 工作流',
      description: 'PPT 子任务编排',
      category: 'office',
      revisionNumber: 1,
      resourceSummary: null,
      governance: {
        systemRole: null,
        adminManaged: true,
        required: false,
        autoActivation: {
          enabled: true,
          triggers: ['ppt'],
          toolNames: [],
        },
      },
    },
    {
      sourceType: 'platform',
      skillId: 'skill-required',
      revisionId: 'rev-required',
      slug: 'required-governed-skill',
      name: '系统常驻 Skill',
      description: '用于验证 required backfill',
      category: 'general',
      revisionNumber: 1,
      resourceSummary: null,
      governance: {
        systemRole: null,
        adminManaged: true,
        required: true,
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
        id: `binding-${input.platformSkillId}`,
        userId: input.userId,
        platformSkillId: input.platformSkillId,
        enabled: input.enabled,
      },
    ];
    return bindings[bindings.length - 1] as any;
  });
  mock.method(userSkillDAO, 'listCustomSkills', async () => []);

  const settings = await userSkillService.listSettings('user-1');

  assert.equal(upsertMock.mock.callCount(), 2);
  assert.equal(settings.availableSkills.some((item) => item.skillId === 'skill-office'), true);
  assert.equal(settings.availableSkills.some((item) => item.skillId === 'skill-ppt-workflow'), true);
  assert.equal(settings.availableSkills.some((item) => item.skillId === 'skill-required'), true);
});
