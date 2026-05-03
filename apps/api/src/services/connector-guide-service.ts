import { connectorGuideDAO, taskSessionConnectorBindingDAO } from '../db/dao';
import { connectorRegistry } from './connector-registry';
import { writeConnectorDebugLog } from '../utils/connector-debug-log';

const SUPPORTED_TRIGGER_MODES = ['on_attach', 'on_active_use', 'on_attach_and_active_use'] as const;
const RESERVED_SKILL_PATTERNS = [/\bplatform[_ -]?skill\b/i, /\bsandbox[_ -]?skill[_ -]?sync\b/i];
const MAX_MARKDOWN_LENGTH = 20_000;
const BUILTIN_NOTES_PREFIX = 'Seeded from connector guide builtin';

type BuiltinConnectorGuide = {
  description: string;
  triggerMode: ConnectorGuideTriggerMode;
  serverInstructionsMarkdown: string;
  guideReminderMarkdown: string;
  blockingRulesMarkdown: string;
  notes: string;
};

const BUILTIN_CONNECTOR_GUIDES: Record<string, BuiltinConnectorGuide> = {
  github: {
    description: 'GitHub connector prompt guide',
    triggerMode: 'on_attach',
    serverInstructionsMarkdown: [
      'Treat GitHub as a repository-scoped connector and inspect the attached repository scope before write actions.',
      'Prefer reading repository files or searching repository state before create/update operations.',
      'When the user asks to create a new repository, attempt the actual GitHub connector tool path first instead of guessing permissions from older failures.',
      'If the connector exposes authorized repositories, assume writes are limited to those repositories unless the fresh tool result proves wider access.',
    ].join('\n'),
    guideReminderMarkdown: [
      'A GitHub connector guide is active for this session.',
      'Use the connected repository scope first, retry fresh GitHub tool calls after reauthorization, and avoid stale permission assumptions.',
    ].join('\n'),
    blockingRulesMarkdown: [
      'Before risky GitHub writes, verify repository target and permission scope from current session context.',
      'If repository ownership or authorization is unclear, stop and ask the user instead of guessing.',
    ].join('\n'),
    notes: 'Seeded from connector guide builtin v1.',
  },
  slack: {
    description: 'Slack connector prompt guide',
    triggerMode: 'on_attach',
    serverInstructionsMarkdown: [
      'Slack is connected through oneceo API broker and Composio Tool Router, not through a sandbox-installed Slack MCP server or user-provided token.',
      'Never ask the user to paste a Slack user token, bot token, workspace secret, or Composio credential into chat, shell, environment variables, or sandbox files.',
      'Use the attached Slack MCP router tools exposed in this session. Start with `slack__COMPOSIO_SEARCH_TOOLS` to find Slack actions, then use `slack__COMPOSIO_GET_TOOL_SCHEMAS` and `slack__COMPOSIO_MULTI_EXECUTE_TOOL` for execution.',
      'Call `slack__COMPOSIO_SEARCH_TOOLS` with `queries`, for example `{ "queries": [{ "use_case": "search Slack channels and read recent messages" }], "session": { "generate_id": true } }`.',
      'Treat Slack as a workspace communication connector and confirm the target workspace, channel, conversation, or user before reads that may expose private content.',
      'Before sending or updating messages, confirm the target channel or conversation explicitly.',
    ].join('\n'),
    guideReminderMarkdown: [
      'A Slack connector guide is active for this session.',
      'Use the already attached Composio-backed Slack router tools; do not request tokens or install any Slack MCP server in shell.',
      'Identify the target workspace/channel/conversation first, then call `slack__COMPOSIO_SEARCH_TOOLS` with a `queries` array, schema lookup, and router execution against the confirmed scope.',
    ].join('\n'),
    blockingRulesMarkdown: [
      'Do not use shell commands to install or invoke Slack MCP. The sandbox does not receive Slack or Composio credentials.',
      'Do not ask for or transmit Slack user tokens, bot tokens, app secrets, signing secrets, or workspace admin credentials.',
      'Do not post or update Slack messages until the target channel/conversation and intended content are explicit.',
      'Do not assume private channel access; ask the user to connect an account with access if a read fails.',
    ].join('\n'),
    notes: `${BUILTIN_NOTES_PREFIX} v2-slack-composio-router.`,
  },
  supabase: {
    description: 'Supabase connector prompt guide',
    triggerMode: 'on_attach',
    serverInstructionsMarkdown: [
      'Supabase is connected through oneceo API broker and Composio Tool Router, not through a sandbox-installed Supabase MCP CLI or user-provided access token.',
      'Never ask the user to paste a Supabase token into the chat, shell, environment variables, or sandbox files.',
      'Use the attached Supabase MCP router tools exposed in this session. Start with `supabase__COMPOSIO_SEARCH_TOOLS` to find Supabase actions, then use `supabase__COMPOSIO_GET_TOOL_SCHEMAS` and `supabase__COMPOSIO_MULTI_EXECUTE_TOOL` for execution.',
      'Call `supabase__COMPOSIO_SEARCH_TOOLS` with `queries`, for example `{ "queries": [{ "use_case": "inspect Supabase projects and database schemas" }], "session": { "generate_id": true } }`.',
      'Treat Supabase operations as production-impacting unless the session explicitly proves a sandbox project.',
      'Inspect available projects, schemas, and target resources before writes or destructive SQL.',
      'Prefer reversible reads and schema inspection before migration-like operations.',
    ].join('\n'),
    guideReminderMarkdown: [
      'A Supabase connector guide is active for this session.',
      'Use the already attached Composio-backed Supabase router tools; do not request tokens or install any Supabase MCP CLI in shell.',
      'Confirm target project and resource scope before schema, data, auth, storage, edge function, or project setting changes.',
    ].join('\n'),
    blockingRulesMarkdown: [
      'Do not use shell commands to install or invoke Supabase MCP. The sandbox does not receive Supabase or Composio credentials.',
      'Do not ask for or transmit Supabase Personal Access Tokens.',
      'Do not issue destructive schema or data changes until the target project is explicitly identified.',
      'If the user intent does not clearly distinguish read-only analysis from live mutation, ask before proceeding.',
    ].join('\n'),
    notes: `${BUILTIN_NOTES_PREFIX} v2-supabase-composio-router.`,
  },
  vercel: {
    description: 'Vercel connector prompt guide',
    triggerMode: 'on_attach',
    serverInstructionsMarkdown: [
      'Treat Vercel as deployment and environment infrastructure, not just a file host.',
      'Inspect project, team, and environment target before changes to domains, env vars, or deployments.',
      'Prefer reading current deployment/project state before mutating configuration.',
    ].join('\n'),
    guideReminderMarkdown: [
      'A Vercel connector guide is active for this session.',
      'Always identify the target project/environment before deployment or configuration changes.',
    ].join('\n'),
    blockingRulesMarkdown: [
      'Do not change production deployment settings or environment variables until the target project/environment is explicit.',
      'If a deployment change might affect live traffic and the target is ambiguous, stop and ask.',
    ].join('\n'),
    notes: 'Seeded from connector guide builtin v1.',
  },
  notion: {
    description: 'Notion connector prompt guide',
    triggerMode: 'on_attach',
    serverInstructionsMarkdown: [
      'Notion is connected through oneceo API broker and Composio Tool Router, not through a sandbox-installed Notion MCP CLI.',
      'Never install, curl, run, ping, or configure `@notionhq/mcp-cli`, `notion-mcp`, `mcp.notion.com`, or any local Notion MCP server inside the sandbox.',
      'Use the attached Notion MCP router tools exposed in this session. Start with `notion__COMPOSIO_SEARCH_TOOLS` to find Notion actions, then use `notion__COMPOSIO_GET_TOOL_SCHEMAS` and `notion__COMPOSIO_MULTI_EXECUTE_TOOL` for execution.',
      'Call `notion__COMPOSIO_SEARCH_TOOLS` with `queries`, for example `{ "queries": [{ "use_case": "search Notion pages by title" }], "session": { "generate_id": true } }`. Do not pass direct MCP/OAuth configuration fields to this search tool.',
      'Treat Notion as a workspace-scoped knowledge connector and confirm the current workspace/page/database target before writes.',
      'Prefer reading page structure, database schema, and access scope before create/update/archive operations.',
      'When the user asks to organize or update Notion content, inspect the existing hierarchy first instead of assuming naming or parent page structure.',
    ].join('\n'),
    guideReminderMarkdown: [
      'A Notion connector guide is active for this session.',
      'Use the already attached Composio-backed Notion router tools; do not install or invoke any Notion MCP CLI in shell.',
      'Identify the target workspace/page/database first, then call `notion__COMPOSIO_SEARCH_TOOLS` with a `queries` array, schema lookup, and router execution against the confirmed scope.',
    ].join('\n'),
    blockingRulesMarkdown: [
      'Do not use shell commands to install or invoke Notion MCP. The sandbox does not receive Notion or Composio credentials.',
      'If the needed Notion action is unclear, search the attached Composio router tools instead of trying a local MCP setup.',
      'Do not create, move, archive, or overwrite Notion pages/databases until the target parent location is explicit.',
      'If multiple workspaces or similarly named pages could match the user request, stop and ask instead of guessing.',
    ].join('\n'),
    notes: `${BUILTIN_NOTES_PREFIX} v3-composio-router-search-schema.`,
  },
  figma: {
    description: 'Figma connector prompt guide',
    triggerMode: 'on_attach',
    serverInstructionsMarkdown: [
      'Figma is connected through oneceo API broker and Composio Tool Router, not through a sandbox-installed Figma MCP CLI or user-provided personal access token.',
      'Never ask the user to paste a Figma token into the chat, shell, environment variables, or sandbox files.',
      'Never install, curl, run, or configure a local Figma MCP server inside the sandbox.',
      'Use the attached Figma MCP router tools exposed in this session. Start with `figma__COMPOSIO_SEARCH_TOOLS` to find Figma actions, then use schema lookup and router execution for the confirmed scope.',
      'Call `figma__COMPOSIO_SEARCH_TOOLS` with `queries`, for example `{ "queries": [{ "use_case": "read Figma file structure from a file URL" }], "session": { "generate_id": true } }`.',
      'Treat Figma as a design-file connector. Confirm the current file, page, frame, node, or comment target before write operations.',
      'Read existing file structure and node metadata before creating comments, editing variables, or modifying design resources.',
    ].join('\n'),
    guideReminderMarkdown: [
      'A Figma connector guide is active for this session.',
      'Use the already attached Composio-backed Figma router tools; do not request tokens or install any Figma MCP CLI in shell.',
      'Identify the target file/page/node first, then call `figma__COMPOSIO_SEARCH_TOOLS` with a `queries` array, schema lookup, and router execution against the confirmed scope.',
    ].join('\n'),
    blockingRulesMarkdown: [
      'Do not use shell commands to install or invoke Figma MCP. The sandbox does not receive Figma or Composio credentials.',
      'Do not ask for or transmit Figma Personal Access Tokens. Figma authorization must go through the platform Composio connector.',
      'Do not create comments, webhooks, variables, dev resources, or modify Figma resources until the target file/page/node is explicit.',
      'If the user provides only a vague design reference and multiple files or nodes could match, stop and ask instead of guessing.',
    ].join('\n'),
    notes: `${BUILTIN_NOTES_PREFIX} v1-figma-composio-router.`,
  },
  custom_api: {
    description: 'Custom API MCP broker prompt guide',
    triggerMode: 'on_attach',
    serverInstructionsMarkdown: [
      'Custom API tools are generated by oneceo from approved endpoint definitions and are executed only through the oneceo API broker.',
      'Never ask the user to paste API tokens, Authorization headers, cookies, or external system secrets into chat, shell, environment variables, or files.',
      'Never call the external API directly from shell with curl, wget, fetch scripts, or ad-hoc HTTP clients. Use the attached custom_api MCP tools only.',
      'Before write-capable custom_api tools, confirm the target external system, object id, intended side effect, and expected rollback boundary.',
      'Use the narrowest read tool and summarize sensitive data instead of repeating raw payloads.',
    ].join('\n'),
    guideReminderMarkdown: [
      'A Custom API connector guide is active for this session.',
      'Use only attached custom_api MCP tools; secrets stay in the oneceo broker and are not available in the sandbox.',
      'For write tools, confirm target object and side effect before calling the tool.',
    ].join('\n'),
    blockingRulesMarkdown: [
      'Do not run curl, wget, or local scripts against the Custom API base URL.',
      'Do not request or transmit API tokens, cookies, Authorization headers, or API keys.',
      'Do not call write-capable tools until the target and side effect are explicit and confirmation requirements are satisfied.',
    ].join('\n'),
    notes: `${BUILTIN_NOTES_PREFIX} v1-custom-api-broker.`,
  },
  custom_mcp: {
    description: 'Custom MCP broker prompt guide',
    triggerMode: 'on_attach',
    serverInstructionsMarkdown: [
      'Custom MCP servers are connected through the oneceo API broker. The sandbox does not receive remote MCP URLs, headers, API keys, or local stdio configuration.',
      'Use only the attached custom_mcp provider tools exposed in this session.',
      'Never ask the user to paste MCP Authorization headers, cookies, API keys, or local MCP command configuration into chat, shell, environment variables, or files.',
      'Do not install or run stdio/local MCP servers in the sandbox. oneceo only supports remote HTTP, Streamable HTTP, and SSE custom MCP profiles for this connector.',
      'Before write-capable custom MCP tools, confirm the target external service, object id, and intended side effect.',
    ].join('\n'),
    guideReminderMarkdown: [
      'A Custom MCP connector guide is active for this session.',
      'Use the already attached custom_mcp broker provider. Do not bypass it with shell, curl, local stdio MCP commands, or ad-hoc scripts.',
    ].join('\n'),
    blockingRulesMarkdown: [
      'Do not run curl, wget, local MCP commands, npx MCP packages, node MCP servers, python MCP servers, or docker MCP servers to reach the custom MCP service.',
      'Do not request or transmit custom MCP tokens, cookies, Authorization headers, or API keys.',
      'If the requested operation could mutate external state, confirm the target and side effect before calling the tool.',
    ].join('\n'),
    notes: `${BUILTIN_NOTES_PREFIX} v1-custom-mcp-broker.`,
  },
};
export type ConnectorGuideTriggerMode = (typeof SUPPORTED_TRIGGER_MODES)[number];

type ConnectorGuideValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

type ConnectorGuidePromptSections = {
  instructionsSection: string;
  reminderSection: string;
};

export type ActiveConnectorGuide = {
  connectorKey: string;
  policyId: string;
  revisionId: string;
  triggerMode: string;
  serverInstructionsMarkdown: string;
  guideReminderMarkdown: string;
  blockingRulesMarkdown: string;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isSupportedTriggerMode(value: string): value is ConnectorGuideTriggerMode {
  return (SUPPORTED_TRIGGER_MODES as readonly string[]).includes(value);
}

function formatGuideSection(title: string, items: Array<{ connectorKey: string; content: string }>) {
  if (items.length === 0) return '';
  return [
    `# ${title}`,
    ...items.map((item) => [`## ${item.connectorKey}`, item.content].join('\n')).filter(Boolean),
  ].join('\n\n');
}

export class ConnectorGuideService {
  private collectActiveConnectorKeysFromBindings(bindings: Array<{ connectorKey: string; desiredState: string }>) {
    return Array.from(
      new Set(
        bindings
          .filter(
            (binding) =>
              binding.desiredState === 'attached' && this.isKnownCatalogConnectorKey(binding.connectorKey)
          )
          .map((binding) => binding.connectorKey)
      )
    );
  }

  private listCurrentCatalogItems() {
    return connectorRegistry.listCatalog();
  }

  private listCreatableCatalogItems() {
    return this.listCurrentCatalogItems().filter((item) => item.visibleInMenu && item.available);
  }

  private isKnownCatalogConnectorKey(connectorKey: string) {
    return this.listCurrentCatalogItems().some((item) => item.key === connectorKey);
  }

  private assertCreatableConnectorKey(connectorKey: string) {
    if (!this.listCreatableCatalogItems().some((item) => item.key === connectorKey)) {
      throw new Error('当前仅支持为平台当前可用且可见的 connector 创建 guide policy');
    }
  }

  private assertKnownConnectorKey(connectorKey: string) {
    if (!this.isKnownCatalogConnectorKey(connectorKey)) {
      throw new Error(`未知 connector guide: ${connectorKey}`);
    }
  }

  private assertTriggerMode(triggerMode: string) {
    if (!isSupportedTriggerMode(triggerMode)) {
      throw new Error('triggerMode 不合法');
    }
  }

  private validateMarkdownField(label: string, value: string, errors: string[]) {
    if (value.length > MAX_MARKDOWN_LENGTH) {
      errors.push(`${label} 长度不能超过 ${MAX_MARKDOWN_LENGTH} 字符`);
    }
    if (RESERVED_SKILL_PATTERNS.some((pattern) => pattern.test(value))) {
      errors.push(`${label} 不能引用现有 platform skills / sandbox skill sync 语法`);
    }
  }

  async listPolicies(filters?: { connectorKey?: string; status?: string; query?: string }) {
    await this.ensureBuiltinPolicies();
    return connectorGuideDAO.listPolicies(filters);
  }

  async getPolicy(policyId: string) {
    const policy = await connectorGuideDAO.getPolicy(policyId);
    if (!policy) {
      throw new Error('connector guide policy 不存在');
    }
    const revisions = await connectorGuideDAO.listRevisions(policyId);
    const publishedRevision = policy.publishedRevisionId
      ? revisions.find((item) => item.id === policy.publishedRevisionId) || null
      : null;
    return {
      ...policy,
      publishedRevision,
      revisions,
    };
  }

  async createPolicy(input: {
    connectorKey: string;
    triggerMode: string;
    description?: string;
    createdBy?: string;
  }) {
    const connectorKey = asText(input.connectorKey).toLowerCase();
    const triggerMode = asText(input.triggerMode);
    this.assertCreatableConnectorKey(connectorKey);
    this.assertTriggerMode(triggerMode);
    const existing = await connectorGuideDAO.getPolicyByConnectorKey(connectorKey);
    if (existing) {
      throw new Error('该 connector 已存在 guide policy');
    }
    return connectorGuideDAO.createPolicy({
      connectorKey,
      triggerMode,
      description: asText(input.description),
      status: 'draft',
      publishedRevisionId: null,
      createdBy: asText(input.createdBy) || null,
    });
  }

  async updatePolicy(
    policyId: string,
    input: {
      triggerMode?: string;
      description?: string;
      status?: string;
    }
  ) {
    const current = await connectorGuideDAO.getPolicy(policyId);
    if (!current) {
      throw new Error('connector guide policy 不存在');
    }
    const patch: Record<string, unknown> = {};
    if (input.triggerMode !== undefined) {
      const triggerMode = asText(input.triggerMode);
      this.assertTriggerMode(triggerMode);
      patch.triggerMode = triggerMode;
    }
    if (input.description !== undefined) {
      patch.description = asText(input.description);
    }
    if (input.status !== undefined) {
      const status = asText(input.status);
      if (!['draft', 'active', 'archived'].includes(status)) {
        throw new Error('status 不合法');
      }
      patch.status = status;
    }
    return connectorGuideDAO.updatePolicy(policyId, patch);
  }

  async createRevision(policyId: string, input?: { createdBy?: string }) {
    const policy = await connectorGuideDAO.getPolicy(policyId);
    if (!policy) {
      throw new Error('connector guide policy 不存在');
    }
    const latest = await connectorGuideDAO.getLatestRevision(policyId);
    const sourceRevision =
      policy.publishedRevisionId
        ? await connectorGuideDAO.getRevision(policyId, policy.publishedRevisionId)
        : latest;
    return connectorGuideDAO.createRevision({
      policyId,
      versionNumber: Number(latest?.versionNumber || 0) + 1,
      status: 'draft',
      serverInstructionsMarkdown: sourceRevision?.serverInstructionsMarkdown || '',
      guideReminderMarkdown: sourceRevision?.guideReminderMarkdown || '',
      blockingRulesMarkdown: sourceRevision?.blockingRulesMarkdown || '',
      notes: sourceRevision?.notes || '',
      createdBy: asText(input?.createdBy) || null,
      publishedAt: null,
    });
  }

  async getRevision(policyId: string, revisionId: string) {
    const revision = await connectorGuideDAO.getRevision(policyId, revisionId);
    if (!revision) {
      throw new Error('connector guide revision 不存在');
    }
    return revision;
  }

  async updateRevision(
    policyId: string,
    revisionId: string,
    input: {
      serverInstructionsMarkdown?: string;
      guideReminderMarkdown?: string;
      blockingRulesMarkdown?: string;
      notes?: string;
    }
  ) {
    const revision = await connectorGuideDAO.getRevision(policyId, revisionId);
    if (!revision) {
      throw new Error('connector guide revision 不存在');
    }
    return connectorGuideDAO.updateRevision(policyId, revisionId, {
      serverInstructionsMarkdown:
        input.serverInstructionsMarkdown !== undefined
          ? asText(input.serverInstructionsMarkdown)
          : revision.serverInstructionsMarkdown,
      guideReminderMarkdown:
        input.guideReminderMarkdown !== undefined
          ? asText(input.guideReminderMarkdown)
          : revision.guideReminderMarkdown,
      blockingRulesMarkdown:
        input.blockingRulesMarkdown !== undefined
          ? asText(input.blockingRulesMarkdown)
          : revision.blockingRulesMarkdown,
      notes: input.notes !== undefined ? asText(input.notes) : revision.notes,
    });
  }

  async validateRevision(policyId: string, revisionId: string): Promise<ConnectorGuideValidationResult> {
    const policy = await connectorGuideDAO.getPolicy(policyId);
    const revision = await connectorGuideDAO.getRevision(policyId, revisionId);
    if (!policy || !revision) {
      throw new Error('connector guide policy 或 revision 不存在');
    }
    this.assertKnownConnectorKey(policy.connectorKey);
    this.assertTriggerMode(policy.triggerMode);

    const errors: string[] = [];
    const warnings: string[] = [];
    const serverInstructionsMarkdown = asText(revision.serverInstructionsMarkdown);
    const guideReminderMarkdown = asText(revision.guideReminderMarkdown);
    const blockingRulesMarkdown = asText(revision.blockingRulesMarkdown);

    if (!serverInstructionsMarkdown && !guideReminderMarkdown && !blockingRulesMarkdown) {
      errors.push('三段文本至少需要填写一段');
    }

    this.validateMarkdownField('serverInstructionsMarkdown', serverInstructionsMarkdown, errors);
    this.validateMarkdownField('guideReminderMarkdown', guideReminderMarkdown, errors);
    this.validateMarkdownField('blockingRulesMarkdown', blockingRulesMarkdown, errors);

    if (!serverInstructionsMarkdown) {
      warnings.push('serverInstructionsMarkdown 为空，Altus 将只看到提示性 guide');
    }
    if (!guideReminderMarkdown) {
      warnings.push('guideReminderMarkdown 为空，Relevant Connector Guides 区块不会展示该 connector');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  async publishRevision(policyId: string, revisionId: string) {
    const validation = await this.validateRevision(policyId, revisionId);
    if (!validation.valid) {
      throw new Error(`发布失败: ${validation.errors.join('；')}`);
    }
    const result = await connectorGuideDAO.publishRevision(policyId, revisionId);
    await this.recomputeSessionsForConnector(result.policy.connectorKey);
    return {
      ...result,
      validation,
    };
  }

  async rollbackRevision(policyId: string, revisionId: string) {
    const revision = await connectorGuideDAO.getRevision(policyId, revisionId);
    if (!revision) {
      throw new Error('connector guide revision 不存在');
    }
    const result = await connectorGuideDAO.publishRevision(policyId, revisionId);
    await this.recomputeSessionsForConnector(result.policy.connectorKey);
    return result;
  }

  async recomputeSessionGuides(taskSessionId: string) {
    const bindings = await taskSessionConnectorBindingDAO.listByTaskSessionId(taskSessionId);
    const activeConnectorKeys = this.collectActiveConnectorKeysFromBindings(bindings);

    writeConnectorDebugLog('[CONNECTOR_GUIDE_RECOMPUTE_START]', {
      taskSessionId,
      bindingCount: bindings.length,
      activeConnectorKeys,
    });

    if (activeConnectorKeys.length === 0) {
      const result = await connectorGuideDAO.replaceSessionGuides(taskSessionId, []);
      writeConnectorDebugLog('[CONNECTOR_GUIDE_RECOMPUTE_DONE]', {
        taskSessionId,
        appliedConnectorKeys: [],
        appliedCount: 0,
      });
      return result;
    }

    const publishedPolicies = await connectorGuideDAO.listPublishedPoliciesByConnectorKeys(activeConnectorKeys);
    const guides = publishedPolicies.map(({ policy, revision }) => ({
      taskSessionId,
      connectorKey: policy.connectorKey,
      policyId: policy.id,
      revisionId: revision.id,
      triggerMode: policy.triggerMode,
      resolvedAt: new Date(),
    }));
    const result = await connectorGuideDAO.replaceSessionGuides(taskSessionId, guides);
    writeConnectorDebugLog('[CONNECTOR_GUIDE_RECOMPUTE_DONE]', {
      taskSessionId,
      appliedConnectorKeys: guides.map((guide) => guide.connectorKey),
      appliedCount: guides.length,
    });
    return result;
  }

  async ensureSessionGuidesUpToDate(taskSessionId: string) {
    const [bindings, sessionGuides] = await Promise.all([
      taskSessionConnectorBindingDAO.listByTaskSessionId(taskSessionId),
      connectorGuideDAO.listSessionGuides(taskSessionId),
    ]);
    const activeConnectorKeys = this.collectActiveConnectorKeysFromBindings(bindings).sort();
    const currentGuideConnectorKeys = Array.from(
      new Set(sessionGuides.map((item) => asText(item.sessionGuide.connectorKey)).filter(Boolean))
    ).sort();
    const needsRecompute =
      activeConnectorKeys.length !== currentGuideConnectorKeys.length ||
      activeConnectorKeys.some((connectorKey, index) => connectorKey !== currentGuideConnectorKeys[index]);
    if (!needsRecompute) {
      return false;
    }
    await this.recomputeSessionGuides(taskSessionId);
    return true;
  }

  async listSessionGuides(taskSessionId: string) {
    return connectorGuideDAO.listSessionGuides(taskSessionId);
  }

  async buildPromptSections(taskSessionId: string): Promise<ConnectorGuidePromptSections> {
    const guides = await connectorGuideDAO.listSessionGuides(taskSessionId);
    const instructions = guides
      .map(({ sessionGuide, revision }) => ({
        connectorKey: sessionGuide.connectorKey,
        content: asText(revision.serverInstructionsMarkdown),
      }))
      .filter((item) => item.content);
    const reminders = guides
      .map(({ sessionGuide, revision }) => ({
        connectorKey: sessionGuide.connectorKey,
        content: asText(revision.guideReminderMarkdown),
      }))
      .filter((item) => item.content);

    const sections = {
      instructionsSection: formatGuideSection('Connector MCP Instructions', instructions),
      reminderSection: formatGuideSection('Relevant Connector Guides', reminders),
    };
    writeConnectorDebugLog('[CONNECTOR_GUIDE_PROMPT_SECTIONS_READY]', {
      taskSessionId,
      sessionGuideCount: guides.length,
      instructionConnectorKeys: instructions.map((item) => item.connectorKey),
      reminderConnectorKeys: reminders.map((item) => item.connectorKey),
      hasInstructionsSection: Boolean(sections.instructionsSection),
      hasReminderSection: Boolean(sections.reminderSection),
    });
    return sections;
  }

  async getBlockingRulesForConnector(taskSessionId: string, connectorKey: string) {
    const guide = await this.getActiveGuideForConnector(taskSessionId, connectorKey);
    return guide ? guide.blockingRulesMarkdown : '';
  }

  async getActiveGuideForConnector(taskSessionId: string, connectorKey: string): Promise<ActiveConnectorGuide | null> {
    const guides = await connectorGuideDAO.listSessionGuides(taskSessionId);
    const matched = guides.find((item) => item.sessionGuide.connectorKey === connectorKey);
    if (!matched) return null;
    return {
      connectorKey: matched.sessionGuide.connectorKey,
      policyId: matched.sessionGuide.policyId,
      revisionId: matched.sessionGuide.revisionId,
      triggerMode: matched.sessionGuide.triggerMode,
      serverInstructionsMarkdown: asText(matched.revision.serverInstructionsMarkdown),
      guideReminderMarkdown: asText(matched.revision.guideReminderMarkdown),
      blockingRulesMarkdown: asText(matched.revision.blockingRulesMarkdown),
    };
  }

  async ensureBuiltinPolicies() {
    const createdPolicies: string[] = [];
    const createdRevisions: string[] = [];
    const touchedConnectorKeys = new Set<string>();

    for (const item of this.listCreatableCatalogItems()) {
      const connectorKey = item.key;
      const builtin = BUILTIN_CONNECTOR_GUIDES[connectorKey];
      let policy = await connectorGuideDAO.getPolicyByConnectorKey(connectorKey);
      if (!policy) {
        policy = await connectorGuideDAO.createPolicy({
          connectorKey,
          triggerMode: builtin?.triggerMode || 'on_attach',
          description: builtin?.description || `${item.name} connector guide`,
          status: 'draft',
          publishedRevisionId: null,
          createdBy: 'system_builtin',
        });
        createdPolicies.push(connectorKey);
        touchedConnectorKeys.add(connectorKey);
      }

      const revisions = await connectorGuideDAO.listRevisions(policy.id);
      if (revisions.length === 0) {
        const revision = await connectorGuideDAO.createRevision({
          policyId: policy.id,
          versionNumber: 1,
          status: 'draft',
          serverInstructionsMarkdown: builtin?.serverInstructionsMarkdown || '',
          guideReminderMarkdown: builtin?.guideReminderMarkdown || '',
          blockingRulesMarkdown: builtin?.blockingRulesMarkdown || '',
          notes: builtin?.notes || '',
          createdBy: 'system_builtin',
          publishedAt: null,
        });
        createdRevisions.push(`${connectorKey}:1`);
        touchedConnectorKeys.add(connectorKey);
        if (builtin) {
          await connectorGuideDAO.publishRevision(policy.id, revision.id);
        }
        continue;
      }

      const publishedRevision =
        policy.publishedRevisionId
          ? revisions.find((item) => item.id === policy.publishedRevisionId) || null
          : null;
      const isBuiltinManaged =
        Boolean(builtin) &&
        (policy.createdBy === 'system_builtin' ||
          asText(publishedRevision?.notes || revisions[0]?.notes).startsWith(BUILTIN_NOTES_PREFIX));
      if (builtin && isBuiltinManaged && asText(publishedRevision?.notes) !== builtin.notes) {
        const latestVersion = Math.max(...revisions.map((item) => Number(item.versionNumber) || 0));
        const revision = await connectorGuideDAO.createRevision({
          policyId: policy.id,
          versionNumber: latestVersion + 1,
          status: 'draft',
          serverInstructionsMarkdown: builtin.serverInstructionsMarkdown,
          guideReminderMarkdown: builtin.guideReminderMarkdown,
          blockingRulesMarkdown: builtin.blockingRulesMarkdown,
          notes: builtin.notes,
          createdBy: 'system_builtin',
          publishedAt: null,
        });
        createdRevisions.push(`${connectorKey}:${latestVersion + 1}`);
        touchedConnectorKeys.add(connectorKey);
        await connectorGuideDAO.publishRevision(policy.id, revision.id);
      }
    }

    return {
      createdPolicies,
      createdRevisions,
      touchedConnectorKeys: Array.from(touchedConnectorKeys),
    };
  }

  async recomputeBuiltinPolicySessions() {
    await this.ensureBuiltinPolicies();
    const policies = await connectorGuideDAO.listPolicies();
    for (const connectorKey of Array.from(new Set(policies.map((item) => asText(item.connectorKey)).filter(Boolean)))) {
      await this.recomputeSessionsForConnector(connectorKey);
    }
  }

  private async recomputeSessionsForConnector(connectorKey: string) {
    const attachedBindings = await taskSessionConnectorBindingDAO.listByConnectorKey(connectorKey);
    const sessionIds = Array.from(
      new Set(
        attachedBindings
          .filter((binding) => binding.desiredState === 'attached')
          .map((binding) => asText(binding.taskSessionId))
          .filter(Boolean)
      )
    );
    for (const taskSessionId of sessionIds) {
      await this.recomputeSessionGuides(taskSessionId);
    }
  }
}

export const connectorGuideService = new ConnectorGuideService();
