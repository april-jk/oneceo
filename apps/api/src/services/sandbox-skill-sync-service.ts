import { createHash } from 'node:crypto';
import { opencodeHttpClient } from '../connectors/opencode-http-client';
import { e2bConnector } from '../connectors/e2b-connector';
import { e2bConfig } from '../config/e2b-config';
import { taskCreationFileMemoryStore } from '../agents/task-creation/file-memory-store';
import { taskSessionRunDAO } from '../db/dao';
import { ensureSandboxRuntimeMetadata } from './sandbox-runtime-metadata-service';
import {
  computeSkillSignature,
  platformSkillService,
} from './platform-skill-service';
import { touchSandbox } from './sandbox-activity-service';
import { userSkillService, type ResolvedUserSkillSelection } from './user-skill-service';

type DesiredSkill = {
  slug: string;
  renderedMarkdown: string;
  source: 'platform' | 'custom';
  ownerUserId?: string | null;
  revisionId?: string | null;
  skillId?: string | null;
};

type TrackedSkill = {
  slug: string;
  path: string;
  source: 'platform' | 'custom';
  ownerUserId?: string | null;
  revisionId?: string | null;
  skillId?: string | null;
  signature: string;
};

type SyncResult = {
  taskSessionId: string | null;
  orchestratorSessionId: string;
  signature: string;
  restartTriggered: boolean;
  changed: boolean;
  items: TrackedSkill[];
  syncedAt: string;
};

const OPENCODE_SKILLS_ROOT = '/home/user/.config/opencode/skills';
const OPENCODE_PLATFORM_SKILLS_ROOT = `${OPENCODE_SKILLS_ROOT}/platform`;
const OPENCODE_USER_SKILLS_ROOT = `${OPENCODE_SKILLS_ROOT}/user`;

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function shellEscape(value: string) {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function normalizeSlug(value: string) {
  const normalized = asText(value).toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-');
  return normalized.replace(/^-+|-+$/g, '');
}

function assertSlug(value: string) {
  const normalized = normalizeSlug(value);
  if (!normalized || !/^[a-z0-9][a-z0-9-_]{1,63}$/.test(normalized)) {
    throw new Error('skill slug 非法');
  }
  return normalized;
}

function normalizeUserPathSegment(value: string) {
  const normalized = asText(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized) {
    throw new Error('skill userId 非法');
  }
  return normalized.slice(0, 128);
}

function buildSkillDirectory(input: { slug: string; source: 'platform' | 'custom'; ownerUserId?: string | null }) {
  const slug = assertSlug(input.slug);
  if (input.source === 'platform') {
    return `${OPENCODE_PLATFORM_SKILLS_ROOT}/${slug}`;
  }
  return `${OPENCODE_USER_SKILLS_ROOT}/${normalizeUserPathSegment(asText(input.ownerUserId))}/${slug}`;
}

function buildSkillPath(input: { slug: string; source: 'platform' | 'custom'; ownerUserId?: string | null }) {
  return `${buildSkillDirectory(input)}/SKILL.md`;
}

function normalizeResourcePath(value: unknown) {
  const normalized = asText(value).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    throw new Error('skill resource_path 非法');
  }
  return normalized;
}

function buildResourcePath(input: {
  slug: string;
  source: 'platform' | 'custom';
  ownerUserId?: string | null;
  resourcePath: string;
}) {
  return `${buildSkillDirectory(input)}/${normalizeResourcePath(input.resourcePath)}`;
}

function buildSkillIdentityKey(input: {
  slug: string;
  source: 'platform' | 'custom';
  ownerUserId?: string | null;
}) {
  return `${input.source}:${input.source === 'custom' ? normalizeUserPathSegment(asText(input.ownerUserId)) : 'platform'}:${assertSlug(input.slug)}`;
}

function buildTrackedSkillDirectory(item: TrackedSkill) {
  const skillPath = asText(item.path);
  if (skillPath.endsWith('/SKILL.md')) {
    return skillPath.slice(0, -'/SKILL.md'.length);
  }
  return buildSkillDirectory(item);
}

