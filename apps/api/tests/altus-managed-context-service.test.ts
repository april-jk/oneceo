import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildManagedConversationEntries } from '../src/services/altus-managed-context-service';

function makeHistory(count: number) {
  return Array.from({ length: count }).map((_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    messageType: index % 2 === 0 ? 'user_input' : 'assistant_message',
    content: `message-${index + 1}`,
    metadata: {},
  }));
}

test('buildManagedConversationEntries keeps minimum tail entries under token pressure', () => {
  const entries = buildManagedConversationEntries(makeHistory(30), {
    limit: 30,
    tokenBudget: 12,
    minTailEntries: 6,
  });

  assert.equal(entries.length, 6);
  assert.equal(entries[0]?.content, 'message-25');
  assert.equal(entries[5]?.content, 'message-30');
});

test('buildManagedConversationEntries expands beyond minimum tail when budget allows', () => {
  const entries = buildManagedConversationEntries(makeHistory(20), {
    limit: 20,
    tokenBudget: 120,
    minTailEntries: 4,
  });

  assert.ok(entries.length > 4);
  assert.equal(entries.at(-1)?.content, 'message-20');
  assert.equal(entries[0]?.content, `message-${20 - entries.length + 1}`);
});
