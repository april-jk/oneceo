import '../src/config/env';

import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { db } from '../src/config/database';
import {
  sandboxExecutionEnvironmentDAO,
  taskCreationSessionDAO,
  taskSessionRunDAO,
} from '../src/db/dao';
import {
  conversationMessages,
  taskSessionRunEvents,
  taskSessionRuns,
} from '../src/db/schema';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function compactContent(value: unknown, limit = 280) {
  const text = asText(value);
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function asRecord(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

async function main() {
  const sessionId = asText(process.argv[2] || process.env.ONECEO_E2E_SESSION_ID);
  if (!sessionId) {
    throw new Error('missing sessionId');
  }

  const session = await taskCreationSessionDAO.getSession(sessionId);
  const latestRun = await taskSessionRunDAO.getLatestRun(sessionId);
  const runs = await db
    .select()
    .from(taskSessionRuns)
    .where(eq(taskSessionRuns.sessionId, sessionId))
    .orderBy(desc(taskSessionRuns.createdAt))
    .limit(6);

  const runIds = runs.map((item) => item.id);
  const toolStartEvents =
    runIds.length > 0
      ? await db
          .select()
          .from(taskSessionRunEvents)
          .where(
            and(
              inArray(taskSessionRunEvents.runId, runIds),
              eq(taskSessionRunEvents.eventType, 'tool_call_started'),
            ),
          )
          .orderBy(asc(taskSessionRunEvents.createdAt), asc(taskSessionRunEvents.sequence))
      : [];

  const messages = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.sessionId, sessionId))
    .orderBy(desc(conversationMessages.timelineCursor))
    .limit(40);

  const canonicalSandbox = await sandboxExecutionEnvironmentDAO.findCanonicalByTaskSessionId(sessionId);

  const toolEvents = toolStartEvents
    .map((item) => ({
      runId: item.runId,
      sequence: item.sequence,
      createdAt: item.createdAt,
      toolName: asText((item.payloadJson as Record<string, unknown> | null)?.toolName),
      content: compactContent((item.payloadJson as Record<string, unknown> | null)?.content),
    }))
    .sort((left, right) => {
      const createdDelta = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      if (createdDelta !== 0) {
        return createdDelta;
      }
      return Number(left.sequence) - Number(right.sequence);
    });

  const autoAttachedMessages = messages
    .filter((item) => {
      const metadata = asRecord(item.metadata);
      return (
        item.content.includes('# Newly auto-attached skills') ||
        item.content.includes('deployment-orchestrator') ||
        asText(metadata.eventType) === 'managed_skill_auto_attached'
      );
    })
    .map((item) => ({
      role: item.role,
      messageType: item.messageType,
      messageKey: item.messageKey,
      createdAt: item.createdAt,
      content: compactContent(item.content, 600),
      metadata: {
        eventType: asText(asRecord(item.metadata).eventType),
        toolName: asText(asRecord(item.metadata).toolName),
        skillSlugs: asRecord(item.metadata).skillSlugs || [],
        promptMarkdown: compactContent(asRecord(item.metadata).promptMarkdown, 600),
      },
    }));

  const recentMessages = messages
    .slice()
    .reverse()
    .slice(-12)
    .map((item) => ({
      role: item.role,
      messageType: item.messageType,
      messageKey: item.messageKey,
      content: compactContent(item.content, 220),
      createdAt: item.createdAt,
      metadata: {
        eventType: asText(asRecord(item.metadata).eventType),
        toolName: asText(asRecord(item.metadata).toolName),
        skillSlugs: asRecord(item.metadata).skillSlugs || [],
      },
    }));

  console.log(
    JSON.stringify(
      {
        ok: true,
        sessionId,
        session: session
          ? {
              id: session.id,
              status: session.status,
              stage: session.stage,
              phase: session.phase,
              title: session.title,
              runtimeGeneration: session.runtimeGeneration,
              updatedAt: session.updatedAt,
            }
          : null,
        latestRun: latestRun
          ? {
              id: latestRun.id,
              status: latestRun.status,
              mode: latestRun.mode,
              createdAt: latestRun.createdAt,
              completedAt: latestRun.completedAt,
            }
          : null,
        runs: runs.map((item) => ({
          id: item.id,
          status: item.status,
          mode: item.mode,
          createdAt: item.createdAt,
          completedAt: item.completedAt,
        })),
        toolEvents,
        autoAttachedMessages,
        recentMessages,
        sandbox: canonicalSandbox
          ? {
              sessionId: canonicalSandbox.sessionId,
              orchestratorSessionId: canonicalSandbox.orchestratorSessionId,
              status: canonicalSandbox.status,
              deploymentState:
                (canonicalSandbox.metadata as Record<string, unknown> | null)?.deploymentState || null,
            }
          : null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
