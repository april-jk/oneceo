type CloudflareDnsRecordInput = {
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
};

export type CloudflareDnsRecordResult = {
  id?: string;
  type: string;
  name: string;
  value: string;
  proxied?: boolean;
  status: 'created' | 'updated' | 'unchanged' | 'error';
  error?: string;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseBoolean(value: unknown, fallback = false): boolean {
  const text = asText(value).toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(text);
}

function getConfig() {
  return {
    token: asText(process.env.CLOUDFLARE_API_TOKEN),
    zoneId: asText(process.env.CLOUDFLARE_ZONE_ID),
    rootDomain: asText(process.env.ONECEO_DEPLOYMENT_PUBLIC_DOMAIN),
    proxied: parseBoolean(process.env.ONECEO_DEPLOYMENT_PUBLIC_DOMAIN_PROXY, false),
  };
}

async function requestCloudflare<T>(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
  }
): Promise<T> {
  const { token } = getConfig();
  if (!token) {
    throw new Error('CLOUDFLARE_API_TOKEN 未配置，无法自动绑定 oneceo.space 域名');
  }

  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: options?.method || 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = (await response.json().catch(() => null)) as {
    success?: boolean;
    result?: T;
    errors?: Array<{ message?: string }>;
  } | null;
  if (!response.ok || !payload?.success) {
    const message =
      payload?.errors?.map((item) => asText(item.message)).filter(Boolean).join('; ') ||
      `Cloudflare API 请求失败: HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload.result as T;
}

function normalizeRecordType(value: string) {
  return asText(value).toUpperCase();
}

function normalizeRecordName(value: string) {
  return asText(value).replace(/\.$/, '').toLowerCase();
}

function normalizeRecordContent(value: string) {
  return asText(value).replace(/\.$/, '');
}

function buildComment(projectKey: string) {
  return `managed-by=oneceo deploymentProjectKey=${asText(projectKey) || 'default'}`;
}

export const cloudflareDnsService = {
  isConfigured(): boolean {
    const config = getConfig();
    return Boolean(config.token && config.zoneId && config.rootDomain);
  },

  getRootDomain(): string {
    return getConfig().rootDomain;
  },

  async upsertRecords(
    records: CloudflareDnsRecordInput[],
    options: {
      projectKey: string;
    }
  ): Promise<CloudflareDnsRecordResult[]> {
    const config = getConfig();
    if (!config.zoneId) {
      throw new Error('CLOUDFLARE_ZONE_ID 未配置，无法自动绑定 oneceo.space 域名');
    }
    const comment = buildComment(options.projectKey);
    const results: CloudflareDnsRecordResult[] = [];

    for (const record of records) {
      const type = normalizeRecordType(record.type);
      const name = normalizeRecordName(record.name);
      const content = normalizeRecordContent(record.content);
      if (!type || !name || !content) {
        continue;
      }

      const existing = await requestCloudflare<
        Array<{
          id?: string;
          type?: string;
          name?: string;
          content?: string;
          proxied?: boolean;
          comment?: string;
        }>
      >(
        `/zones/${encodeURIComponent(config.zoneId)}/dns_records?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`
      );
      const matched = existing.find((item) => normalizeRecordName(asText(item.name)) === name);
      const expectedProxied = type === 'CNAME' ? config.proxied : undefined;

      if (!matched?.id) {
        const created = await requestCloudflare<{
          id?: string;
          type?: string;
          name?: string;
          content?: string;
          proxied?: boolean;
        }>(`/zones/${encodeURIComponent(config.zoneId)}/dns_records`, {
          method: 'POST',
          body: {
            type,
            name,
            content,
            ...(type === 'CNAME' ? { proxied: expectedProxied } : {}),
            comment,
          },
        });
        results.push({
          id: created.id,
          type,
          name,
          value: content,
          proxied: created.proxied,
          status: 'created',
        });
        continue;
      }

      const currentContent = normalizeRecordContent(asText(matched.content));
      const currentProxied = matched.proxied;
      const contentMatches = currentContent === content;
      const proxyMatches = type !== 'CNAME' || currentProxied === expectedProxied;
      if (contentMatches && proxyMatches) {
        results.push({
          id: matched.id,
          type,
          name,
          value: content,
          proxied: currentProxied,
          status: 'unchanged',
        });
        continue;
      }

      const isManagedByOneCeo = asText(matched.comment).includes('managed-by=oneceo');
      if (!isManagedByOneCeo) {
        results.push({
          id: matched.id,
          type,
          name,
          value: content,
          proxied: currentProxied,
          status: 'error',
          error: '同名 DNS 记录已存在且不是 OneCEO 管理记录，已停止覆盖',
        });
        continue;
      }

      const updated = await requestCloudflare<{
        id?: string;
        type?: string;
        name?: string;
        content?: string;
        proxied?: boolean;
      }>(`/zones/${encodeURIComponent(config.zoneId)}/dns_records/${encodeURIComponent(matched.id)}`, {
        method: 'PATCH',
        body: {
          type,
          name,
          content,
          ...(type === 'CNAME' ? { proxied: expectedProxied } : {}),
          comment,
        },
      });
      results.push({
        id: updated.id,
        type,
        name,
        value: content,
        proxied: updated.proxied,
        status: 'updated',
      });
    }

    return results;
  },
};
