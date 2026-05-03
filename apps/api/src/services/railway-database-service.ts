import { Pool } from 'pg';

import type { UserPlatformDeploymentAccount } from './platform-deployment-account-service';
import { requestRailwayGraphql } from './railway-graphql-client';

type RailwayDatabaseVariables = Record<string, unknown>;

export type RailwayDatabaseConnectionInfo = {
  connectionUrl: string;
  publicConnectionUrl?: string;
  host: string;
  port: string;
  username: string;
  password: string;
  database: string;
  sslMode: 'require';
};

export type RailwayDatabaseColumn = {
  name: string;
  dataType: string;
  format?: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  hasDefault: boolean;
  defaultValue?: string;
};

export type RailwayDatabaseTableSummary = {
  id: string;
  schema: string;
  name: string;
  rowCount: number;
  sourceLabel: string;
};

export type RailwayDatabaseSummary = {
  configured: boolean;
  provider: 'railway_postgres';
  serviceId: string;
  serviceName: string;
  volumeId?: string;
  volumeName?: string;
  latestDeploymentStatus?: string;
  latestDeploymentAt?: string;
  connection: RailwayDatabaseConnectionInfo;
  tables: RailwayDatabaseTableSummary[];
};

export type RailwayDatabaseRowLocator = {
  ctid?: string;
  primaryKey?: Record<string, unknown>;
};

export type RailwayDatabaseRowsPage = {
  table: RailwayDatabaseTableSummary;
  columns: RailwayDatabaseColumn[];
  rows: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type RailwayDatabaseSchemaSummary = {
  configured: boolean;
  provider: 'railway_postgres';
  serviceId: string;
  serviceName: string;
  tables: Array<{
    table: RailwayDatabaseTableSummary;
    columns: RailwayDatabaseColumn[];
  }>;
};

type TableRecord = {
  schema: string;
  name: string;
  rowCount: number;
};

type ColumnRecord = {
  name: string;
  dataType: string;
  format?: string;
  isNullable: boolean;
  hasDefault: boolean;
  defaultValue?: string;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteTable(schema: string, table: string) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableDatabaseError(error: unknown) {
  const message = asText(error instanceof Error ? error.message : error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('econnreset') ||
    normalized.includes('connection terminated unexpectedly') ||
    normalized.includes('terminating connection') ||
    normalized.includes('connection refused') ||
    normalized.includes('timeout') ||
    normalized.includes('socket hang up')
  );
}

function parseTableId(tableId: string) {
  const raw = asText(tableId);
  if (!raw) {
    throw new Error('缺少数据表信息');
  }
  const [schema, ...rest] = raw.split('.');
  const table = rest.join('.');
  if (!schema || !table) {
    throw new Error('数据表格式非法，应为 schema.table');
  }
  return {
    schema,
    table,
  };
}

function toTableId(schema: string, table: string) {
  return `${schema}.${table}`;
}

function buildTableSummary(table: TableRecord): RailwayDatabaseTableSummary {
  return {
    id: toTableId(table.schema, table.name),
    schema: table.schema,
    name: table.name,
    rowCount: table.rowCount,
    sourceLabel: table.schema === 'public' ? '应用数据库' : table.schema,
  };
}

function parseConnectionInfo(variables: RailwayDatabaseVariables): RailwayDatabaseConnectionInfo {
  const connectionUrl = asText(variables.DATABASE_PUBLIC_URL) || asText(variables.DATABASE_URL);
  const parsed = connectionUrl ? new URL(connectionUrl) : null;
  const host = asText(variables.RAILWAY_TCP_PROXY_DOMAIN) || parsed?.hostname || asText(variables.PGHOST);
  const port = asText(variables.RAILWAY_TCP_PROXY_PORT) || parsed?.port || asText(variables.PGPORT) || '5432';
  const username =
    asText(variables.PGUSER) || (parsed?.username ? decodeURIComponent(parsed.username) : '');
  const password =
    asText(variables.PGPASSWORD) || (parsed?.password ? decodeURIComponent(parsed.password) : '');
  const database =
    asText(variables.PGDATABASE) ||
    asText(variables.POSTGRES_DB) ||
    (parsed?.pathname ? parsed.pathname.replace(/^\//, '') : '');

  if (!connectionUrl || !host || !port || !username || !password || !database) {
    throw new Error('Railway PostgreSQL 连接信息不完整');
  }

  return {
    connectionUrl,
    publicConnectionUrl: asText(variables.DATABASE_PUBLIC_URL) || undefined,
    host,
    port,
    username,
    password,
    database,
    sslMode: 'require',
  };
}

function normalizeCellValue(value: unknown, dataType: string) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (dataType === 'json' || dataType === 'jsonb') {
    if (typeof value === 'string') {
      const raw = value.trim();
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return value;
  }
  if (dataType === 'boolean') {
    if (typeof value === 'boolean') return value;
    const raw = String(value).trim().toLowerCase();
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
  }
  if (
    ['smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision'].includes(dataType) &&
    typeof value === 'string'
  ) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return value;
}

function serializeRow(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === 'bigint' ? value.toString() : value instanceof Date ? value.toISOString() : value,
    ])
  );
}

async function executeRailwayGraphql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  return requestRailwayGraphql<T>(
    {
      token,
      kind: 'project',
    },
    query,
    variables
  );
}

