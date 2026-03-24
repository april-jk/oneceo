import type express from 'express';
import { taskSessionRunDAO } from '../db/dao';

type ManagedStreamEnvelope = {
  sequence: number;
  eventType: string;
  payload: Record<string, unknown>;
};

type Subscriber = {
  res: express.Response;
  closed: boolean;
};

function writeSse(res: express.Response, input: ManagedStreamEnvelope) {
  if (res.writableEnded) return;
  res.write(`id: ${input.sequence}\n`);
  res.write(`event: ${input.eventType}\n`);
  res.write(`data: ${JSON.stringify({
    sequence: input.sequence,
    eventType: input.eventType,
    payload: input.payload,
  })}\n\n`);
}

export class AltusManagedStreamService {
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  async subscribe(runId: string, res: express.Response, options?: { afterSequence?: number | null }) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const historical = await taskSessionRunDAO.listRunEvents(runId, {
      afterSequence: options?.afterSequence ?? null,
    });
    for (const event of historical) {
      writeSse(res, {
        sequence: Number(event.sequence || 0),
        eventType: String(event.eventType || 'message'),
        payload: ((event.payloadJson || {}) as Record<string, unknown>) || {},
      });
    }

    const subscriber: Subscriber = {
      res,
      closed: false,
    };

    const current = this.subscribers.get(runId) || new Set<Subscriber>();
    current.add(subscriber);
    this.subscribers.set(runId, current);

    const cleanup = () => {
      if (subscriber.closed) return;
      subscriber.closed = true;
      const set = this.subscribers.get(runId);
      if (!set) return;
      set.delete(subscriber);
      if (set.size === 0) {
        this.subscribers.delete(runId);
      }
    };

    res.on('close', cleanup);
    res.on('finish', cleanup);
    res.on('error', cleanup);

    const heartbeat = setInterval(() => {
      if (subscriber.closed || res.writableEnded) {
        cleanup();
        clearInterval(heartbeat);
        return;
      }
      res.write(`event: heartbeat\ndata: {"ok":true}\n\n`);
    }, 15000);

    res.on('close', () => clearInterval(heartbeat));
    res.on('finish', () => clearInterval(heartbeat));
    res.on('error', () => clearInterval(heartbeat));
  }

  publish(runId: string, input: ManagedStreamEnvelope) {
    const subscribers = this.subscribers.get(runId);
    if (!subscribers || subscribers.size === 0) return;
    for (const subscriber of subscribers) {
      if (subscriber.closed || subscriber.res.writableEnded) {
        continue;
      }
      writeSse(subscriber.res, input);
    }
  }
}

export const altusManagedStreamService = new AltusManagedStreamService();
