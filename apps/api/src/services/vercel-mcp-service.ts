import { taskSessionConnectorBindingDAO } from '../db/dao';
import { userConnectorService } from './user-connector-service';
import { vercelRestClient } from './vercel-rest-client';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asText(item)).filter(Boolean);
}

function buildTextContent(value: unknown) {
  return [
    {
      type: 'text' as const,
      text: JSON.stringify(value, null, 2),
    },
  ];
}

const TOOL_DEFINITIONS = [
  {
    name: 'vercel_list_projects',
    title: 'List Vercel Projects',
    description: 'List Vercel projects for the authorized user or team.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        since: { type: 'number' },
        until: { type: 'number' },
        repoUrl: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vercel_get_project',
    title: 'Get Vercel Project',
    description: 'Get a Vercel project by project ID or project slug.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        projectSlug: { type: 'string' },
        projectIdOrName: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vercel_list_deployments',
    title: 'List Vercel Deployments',
    description: 'List deployments, optionally scoped to a project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        projectSlug: { type: 'string' },
        projectIdOrName: { type: 'string' },
        limit: { type: 'number' },
        target: { type: 'string' },
        state: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vercel_get_deployment',
    title: 'Get Vercel Deployment',
    description: 'Get a deployment by deployment ID or URL.',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: { type: 'string' },
        deploymentUrl: { type: 'string' },
        deploymentIdOrUrl: { type: 'string' },
      },
      required: ['deploymentIdOrUrl'],
      additionalProperties: false,
    },
  },
  {
    name: 'vercel_get_deployment_events',
    title: 'Get Vercel Deployment Events',
    description: 'Get build and deployment events for a deployment.',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: { type: 'string' },
        deploymentUrl: { type: 'string' },
        deploymentIdOrUrl: { type: 'string' },
        buildId: { type: 'string' },
        direction: { type: 'string' },
        limit: { type: 'number' },
        follow: { type: 'boolean' },
      },
      required: ['deploymentIdOrUrl'],
      additionalProperties: false,
    },
  },
  {
    name: 'vercel_list_project_domains',
    title: 'List Vercel Project Domains',
    description: 'List domains configured for a project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        projectSlug: { type: 'string' },
        projectIdOrName: { type: 'string' },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vercel_list_env_vars',
    title: 'List Vercel Env Vars',
    description: 'List environment variables for a project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        projectSlug: { type: 'string' },
        projectIdOrName: { type: 'string' },
        target: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' } },
          ],
        },
        gitBranch: { type: 'string' },
        decrypt: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vercel_add_project_domain',
    title: 'Add Vercel Project Domain',
    description: 'Add a domain to a Vercel project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        projectSlug: { type: 'string' },
        projectIdOrName: { type: 'string' },
        domain: { type: 'string' },
        gitBranch: { type: 'string' },
        redirect: { type: 'string' },
        redirectStatusCode: { type: 'number' },
        customEnvironmentId: { type: 'string' },
      },
      required: ['domain'],
      additionalProperties: false,
    },
  },
  {
    name: 'vercel_upsert_env_var',
    title: 'Upsert Vercel Env Var',
    description: 'Create or update a Vercel project environment variable.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        projectSlug: { type: 'string' },
        projectIdOrName: { type: 'string' },
        key: { type: 'string' },
        value: { type: 'string' },
        type: { type: 'string' },
        target: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' } },
          ],
        },
        gitBranch: { type: 'string' },
        customEnvironmentIds: {
          type: 'array',
          items: { type: 'string' },
        },
        comment: { type: 'string' },
      },
      required: ['key', 'value', 'target'],
      additionalProperties: false,
    },
  },
  {
    name: 'vercel_remove_env_var',
    title: 'Remove Vercel Env Var',
    description: 'Remove a Vercel project environment variable by env var ID.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        projectSlug: { type: 'string' },
        projectIdOrName: { type: 'string' },
        envVarId: { type: 'string' },
        customEnvironmentId: { type: 'string' },
      },
      required: ['envVarId'],
      additionalProperties: false,
    },
  },
  {
    name: 'vercel_redeploy_deployment',
    title: 'Redeploy Vercel Deployment',
    description: 'Create a new deployment from an existing deployment ID.',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: { type: 'string' },
        target: { type: 'string' },
        withLatestCommit: { type: 'boolean' },
      },
      required: ['deploymentId'],
      additionalProperties: false,
    },
  },
] as const;

type VercelToolName = (typeof TOOL_DEFINITIONS)[number]['name'];

