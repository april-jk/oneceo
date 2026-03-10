import { ApiClient, ConnectionConfig, type components } from 'e2b';
import { config } from '../config';
import { AppError } from '../utils/errors';
import { ensureProxyDispatcher } from '../utils/http-proxy';

type Template = components['schemas']['Template'];
type TemplateWithBuilds = components['schemas']['TemplateWithBuilds'];
type TemplateBuildInfo = components['schemas']['TemplateBuildInfo'];
type TemplateBuildLogsResponse = components['schemas']['TemplateBuildLogsResponse'];
type TemplateLegacy = components['schemas']['TemplateLegacy'];
type TemplateAliasResponse = components['schemas']['TemplateAliasResponse'];
type AssignedTemplateTags = components['schemas']['AssignedTemplateTags'];

function requireApiKey() {
  if (!config.e2bApiKey) {
    throw new AppError(500, 'E2B_API_KEY 未配置，无法访问 E2B API');
  }
  ensureProxyDispatcher();
}

function client() {
  requireApiKey();
  const connection = new ConnectionConfig({ apiKey: config.e2bApiKey });
  return new ApiClient(connection, { requireApiKey: true });
}

async function listTemplates(teamID?: string): Promise<Template[]> {
  const api = client().api;
  const result = await api.GET('/templates', { params: { query: teamID ? { teamID } : undefined } });
  if (result.error) {
    throw new AppError(result.response.status, result.error?.message ?? 'E2B templates list failed', result.error);
  }
  return result.data ?? [];
}

async function getTemplate(templateID: string, opts?: { limit?: number; nextToken?: string }): Promise<TemplateWithBuilds> {
  const api = client().api;
  const result = await api.GET('/templates/{templateID}', {
    params: { path: { templateID }, query: opts },
  });
  if (result.error) {
    throw new AppError(result.response.status, result.error?.message ?? 'E2B template fetch failed', result.error);
  }
  return result.data as TemplateWithBuilds;
}

async function rebuildTemplate(templateID: string, payload: components['schemas']['TemplateBuildRequest']) {
  const api = client().api;
  const result = await api.POST('/templates/{templateID}', {
    params: { path: { templateID } },
    body: payload,
  });
  if (result.error) {
    throw new AppError(result.response.status, result.error?.message ?? 'E2B template rebuild failed', result.error);
  }
  return result.data as TemplateLegacy;
}

async function createTemplate(payload: components['schemas']['TemplateBuildRequest']) {
  const api = client().api;
  const result = await api.POST('/templates', { body: payload });
  if (result.error) {
    throw new AppError(result.response.status, result.error?.message ?? 'E2B template create failed', result.error);
  }
  return result.data as TemplateLegacy;
}

async function updateTemplate(
  templateID: string,
  payload: components['schemas']['TemplateUpdateRequest']
): Promise<boolean> {
  const api = client().api;
  const result = await api.PATCH('/templates/{templateID}', { params: { path: { templateID } }, body: payload });
  if (result.error) {
    throw new AppError(result.response.status, result.error?.message ?? 'E2B template update failed', result.error);
  }
  return true;
}

async function deleteTemplate(templateID: string): Promise<boolean> {
  const api = client().api;
  const result = await api.DELETE('/templates/{templateID}', { params: { path: { templateID } } });
  if (result.error) {
    throw new AppError(result.response.status, result.error?.message ?? 'E2B template delete failed', result.error);
  }
  return true;
}

async function getBuildLogs(
  templateID: string,
  buildID: string,
  query?: Record<string, unknown>
): Promise<TemplateBuildLogsResponse> {
  const api = client().api;
  const result = await api.GET('/templates/{templateID}/builds/{buildID}/logs', {
    params: { path: { templateID, buildID }, query },
  });
  if (result.error) {
    throw new AppError(result.response.status, result.error?.message ?? 'E2B build logs failed', result.error);
  }
  return result.data as TemplateBuildLogsResponse;
}

async function getBuildStatus(
  templateID: string,
  buildID: string,
  query?: Record<string, unknown>
): Promise<TemplateBuildInfo> {
  const api = client().api;
  const result = await api.GET('/templates/{templateID}/builds/{buildID}/status', {
    params: { path: { templateID, buildID }, query },
  });
  if (result.error) {
    throw new AppError(result.response.status, result.error?.message ?? 'E2B build status failed', result.error);
  }
  return result.data as TemplateBuildInfo;
}

async function checkTemplateAlias(alias: string): Promise<TemplateAliasResponse> {
  const api = client().api;
  const result = await api.GET('/templates/aliases/{alias}', { params: { path: { alias } } });
  if (result.error) {
    throw new AppError(result.response.status, result.error?.message ?? 'E2B alias check failed', result.error);
  }
  return result.data as TemplateAliasResponse;
}

async function assignTags(payload: components['schemas']['AssignTemplateTagsRequest']): Promise<AssignedTemplateTags> {
  const api = client().api;
  const result = await api.POST('/templates/tags', { body: payload });
  if (result.error) {
    throw new AppError(result.response.status, result.error?.message ?? 'E2B tag assign failed', result.error);
  }
  return result.data as AssignedTemplateTags;
}

async function deleteTags(payload: components['schemas']['DeleteTemplateTagsRequest']): Promise<boolean> {
  const api = client().api;
  const result = await api.DELETE('/templates/tags', { body: payload });
  if (result.error) {
    throw new AppError(result.response.status, result.error?.message ?? 'E2B tag delete failed', result.error);
  }
  return true;
}

export const e2bTemplateConnector = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  rebuildTemplate,
  deleteTemplate,
  getBuildLogs,
  getBuildStatus,
  checkTemplateAlias,
  assignTags,
  deleteTags,
};
