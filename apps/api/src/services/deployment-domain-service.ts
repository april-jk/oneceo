import { createHash } from 'node:crypto';

import { cloudflareDnsService, type CloudflareDnsRecordResult } from './cloudflare-dns-service';
import { requestRailwayGraphql, type RailwayAuthKind } from './railway-graphql-client';

type DnsRecordInput = {
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
};

export type DeploymentPublicDomainBinding = {
  publicDomain?: string;
  publicUrl?: string;
  publicDomainProvider?: 'cloudflare_railway_custom_domain';
  railwayCustomDomainId?: string;
  railwayCnameTarget?: string;
  cloudflareZoneId?: string;
  cloudflareDnsRecords?: CloudflareDnsRecordResult[];
  domainStatus:
    | 'unconfigured'
    | 'creating_custom_domain'
    | 'pending_dns'
    | 'pending_certificate'
    | 'active'
    | 'failed'
    | 'repair_required';
  domainStatusMessage?: string;
  domainLastCheckedAt?: string;
  domainActivatedAt?: string;
};

type RailwayDnsRecord = {
  recordType?: string;
  fqdn?: string;
  hostlabel?: string;
  requiredValue?: string;
  currentValue?: string;
  status?: string;
};

type RailwayCustomDomain = {
  id?: string;
  domain?: string;
  status?: {
    dnsRecords?: RailwayDnsRecord[];
    verified?: boolean;
    certificateStatus?: string;
    certificateErrorMessage?: string;
    verificationDnsHost?: string;
    verificationToken?: string;
  } | null;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeSlug(value: string, maxLength: number) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLength) || 'app'
  );
}

