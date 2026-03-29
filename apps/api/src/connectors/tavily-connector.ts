type TavilySearchTopic = 'general' | 'news' | 'finance';
type TavilySearchDepth = 'basic' | 'advanced';
type TavilyExtractDepth = 'basic' | 'advanced';
type TavilyExtractFormat = 'markdown' | 'text';

type TavilyConfig = {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
};

export type TavilyImageResult = {
  url: string;
  description?: string;
};

export type TavilySearchResult = {
  title: string;
  url: string;
  content: string;
  score?: number;
  favicon?: string;
  images: TavilyImageResult[];
};

export type TavilyExtractResult = {
  url: string;
  rawContent: string;
  favicon?: string;
  images: TavilyImageResult[];
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toPositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.floor(parsed));
}

function toPositiveNumber(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, parsed);
}

function pickStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const text = asText(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= maxItems) break;
  }
  return result;
}

function normalizeImageArray(value: unknown, maxItems = 8): TavilyImageResult[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const results: TavilyImageResult[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const url = asText(record.url || record.image_url || record.src);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const description = asText(record.description || record.alt_text || record.alt);
    results.push({
      url,
      ...(description ? { description } : {}),
    });
    if (results.length >= maxItems) break;
  }
  return results;
}

function normalizeSearchResultArray(value: unknown, maxItems = 6): TavilySearchResult[] {
  if (!Array.isArray(value)) return [];
  const results: TavilySearchResult[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const title = asText(record.title);
    const url = asText(record.url);
    if (!url) continue;
    const content =
      asText(record.content) ||
      asText(record.snippet) ||
      asText(record.raw_content);
    const favicon = asText(record.favicon);
    const score = Number(record.score);
    results.push({
      title: title || url,
      url,
      content,
      ...(Number.isFinite(score) ? { score } : {}),
      ...(favicon ? { favicon } : {}),
      images: normalizeImageArray(record.images, 6),
    });
    if (results.length >= maxItems) break;
  }
  return results;
}

function normalizeExtractResultArray(value: unknown, maxItems = 6): TavilyExtractResult[] {
  if (!Array.isArray(value)) return [];
  const results: TavilyExtractResult[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const url = asText(record.url);
    if (!url) continue;
    const rawContent =
      asText(record.raw_content) ||
      asText(record.content) ||
      asText(record.text);
    const favicon = asText(record.favicon);
    results.push({
      url,
      rawContent,
      ...(favicon ? { favicon } : {}),
      images: normalizeImageArray(record.images, 8),
    });
    if (results.length >= maxItems) break;
  }
  return results;
}

function loadConfig(): TavilyConfig {
  const apiKey = asText(process.env.TAVILY_API_KEY);
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY is not configured');
  }
  return {
    apiKey,
    baseUrl: asText(process.env.TAVILY_BASE_URL) || 'https://api.tavily.com',
    timeoutMs: toPositiveInt(process.env.TAVILY_TIMEOUT_MS, 20000, 120000),
  };
}

export class TavilyConnector {
  private async post<T>(endpoint: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const config = loadConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort);
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const text = await response.text().catch(() => '');
      let parsed: any = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }

      if (!response.ok) {
        const message =
          asText(parsed?.detail) ||
          asText(parsed?.message) ||
          asText(parsed?.error?.message) ||
          text ||
          `tavily_request_failed:${response.status}`;
        throw new Error(message);
      }

      return (parsed || {}) as T;
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        throw new Error('tavily_request_timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }

  async search(
    input: {
      query: string;
      topic?: string;
      maxResults?: number;
      includeImages?: boolean;
      searchDepth?: string;
      includeDomains?: string[];
      excludeDomains?: string[];
      timeRange?: string;
    },
    signal?: AbortSignal
  ) {
    const query = asText(input.query);
    if (!query) {
      throw new Error('tavily_search_missing_query');
    }

    const topicRaw = asText(input.topic).toLowerCase();
    const topic: TavilySearchTopic =
      topicRaw === 'news' || topicRaw === 'finance' ? (topicRaw as TavilySearchTopic) : 'general';
    const searchDepthRaw = asText(input.searchDepth).toLowerCase();
    const searchDepth: TavilySearchDepth = searchDepthRaw === 'advanced' ? 'advanced' : 'basic';
    const maxResults = toPositiveInt(input.maxResults, 5, 8);
    const includeImages = Boolean(input.includeImages);
    const includeDomains = pickStringArray(input.includeDomains, 20);
    const excludeDomains = pickStringArray(input.excludeDomains, 20);
    const timeRange = asText(input.timeRange).toLowerCase();

    const payload: Record<string, unknown> = {
      query,
      topic,
      search_depth: searchDepth,
      max_results: maxResults,
      include_images: includeImages,
      include_image_descriptions: includeImages,
      include_favicon: true,
      include_answer: false,
      include_raw_content: false,
    };
    if (includeDomains.length > 0) payload.include_domains = includeDomains;
    if (excludeDomains.length > 0) payload.exclude_domains = excludeDomains;
    if (['day', 'week', 'month', 'year', 'd', 'w', 'm', 'y'].includes(timeRange)) {
      payload.time_range = timeRange;
    }

    const raw = await this.post<any>('/search', payload, signal);
    return {
      query,
      topic,
      searchDepth,
      results: normalizeSearchResultArray(raw?.results, maxResults),
      images: normalizeImageArray(raw?.images, 8),
      answer: asText(raw?.answer),
      requestId: asText(raw?.request_id),
      responseTime: toPositiveNumber(raw?.response_time, 0, 999),
    };
  }

  async extract(
    input: {
      urls: string[];
      extractDepth?: string;
      includeImages?: boolean;
      format?: string;
      timeoutSeconds?: number;
    },
    signal?: AbortSignal
  ) {
    const urls = pickStringArray(input.urls, 8);
    if (urls.length === 0) {
      throw new Error('tavily_extract_missing_urls');
    }

    const extractDepthRaw = asText(input.extractDepth).toLowerCase();
    const extractDepth: TavilyExtractDepth = extractDepthRaw === 'advanced' ? 'advanced' : 'basic';
    const formatRaw = asText(input.format).toLowerCase();
    const format: TavilyExtractFormat = formatRaw === 'text' ? 'text' : 'markdown';
    const includeImages = Boolean(input.includeImages);
    const timeoutSeconds = toPositiveNumber(input.timeoutSeconds, extractDepth === 'advanced' ? 20 : 10, 60);

    const raw = await this.post<any>(
      '/extract',
      {
        urls,
        extract_depth: extractDepth,
        include_images: includeImages,
        include_favicon: true,
        format,
        timeout: timeoutSeconds,
      },
      signal
    );

    return {
      urls,
      extractDepth,
      format,
      results: normalizeExtractResultArray(raw?.results, urls.length),
      failedResults: pickStringArray(
        Array.isArray(raw?.failed_results)
          ? raw.failed_results.map((item: any) =>
              typeof item === 'string' ? item : item?.url || item?.source
            )
          : [],
        8
      ),
      requestId: asText(raw?.request_id),
      responseTime: toPositiveNumber(raw?.response_time, 0, 999),
    };
  }
}

export const tavilyConnector = new TavilyConnector();
