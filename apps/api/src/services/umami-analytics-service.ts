type UmamiAuthResponse = {
  token?: string;
};

export type UmamiWebsiteSummary = {
  id: string;
  name?: string;
  domain?: string;
};

export type UmamiWebsiteMetrics = {
  pageviews?: number;
  visits?: number;
  visitors?: number;
  events?: number;
  activeVisitors?: number;
  updatedAt: string;
};

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type UmamiWebsiteListResponse = {
  data?: unknown;
  count?: unknown;
  page?: unknown;
  pageSize?: unknown;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseBoolean(value: unknown): boolean | null {
  const text = asText(value).toLowerCase();
  if (!text) return null;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return null;
}

function normalizeDomain(value: string): string {
  const trimmed = asText(value);
  if (!trimmed) return '';
  const withProtocol =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`;
  try {
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return trimmed.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  }
}

function unwrapPayload<T>(payload: unknown): T {
  const record = asObject(payload);
  if ('data' in record) {
    return record.data as T;
  }
  return payload as T;
}

function formatUmamiError(status: number, payload: unknown): string {
  const record = asObject(payload);
  const error = asText(record.error);
  const message = asText(record.message);
  if (error) return error;
  if (message) return message;
  return `umami request failed: ${status}`;
}

function extractActiveVisitors(payload: unknown): number | undefined {
  const direct = asNumber(payload);
  if (direct !== undefined) {
    return direct;
  }

  const record = asObject(payload);
  for (const key of ['x', 'value', 'visitors', 'activeVisitors', 'count']) {
    const candidate = asNumber(record[key]);
    if (candidate !== undefined) {
      return candidate;
    }
  }

  const data = unwrapPayload<unknown>(payload);
  if (data !== payload) {
    return extractActiveVisitors(data);
  }

  const list = asArray(payload);
  if (list.length === 1) {
    return extractActiveVisitors(list[0]);
  }
  return undefined;
}

class UmamiAnalyticsService {
  private authToken: { token: string; expiresAt: number } | null = null;

  private getHost(): string {
    return asText(process.env.UMAMI_HOST_URL).replace(/\/+$/, '');
  }

  private getUsername(): string {
    return asText(process.env.UMAMI_USERNAME);
  }

  private getPassword(): string {
    return asText(process.env.UMAMI_PASSWORD);
  }

  private getTeamId(): string {
    return asText(process.env.UMAMI_TEAM_ID);
  }

  isEnabled(): boolean {
    const explicit = parseBoolean(process.env.UMAMI_ENABLED);
    if (explicit !== null) {
      return explicit;
    }
    return Boolean(this.getHost() && this.getUsername() && this.getPassword() && this.getTeamId());
  }

  isConfigured(): boolean {
    return this.isEnabled() && Boolean(this.getHost() && this.getUsername() && this.getPassword() && this.getTeamId());
  }

  getTrackerHost(): string {
    return this.getHost();
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    options?: { auth?: boolean; retryOnAuthError?: boolean }
  ): Promise<T> {
    const host = this.getHost();
    if (!host) {
      throw new Error('UMAMI_HOST_URL 未配置');
    }

    const headers = new Headers(init.headers || {});
    headers.set('accept', 'application/json');
    const auth = options?.auth ?? true;
    if (auth) {
      const token = await this.getAccessToken();
      headers.set('authorization', `Bearer ${token}`);
    }

    const response = await fetch(`${host}${path}`, {
      ...init,
      headers,
    });

    const text = await response.text();
    let payload: unknown = {};
    if (text) {
      try {
        payload = JSON.parse(text) as JsonValue;
      } catch {
        payload = { raw: text };
      }
    }

    if ((response.status === 401 || response.status === 403) && auth && options?.retryOnAuthError !== false) {
      this.authToken = null;
      return this.request<T>(path, init, {
        auth,
        retryOnAuthError: false,
      });
    }

    if (!response.ok) {
      throw new Error(formatUmamiError(response.status, payload));
    }

    return payload as T;
  }

  private async getAccessToken(): Promise<string> {
    if (this.authToken && this.authToken.expiresAt > Date.now()) {
      return this.authToken.token;
    }

    const username = this.getUsername();
    const password = this.getPassword();
    if (!username || !password) {
      throw new Error('Umami 集成账号未配置');
    }

    const payload = await this.request<UmamiAuthResponse>(
      '/api/auth/login',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          username,
          password,
        }),
      },
      {
        auth: false,
        retryOnAuthError: false,
      }
    );

    const token = asText(asObject(payload).token);
    if (!token) {
      throw new Error('Umami 登录未返回 token');
    }

    this.authToken = {
      token,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    return token;
  }

  async listWebsites(): Promise<UmamiWebsiteSummary[]> {
    if (!this.isConfigured()) {
      return [];
    }

    const teamId = this.getTeamId();
    const pageSize = 100;
    let page = 1;
    const collected: UmamiWebsiteSummary[] = [];

    while (page <= 100) {
      const params = new URLSearchParams();
      if (teamId) {
        params.set('teamId', teamId);
      }
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));

      const payload = await this.request<UmamiWebsiteListResponse>(`/api/websites?${params.toString()}`, {
        method: 'GET',
      });
      const response = asObject(payload);
      const list = asArray(response.data);
      collected.push(
        ...list
          .map((item) => {
            const record = asObject(item);
            return {
              id: asText(record.id),
              name: asText(record.name) || undefined,
              domain: normalizeDomain(asText(record.domain)) || undefined,
            } satisfies UmamiWebsiteSummary;
          })
          .filter((item) => item.id)
      );

      const totalCount = asNumber(response.count);
      const currentPage = asNumber(response.page) || page;
      const currentPageSize = asNumber(response.pageSize) || pageSize;
      if (!list.length) {
        break;
      }
      if (totalCount !== undefined && collected.length >= totalCount) {
        break;
      }
      if (list.length < currentPageSize) {
        break;
      }
      page = currentPage + 1;
    }

    return collected;
  }

  async ensureWebsite(input: { name: string; domain: string }): Promise<UmamiWebsiteSummary> {
    if (!this.isConfigured()) {
      throw new Error('Umami 未配置完成');
    }

    const normalizedDomain = normalizeDomain(input.domain);
    if (!normalizedDomain) {
      throw new Error('缺少有效站点域名');
    }

    const websites = await this.listWebsites();
    const matched = websites.find((item) => normalizeDomain(item.domain || '') === normalizedDomain);
    if (matched) {
      return matched;
    }

    const payload = await this.request<unknown>('/api/websites', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: asText(input.name) || normalizedDomain,
        domain: normalizedDomain,
        teamId: this.getTeamId(),
      }),
    });
    const record = asObject(unwrapPayload<unknown>(payload));
    const id = asText(record.id);
    if (!id) {
      throw new Error('Umami website 创建失败');
    }
    return {
      id,
      name: asText(record.name) || asText(input.name) || normalizedDomain,
      domain: normalizeDomain(asText(record.domain) || normalizedDomain) || normalizedDomain,
    };
  }

  async updateWebsite(
    websiteId: string,
    input: {
      name?: string;
      domain: string;
    }
  ): Promise<UmamiWebsiteSummary> {
    if (!this.isConfigured()) {
      throw new Error('Umami 未配置完成');
    }

    const safeWebsiteId = asText(websiteId);
    const normalizedDomain = normalizeDomain(input.domain);
    if (!safeWebsiteId) {
      throw new Error('缺少 websiteId');
    }
    if (!normalizedDomain) {
      throw new Error('缺少有效站点域名');
    }

    const payload = await this.request<unknown>(`/api/websites/${encodeURIComponent(safeWebsiteId)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: asText(input.name) || normalizedDomain,
        domain: normalizedDomain,
      }),
    });
    const record = asObject(unwrapPayload<unknown>(payload));
    const id = asText(record.id) || safeWebsiteId;
    if (!id) {
      throw new Error('Umami website 更新失败');
    }
    return {
      id,
      name: asText(record.name) || asText(input.name) || normalizedDomain,
      domain: normalizeDomain(asText(record.domain) || normalizedDomain) || normalizedDomain,
    };
  }

  async ensureWebsiteBinding(input: {
    websiteId?: string;
    name: string;
    domain: string;
  }): Promise<UmamiWebsiteSummary> {
    const safeWebsiteId = asText(input.websiteId);
    if (safeWebsiteId) {
      try {
        return await this.updateWebsite(safeWebsiteId, {
          name: input.name,
          domain: input.domain,
        });
      } catch (error: any) {
        const message = asText(error?.message).toLowerCase();
        if (!message.includes('not found')) {
          throw error;
        }
      }
    }
    return this.ensureWebsite({
      name: input.name,
      domain: input.domain,
    });
  }

  async deleteWebsite(websiteId: string): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    const safeWebsiteId = asText(websiteId);
    if (!safeWebsiteId) {
      return false;
    }

    try {
      await this.request<unknown>(`/api/websites/${encodeURIComponent(safeWebsiteId)}`, {
        method: 'DELETE',
      });
      return true;
    } catch (error: any) {
      const message = asText(error?.message).toLowerCase();
      if (message.includes('not found')) {
        return false;
      }
      throw error;
    }
  }

  async getWebsiteMetrics(websiteId: string): Promise<UmamiWebsiteMetrics | null> {
    if (!this.isConfigured()) {
      return null;
    }

    const safeWebsiteId = asText(websiteId);
    if (!safeWebsiteId) {
      return null;
    }

    const endAt = Date.now();
    const startAt = endAt - 30 * 24 * 60 * 60 * 1000;
    const statsPayload = await this.request<unknown>(
      `/api/websites/${encodeURIComponent(safeWebsiteId)}/stats?startAt=${startAt}&endAt=${endAt}`,
      {
        method: 'GET',
      }
    );
    const activePayload = await this.request<unknown>(
      `/api/websites/${encodeURIComponent(safeWebsiteId)}/active`,
      {
        method: 'GET',
      }
    );
    const stats = asObject(unwrapPayload<unknown>(statsPayload));

    return {
      pageviews: asNumber(stats.pageviews),
      visits: asNumber(stats.visits),
      visitors: asNumber(stats.visitors),
      events: asNumber(stats.events),
      activeVisitors: extractActiveVisitors(activePayload),
      updatedAt: new Date().toISOString(),
    };
  }
}

export const umamiAnalyticsService = new UmamiAnalyticsService();
