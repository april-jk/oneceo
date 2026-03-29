import '../../src/config/env.ts';
import { writeFile } from 'node:fs/promises';
import { e2bConnector } from '../../src/connectors/e2b-connector';

const API_BASE = `http://127.0.0.1:${process.env.PORT || '4000'}`;
const USER_ID = `codex-ppt-visual-smoke-${Date.now()}`;
const FIXED_SANDBOX_ID = String(process.env.OSAC_FIXED_SANDBOX_SESSION_ID || '').trim();
const RESULT_FILE_URL = new URL('../../.tmp_ppt_visual_smoke_result.json', import.meta.url);
const PROMPT =
  '帮我生成一份职业规划 PPT，要求包含封面配图、至少两页图文排版、引用外部资料来源，最终文件名为 career-plan-visual.pptx。';
const TIMEOUT_MS = 8 * 60 * 1000;

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function headers(extra?: Record<string, string>) {
  return {
    'X-User-Id': USER_ID,
    ...(extra || {}),
  };
}

async function parseJson(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function ensureOk(response: Response, label: string) {
  if (response.ok) return response;
  const payload = await parseJson(response);
  throw new Error(`${label}_failed:${response.status}:${JSON.stringify(payload).slice(0, 1200)}`);
}

function parseSseDataBlocks(raw: string) {
  const blocks = raw.split(/\r?\n\r?\n/).filter(Boolean);
  const payloads: any[] = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const dataLines = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    if (dataLines.length === 0) continue;
    const data = dataLines.join('\n');
    if (data === '[DONE]') continue;
    try {
      payloads.push(JSON.parse(data));
    } catch {
      payloads.push({ raw: data });
    }
  }
  return payloads;
}