function buildTrackedSkill(input: DesiredSkill): TrackedSkill {
  const slug = assertSlug(input.slug);
  return {
    slug,
    path: buildSkillPath({
      slug,
      source: input.source,
      ownerUserId: input.ownerUserId || null,
    }),
    source: input.source,
    ownerUserId: input.ownerUserId || null,
    revisionId: input.revisionId || null,
    skillId: input.skillId || null,
    signature: computeSkillSignature(input.renderedMarkdown),
  };
}

function computeAggregateSignature(items: TrackedSkill[]) {
  const ordered = [...items].sort((left, right) => left.path.localeCompare(right.path));
  const payload = JSON.stringify(
    ordered.map((item) => ({
      slug: item.slug,
      path: item.path,
      source: item.source,
      ownerUserId: item.ownerUserId || null,
      revisionId: item.revisionId || null,
      skillId: item.skillId || null,
      signature: item.signature,
    }))
  );
  return createHash('sha256').update(payload).digest('hex');
}

function readTrackedSkills(metadataJson: unknown): { signature: string | null; items: TrackedSkill[] } {
  const metadata = asObject(metadataJson);
  const skillSync = asObject(metadata.skillSync);
  const rawItems = Array.isArray(skillSync.items) ? skillSync.items : [];
  const items: TrackedSkill[] = [];
  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const slug = assertSlug(asText(record.slug));
    const signature = asText(record.signature);
    if (!signature) continue;
    items.push({
      slug,
      path:
        asText(record.path) ||
        buildSkillPath({
          slug,
          source: asText(record.source) === 'custom' ? 'custom' : 'platform',
          ownerUserId: asText(record.ownerUserId) || null,
        }),
      source: asText(record.source) === 'custom' ? 'custom' : 'platform',
      ownerUserId: asText(record.ownerUserId) || null,
      revisionId: asText(record.revisionId) || null,
      skillId: asText(record.skillId) || null,
      signature,
    });
  }
  return {
    signature: asText(skillSync.signature) || null,
    items,
  };
}

async function stopOpencodeServer(orchestratorSessionId: string) {
  const command = `pid=$(ps -ef | awk '/opencode serve --hostname ${e2bConfig.opencodeHost} --port ${e2bConfig.opencodePort}/ && !/awk/ {print $2; exit}')
if [ -n "$pid" ]; then
  kill "$pid" || true
fi`;
  try {
    await e2bConnector.runCommand(orchestratorSessionId, command, { timeoutMs: 20_000 });
  } catch {
    // best effort
  }
}