function toPublicUrl(domain: string) {
  const normalized = asText(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return normalized ? `https://${normalized}` : undefined;
}

function normalizeRailwayRecordType(value: string) {
  const normalized = asText(value).toUpperCase();
  if (normalized.endsWith('_CNAME')) return 'CNAME';
  if (normalized.endsWith('_TXT')) return 'TXT';
  if (normalized.endsWith('_A')) return 'A';
  return normalized.replace(/^DNS_RECORD_TYPE_/, '');
}

function buildDefaultPublicDomain(input: {
  projectKey: string;
  projectName?: string;
  rootDomain: string;
}) {
  const source = asText(input.projectName) || asText(input.projectKey) || 'app';
  const slug = sanitizeSlug(source, 48);
  const hash = createHash('sha1').update(`${input.projectKey}:${source}`).digest('hex').slice(0, 6);
  return `${slug}-${hash}.${input.rootDomain}`;
}

function buildVerificationRecord(input: {
  rootDomain: string;
  verificationDnsHost?: string;
  verificationToken?: string;
}): DnsRecordInput | null {
  const host = asText(input.verificationDnsHost).replace(/\.$/, '');
  const token = asText(input.verificationToken);
  if (!host || !token) return null;
  return {
    type: 'TXT',
    name: host.endsWith(`.${input.rootDomain}`) ? host : `${host}.${input.rootDomain}`,
    content: token,
  };
}

async function executeRailwayGraphql<T>(
  token: string,
  tokenKind: RailwayAuthKind,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  return requestRailwayGraphql<T>(
    {
      token,
      kind: tokenKind,
    },
    query,
    variables
  );
}

function normalizeRailwayRecord(input: {
  record: RailwayDnsRecord;
  domain: string;
}): DnsRecordInput | null {
  const type = normalizeRailwayRecordType(asText(input.record.recordType));
  const name = asText(input.record.fqdn) || asText(input.record.hostlabel) || input.domain;
  const value = asText(input.record.requiredValue);
  if (!type || !name || !value) {
    return null;
  }
  return {
    type,
    name,
    content: value,
    proxied: type === 'CNAME' ? false : undefined,
  };
}

async function loadCustomDomains(input: {
  token: string;
  tokenKind: RailwayAuthKind;
  projectId: string;
  environmentId: string;
  serviceId: string;
}) {
  return executeRailwayGraphql<{
    domains?: {
      customDomains?: RailwayCustomDomain[];
    } | null;
  }>(
    input.token,
    input.tokenKind,
    `
      query OneCeoPublicCustomDomains($projectId: String!, $serviceId: String!, $environmentId: String!) {
        domains(projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId) {
          customDomains {
            id
            domain
            status {
              verified
              certificateStatus
              certificateErrorMessage
              verificationDnsHost
              verificationToken
              dnsRecords {
                recordType
                fqdn
                hostlabel
                requiredValue
                currentValue
                status
              }
            }
          }
        }
      }
    `,
    {
      projectId: input.projectId,
      serviceId: input.serviceId,
      environmentId: input.environmentId,
    }
  );
}

async function createCustomDomain(input: {
  token: string;
  tokenKind: RailwayAuthKind;
  projectId: string;
  environmentId: string;
  serviceId: string;
  domain: string;
  targetPort: number;
}) {
  return executeRailwayGraphql<{
    customDomainCreate?: RailwayCustomDomain | null;
  }>(
    input.token,
    input.tokenKind,
    `
      mutation OneCeoCreatePublicCustomDomain($input: CustomDomainCreateInput!) {
        customDomainCreate(input: $input) {
          id
          domain
          status {
            verified
            certificateStatus
            certificateErrorMessage
            verificationDnsHost
            verificationToken
            dnsRecords {
              recordType
              fqdn
              hostlabel
              requiredValue
              currentValue
              status
            }
          }
        }
      }
    `,
    {
      input: {
        domain: input.domain,
        projectId: input.projectId,
        serviceId: input.serviceId,
        environmentId: input.environmentId,
        targetPort: input.targetPort,
      },
    }
  );
}

async function refreshCustomDomain(input: {
  token: string;
  tokenKind: RailwayAuthKind;
  environmentId: string;
  customDomainId: string;
  targetPort: number;
}) {
  return executeRailwayGraphql<{
    customDomainUpdate?: boolean | null;
  }>(
    input.token,
    input.tokenKind,
    `
      mutation OneCeoRefreshPublicCustomDomain($id: String!, $environmentId: String!, $targetPort: Int) {
        customDomainUpdate(id: $id, environmentId: $environmentId, targetPort: $targetPort)
      }
    `,
    {
      id: input.customDomainId,
      environmentId: input.environmentId,
      targetPort: input.targetPort,
    }
  );
}

export async function ensureDeploymentPublicDomain(input: {
  token: string;
  tokenKind: RailwayAuthKind;
  projectKey: string;
  projectName?: string;
  projectId: string;
  environmentId: string;
  serviceId: string;
  existing?: Partial<DeploymentPublicDomainBinding>;
}): Promise<DeploymentPublicDomainBinding> {
  const rootDomain = cloudflareDnsService.getRootDomain();
  if (!cloudflareDnsService.isConfigured() || !rootDomain) {
    return {
      ...input.existing,
      domainStatus: 'unconfigured',
      domainStatusMessage: 'Cloudflare DNS 未配置，暂未启用 oneceo.space 默认域名',
      domainLastCheckedAt: new Date().toISOString(),
    };
  }

  const publicDomain =
    asText(input.existing?.publicDomain) ||
    buildDefaultPublicDomain({
      projectKey: input.projectKey,
      projectName: input.projectName,
      rootDomain,
    });
  const targetPort = Number.parseInt(asText(process.env.RAILWAY_DEPLOYMENT_TARGET_PORT) || '8080', 10);
  const now = new Date().toISOString();

  try {
    const existingDomains = await loadCustomDomains(input);
    let customDomain =
      existingDomains.domains?.customDomains
        ?.map((entry) => ({
          id: asText(entry.id),
          domain: asText(entry.domain),
          status: entry.status,
        }))
        .find((entry) => entry.id && entry.domain === publicDomain) || null;

    if (!customDomain) {
      const created = await createCustomDomain({
        ...input,
        domain: publicDomain,
        targetPort: Number.isFinite(targetPort) ? targetPort : 8080,
      });
      customDomain = {
        id: asText(created.customDomainCreate?.id),
        domain: asText(created.customDomainCreate?.domain),
        status: created.customDomainCreate?.status || null,
      };
    }

    const railwayRecords: DnsRecordInput[] =
      customDomain?.status?.dnsRecords
        ?.map((record) =>
          normalizeRailwayRecord({
            record,
            domain: publicDomain,
          })
        )
        .filter((record): record is NonNullable<typeof record> => Boolean(record)) || [];
    const verificationRecord = buildVerificationRecord({
      rootDomain,
      verificationDnsHost: customDomain?.status?.verificationDnsHost,
      verificationToken: customDomain?.status?.verificationToken,
    });
    if (verificationRecord) {
      railwayRecords.push(verificationRecord);
    }
    const dnsRecords = railwayRecords.length
      ? await cloudflareDnsService.upsertRecords(railwayRecords, {
          projectKey: input.projectKey,
        })
      : [];
    const failedRecord = dnsRecords.find((record) => record.status === 'error');
    if (!failedRecord && customDomain?.id && customDomain.status?.verified !== true) {
      await refreshCustomDomain({
        token: input.token,
        tokenKind: input.tokenKind,
        environmentId: input.environmentId,
        customDomainId: customDomain.id,
        targetPort: Number.isFinite(targetPort) ? targetPort : 8080,
      }).catch(() => null);
    }

    return {
      publicDomain,
      publicUrl: toPublicUrl(publicDomain),
      publicDomainProvider: 'cloudflare_railway_custom_domain',
      railwayCustomDomainId: asText(customDomain?.id) || input.existing?.railwayCustomDomainId,
      cloudflareZoneId: asText(process.env.CLOUDFLARE_ZONE_ID) || input.existing?.cloudflareZoneId,
      cloudflareDnsRecords: dnsRecords,
      domainStatus: failedRecord
        ? 'repair_required'
        : customDomain?.status?.verified
          ? 'active'
          : dnsRecords.length > 0
            ? 'pending_certificate'
            : 'pending_dns',
      domainStatusMessage:
        failedRecord?.error ||
        asText(customDomain?.status?.certificateErrorMessage) ||
        (customDomain?.status?.verified
          ? 'oneceo.space 默认域名已生效'
          : 'oneceo.space 默认域名已绑定，等待 DNS 或证书生效'),
      domainLastCheckedAt: now,
      domainActivatedAt: customDomain?.status?.verified ? now : input.existing?.domainActivatedAt,
    };
  } catch (error: any) {
    return {
      ...input.existing,
      publicDomain,
      publicUrl: toPublicUrl(publicDomain),
      publicDomainProvider: 'cloudflare_railway_custom_domain',
      domainStatus: 'failed',
      domainStatusMessage: asText(error?.message) || 'oneceo.space 默认域名绑定失败',
      domainLastCheckedAt: now,
    };
  }
}
