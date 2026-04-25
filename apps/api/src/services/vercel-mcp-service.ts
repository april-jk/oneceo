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

function setStringOrNull(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string
) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return;
  if (source[key] === null) {
    target[key] = null;
    return;
  }
  const value = asText(source[key]);
  if (value) {
    target[key] = value;
  }
}

function setBoolean(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string
) {
  if (typeof source[key] === 'boolean') {
    target[key] = source[key];
  }
}

function buildProjectMutationBody(
  args: Record<string, unknown>,
  options: { requireName?: boolean } = {}
) {
  const body: Record<string, unknown> = {};
  for (const key of [
    'name',
    'framework',
    'buildCommand',
    'devCommand',
    'installCommand',
    'outputDirectory',
    'rootDirectory',
    'nodeVersion',
  ]) {
    setStringOrNull(body, args, key);
  }
  for (const key of ['directoryListing', 'publicSource']) {
    setBoolean(body, args, key);
  }
  if (options.requireName && !asText(body.name)) {
    throw new Error('缺少 Vercel 项目 name');
  }
  return body;
}

function buildGitRepositoryBody(args: Record<string, unknown>) {
  const gitRepository = pickObject(args.gitRepository);
  const type = asText(gitRepository.type);
  const repo = asText(gitRepository.repo);
  const repoId = asText(gitRepository.repoId);
  if (!type || (!repo && !repoId)) {
    throw new Error('缺少明确的 gitRepository.type 以及 repo 或 repoId');
  }
  const body: Record<string, unknown> = {
    gitRepository: {
      type,
      ...(repo ? { repo } : {}),
      ...(repoId ? { repoId } : {}),
    },
  };
  for (const key of ['gitLFS', 'gitForkProtection']) {
    setBoolean(body, args, key);
  }
  const gitProviderOptions = pickObject(args.gitProviderOptions);
  if (Object.keys(gitProviderOptions).length > 0) {
    body.gitProviderOptions = gitProviderOptions;
  }
  return body;
}

function buildProjectFromGitBody(args: Record<string, unknown>) {
  return {
    ...buildProjectMutationBody(args, { requireName: true }),
    ...buildGitRepositoryBody(args),
  };
}

function buildDeploymentBody(args: Record<string, unknown>) {
  if (Object.prototype.hasOwnProperty.call(args, 'files')) {
    throw new Error('vercel_create_deployment 首版只支持 Git deployment，不支持 files 上传');
  }
  const gitSource = pickObject(args.gitSource);
  if (Object.keys(gitSource).length === 0) {
    throw new Error('vercel_create_deployment 缺少 gitSource');
  }
  const body: Record<string, unknown> = {
    gitSource,
  };
  for (const key of ['name', 'project', 'target']) {
    setStringOrNull(body, args, key);
  }
  for (const key of ['skipAutoDetectionConfirmation']) {
    setBoolean(body, args, key);
  }
  const gitMetadata = pickObject(args.gitMetadata);
  if (Object.keys(gitMetadata).length > 0) {
    body.gitMetadata = gitMetadata;
  }
  const projectSettings = pickObject(args.projectSettings);
  if (Object.keys(projectSettings).length > 0) {
    body.projectSettings = projectSettings;
  }
  return body;
}

