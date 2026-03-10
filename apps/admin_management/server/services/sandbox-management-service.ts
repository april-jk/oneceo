import { Sandbox } from 'e2b';
import type {
  E2bSandboxFullInfo,
  E2bSandboxListItem,
} from '../connectors/e2b-connector';
import { e2bConnector } from '../connectors/e2b-connector';
import { e2bTemplateConnector } from '../connectors/e2b-template-connector';
import { config } from '../config';
import { AppError } from '../utils/errors';

type SandboxStatusSummary = {
  total: number;
  running: number;
  paused: number;
};

function summarizeStatus(records: E2bSandboxListItem[]): SandboxStatusSummary {
  return {
    total: records.length,
    running: records.filter((item) => item.state === 'running').length,
    paused: records.filter((item) => item.state === 'paused').length,
  };
}

export class SandboxManagementService {
  async getOverview(
    limit = 50,
    query?: {
      state?: Array<'running' | 'paused'>;
      metadata?: Record<string, string>;
      templateId?: string;
    }
  ) {
    const hasKey = Boolean(config.e2bApiKey);
    if (!hasKey) {
      return {
        sandboxApi: {
          online: false,
          status: 'missing_api_key',
          service: 'e2b',
          version: null,
          timestamp: null,
        },
        summary: summarizeStatus([]),
        sandboxes: [],
      };
    }

    try {
      const sandboxes = await e2bConnector.listSandboxes(limit, query);
      const filtered = query?.templateId
        ? sandboxes.filter((item) => item.templateId === query.templateId || item.alias === query.templateId)
        : sandboxes;
      return {
        sandboxApi: {
          online: true,
          status: 'ok',
          service: 'e2b',
          version: null,
          timestamp: new Date().toISOString(),
        },
        summary: summarizeStatus(filtered),
        sandboxes: filtered,
      };
    } catch (error) {
      return {
        sandboxApi: {
          online: false,
          status: error instanceof Error ? error.message : 'unavailable',
          service: 'e2b',
          version: null,
          timestamp: new Date().toISOString(),
        },
        summary: summarizeStatus([]),
        sandboxes: [],
      };
    }
  }

  async getEnvironment(sandboxId: string) {
    return e2bConnector.getSandboxInfo(sandboxId);
  }

  async getEnvironmentFullInfo(sandboxId: string): Promise<E2bSandboxFullInfo> {
    return e2bConnector.getSandboxFullInfo(sandboxId);
  }

  async getEnvironmentMetrics(sandboxId: string, start?: string, end?: string) {
    return e2bConnector.getSandboxMetrics(sandboxId, {
      start: start ? new Date(start) : undefined,
      end: end ? new Date(end) : undefined,
    });
  }

  async setEnvironmentTimeout(sandboxId: string, timeoutMs: number) {
    return e2bConnector.setSandboxTimeout(sandboxId, timeoutMs);
  }

  async createEnvironment(payload: {
    template?: string;
    timeoutMs?: number;
    metadata?: Record<string, string>;
    envs?: Record<string, string>;
    allowInternetAccess?: boolean;
    secure?: boolean;
    mcp?: unknown;
    network?: unknown;
    autoPause?: boolean;
  }) {
    return e2bConnector.createSandbox(payload);
  }

  async closeEnvironment(sandboxId: string) {
    return e2bConnector.killSandbox(sandboxId);
  }

  async pauseEnvironment(sandboxId: string) {
    return e2bConnector.pauseSandbox(sandboxId);
  }

  async resumeEnvironment(sandboxId: string) {
    return e2bConnector.resumeSandbox(sandboxId);
  }

  async listTemplates(teamID?: string) {
    return e2bTemplateConnector.listTemplates(teamID);
  }

  async getTemplate(templateID: string, opts?: { limit?: number; nextToken?: string }) {
    return e2bTemplateConnector.getTemplate(templateID, opts);
  }

  async createTemplate(payload: Record<string, unknown>) {
    return e2bTemplateConnector.createTemplate(payload as any);
  }

  async updateTemplate(templateID: string, payload: Record<string, unknown>) {
    return e2bTemplateConnector.updateTemplate(templateID, payload as any);
  }

  async rebuildTemplate(templateID: string, payload: Record<string, unknown>) {
    return e2bTemplateConnector.rebuildTemplate(templateID, payload as any);
  }

  async deleteTemplate(templateID: string) {
    return e2bTemplateConnector.deleteTemplate(templateID);
  }

  async getTemplateBuildLogs(templateID: string, buildID: string, query?: Record<string, unknown>) {
    return e2bTemplateConnector.getBuildLogs(templateID, buildID, query);
  }

  async getTemplateBuildStatus(templateID: string, buildID: string, query?: Record<string, unknown>) {
    return e2bTemplateConnector.getBuildStatus(templateID, buildID, query);
  }

  async checkTemplateAlias(alias: string) {
    return e2bTemplateConnector.checkTemplateAlias(alias);
  }

  async assignTemplateTags(payload: Record<string, unknown>) {
    return e2bTemplateConnector.assignTags(payload as any);
  }

