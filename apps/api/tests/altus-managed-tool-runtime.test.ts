import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { AltusManagedToolRuntime } from '../src/services/altus-managed-tool-runtime';
import { sandboxSkillSyncService } from '../src/services/sandbox-skill-sync-service';

afterEach(() => {
  mock.reset();
});

test('load_skill_resource only allows active selected platform skills and returns synced path', async () => {
  const syncMock = mock.method(sandboxSkillSyncService, 'syncResolvedSkillResource', async () => ({
    taskSessionId: 'session-1',
    orchestratorSessionId: 'sandbox-1',
    skillId: 'skill-1',
    revisionId: 'rev-1',
    slug: 'office-ppt',
    resourcePath: 'references/slide-structure-guide.md',
    skillResourcePath: '/home/user/.config/opencode/skills/platform/office-ppt/references/slide-structure-guide.md',
    resourceType: 'reference',
  }));

  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [
      {
        sourceType: 'platform',
        skillId: 'skill-1',
        revisionId: 'rev-1',
        slug: 'office-ppt',
        name: 'PPT 办公',
        description: '创建专业演示文稿',
        category: 'office',
        renderedMarkdown: '# Skill Brief',
        revisionNumber: 3,
        resourceSummary: {
          totalCount: 2,
          referenceCount: 1,
          templateCount: 1,
          paths: ['references/slide-structure-guide.md', 'templates/business-deck-outline.md'],
        },
      },
    ],
  });

  const result = await runtime.execute('load_skill_resource', {
    skillId: 'skill-1',
    revisionId: 'rev-1',
    resourcePath: 'references/slide-structure-guide.md',
  });

  assert.equal(syncMock.mock.callCount(), 1);
  assert.equal(result.type, 'result');
  const payload = JSON.parse(result.content);
  assert.equal(payload.skillId, 'skill-1');
  assert.equal(payload.resourceType, 'reference');
  assert.match(payload.skillResourcePath, /office-ppt\/references\/slide-structure-guide\.md$/);
});

test('load_skill_resource rejects inactive or non-selected skills', async () => {
  const runtime = new AltusManagedToolRuntime({
    sessionId: 'session-1',
    sandboxId: 'sandbox-1',
    workspaceRoot: '/workspace/session-1',
    activeSkills: [],
  });

  await assert.rejects(
    runtime.execute('load_skill_resource', {
      skillId: 'skill-1',
      revisionId: 'rev-1',
      resourcePath: 'references/slide-structure-guide.md',
    }),
    /load_skill_resource_skill_not_active/
  );
});