function extractProjectGitRepositoryContext(project: Record<string, unknown>) {
  return {
    id: asText(project.id) || null,
    name: asText(project.name) || null,
    link: pickObject(project.link),
    gitRepository: pickObject(project.gitRepository),
    gitProviderOptions: pickObject(project.gitProviderOptions),
    gitLFS: typeof project.gitLFS === 'boolean' ? project.gitLFS : null,
    gitForkProtection:
      typeof project.gitForkProtection === 'boolean' ? project.gitForkProtection : null,
  };
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
    name: 'vercel_get_auth_context',
    title: 'Get Vercel Auth Context',
    description: 'Return non-sensitive Vercel connector authorization context.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
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
    name: 'vercel_list_teams',
    title: 'List Vercel Teams',
    description: 'List teams available to the authorized Vercel user.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        since: { type: 'number' },
        until: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vercel_create_project',
    title: 'Create Vercel Project',
    description: 'Create a Vercel project for the authorized user or team.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        teamId: { type: 'string' },
        framework: { type: 'string' },
        buildCommand: { type: ['string', 'null'] },
        devCommand: { type: ['string', 'null'] },
        installCommand: { type: ['string', 'null'] },
        outputDirectory: { type: ['string', 'null'] },
        rootDirectory: { type: ['string', 'null'] },
        directoryListing: { type: 'boolean' },
        publicSource: { type: 'boolean' },
        nodeVersion: { type: 'string' },
      },
      required: ['name'],
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
    name: 'vercel_update_project',
    title: 'Update Vercel Project',
    description: 'Update Vercel project settings by project ID or project slug.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        projectSlug: { type: 'string' },
        projectIdOrName: { type: 'string' },
        teamId: { type: 'string' },
        name: { type: 'string' },
        framework: { type: 'string' },
        buildCommand: { type: ['string', 'null'] },
        devCommand: { type: ['string', 'null'] },
        installCommand: { type: ['string', 'null'] },
        outputDirectory: { type: ['string', 'null'] },
        rootDirectory: { type: ['string', 'null'] },
        directoryListing: { type: 'boolean' },
        publicSource: { type: 'boolean' },
        nodeVersion: { type: 'string' },
      },
      required: ['projectIdOrName'],
      additionalProperties: false,
    },
  },
  {
    name: 'vercel_delete_project',
    title: 'Delete Vercel Project',
    description: 'Delete a Vercel project by project ID or project slug. Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        projectSlug: { type: 'string' },
        projectIdOrName: { type: 'string' },
        teamId: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['projectIdOrName', 'confirm'],
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
    name: 'vercel_create_deployment',
    title: 'Create Vercel Deployment',
    description: 'Create a Vercel Git deployment. Workspace file upload is not supported.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        project: { type: 'string' },
        teamId: { type: 'string' },
        target: { type: 'string' },
        gitSource: { type: 'object' },
        gitMetadata: { type: 'object' },
        projectSettings: { type: 'object' },
        skipAutoDetectionConfirmation: { type: 'boolean' },
        forceNew: { type: 'boolean' },
      },
      required: ['gitSource'],
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
    name: 'vercel_create_project_from_git',
    title: 'Create Vercel Project From Git',
    description: 'Create a Vercel project bound to an explicit Git repository.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        teamId: { type: 'string' },
        gitRepository: { type: 'object' },
        framework: { type: 'string' },
        buildCommand: { type: ['string', 'null'] },
        devCommand: { type: ['string', 'null'] },
        installCommand: { type: ['string', 'null'] },
        outputDirectory: { type: ['string', 'null'] },
        rootDirectory: { type: ['string', 'null'] },
        nodeVersion: { type: 'string' },
      },
      required: ['name', 'gitRepository'],
      additionalProperties: false,
    },
  },
  {
    name: 'vercel_update_project_git_repository',
    title: 'Update Vercel Project Git Repository',
    description: 'Update only Git repository related fields for a Vercel project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        projectSlug: { type: 'string' },
        projectIdOrName: { type: 'string' },
        teamId: { type: 'string' },
        gitRepository: { type: 'object' },
        gitLFS: { type: 'boolean' },
        gitForkProtection: { type: 'boolean' },
        gitProviderOptions: { type: 'object' },
      },
      required: ['projectIdOrName', 'gitRepository'],
      additionalProperties: false,
    },
  },
  {
    name: 'vercel_get_project_git_repository',
    title: 'Get Vercel Project Git Repository',
    description: 'Extract Git repository binding context from a Vercel project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        projectSlug: { type: 'string' },
        projectIdOrName: { type: 'string' },
        teamId: { type: 'string' },
      },
      required: ['projectIdOrName'],
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