export type VercelMcpRuntimeContext = {
  connectorKey: 'vercel';
  taskSessionId: string;
  userId: string;
  profileId: string;
};

function resolveProjectIdOrName(
  args: Record<string, unknown>,
  profileConfig: Record<string, unknown>,
  required = false
) {
  const projectIdOrName =
    asText(args.projectIdOrName) ||
    asText(args.projectId) ||
    asText(args.projectSlug) ||
    asText(profileConfig.projectId) ||
    asText(profileConfig.projectSlug);
  if (required && !projectIdOrName) {
    throw new Error('Vercel 写操作缺少明确 projectId 或 projectSlug');
  }
  return projectIdOrName;
}

function resolveTeamId(args: Record<string, unknown>, profileConfig: Record<string, unknown>) {
  return asText(args.teamId) || asText(profileConfig.teamId) || undefined;
}

function resolveTargets(value: unknown): string[] {
  const single = asText(value);
  if (single) {
    return [single];
  }
  return pickStringArray(value);
}

export class VercelMcpService {
  listTools() {
    return TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  private async loadAuthorizedProfile(context: VercelMcpRuntimeContext) {
    const binding = await taskSessionConnectorBindingDAO.getByTaskSessionAndConnectorKey(
      context.taskSessionId,
      'vercel'
    );
    if (
      !binding ||
      binding.desiredState !== 'attached' ||
      asText(binding.profileId) !== context.profileId
    ) {
      throw new Error('当前 task session 未挂载对应的 Vercel connector profile');
    }

    const profile = await userConnectorService.getProfileMaterial(context.userId, context.profileId);
    if (!profile || profile.connectorKey !== 'vercel') {
      throw new Error('Vercel connector profile 不存在');
    }
    if (profile.authStatus !== 'authorized') {
      throw new Error('Vercel connector 当前未授权，需要重新连接');
    }
    return profile;
  }

  async callTool(
    context: VercelMcpRuntimeContext,
    toolName: VercelToolName,
    rawArguments: Record<string, unknown>
  ) {
    const profile = await this.loadAuthorizedProfile(context);
    const profileConfig = pickObject(profile.configJson);
    const args = pickObject(rawArguments);
    const requestContext = {
      userId: context.userId,
      profileId: context.profileId,
      taskSessionId: context.taskSessionId,
      teamId: resolveTeamId(args, profileConfig),
    };

    switch (toolName) {
      case 'vercel_list_projects':
        return vercelRestClient.listProjects(requestContext, {
          limit: args.limit,
          since: args.since,
          until: args.until,
          repoUrl: args.repoUrl,
        });
      case 'vercel_get_project': {
        const projectIdOrName = resolveProjectIdOrName(args, profileConfig, true);
        return vercelRestClient.getProject(requestContext, projectIdOrName);
      }
      case 'vercel_list_deployments': {
        const projectIdOrName = resolveProjectIdOrName(args, profileConfig, false);
        return vercelRestClient.listDeployments(requestContext, {
          limit: args.limit,
          target: args.target,
          state: args.state,
          projectId: projectIdOrName || undefined,
        });
      }
      case 'vercel_get_deployment': {
        const deploymentIdOrUrl =
          asText(args.deploymentIdOrUrl) ||
          asText(args.deploymentId) ||
          asText(args.deploymentUrl);
        if (!deploymentIdOrUrl) {
          throw new Error('缺少 deploymentIdOrUrl');
        }
        return vercelRestClient.getDeployment(requestContext, deploymentIdOrUrl);
      }
      case 'vercel_get_deployment_events': {
        const deploymentIdOrUrl =
          asText(args.deploymentIdOrUrl) ||
          asText(args.deploymentId) ||
          asText(args.deploymentUrl);
        if (!deploymentIdOrUrl) {
          throw new Error('缺少 deploymentIdOrUrl');
        }
        return vercelRestClient.getDeploymentEvents(requestContext, deploymentIdOrUrl, {
          name: args.buildId,
          direction: args.direction,
          limit: args.limit,
          follow: args.follow === true ? '1' : undefined,
        });
      }
      case 'vercel_list_project_domains': {
        const projectIdOrName = resolveProjectIdOrName(args, profileConfig, true);
        return vercelRestClient.listProjectDomains(requestContext, projectIdOrName, {
          limit: args.limit,
        });
      }
      case 'vercel_list_env_vars': {
        const projectIdOrName = resolveProjectIdOrName(args, profileConfig, true);
        const targets = resolveTargets(args.target);
        return vercelRestClient.listEnvVars(requestContext, projectIdOrName, {
          target: targets.length > 0 ? targets : undefined,
          gitBranch: args.gitBranch,
          decrypt: args.decrypt === true ? 'true' : undefined,
        });
      }
      case 'vercel_add_project_domain': {
        const projectIdOrName = resolveProjectIdOrName(args, profileConfig, true);
        const domain = asText(args.domain);
        if (!domain) {
          throw new Error('缺少 domain');
        }
        console.info('[VERCEL_MCP_WRITE:add_project_domain]', {
          taskSessionId: context.taskSessionId,
          profileId: context.profileId,
          projectIdOrName,
          domain,
        });
        return vercelRestClient.addProjectDomain(requestContext, projectIdOrName, {
          name: domain,
          gitBranch: asText(args.gitBranch) || null,
          redirect: asText(args.redirect) || null,
          redirectStatusCode:
            typeof args.redirectStatusCode === 'number' ? args.redirectStatusCode : undefined,
          customEnvironmentId: asText(args.customEnvironmentId) || undefined,
        });
      }
      case 'vercel_upsert_env_var': {
        const projectIdOrName = resolveProjectIdOrName(args, profileConfig, true);
        const key = asText(args.key);
        const value = asText(args.value);
        const targets = resolveTargets(args.target);
        if (!key || !value) {
          throw new Error('缺少环境变量 key 或 value');
        }
        if (targets.length === 0) {
          throw new Error('修改 Vercel 环境变量时必须显式指定 target 环境');
        }
        console.info('[VERCEL_MCP_WRITE:upsert_env_var]', {
          taskSessionId: context.taskSessionId,
          profileId: context.profileId,
          projectIdOrName,
          key,
          target: targets,
        });
        return vercelRestClient.upsertEnvVar(requestContext, projectIdOrName, {
          key,
          value,
          type: asText(args.type) || 'plain',
          target: targets,
          gitBranch: asText(args.gitBranch) || undefined,
          customEnvironmentIds: pickStringArray(args.customEnvironmentIds),
          comment: asText(args.comment) || undefined,
        });
      }
      case 'vercel_remove_env_var': {
        const projectIdOrName = resolveProjectIdOrName(args, profileConfig, true);
        const envVarId = asText(args.envVarId);
        if (!envVarId) {
          throw new Error('缺少 envVarId');
        }
        console.info('[VERCEL_MCP_WRITE:remove_env_var]', {
          taskSessionId: context.taskSessionId,
          profileId: context.profileId,
          projectIdOrName,
          envVarId,
        });
        return vercelRestClient.removeEnvVar(requestContext, projectIdOrName, envVarId, {
          customEnvironmentId: asText(args.customEnvironmentId) || undefined,
        });
      }
      case 'vercel_redeploy_deployment': {
        const deploymentId = asText(args.deploymentId);
        if (!deploymentId) {
          throw new Error('缺少 deploymentId');
        }
        console.info('[VERCEL_MCP_WRITE:redeploy_deployment]', {
          taskSessionId: context.taskSessionId,
          profileId: context.profileId,
          deploymentId,
        });
        return vercelRestClient.redeployDeployment(requestContext, {
          deploymentId,
          target: asText(args.target) || undefined,
          withLatestCommit: args.withLatestCommit === true ? true : undefined,
        });
      }
      default:
        throw new Error(`未知的 Vercel MCP tool: ${toolName}`);
    }
  }

  async executeRpc(input: {
    method: string;
    params?: Record<string, unknown>;
    runtimeContext: VercelMcpRuntimeContext;
  }) {
    const params = pickObject(input.params);
    if (input.method === 'initialize') {
      return {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'oneceo-vercel-internal-mcp',
          version: '1.0.0',
        },
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
      };
    }
    if (input.method === 'ping') {
      return {};
    }
    if (input.method === 'notifications/initialized') {
      return {};
    }
    if (input.method === 'tools/list') {
      return {
        tools: this.listTools(),
      };
    }
    if (input.method === 'tools/call') {
      const toolName = asText(params.name) as VercelToolName;
      if (!toolName) {
        throw new Error('tools/call 缺少 name');
      }
      const result = await this.callTool(input.runtimeContext, toolName, pickObject(params.arguments));
      return {
        content: buildTextContent(result),
        structuredContent: {
          result,
        },
      };
    }
    throw new Error(`不支持的 MCP 方法: ${input.method}`);
  }
}

export const vercelMcpService = new VercelMcpService();