async function main() {
  let sessionId = '';
  let runtimeSandboxId = '';
  try {
    const createResp = await ensureOk(
      await fetch(`${API_BASE}/api/task-creation/sessions`, {
        method: 'POST',
        headers: headers({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          title: 'PPT visual smoke',
          mode: 'altus',
        }),
      }),
      'create_session'
    );
    const createPayload = (await createResp.json()) as any;
    sessionId = asText(createPayload?.data?.id);
    if (!sessionId) {
      throw new Error('session_id_missing');
    }

    const skillsResp = await ensureOk(
      await fetch(`${API_BASE}/api/task-creation/skills`, {
        headers: headers(),
      }),
      'list_skills'
    );
    const skillsPayload = (await skillsResp.json()) as any;
    const skills = Array.isArray(skillsPayload?.data) ? skillsPayload.data : [];
    const pptSkill = skills.find((item: any) => asText(item?.slug) === 'office-ppt');
    if (!pptSkill?.skillId || !pptSkill?.revisionId) {
      throw new Error('office_ppt_skill_missing');
    }

    const runResp = await ensureOk(
      await fetch(`${API_BASE}/api/altus-managed/sessions/${encodeURIComponent(sessionId)}/runs`, {
        method: 'POST',
        headers: headers({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          content: PROMPT,
          messageKey: `codex:ppt-visual:${Date.now()}`,
          metadata: {
            skills: [
              {
                skillId: pptSkill.skillId,
                revisionId: pptSkill.revisionId,
                slug: pptSkill.slug,
                name: pptSkill.name,
                description: pptSkill.description,
                category: pptSkill.category,
                revisionNumber: pptSkill.revisionNumber,
              },
            ],
          },
        }),
      }),
      'start_run'
    );
    const runPayload = (await runResp.json()) as any;
    const runId = asText(runPayload?.data?.id || runPayload?.data?.runId);
    if (!runId) {
      throw new Error('run_id_missing');
    }

    const streamResp = await ensureOk(
      await fetch(
        `${API_BASE}/api/altus-managed/runs/${encodeURIComponent(runId)}/stream?userId=${encodeURIComponent(USER_ID)}`,
        {
          headers: headers(),
        }
      ),
      'stream_run'
    );

    const startedAt = Date.now();
    const toolNames = new Set<string>();
    let latestRunStatus = '';
    const streamEvents: Array<Record<string, unknown>> = [];

    if (!streamResp.body) {
      throw new Error('managed_stream_body_missing');
    }

    const reader = streamResp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (Date.now() - startedAt < TIMEOUT_MS) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const segments = buffer.split(/\r?\n\r?\n/);
      buffer = segments.pop() || '';
      for (const segment of segments) {
        const payloads = parseSseDataBlocks(segment);
        for (const payload of payloads) {
          const record =
            payload && typeof payload === 'object' && !Array.isArray(payload)
              ? (payload as Record<string, unknown>)
              : { raw: payload };
          streamEvents.push(record);
          const nestedPayload =
            record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
              ? (record.payload as Record<string, unknown>)
              : {};

          const runStatus = asText(
            record.status || record.runStatus || nestedPayload.status || nestedPayload.runStatus
          ).toLowerCase();
          const eventType = asText(record.eventType || nestedPayload.eventType).toLowerCase();
          const toolName = asText(record.toolName || nestedPayload.toolName);
          const sandboxId = asText(record.sandboxId || nestedPayload.sandboxId);
          if (toolName) {
            toolNames.add(toolName);
          }
          if (sandboxId) {
            runtimeSandboxId = sandboxId;
          }
          if (runStatus) {
            latestRunStatus = runStatus;
          } else if (eventType === 'run_completed') {
            latestRunStatus = 'completed';
          } else if (eventType === 'run_failed') {
            latestRunStatus = 'failed';
          } else if (eventType === 'run_stopped') {
            latestRunStatus = 'stopped';
          }
          if (['completed', 'failed', 'waiting_user', 'stopped'].includes(latestRunStatus)) {
            break;
          }
        }
        if (['completed', 'failed', 'waiting_user', 'stopped'].includes(latestRunStatus)) {
          break;
        }
      }
      if (['completed', 'failed', 'waiting_user', 'stopped'].includes(latestRunStatus)) {
        break;
      }
    }
    await reader.cancel().catch(() => undefined);

    const deliverablesResp = await ensureOk(
      await fetch(`${API_BASE}/api/task-creation/sessions/${encodeURIComponent(sessionId)}/deliverables`, {
        headers: headers(),
      }),
      'deliverables'
    );
    const deliverablesPayload = (await deliverablesResp.json()) as any;
    const deliverables = Array.isArray(deliverablesPayload?.data) ? deliverablesPayload.data : [];

    let downloadSummary: Record<string, unknown> | null = null;
    if (deliverables[0]?.id) {
      const artifactId = encodeURIComponent(String(deliverables[0].id));
      const downloadResp = await ensureOk(
        await fetch(
          `${API_BASE}/api/task-creation/sessions/${encodeURIComponent(sessionId)}/deliverables/${artifactId}/download`,
          {
            headers: headers(),
          }
        ),
        'download_deliverable'
      );
      const buffer = Buffer.from(await downloadResp.arrayBuffer());
      downloadSummary = {
        bytes: buffer.length,
        contentType: downloadResp.headers.get('content-type') || '',
        contentDisposition: downloadResp.headers.get('content-disposition') || '',
      };
    }

    const summary = {
      sessionId,
      runId,
      latestRunStatus,
      runtimeSandboxId,
      usedTools: Array.from(toolNames).sort(),
      streamTail: streamEvents.slice(-12),
      deliverables,
      downloadSummary,
    };
    await writeFile(RESULT_FILE_URL, JSON.stringify(summary, null, 2), 'utf8');
    console.log(
      JSON.stringify(summary, null, 2)
    );
  } finally {
    if (runtimeSandboxId && runtimeSandboxId !== FIXED_SANDBOX_ID) {
      try {
        await e2bConnector.killSandbox(runtimeSandboxId);
        console.log(`[cleanup] sandbox killed: ${runtimeSandboxId}`);
      } catch (error) {
        console.warn('[cleanup] sandbox kill failed:', runtimeSandboxId, error);
      }
    }

    if (sessionId) {
      try {
        await fetch(`${API_BASE}/api/task-creation/sessions/${encodeURIComponent(sessionId)}`, {
          method: 'DELETE',
          headers: headers(),
        });
        console.log(`[cleanup] session deleted: ${sessionId}`);
      } catch (error) {
        console.warn('[cleanup] session delete failed:', sessionId, error);
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