async function startOpencodeServer(
  orchestratorSessionId: string,
  input: { baseUrl: string; stateRoot?: string | null; trafficAccessToken?: string | null }
) {
  const envPrefix = asText(input.stateRoot) ? `XDG_DATA_HOME=${shellEscape(asText(input.stateRoot))} ` : '';
  const command = `${envPrefix}nohup opencode serve --hostname ${e2bConfig.opencodeHost} --port ${e2bConfig.opencodePort} > /tmp/opencode-server.log 2>&1 &`;
  await e2bConnector.runCommand(orchestratorSessionId, command, { timeoutMs: 30_000 });

  const maxAttempts = Math.max(5, Number(process.env.OPENCODE_SERVER_START_ATTEMPTS || 20));
  const delayMs = Math.max(200, Number(process.env.OPENCODE_SERVER_START_DELAY_MS || 500));
  let lastError: unknown = null;
  for (let index = 0; index < maxAttempts; index += 1) {
    try {
      await opencodeHttpClient.ensureServerReady(input.baseUrl, input.trafficAccessToken || undefined);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`opencode serve 启动失败: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function restartOpencodeServer(
  orchestratorSessionId: string,
  input: { baseUrl: string; stateRoot?: string | null; trafficAccessToken?: string | null }
) {
  await stopOpencodeServer(orchestratorSessionId);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await startOpencodeServer(orchestratorSessionId, input);
}

export class SandboxSkillSyncService {
  private async resolveSandboxContext(input: { taskSessionId?: string | null; orchestratorSessionId?: string | null }) {
    let taskSessionId = asText(input.taskSessionId) || null;
    let orchestratorSessionId = asText(input.orchestratorSessionId) || '';

    if (!orchestratorSessionId && taskSessionId) {
      const binding = await taskSessionRunDAO.getSandboxBindingBySession(taskSessionId);
      orchestratorSessionId = asText(binding?.sandboxId);
      if (!orchestratorSessionId) {
        const session = await taskCreationFileMemoryStore.getSession(taskSessionId);
        orchestratorSessionId = asText(session?.runtime?.orchestratorSessionId);
      }
    }

    if (!orchestratorSessionId) {
      throw new Error('未找到可用 sandbox');
    }

    const runtime = await ensureSandboxRuntimeMetadata(orchestratorSessionId, {
      taskSessionId,
    });
    if (!runtime) {
      throw new Error('sandbox runtime metadata 不存在');
    }

    taskSessionId = taskSessionId || asText(runtime.metadata.taskSessionId) || null;
    let binding = taskSessionId ? await taskSessionRunDAO.getSandboxBindingBySession(taskSessionId) : null;
    if (!binding && taskSessionId) {
      binding = await taskSessionRunDAO.upsertSandboxBinding({
        sessionId: taskSessionId,
        sandboxId: orchestratorSessionId,
        workspaceRoot: runtime.workspaceRoot,
        status: 'ready',
        metadataJson: {},
      });
    }

    return {
      taskSessionId,
      orchestratorSessionId,
      runtime,
      binding,
    };
  }

  private async applyDesiredSkills(input: {
    taskSessionId?: string | null;
    orchestratorSessionId?: string | null;
    desiredSkills: DesiredSkill[];
  }): Promise<SyncResult> {
    const context = await this.resolveSandboxContext(input);
    const current = readTrackedSkills(context.binding?.metadataJson);
    const desiredTracked = input.desiredSkills.map((item) => buildTrackedSkill(item));
    const desiredSignature = computeAggregateSignature(desiredTracked);
    const currentSignature = current.signature || computeAggregateSignature(current.items);
    const now = new Date().toISOString();

    if (desiredSignature === currentSignature) {
      return {
        taskSessionId: context.taskSessionId,
        orchestratorSessionId: context.orchestratorSessionId,
        signature: desiredSignature,
        restartTriggered: false,
        changed: false,
        items: desiredTracked,
        syncedAt: now,
      };
    }

    await e2bConnector.runCommand(
      context.orchestratorSessionId,
      `mkdir -p ${shellEscape(OPENCODE_PLATFORM_SKILLS_ROOT)} ${shellEscape(OPENCODE_USER_SKILLS_ROOT)}`,
      { timeoutMs: 15_000 }
    );

    const desiredByKey = new Map<string, DesiredSkill>();
    for (const item of input.desiredSkills) {
      desiredByKey.set(buildSkillIdentityKey(item), item);
    }
    const currentByKey = new Map<string, TrackedSkill>();
    for (const item of current.items) {
      currentByKey.set(buildSkillIdentityKey(item), item);
    }

    for (const currentItem of current.items) {
      if (desiredByKey.has(buildSkillIdentityKey(currentItem))) continue;
      await e2bConnector.runCommand(
        context.orchestratorSessionId,
        `rm -rf ${shellEscape(buildTrackedSkillDirectory(currentItem))}`,
        { timeoutMs: 15_000 }
      );
    }

    for (const desired of input.desiredSkills) {
      const nextTracked = buildTrackedSkill(desired);
      const existing = currentByKey.get(buildSkillIdentityKey(desired));
      if (existing && existing.signature === nextTracked.signature) {
        continue;
      }
      await e2bConnector.runCommand(
        context.orchestratorSessionId,
        `mkdir -p ${shellEscape(buildTrackedSkillDirectory(nextTracked))}`,
        { timeoutMs: 15_000 }
      );
      await e2bConnector.writeFile(
        context.orchestratorSessionId,
        nextTracked.path,
        Buffer.from(desired.renderedMarkdown, 'utf8')
      );
    }

    await restartOpencodeServer(context.orchestratorSessionId, {
      baseUrl: context.runtime.baseUrl,
      stateRoot: context.runtime.stateRoot,
      trafficAccessToken: context.runtime.trafficAccessToken,
    });
    await touchSandbox(context.orchestratorSessionId, 'skill_sync_restart');

    const nextMetadata = {
      ...(asObject(context.binding?.metadataJson)),
      skillSync: {
        signature: desiredSignature,
        syncedAt: now,
        items: desiredTracked,
      },
    };
    if (context.taskSessionId) {
      await taskSessionRunDAO.updateSandboxBindingMetadata(context.taskSessionId, nextMetadata, {
        status: 'ready',
      });
    }

    return {
      taskSessionId: context.taskSessionId,
      orchestratorSessionId: context.orchestratorSessionId,
      signature: desiredSignature,
      restartTriggered: true,
      changed: true,
      items: desiredTracked,
      syncedAt: now,
    };
  }

  async syncSelectedSkills(input: {
    taskSessionId: string;
    orchestratorSessionId?: string | null;
    skills: unknown;
  }) {
    const resolved = await userSkillService.resolveSelectionsForSession(input.taskSessionId, input.skills);
    return this.syncResolvedSkills({
      taskSessionId: input.taskSessionId,
      orchestratorSessionId: input.orchestratorSessionId,
      skills: resolved,
    });
  }

  async syncResolvedSkills(input: {
    taskSessionId: string;
    orchestratorSessionId?: string | null;
    skills: ResolvedUserSkillSelection[];
  }) {
    const result = await this.applyDesiredSkills({
      taskSessionId: input.taskSessionId,
      orchestratorSessionId: input.orchestratorSessionId || null,
      desiredSkills: input.skills.map((item) => ({
        slug: item.slug,
        renderedMarkdown: item.renderedMarkdown,
        source: item.sourceType,
        ownerUserId: item.userId || null,
        revisionId: item.revisionId,
        skillId: item.skillId,
      })),
    });
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        skillPath: item.path,
      })),
    };
  }

  async syncResolvedSkillResource(input: {
    taskSessionId?: string | null;
    orchestratorSessionId?: string | null;
    skill: ResolvedUserSkillSelection;
    resourcePath: string;
  }) {
    const normalizedResourcePath = normalizeResourcePath(input.resourcePath);
    const context = await this.resolveSandboxContext({
      taskSessionId: input.taskSessionId || null,
      orchestratorSessionId: input.orchestratorSessionId || null,
    });
    const resolvedResource =
      input.skill.sourceType === 'platform'
        ? await platformSkillService.getRevisionResource(
            input.skill.skillId,
            input.skill.revisionId,
            normalizedResourcePath
          )
        : {
            resource: {
              resourcePath: normalizedResourcePath,
              resourceType: 'reference',
              contentMarkdown: (
                await userSkillService.getCustomSkillDocument(
                  asText(input.skill.userId),
                  input.skill.skillId,
                  normalizedResourcePath
                )
              ).bodyMarkdown,
            },
          };
    const absolutePath = buildResourcePath({
      slug: input.skill.slug,
      source: input.skill.sourceType,
      ownerUserId: input.skill.userId || null,
      resourcePath: normalizedResourcePath,
    });
    const parentDir = absolutePath.slice(0, absolutePath.lastIndexOf('/'));
    await e2bConnector.runCommand(
      context.orchestratorSessionId,
      `mkdir -p ${shellEscape(parentDir)}`,
      { timeoutMs: 15_000 }
    );
    await e2bConnector.writeFile(
      context.orchestratorSessionId,
      absolutePath,
      Buffer.from(resolvedResource.resource.contentMarkdown, 'utf8')
    );
    await touchSandbox(context.orchestratorSessionId, 'skill_resource_sync');
    return {
      taskSessionId: context.taskSessionId,
      orchestratorSessionId: context.orchestratorSessionId,
      skillId: input.skill.skillId,
      revisionId: input.skill.revisionId,
      slug: input.skill.slug,
      resourcePath: normalizedResourcePath,
      skillResourcePath: absolutePath,
      resourceType: resolvedResource.resource.resourceType,
      contentMarkdown: resolvedResource.resource.contentMarkdown,
    };
  }

  async syncPlatformRevisionForValidation(input: {
    taskSessionId: string;
    orchestratorSessionId?: string | null;
    skillId: string;
    revisionId: string;
  }) {
    const resolved = await platformSkillService.resolveSkillSelections([
      {
        skillId: input.skillId,
        revisionId: input.revisionId,
      },
    ]);
    const result = await this.applyDesiredSkills({
      taskSessionId: input.taskSessionId,
      orchestratorSessionId: input.orchestratorSessionId || null,
      desiredSkills: resolved.map((item) => ({
        slug: item.revision.slugSnapshot,
        renderedMarkdown: item.renderedMarkdown,
        source: 'platform',
        revisionId: item.revision.id,
        skillId: item.skill.id,
      })),
    });
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        skillPath: item.path,
      })),
    };
  }

  async upsertCustomSkill(input: {
    taskSessionId?: string | null;
    orchestratorSessionId?: string | null;
    skillName: string;
    skillContent: string;
  }) {
    const context = await this.resolveSandboxContext(input);
    const current = readTrackedSkills(context.binding?.metadataJson);
    const currentItems = current.items.filter(
      (item) => !(item.source === 'custom' && item.slug === assertSlug(input.skillName))
    );
    const renderedMarkdown = platformSkillService.renderSkillMarkdown({
      slug: input.skillName,
      description: '',
      bodyMarkdown: input.skillContent,
    });
    const desiredSkills: DesiredSkill[] = currentItems.map((item) => ({
      slug: item.slug,
      renderedMarkdown: '',
      source: item.source,
      ownerUserId: item.ownerUserId || null,
      revisionId: item.revisionId,
      skillId: item.skillId,
    }));
    for (const item of desiredSkills) {
      const raw = await e2bConnector.readFile(
        context.orchestratorSessionId,
        buildSkillPath({ slug: item.slug, source: item.source, ownerUserId: item.ownerUserId || null })
      ).catch(() => null);
      item.renderedMarkdown = raw ? Buffer.from(raw).toString('utf8') : '';
    }
    desiredSkills.push({
      slug: input.skillName,
      renderedMarkdown,
      source: 'custom',
    });
    return this.applyDesiredSkills({
      taskSessionId: context.taskSessionId,
      orchestratorSessionId: context.orchestratorSessionId,
      desiredSkills,
    });
  }

  async removeSkill(input: {
    taskSessionId?: string | null;
    orchestratorSessionId?: string | null;
    skillName: string;
  }) {
    const context = await this.resolveSandboxContext(input);
    const current = readTrackedSkills(context.binding?.metadataJson);
    const remaining = current.items.filter(
      (item) => !(item.source === 'custom' && item.slug === assertSlug(input.skillName))
    );
    const desiredSkills: DesiredSkill[] = [];
    for (const item of remaining) {
      const raw = await e2bConnector.readFile(
        context.orchestratorSessionId,
        buildSkillPath({ slug: item.slug, source: item.source, ownerUserId: item.ownerUserId || null })
      ).catch(() => null);
      if (!raw) continue;
      desiredSkills.push({
        slug: item.slug,
        renderedMarkdown: Buffer.from(raw).toString('utf8'),
        source: item.source,
        ownerUserId: item.ownerUserId || null,
        revisionId: item.revisionId,
        skillId: item.skillId,
      });
    }
    return this.applyDesiredSkills({
      taskSessionId: context.taskSessionId,
      orchestratorSessionId: context.orchestratorSessionId,
      desiredSkills,
    });
  }
}

export const sandboxSkillSyncService = new SandboxSkillSyncService();