  async deleteTemplateTags(payload: Record<string, unknown>) {
    return e2bTemplateConnector.deleteTags(payload as any);
  }

  private async withSandbox<T>(sandboxId: string, fn: (sandbox: Sandbox) => Promise<T>) {
    if (!config.e2bApiKey) {
      throw new AppError(500, 'E2B_API_KEY 未配置，无法访问 E2B API');
    }
    const sandbox = await Sandbox.connect(sandboxId, { apiKey: config.e2bApiKey });
    return fn(sandbox);
  }

  async runToolAction(sandboxId: string, action: string, payload?: Record<string, unknown>) {
    return this.withSandbox(sandboxId, async (sandbox) => {
      switch (action) {
        case 'command.list':
          return sandbox.commands.list(payload as any);
        case 'command.run':
          return sandbox.commands.run(String(payload?.cmd ?? ''), payload as any);
        case 'command.kill':
          return sandbox.commands.kill(Number(payload?.pid), payload as any);
        case 'command.stdin':
          return sandbox.commands.sendStdin(Number(payload?.pid), String(payload?.data ?? ''), payload as any);
        case 'files.list':
          return sandbox.files.list(String(payload?.path ?? '/'), payload as any);
        case 'files.read':
          return sandbox.files.read(String(payload?.path ?? ''), payload as any);
        case 'files.write':
          return sandbox.files.write(String(payload?.path ?? ''), payload?.data as any, payload as any);
        case 'files.writeFiles':
          return sandbox.files.writeFiles((payload?.files as any[]) ?? [], payload as any);
        case 'files.remove':
          return sandbox.files.remove(String(payload?.path ?? ''), payload as any);
        case 'files.mkdir':
          return sandbox.files.makeDir(String(payload?.path ?? ''), payload as any);
        case 'files.rename':
          return sandbox.files.rename(String(payload?.oldPath ?? ''), String(payload?.newPath ?? ''), payload as any);
        case 'files.exists':
          return sandbox.files.exists(String(payload?.path ?? ''), payload as any);
        case 'files.info':
          return sandbox.files.getInfo(String(payload?.path ?? ''), payload as any);
        case 'git.status':
          return sandbox.git.status(String(payload?.path ?? '.'), payload as any);
        case 'git.branches':
          return sandbox.git.branches(String(payload?.path ?? '.'), payload as any);
        case 'git.clone':
          return sandbox.git.clone(String(payload?.url ?? ''), payload as any);
        case 'git.init':
          return sandbox.git.init(String(payload?.path ?? '.'), payload as any);
        case 'git.remoteAdd':
          return sandbox.git.remoteAdd(
            String(payload?.path ?? '.'),
            String(payload?.name ?? 'origin'),
            String(payload?.url ?? ''),
            payload as any
          );
        case 'git.remoteGet':
          return sandbox.git.remoteGet(String(payload?.path ?? '.'), String(payload?.name ?? 'origin'), payload as any);
        case 'git.createBranch':
          return sandbox.git.createBranch(String(payload?.path ?? '.'), String(payload?.branch ?? ''), payload as any);
        case 'git.checkoutBranch':
          return sandbox.git.checkoutBranch(String(payload?.path ?? '.'), String(payload?.branch ?? ''), payload as any);
        case 'git.deleteBranch':
          return sandbox.git.deleteBranch(String(payload?.path ?? '.'), String(payload?.branch ?? ''), payload as any);
        case 'git.add':
          return sandbox.git.add(String(payload?.path ?? '.'), payload as any);
        case 'git.commit':
          return sandbox.git.commit(String(payload?.path ?? '.'), String(payload?.message ?? ''), payload as any);
        case 'git.reset':
          return sandbox.git.reset(String(payload?.path ?? '.'), payload as any);
        case 'git.restore':
          return sandbox.git.restore(String(payload?.path ?? '.'), payload as any);
        case 'git.pull':
          return sandbox.git.pull(String(payload?.path ?? '.'), payload as any);
        case 'git.push':
          return sandbox.git.push(String(payload?.path ?? '.'), payload as any);
        case 'git.setConfig':
          return sandbox.git.setConfig(String(payload?.key ?? ''), String(payload?.value ?? ''), payload as any);
        case 'git.getConfig':
          return sandbox.git.getConfig(String(payload?.key ?? ''), payload as any);
        case 'git.configureUser':
          return sandbox.git.configureUser(String(payload?.name ?? ''), String(payload?.email ?? ''), payload as any);
        case 'git.dangerouslyAuthenticate':
          return sandbox.git.dangerouslyAuthenticate(payload as any);
        case 'sandbox.host':
          return sandbox.getHost(Number(payload?.port));
        case 'sandbox.uploadUrl':
          return sandbox.uploadUrl(payload?.path as any, payload as any);
        case 'sandbox.downloadUrl':
          return sandbox.downloadUrl(String(payload?.path ?? ''), payload as any);
        default:
          throw new AppError(400, `未知 action: ${action}`);
      }
    });
  }
}