class RailwayDatabasePoolRegistry {
  private pools = new Map<string, Pool>();

  get(key: string, connection: RailwayDatabaseConnectionInfo) {
    const existing = this.pools.get(key);
    if (existing) return existing;
    const pool = new Pool({
      connectionString: connection.publicConnectionUrl || connection.connectionUrl,
      ssl: {
        rejectUnauthorized: false,
      },
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });
    pool.on('error', () => {
      this.pools.delete(key);
    });
    this.pools.set(key, pool);
    return pool;
  }

  async reset(key: string) {
    const existing = this.pools.get(key);
    this.pools.delete(key);
    if (existing) {
      await existing.end().catch(() => undefined);
    }
  }
}

const poolRegistry = new RailwayDatabasePoolRegistry();

function buildPoolKey(account: UserPlatformDeploymentAccount) {
  return `${account.projectId}:${account.databaseServiceId || 'missing'}`;
}

async function loadDatabaseVariables(account: UserPlatformDeploymentAccount) {
  if (!account.databaseServiceId) {
    throw new Error('数据库服务尚未准备完成');
  }
  const result = await executeRailwayGraphql<{
    variables?: Record<string, unknown> | null;
    serviceInstance?: {
      latestDeployment?: {
        status?: string;
        createdAt?: string;
      } | null;
    } | null;
  }>(
    account.accessToken,
    `
      query RailwayDatabaseVariables(
        $projectId: String!,
        $environmentId: String!,
        $serviceId: String!
      ) {
        variables(
          projectId: $projectId,
          environmentId: $environmentId,
          serviceId: $serviceId
        )
        serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
          latestDeployment {
            status
            createdAt
          }
        }
      }
    `,
    {
      projectId: account.projectId,
      environmentId: account.environmentId,
      serviceId: account.databaseServiceId,
    }
  );

  return {
    variables: pickRecord(result.variables),
    latestDeploymentStatus: asText(result.serviceInstance?.latestDeployment?.status) || undefined,
    latestDeploymentAt: asText(result.serviceInstance?.latestDeployment?.createdAt) || undefined,
  };
}

async function getPool(account: UserPlatformDeploymentAccount) {
  const { variables } = await loadDatabaseVariables(account);
  const connection = parseConnectionInfo(variables);
  return {
    connection,
    pool: poolRegistry.get(buildPoolKey(account), connection),
    variables,
  };
}

async function withDatabaseRetry<T>(
  account: UserPlatformDeploymentAccount,
  operation: () => Promise<T>
): Promise<T> {
  const poolKey = buildPoolKey(account);
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetriableDatabaseError(error) || attempt === 5) {
        throw error;
      }
      await poolRegistry.reset(poolKey);
      await sleep((attempt + 1) * 5_000);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('数据库查询失败');
}

async function listTables(pool: Pool): Promise<TableRecord[]> {
  const result = await pool.query<{
    table_schema: string;
    table_name: string;
    row_count: string | number | null;
  }>(`
    select
      tables.table_schema,
      tables.table_name,
      coalesce(stats.n_live_tup, 0)::bigint as row_count
    from information_schema.tables as tables
    left join pg_stat_user_tables as stats
      on stats.schemaname = tables.table_schema
     and stats.relname = tables.table_name
    where tables.table_type = 'BASE TABLE'
      and tables.table_schema not in ('pg_catalog', 'information_schema')
    order by
      case when tables.table_schema = 'public' then 0 else 1 end,
      tables.table_schema asc,
      tables.table_name asc
  `);

  return result.rows.map((row) => ({
    schema: row.table_schema,
    name: row.table_name,
    rowCount: Number(row.row_count || 0),
  }));
}

