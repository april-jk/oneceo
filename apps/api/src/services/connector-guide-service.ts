import { connectorGuideDAO, taskSessionConnectorBindingDAO } from '../db/dao';
import { writeConnectorDebugLog } from '../utils/connector-debug-log';

const SUPPORTED_CONNECTOR_KEYS = ['github', 'supabase', 'vercel'] as const;
const SUPPORTED_TRIGGER_MODES = ['on_attach', 'on_active_use', 'on_attach_and_active_use'] as const;
const RESERVED_SKILL_PATTERNS = [/\bplatform[_ -]?skill\b/i, /\bsandbox[_ -]?skill[_ -]?sync\b/i];
const MAX_MARKDOWN_LENGTH = 20_000;

const BUILTIN_CONNECTOR_GUIDES: Record<
  SupportedConnectorKey,
  {
    description: string;
    triggerMode: ConnectorGuideTriggerMode;
    serverInstructionsMarkdown: string;
    guideReminderMarkdown: string;
    blockingRulesMarkdown: string;
    notes: string;
  }
> = {
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
  supabase: {
    description: 'Supabase connector prompt guide',
    triggerMode: 'on_attach',
    serverInstructionsMarkdown: [
      'Treat Supabase operations as production-impacting unless the session explicitly proves a sandbox project.',
      'Inspect available projects, schemas, and target resources before writes or destructive SQL.',
      'Prefer reversible reads and schema inspection before migration-like operations.',
    ].join('\n'),
    guideReminderMarkdown: [
      'A Supabase connector guide is active for this session.',
      'Confirm target project and resource scope before schema, data, or auth changes.',
    ].join('\n'),
    blockingRulesMarkdown: [
      'Do not issue destructive schema or data changes until the target project is explicitly identified.',
      'If the user intent does not clearly distinguish read-only analysis from live mutation, ask before proceeding.',
    ].join('\n'),
    notes: 'Seeded from connector guide builtin v1.',
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
};

export type SupportedConnectorKey = (typeof SUPPORTED_CONNECTOR_KEYS)[number];
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

function isSupportedConnectorKey(value: string): value is SupportedConnectorKey {
  return (SUPPORTED_CONNECTOR_KEYS as readonly string[]).includes(value);
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
  private assertSupportedConnectorKey(connectorKey: string) {
    if (!isSupportedConnectorKey(connectorKey)) {
      throw new Error('首批仅支持 github、supabase、vercel 三个 connector guide');
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
    this.assertSupportedConnectorKey(connectorKey);
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
    this.assertSupportedConnectorKey(policy.connectorKey);
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
    const activeConnectorKeys = Array.from(
      new Set(
        bindings
          .filter((binding) => binding.desiredState === 'attached' && isSupportedConnectorKey(binding.connectorKey))
          .map((binding) => binding.connectorKey)
      )
    ) as SupportedConnectorKey[];

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
    const touchedConnectorKeys = new Set<SupportedConnectorKey>();

    for (const connectorKey of SUPPORTED_CONNECTOR_KEYS) {
      const builtin = BUILTIN_CONNECTOR_GUIDES[connectorKey];
      let policy = await connectorGuideDAO.getPolicyByConnectorKey(connectorKey);
      if (!policy) {
        policy = await connectorGuideDAO.createPolicy({
          connectorKey,
          triggerMode: builtin.triggerMode,
          description: builtin.description,
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
          serverInstructionsMarkdown: builtin.serverInstructionsMarkdown,
          guideReminderMarkdown: builtin.guideReminderMarkdown,
          blockingRulesMarkdown: builtin.blockingRulesMarkdown,
          notes: builtin.notes,
          createdBy: 'system_builtin',
          publishedAt: null,
        });
        createdRevisions.push(`${connectorKey}:1`);
        await connectorGuideDAO.publishRevision(policy.id, revision.id);
        touchedConnectorKeys.add(connectorKey);
      }
    }

    return {
      createdPolicies,
      createdRevisions,
      touchedConnectorKeys: Array.from(touchedConnectorKeys),
    };
  }

  async recomputeBuiltinPolicySessions() {
    for (const connectorKey of SUPPORTED_CONNECTOR_KEYS) {
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
