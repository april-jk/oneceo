import assert from 'node:assert/strict';
import test from 'node:test';
import { altusManagedStreamService } from '../src/services/altus-managed-stream-service';
import { taskSessionRunDAO } from '../src/db/dao';

type FakeResponse = {
  headers: Record<string, string>;
  body: string[];
  writableEnded: boolean;
  setHeader(name: string, value: string): void;
  flushHeaders(): void;
  write(chunk: string): void;
  on(event: string, handler: () => void): void;
  emit(event: string): void;
};

function createFakeResponse(): FakeResponse {
  const listeners = new Map<string, Array<() => void>>();
  return {
    headers: {},
    body: [],
    writableEnded: false,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    flushHeaders() {},
    write(chunk: string) {
      this.body.push(chunk);
    },
    on(event: string, handler: () => void) {
      const current = listeners.get(event) || [];
      current.push(handler);
      listeners.set(event, current);
    },
    emit(event: string) {
      const current = listeners.get(event) || [];
      for (const handler of current) {
        handler();
      }
    },
  };
}

test('altus managed stream service prefers redis historical events before db fallback', async () => {
  const service: any = altusManagedStreamService;
  const originalRedisList = service.redisStateService.listRunEvents.bind(service.redisStateService);
  const originalDaoList = taskSessionRunDAO.listRunEvents.bind(taskSessionRunDAO);
  let daoCalled = false;

  service.redisStateService.listRunEvents = async () => [
    {
      sequence: 3,
      eventType: 'run_status',
      payload: {
        status: 'running',
        content: 'from redis',
      },
    },
  ];
  (taskSessionRunDAO as any).listRunEvents = async () => {
    daoCalled = true;
    return [];
  };

  const res = createFakeResponse() as any;
  try {
    await service.subscribe(
      {
        runId: 'run-stream-1',
        sessionId: 'session-stream-1',
        userId: 'user-stream-1',
      },
      res,
      {
        afterSequence: 0,
      }
    );

    const output = res.body.join('');
    res.emit('close');
    assert.equal(daoCalled, false);
    assert.match(output, /event: run_status/);
    assert.match(output, /from redis/);
  } finally {
    service.redisStateService.listRunEvents = originalRedisList;
    (taskSessionRunDAO as any).listRunEvents = originalDaoList;
  }
});

test('altus managed stream service falls back to db when redis has no stream history', async () => {
  const service: any = altusManagedStreamService;
  const originalRedisList = service.redisStateService.listRunEvents.bind(service.redisStateService);
  const originalDaoList = taskSessionRunDAO.listRunEvents.bind(taskSessionRunDAO);
  let daoCalled = false;

  service.redisStateService.listRunEvents = async () => [];
  (taskSessionRunDAO as any).listRunEvents = async () => {
    daoCalled = true;
    return [
      {
        sequence: 5,
        eventType: 'run_completed',
        payloadJson: {
          status: 'completed',
          content: 'from db',
        },
      },
    ];
  };

  const res = createFakeResponse() as any;
  try {
    await service.subscribe(
      {
        runId: 'run-stream-2',
        sessionId: 'session-stream-2',
        userId: 'user-stream-2',
      },
      res,
      {
        afterSequence: 0,
      }
    );

    const output = res.body.join('');
    res.emit('close');
    assert.equal(daoCalled, true);
    assert.match(output, /event: run_completed/);
    assert.match(output, /from db/);
  } finally {
    service.redisStateService.listRunEvents = originalRedisList;
    (taskSessionRunDAO as any).listRunEvents = originalDaoList;
  }
});