async function listColumns(pool: Pool, schema: string, table: string): Promise<RailwayDatabaseColumn[]> {
  const [columnsResult, primaryKeyResult] = await Promise.all([
    pool.query<{
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `
        select
          column_name,
          data_type,
          udt_name,
          is_nullable,
          column_default
        from information_schema.columns
        where table_schema = $1 and table_name = $2
        order by ordinal_position asc
      `,
      [schema, table]
    ),
    pool.query<{ column_name: string }>(
      `
        select kcu.column_name
        from information_schema.table_constraints as tc
        join information_schema.key_column_usage as kcu
          on tc.constraint_name = kcu.constraint_name
         and tc.table_schema = kcu.table_schema
         and tc.table_name = kcu.table_name
        where tc.constraint_type = 'PRIMARY KEY'
          and tc.table_schema = $1
          and tc.table_name = $2
        order by kcu.ordinal_position asc
      `,
      [schema, table]
    ),
  ]);

  const primaryKeyColumns = new Set(primaryKeyResult.rows.map((row) => row.column_name));
  return columnsResult.rows.map((row) => ({
    name: row.column_name,
    dataType: row.data_type,
    format: row.udt_name || undefined,
    isNullable: row.is_nullable === 'YES',
    isPrimaryKey: primaryKeyColumns.has(row.column_name),
    hasDefault: Boolean(row.column_default),
    defaultValue: row.column_default || undefined,
  }));
}

async function countRows(pool: Pool, schema: string, table: string) {
  const result = await pool.query<{ total: string }>(`select count(*)::bigint as total from ${quoteTable(schema, table)}`);
  return Number(result.rows[0]?.total || 0);
}

function buildLocatorClause(
  locator: RailwayDatabaseRowLocator,
  columns: RailwayDatabaseColumn[],
  parameterOffset = 0
): {
  clause: string;
  values: unknown[];
} {
  if (asText(locator.ctid)) {
    return {
      clause: `ctid = $${parameterOffset + 1}::tid`,
      values: [asText(locator.ctid)],
    };
  }

  const primaryKey = pickRecord(locator.primaryKey);
  const primaryKeyColumns = columns.filter((column) => column.isPrimaryKey);
  if (!primaryKeyColumns.length) {
    throw new Error('当前数据表没有主键，请刷新后使用系统行定位');
  }

  const values: unknown[] = [];
  const parts = primaryKeyColumns.map((column, index) => {
    if (!(column.name in primaryKey)) {
      throw new Error(`缺少主键字段 ${column.name}`);
    }
    values.push(primaryKey[column.name]);
    return `${quoteIdentifier(column.name)} = $${parameterOffset + index + 1}`;
  });

  return {
    clause: parts.join(' and '),
    values,
  };
}

export class RailwayDatabaseService {
  async getSummary(account: UserPlatformDeploymentAccount): Promise<RailwayDatabaseSummary> {
    if (!account.databaseServiceId || !account.databaseServiceName) {
      throw new Error('数据库服务尚未准备完成');
    }
    const serviceId = account.databaseServiceId;
    const serviceName = account.databaseServiceName;

    return withDatabaseRetry(account, async () => {
      const [{ connection, pool }, metadata] = await Promise.all([
        getPool(account),
        loadDatabaseVariables(account),
      ]);
      const tables = await listTables(pool);

        return {
          configured: true,
          provider: 'railway_postgres',
          serviceId,
          serviceName,
          volumeId: account.databaseVolumeId,
          volumeName: account.databaseVolumeName,
        latestDeploymentStatus: metadata.latestDeploymentStatus,
        latestDeploymentAt: metadata.latestDeploymentAt,
        connection,
        tables: tables.map(buildTableSummary),
      };
    });
  }

  async getRows(
    account: UserPlatformDeploymentAccount,
    tableId: string,
    page = 1,
    pageSize = 50
  ): Promise<RailwayDatabaseRowsPage> {
    return withDatabaseRetry(account, async () => {
      const { schema, table } = parseTableId(tableId);
      const normalizedPage = clamp(page, 1, 10_000);
      const normalizedPageSize = clamp(pageSize, 10, 200);
      const offset = (normalizedPage - 1) * normalizedPageSize;
      const { pool } = await getPool(account);
      const [tables, columns, total] = await Promise.all([
        listTables(pool),
        listColumns(pool, schema, table),
        countRows(pool, schema, table),
      ]);
      const target = tables.find((item) => item.schema === schema && item.name === table);
      if (!target) {
        throw new Error('数据表不存在');
      }

      const rowsResult = await pool.query(
        `select ctid::text as "_oneceo_ctid", * from ${quoteTable(schema, table)} order by ctid asc limit $1 offset $2`,
        [normalizedPageSize, offset]
      );

      return {
        table: buildTableSummary(target),
        columns,
        rows: rowsResult.rows.map((row) => serializeRow(row)),
        page: normalizedPage,
        pageSize: normalizedPageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
      };
    });
  }

