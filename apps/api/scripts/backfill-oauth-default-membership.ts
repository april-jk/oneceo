import { sql } from 'drizzle-orm';
import { db } from '../src/config/database';
import { membershipService } from '../src/services/membership-service';

type CandidateRow = {
  userId: string;
  email: string;
  displayName: string;
  createdAt: Date;
  providers: string[];
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function readOption(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0) return '';
  return asText(process.argv[index + 1]);
}

function parsePositiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseDateOption(name: string): Date | undefined {
  const value = readOption(name);
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${name} 日期格式无效`);
  }
  return date;
}

function uniqueProviders(rows: Array<{ provider: string | null }>) {
  return [...new Set(rows.map((row) => asText(row.provider)).filter(Boolean))];
}

async function loadCandidates(options: {
  userIds?: string[];
  email?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  limit: number;
}): Promise<CandidateRow[]> {
  const userIds = options.userIds && options.userIds.length > 0 ? options.userIds : null;
  const result = await db.execute(sql`
    SELECT
      u.id::text AS user_id,
      u.email,
      u.display_name,
      u.created_at,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT oa.provider), NULL) AS providers
    FROM app_users u
    INNER JOIN app_user_oauth_accounts oa ON oa.user_id = u.id
    LEFT JOIN user_memberships um ON um.user_id = u.id
    LEFT JOIN user_credits uc ON uc.user_id = u.id
    WHERE u.status = 'active'
      AND um.id IS NULL
      AND uc.id IS NULL
      AND (${options.email || null}::text IS NULL OR u.email = ${options.email || null}::text)
      AND (${userIds}::uuid[] IS NULL OR u.id = ANY(${userIds}::uuid[]))
      AND (${options.createdAfter || null}::timestamp IS NULL OR u.created_at >= ${options.createdAfter || null}::timestamp)
      AND (${options.createdBefore || null}::timestamp IS NULL OR u.created_at <= ${options.createdBefore || null}::timestamp)
    GROUP BY u.id, u.email, u.display_name, u.created_at
    ORDER BY u.created_at ASC, u.id ASC
    LIMIT ${options.limit}
  `);

  const rows = Array.isArray((result as any)?.rows) ? (result as any).rows : [];
  return rows.map((row: any) => ({
    userId: String(row.user_id),
    email: String(row.email || ''),
    displayName: String(row.display_name || ''),
    createdAt: new Date(row.created_at),
    providers: uniqueProviders(
      Array.isArray(row.providers) ? row.providers.map((provider: string | null) => ({ provider })) : []
    ),
  }));
}

async function resolveDefaultPlanSummary() {
  const [row] = await db.execute(sql`
    SELECT id::text AS id, name, default_credits::int AS default_credits
    FROM membership_plans
    WHERE status = 'active' AND is_default = true
    ORDER BY updated_at DESC
    LIMIT 1
  `).then((result: any) => result.rows || []);

  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name || ''),
    defaultCredits: Number(row.default_credits || 0),
  };
}

async function applyBackfill(candidates: CandidateRow[]) {
  let successCount = 0;
  const failures: Array<{ userId: string; email: string; error: string }> = [];

  for (const candidate of candidates) {
    try {
      const result = await membershipService.assignDefaultMembershipForNewUser(candidate.userId);
      if (!result) {
        throw new Error('当前不存在启用中的默认会员计划');
      }
      successCount += 1;
      console.log(
        `APPLIED userId=${candidate.userId} email=${candidate.email} providers=${candidate.providers.join(',')} membershipId=${result.membership.id}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({
        userId: candidate.userId,
        email: candidate.email,
        error: message,
      });
      console.error(`FAILED userId=${candidate.userId} email=${candidate.email}: ${message}`);
    }
  }

  return {
    successCount,
    failures,
  };
}

async function main() {
  const apply = hasFlag('--apply');
  const email = asText(readOption('--email')).toLowerCase();
  const userIds = asText(readOption('--user-ids'))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const createdAfter = parseDateOption('--created-after');
  const createdBefore = parseDateOption('--created-before');
  const limit = parsePositiveInteger(readOption('--limit'), 200);

  const defaultPlan = await resolveDefaultPlanSummary();
  if (!defaultPlan) {
    throw new Error('未找到启用中的默认会员计划，无法执行回填');
  }

  const candidates = await loadCandidates({
    userIds,
    email: email || undefined,
    createdAfter,
    createdBefore,
    limit,
  });

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        defaultPlan,
        filters: {
          email: email || null,
          userIds,
          createdAfter: createdAfter?.toISOString() || null,
          createdBefore: createdBefore?.toISOString() || null,
          limit,
        },
        candidateCount: candidates.length,
        candidates: candidates.map((candidate) => ({
          userId: candidate.userId,
          email: candidate.email,
          displayName: candidate.displayName,
          createdAt: candidate.createdAt.toISOString(),
          providers: candidate.providers,
        })),
      },
      null,
      2
    )
  );

  if (!apply) {
    return;
  }

  const result = await applyBackfill(candidates);
  console.log(
    JSON.stringify(
      {
        mode: 'apply',
        defaultPlan,
        candidateCount: candidates.length,
        successCount: result.successCount,
        failureCount: result.failures.length,
        failures: result.failures,
      },
      null,
      2
    )
  );

  if (result.failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[backfill-oauth-default-membership] failed:', error);
  process.exit(1);
});
