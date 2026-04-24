import { asText } from './altus-managed-shared';

export type ManagedToolDescriptor = {
  name: string;
  category: 'workspace' | 'web' | 'deployment' | 'connector' | 'conversation' | 'skill';
  mutatesWorkspace: boolean;
  readsWorkspace: boolean;
  requiresConnectorGuide: boolean;
  requiresExplicitDeploymentIntent: boolean;
  budgetHint: 'small' | 'medium' | 'large';
  hasStableProgressShape: boolean;
};

const BASE_TOOL_DESCRIPTORS: ManagedToolDescriptor[] = [
  {
    name: 'shell_execute',
    category: 'workspace',
    mutatesWorkspace: true,
    readsWorkspace: true,
    requiresConnectorGuide: false,
    requiresExplicitDeploymentIntent: false,
    budgetHint: 'large',
    hasStableProgressShape: false,
  },
  {
    name: 'debug_open_page',
    category: 'web',
    mutatesWorkspace: false,
    readsWorkspace: false,
    requiresConnectorGuide: false,
    requiresExplicitDeploymentIntent: false,
    budgetHint: 'small',
    hasStableProgressShape: false,
  },
  {
    name: 'deploy_application',
    category: 'deployment',
    mutatesWorkspace: false,
    readsWorkspace: false,
    requiresConnectorGuide: false,
    requiresExplicitDeploymentIntent: true,
    budgetHint: 'medium',
    hasStableProgressShape: false,
  },
  {
    name: 'redeploy_application',
    category: 'deployment',
    mutatesWorkspace: false,
    readsWorkspace: false,
    requiresConnectorGuide: false,
    requiresExplicitDeploymentIntent: true,
    budgetHint: 'medium',
    hasStableProgressShape: false,
  },
  {
    name: 'rollback_application_deployment',
    category: 'deployment',
    mutatesWorkspace: false,
    readsWorkspace: false,
    requiresConnectorGuide: false,
    requiresExplicitDeploymentIntent: true,
    budgetHint: 'medium',
    hasStableProgressShape: false,
  },
  {
    name: 'get_application_deployment_status',
    category: 'deployment',
    mutatesWorkspace: false,
    readsWorkspace: false,
    requiresConnectorGuide: false,
    requiresExplicitDeploymentIntent: true,
    budgetHint: 'medium',
    hasStableProgressShape: false,
  },
  {
    name: 'read_file',
    category: 'workspace',
    mutatesWorkspace: false,
    readsWorkspace: true,
    requiresConnectorGuide: false,
    requiresExplicitDeploymentIntent: false,
    budgetHint: 'large',
    hasStableProgressShape: false,
  },
  {
    name: 'write_file',
    category: 'workspace',
    mutatesWorkspace: true,
    readsWorkspace: false,
    requiresConnectorGuide: false,
    requiresExplicitDeploymentIntent: false,
    budgetHint: 'small',
    hasStableProgressShape: true,
  },
  {
    name: 'list_directory',
    category: 'workspace',
    mutatesWorkspace: false,
    readsWorkspace: true,
    requiresConnectorGuide: false,
    requiresExplicitDeploymentIntent: false,
    budgetHint: 'medium',
    hasStableProgressShape: false,
  },
  {
    name: 'search_code',
    category: 'workspace',
    mutatesWorkspace: false,
    readsWorkspace: true,
    requiresConnectorGuide: false,
    requiresExplicitDeploymentIntent: false,
    budgetHint: 'large',
    hasStableProgressShape: false,
  },
  {
    name: 'web_search',
    category: 'web',
    mutatesWorkspace: false,
    readsWorkspace: false,
    requiresConnectorGuide: false,
    requiresExplicitDeploymentIntent: false,
    budgetHint: 'large',
    hasStableProgressShape: false,
  },
  {
    name: 'web_extract',
    category: 'web',
    mutatesWorkspace: false,
    readsWorkspace: false,
    requiresConnectorGuide: false,
    requiresExplicitDeploymentIntent: false,
    budgetHint: 'large',
    hasStableProgressShape: false,
  },
  {
    name: 'load_skill_resource',
    category: 'skill',
    mutatesWorkspace: false,
    readsWorkspace: false,
    requiresConnectorGuide: false,
    requiresExplicitDeploymentIntent: false,
    budgetHint: 'medium',
    hasStableProgressShape: false,
  },
  {
    name: 'load_connector_guide',
    category: 'connector',
    mutatesWorkspace: false,
    readsWorkspace: false,
    requiresConnectorGuide: false,
    requiresExplicitDeploymentIntent: false,
    budgetHint: 'small',
    hasStableProgressShape: false,
  },
  {
    name: 'ask_user',
    category: 'conversation',
    mutatesWorkspace: false,
    readsWorkspace: false,
    requiresConnectorGuide: false,
    requiresExplicitDeploymentIntent: false,
    budgetHint: 'small',
    hasStableProgressShape: false,
  },
  {
    name: 'complete_task',
    category: 'conversation',
    mutatesWorkspace: false,
    readsWorkspace: false,
    requiresConnectorGuide: false,
    requiresExplicitDeploymentIntent: false,
    budgetHint: 'small',
    hasStableProgressShape: false,
  },
];

const BASE_TOOL_DESCRIPTOR_MAP = new Map(BASE_TOOL_DESCRIPTORS.map((item) => [item.name, item] as const));

export function listManagedBaseToolDescriptors() {
  return [...BASE_TOOL_DESCRIPTORS];
}

export function resolveManagedToolDescriptor(toolName: string): ManagedToolDescriptor | null {
  return BASE_TOOL_DESCRIPTOR_MAP.get(asText(toolName)) || null;
}

export function isOpaqueManagedMcpTool(toolName: string) {
  return asText(toolName).startsWith('mcp__');
}