  async getSchemaSummary(account: UserPlatformDeploymentAccount): Promise<RailwayDatabaseSchemaSummary> {
    if (!account.databaseServiceId || !account.databaseServiceName) {
      throw new Error('数据库服务尚未准备完成');
    }
    const serviceId = account.databaseServiceId;
    const serviceName = account.databaseServiceName;
    return withDatabaseRetry(account, async () => {
      const { pool } = await getPool(account);
      const tables = await listTables(pool);
      const tablesWithColumns = await Promise.all(
        tables.map(async (table) => ({
          table: buildTableSummary(table),
          columns: await listColumns(pool, table.schema, table.name),
        }))
      );
      return {
        configured: true,
        provider: 'railway_postgres',
        serviceId,
        serviceName,
        tables: tablesWithColumns,
      };
    });
  }

  async insertRow(
    account: UserPlatformDeploymentAccount,
    tableId: string,
    values: Record<string, unknown>
  ) {
    return withDatabaseRetry(account, async () => {
      const { schema, table } = parseTableId(tableId);
      const payload = pickRecord(values);
      const { pool } = await getPool(account);
      const columns = await listColumns(pool, schema, table);
      const editableColumns = columns.filter((column) => column.name in payload);
      if (!editableColumns.length) {
        throw new Error('缺少可写入字段');
      }

      const params = editableColumns.map((column) =>
        normalizeCellValue(payload[column.name], column.dataType)
      );
      const sql = `
        insert into ${quoteTable(schema, table)} (
          ${editableColumns.map((column) => quoteIdentifier(column.name)).join(', ')}
        )
        values (${editableColumns.map((_, index) => `$${index + 1}`).join(', ')})
        returning ctid::text as "_oneceo_ctid", *
      `;
      const result = await pool.query(sql, params);
      return serializeRow(result.rows[0] || {});
    });
  }

  async updateRow(
    account: UserPlatformDeploymentAccount,
    tableId: string,
    locator: RailwayDatabaseRowLocator,
    values: Record<string, unknown>
  ) {
    return withDatabaseRetry(account, async () => {
      const { schema, table } = parseTableId(tableId);
      const payload = pickRecord(values);
      const { pool } = await getPool(account);
      const columns = await listColumns(pool, schema, table);
      const editableColumns = columns.filter(
        (column) => !column.isPrimaryKey && column.name in payload
      );
      if (!editableColumns.length) {
        throw new Error('缺少可更新字段');
      }

      const setValues = editableColumns.map((column) =>
        normalizeCellValue(payload[column.name], column.dataType)
      );
      const locatorClause = buildLocatorClause(locator, columns, setValues.length);
      const assignments = editableColumns.map(
        (column, index) => `${quoteIdentifier(column.name)} = $${index + 1}`
      );
      const sql = `
        update ${quoteTable(schema, table)}
        set ${assignments.join(', ')}
        where ${locatorClause.clause}
        returning ctid::text as "_oneceo_ctid", *
      `;
      const result = await pool.query(sql, [...setValues, ...locatorClause.values]);
      if (!result.rows[0]) {
        throw new Error('未找到需要更新的数据行');
      }
      return serializeRow(result.rows[0]);
    });
  }

  async deleteRow(
    account: UserPlatformDeploymentAccount,
    tableId: string,
    locator: RailwayDatabaseRowLocator
  ) {
    return withDatabaseRetry(account, async () => {
      const { schema, table } = parseTableId(tableId);
      const { pool } = await getPool(account);
      const columns = await listColumns(pool, schema, table);
      const locatorClause = buildLocatorClause(locator, columns);
      const result = await pool.query(
        `delete from ${quoteTable(schema, table)} where ${locatorClause.clause}`,
        locatorClause.values
      );
      return {
        deleted: result.rowCount || 0,
      };
    });
  }
}

export const railwayDatabaseService = new RailwayDatabaseService();
