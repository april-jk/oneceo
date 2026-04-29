export type UserManagementFilters = {
  query: string;
  status: string;
  activity: string;
  hasSession: string;
  hasConversation: string;
};

export type UserManagementSortKey = 'user' | 'status' | 'last_activity' | 'sessions' | 'conversations' | 'sandboxes';
export type UserManagementSortDirection = 'asc' | 'desc';
export type UserManagementSort = {
  key: UserManagementSortKey;
  direction: UserManagementSortDirection;
};

export type UserDetailTab = 'overview' | 'billing' | 'conversations' | 'sandboxes' | 'deployments';
export type UserManagementViewState = {
  filters: UserManagementFilters;
  sort: UserManagementSort;
  selectedUserId: string | null;
  selectedUserLabel: string | null;
  drawerOpen: boolean;
  detailTab: UserDetailTab;
};

export const DEFAULT_USER_MANAGEMENT_FILTERS: UserManagementFilters = {
  query: '',
  status: 'all',
  activity: 'all',
  hasSession: 'all',
  hasConversation: 'all',
};

export const DEFAULT_USER_MANAGEMENT_SORT: UserManagementSort = {
  key: 'last_activity',
  direction: 'desc',
};

export const DEFAULT_USER_MANAGEMENT_VIEW_STATE: UserManagementViewState = {
  filters: DEFAULT_USER_MANAGEMENT_FILTERS,
  sort: DEFAULT_USER_MANAGEMENT_SORT,
  selectedUserId: null,
  selectedUserLabel: null,
  drawerOpen: false,
  detailTab: 'overview',
};

export type DeploymentManagementViewKey = 'records' | 'conversations' | 'users' | 'railway';
export type DeploymentManagementDetailTab = 'overview' | 'history' | 'logs' | 'relations' | 'raw';
export type DeploymentManagementViewState = {
  view: DeploymentManagementViewKey;
  filters: {
    query: string;
    status: string;
    hasUrl: string;
    userId: string;
    taskSessionId: string;
  };
  selectedTaskSessionId: string | null;
  detailDialogOpen: boolean;
  detailTab: DeploymentManagementDetailTab;
};

export const DEFAULT_DEPLOYMENT_MANAGEMENT_FILTERS: DeploymentManagementViewState['filters'] = {
  query: '',
  status: 'all',
  hasUrl: 'all',
  userId: '',
  taskSessionId: '',
};

export const DEFAULT_DEPLOYMENT_MANAGEMENT_VIEW_STATE: DeploymentManagementViewState = {
  view: 'records',
  filters: DEFAULT_DEPLOYMENT_MANAGEMENT_FILTERS,
  selectedTaskSessionId: null,
  detailDialogOpen: false,
  detailTab: 'overview',
};

export type SkillViewFilter = 'all' | 'active' | 'archived' | 'published' | 'unpublished';
export type SkillManagementViewState = {
  filters: {
    query: string;
    status: string;
    category: string;
  };
  skillView: SkillViewFilter;
  selectedSkillId: string | null;
  detailDialogOpen: boolean;
  detailTab: 'editor' | 'resources' | 'validation';
  selectedRevisionId: string | null;
  selectedResourcePath: string | null;
};

export const DEFAULT_SKILL_MANAGEMENT_FILTERS: SkillManagementViewState['filters'] = {
  query: '',
  status: 'all',
  category: '',
};

export const DEFAULT_SKILL_MANAGEMENT_VIEW_STATE: SkillManagementViewState = {
  filters: DEFAULT_SKILL_MANAGEMENT_FILTERS,
  skillView: 'all',
  selectedSkillId: null,
  detailDialogOpen: false,
  detailTab: 'editor',
  selectedRevisionId: null,
  selectedResourcePath: null,
};

export type ConnectorGuideManagementViewState = {
  filters: {
    connectorKey: string;
    status: string;
    query: string;
  };
  selectedPolicyId: string | null;
  selectedRevisionId: string | null;
};

export const DEFAULT_CONNECTOR_GUIDE_MANAGEMENT_FILTERS: ConnectorGuideManagementViewState['filters'] = {
  connectorKey: '',
  status: 'all',
  query: '',
};

export const DEFAULT_CONNECTOR_GUIDE_MANAGEMENT_VIEW_STATE: ConnectorGuideManagementViewState = {
  filters: DEFAULT_CONNECTOR_GUIDE_MANAGEMENT_FILTERS,
  selectedPolicyId: null,
  selectedRevisionId: null,
};

export type OsacReleaseTabKey = 'published' | 'pending' | 'all' | 'upload';
export type OsacReleaseManagementViewState = {
  tab: OsacReleaseTabKey;
  query: string;
  selectedReleaseId: string | null;
  detailDialogOpen: boolean;
};

export const DEFAULT_OSAC_RELEASE_MANAGEMENT_VIEW_STATE: OsacReleaseManagementViewState = {
  tab: 'published',
  query: '',
  selectedReleaseId: null,
  detailDialogOpen: false,
};
