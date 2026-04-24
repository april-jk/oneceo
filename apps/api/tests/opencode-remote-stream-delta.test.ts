import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  inspectLatestAssistantTurn,
  isMeaningfulArtifactFile,
  OpencodeRemoteService,
} from '../src/services/opencode-remote-service';

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

test('inspectLatestAssistantTurn ignores trailing empty assistant placeholders', () => {
  const result = inspectLatestAssistantTurn(
    [
      {
        info: { role: 'assistant', time: { created: 2000, completed: 2600 }, id: 'assistant-1' },
        parts: [
          { type: 'step-start', id: 'step-1' },
          { type: 'tool', tool: 'write', state: { status: 'completed', time: { start: 2200, end: 2400 } } },
          { type: 'step-finish', id: 'step-1' },
        ],
      },
      {
        info: { role: 'assistant', time: { created: 3000 }, id: 'assistant-empty' },
        parts: [],
      },
    ],
    0
  );

  assert.equal(result.assistantObserved, true);
  assert.equal(result.hasActiveAssistantParts, false);
  assert.match(result.latestAssistantSignature, /assistant-1/);
});

test('inspectLatestAssistantTurn ignores step-only assistant loops without content', () => {
  const result = inspectLatestAssistantTurn(
    [
      {
        info: { role: 'assistant', time: { created: 2000, completed: 2600 }, id: 'assistant-text' },
        parts: [{ type: 'text', text: '准备创建样例 CSV 并继续执行。' }],
      },
      {
        info: { role: 'assistant', time: { created: 3000, completed: 3200 }, id: 'assistant-step-only' },
        parts: [
          { type: 'step-start', id: 'step-2' },
          { type: 'step-finish', id: 'step-2' },
        ],
      },
    ],
    0
  );

  assert.equal(result.assistantObserved, true);
  assert.equal(result.hasActiveAssistantParts, false);
  assert.match(result.latestAssistantText, /样例 CSV/);
  assert.match(result.latestAssistantSignature, /assistant-text/);
});

test('isMeaningfulArtifactFile keeps script sample data out of deliverable detection', () => {
  assert.equal(isMeaningfulArtifactFile('sample_data.csv', 'script_artifact'), false);
  assert.equal(isMeaningfulArtifactFile('report.md', 'script_artifact'), true);
  assert.equal(isMeaningfulArtifactFile('analyze_csv.py', 'script_artifact'), true);
});
