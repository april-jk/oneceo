import assert from 'node:assert/strict';
import { test } from 'node:test';
import { altusManagedDynamicContextBlockService } from '../src/services/altus-managed-dynamic-context-blocks';
import { AltusManagedContextManifestService } from '../src/services/altus-managed-context-manifest-service';
import { AltusManagedContextLedgerAdapter } from '../src/services/altus-managed-context-ledger-adapter';

const customSkill = {
  sourceType: 'custom' as const,
  skillId: 'skill-custom-1',
  revisionId: 'rev-custom-1',
  slug: 'customer-admin',
  name: 'Customer Admin',
  description: 'Build admin systems',
  category: 'business',
  renderedMarkdown: '# Customer Admin\n\nUse admin conventions.',
  revisionNumber: 7,
  resourceSummary: {
    totalCount: 1,
    referenceCount: 1,
    templateCount: 0,
    paths: ['references/admin.md'],
  },
};

test('dynamic context blocks preserve selected custom skill identity', () => {
  const blocks = altusManagedDynamicContextBlockService.buildSkillBlocks({
    activeSkills: [customSkill],
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.type, 'skill');
  assert.equal(blocks[0]?.visibility, 'model_context');
  assert.equal((blocks[0]?.payload as any).sourceType, 'custom');
  assert.equal((blocks[0]?.payload as any).skillId, 'skill-custom-1');
  assert.equal((blocks[0]?.payload as any).revisionId, 'rev-custom-1');
  assert.equal((blocks[0]?.payload as any).activatedBy, 'selected');
  assert.match(blocks[0]?.hash || '', /^[a-f0-9]{64}$/);
});

test('dynamic context blocks mark auto-attached skills as next-turn delta', () => {
  const blocks = altusManagedDynamicContextBlockService.buildSkillBlocks({
    autoAttachedSkills: [customSkill],
    toolName: 'load_skill_resource',
  });
  const manifest = altusManagedDynamicContextBlockService.buildIncludedContextManifest(blocks);

  assert.equal(blocks[0]?.visibility, 'next_turn_delta');
  assert.equal((blocks[0]?.payload as any).activatedBy, 'auto_attached');
  assert.equal((blocks[0]?.payload as any).toolName, 'load_skill_resource');
  assert.equal(manifest.blocks[0]?.id, blocks[0]?.id);
  assert.match(manifest.hash, /^[a-f0-9]{64}$/);
});

test('dynamic context blocks represent mcp provider snapshot and guide delta state', () => {
  const blocks = altusManagedDynamicContextBlockService.buildMcpBlocks({
    snapshotId: 'snapshot-mcp-1',
    loadedGuideRevisions: {
      github: 'guide-rev-1',
    },
    providers: [
      {
        providerId: 'provider-github',
        connectorKey: 'github',
        tools: [
          {
            providerId: 'provider-github',
            toolName: 'search_repositories',
          },
        ],
      },
    ],
  });

  assert.equal(blocks[0]?.type, 'mcp');
  assert.equal((blocks[0]?.payload as any).providerId, 'provider-github');
  assert.equal((blocks[0]?.payload as any).connectorKey, 'github');
  assert.equal((blocks[0]?.payload as any).snapshotId, 'snapshot-mcp-1');
  assert.equal((blocks[0]?.payload as any).guideLoaded, true);
  assert.equal((blocks[0]?.payload as any).guideRevisionId, 'guide-rev-1');
});

test('dynamic context blocks preserve attachment object refs for replay', () => {
  const blocks = altusManagedDynamicContextBlockService.buildAttachmentBlocks([
    {
      messageKey: 'message-attachment-1',
      createdAt: '2026-04-26T03:00:00.000Z',
      metadata: {
        attachments: [
          {
            name: 'screenshot.png',
            path: 'uploads/screenshot.png',
            mimeType: 'image/png',
            externalObjectKey: 'managed-images/session/message/screenshot.png',
          },
        ],
      },
    },
  ]);

  assert.equal(blocks[0]?.type, 'attachment');
  assert.equal((blocks[0]?.payload as any).externalObjectKey, 'managed-images/session/message/screenshot.png');
  assert.equal((blocks[0]?.payload as any).apiVisibility, 'signed_url_refreshable');
  assert.equal((blocks[0]?.payload as any).messageKey, 'message-attachment-1');
});

test('dynamic context blocks hash memory with explicit session-fact precedence', () => {
  const blocks = altusManagedDynamicContextBlockService.buildMemoryBlocks({
    userMemory: { preference: '中文回答' },
    sessionMemory: { summary: { goal: '做用户管理系统' } },
  });

  assert.deepEqual(
    blocks.map((block) => block.id),
    ['memory:user', 'memory:session']
  );
  assert.equal((blocks[0]?.payload as any).precedence, 'session_explicit_fact_wins');
  assert.match(blocks[0]?.hash || '', /^[a-f0-9]{64}$/);
});

test('context manifest can explain included dynamic context blocks', () => {
  const ledger = new AltusManagedContextLedgerAdapter().buildFromRecords({
    sessionId: 'session-dynamic-manifest',
    messages: [
      {
        id: 'message-1',
        role: 'user',
        content: '做一个后台',
        messageKey: 'message-1',
      },
    ],
  });
  const blocks = altusManagedDynamicContextBlockService.buildSkillBlocks({
    activeSkills: [customSkill],
  });
  const includedContext = altusManagedDynamicContextBlockService.buildIncludedContextManifest(blocks);
  const manifest = new AltusManagedContextManifestService().buildManifest(ledger, {
    includedContext,
  });

  assert.equal(manifest.includedContext?.hash, includedContext.hash);
  assert.equal(manifest.includedContext?.blocks[0]?.type, 'skill');
  assert.equal(manifest.includedContext?.blocks[0]?.id, blocks[0]?.id);
});