function resolveExplicitProjectIdOrName(args: Record<string, unknown>) {
  const projectIdOrName =
    asText(args.projectIdOrName) ||
    asText(args.projectId) ||
    asText(args.projectSlug);
  if (!projectIdOrName) {
    throw new Error('缺少明确的 projectId 或 projectSlug');
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
      case 'vercel_get_auth_context':
        return {
          authMode: asText(profileConfig.vercelAuthMode) || 'oauth',
          hasAccessToken: Boolean(asText(profile.secret?.accessToken)),
          teamId: asText(profileConfig.teamId) || null,
          configurationId: asText(profileConfig.configurationId) || null,
          installationSource: asText(profileConfig.installationSource) || null,
          integrationSlug: asText(process.env.VERCEL_INTEGRATION_SLUG) || null,
        };
      case 'vercel_list_projects':
        return vercelRestClient.listProjects(requestContext, {
          limit: args.limit,
          since: args.since,
          until: args.until,
          repoUrl: args.repoUrl,
        });
      case 'vercel_list_teams':
        return vercelRestClient.listTeams(requestContext, {
          limit: args.limit,
          since: args.since,
          until: args.until,
        });
      case 'vercel_create_project': {
        const body = buildProjectMutationBody(args, { requireName: true });
        console.info('[VERCEL_MCP_WRITE:create_project]', {
          taskSessionId: context.taskSessionId,
          profileId: context.profileId,
          name: body.name,
        });
        return vercelRestClient.createProject(requestContext, body);
      }
      case 'vercel_create_project_from_git': {
        const body = buildProjectFromGitBody(args);
        console.info('[VERCEL_MCP_WRITE:create_project_from_git]', {
          taskSessionId: context.taskSessionId,
          profileId: context.profileId,
          name: body.name,
          gitRepository: body.gitRepository,
        });
        return vercelRestClient.createProject(requestContext, body);
      }
      case 'vercel_get_project': {
        const projectIdOrName = resolveProjectIdOrName(args, profileConfig, true);
        return vercelRestClient.getProject(requestContext, projectIdOrName);
      }
      case 'vercel_update_project': {
        const projectIdOrName = resolveExplicitProjectIdOrName(args);
        const body = buildProjectMutationBody(args);
        if (Object.keys(body).length === 0) {
          throw new Error('更新 Vercel 项目时至少需要提供一个配置字段');
        }
        console.info('[VERCEL_MCP_WRITE:update_project]', {
          taskSessionId: context.taskSessionId,
          profileId: context.profileId,
          projectIdOrName,
          fields: Object.keys(body),
        });
        return vercelRestClient.updateProject(requestContext, projectIdOrName, body);
      }
      case 'vercel_update_project_git_repository': {
        const projectIdOrName = resolveExplicitProjectIdOrName(args);
        const body = buildGitRepositoryBody(args);
        console.info('[VERCEL_MCP_WRITE:update_project_git_repository]', {
          taskSessionId: context.taskSessionId,
          profileId: context.profileId,
          projectIdOrName,
          fields: Object.keys(body),
        });
        return vercelRestClient.updateProject(requestContext, projectIdOrName, body);
      }
      case 'vercel_get_project_git_repository': {
        const projectIdOrName = resolveExplicitProjectIdOrName(args);
        const project = await vercelRestClient.getProject(requestContext, projectIdOrName);
        return extractProjectGitRepositoryContext(project);
      }
      case 'vercel_delete_project': {
        const projectIdOrName = resolveExplicitProjectIdOrName(args);
        if (args.confirm !== true) {
          throw new Error('删除 Vercel 项目前必须显式传入 confirm: true');
        }
        console.info('[VERCEL_MCP_WRITE:delete_project]', {
          taskSessionId: context.taskSessionId,
          profileId: context.profileId,
          projectIdOrName,
        });
        return vercelRestClient.deleteProject(requestContext, projectIdOrName);
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
      case 'vercel_create_deployment': {
        const body = buildDeploymentBody(args);
        console.info('[VERCEL_MCP_WRITE:create_deployment]', {
          taskSessionId: context.taskSessionId,
          profileId: context.profileId,
          project: body.project,
          target: body.target,
        });
        return vercelRestClient.createDeployment(requestContext, body, {
          forceNew: args.forceNew === true ? '1' : undefined,
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
