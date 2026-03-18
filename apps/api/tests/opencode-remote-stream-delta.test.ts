import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpencodeRemoteService } from '../src/services/opencode-remote-service';

test('upsertTextStream derives delta from successive full-text snapshots', () => {
  const service = new OpencodeRemoteService();
  const upsertTextStream = (service as any).upsertTextStream.bind(service) as (input: {
    taskSessionId: string;
    orchestratorSessionId: string;
    opencodeSessionId: string;
    partId: string;
    text: string;
    delta: string;
    updatedAt: number;
  }) => { streamKey: string; text: string; delta: string; resetFrom?: string };

  const first = upsertTextStream({
    taskSessionId: 'task-1',
    orchestratorSessionId: 'orch-1',
    opencodeSessionId: 'sess-1',
    partId: 'part-1',
    text: 'Hello',
    delta: '',
    updatedAt: 1,
  });
  const second = upsertTextStream({
    taskSessionId: 'task-1',
    orchestratorSessionId: 'orch-1',
    opencodeSessionId: 'sess-1',
    partId: 'part-1',
    text: 'Hello world',
    delta: '',
    updatedAt: 2,
  });

  assert.equal(first.text, 'Hello');
  assert.equal(first.delta, 'Hello');
  assert.equal(second.text, 'Hello world');
  assert.equal(second.delta, ' world');
  assert.equal(second.resetFrom, undefined);
});
