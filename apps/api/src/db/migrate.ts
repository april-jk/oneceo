/**
 * 数据库迁移脚本
 * 
 * 创建所有必要的数据库表
 */

import { sql } from 'drizzle-orm';
import { db, databasePool, ensureDatabaseConnection } from '../config/database';

type SchemaReadinessReport = {
  ready: boolean;
  missing: string[];
};

const REQUIRED_TABLES = [
  'app_users',
  'app_user_projects',
  'app_user_legacy_id_mappings',
  'app_user_sessions',
  'app_user_email_verifications',
  'admin_users',
  'admin_user_sessions',
  'task_creation_sessions',
  'conversation_messages',
  'task_session_recent_messages',
  'task_session_workspace_cache',
  'task_session_runs',
  'task_session_run_events',
  'task_session_deliverable_artifacts',
  'task_session_sandbox_bindings',
  'task_session_connector_snapshots',
  'task_session_mcp_tool_snapshots',
  'task_session_connector_runtime_events',
  'platform_skills',
  'platform_skill_revisions',
  'platform_skill_revision_resources',
  'platform_skill_revision_entries',
  'platform_skill_revision_resource_indexes',
  'platform_skill_revision_resource_bodies',
  'platform_skill_revision_resource_chunks',
  'platform_skill_revision_resource_links',
  'sandbox_execution_environments',
  'user_connector_accounts',
  'user_connector_profiles',
  'custom_api_definitions',
  'custom_api_endpoint_tools',
  'custom_api_confirmations',
  'custom_api_call_audit_logs',
  'user_platform_skill_bindings',
  'user_custom_skills',
  'user_custom_skill_documents',
  'task_session_connector_bindings',
  'connector_guide_policies',
  'connector_guide_revisions',
  'task_session_connector_guides',
  'task_session_mcp_recovery_jobs',
  'task_session_deployment_sync_jobs',
  'project_storage_resources',
  'connector_auth_requests',
  'platform_runtime_artifact_releases',
  'platform_runtime_artifact_channels',
  'user_credits',
  'credit_transactions',
  'token_usage_logs',
  'model_pricing',
  'cache_pricing_config',
  'credit_activation_codes',
  'credit_activation_code_uses',
  'credit_activation_code_groups',
  'membership_plans',
  'user_memberships',
  'membership_grants',
  'membership_audit_logs',
  'membership_daily_restores',
  'notifications',
  'user_notifications',
  'ui_promo_banners',
  'ui_promo_banner_items',
  'ui_promo_banner_events',
  'session_api_traces',
  'api_request_logs',
] as const;

const REQUIRED_COLUMNS = [
  ['app_users', 'email'],
  ['app_users', 'password_hash'],
  ['app_users', 'display_name'],
  ['app_users', 'profile_json'],
  ['app_user_projects', 'user_id'],
  ['app_user_projects', 'name'],
  ['app_user_projects', 'description'],
  ['app_user_projects', 'project_type'],
  ['app_user_projects', 'status'],
  ['app_user_projects', 'metadata_json'],
  ['app_user_legacy_id_mappings', 'app_user_id'],
  ['app_user_legacy_id_mappings', 'legacy_user_id'],
  ['app_user_legacy_id_mappings', 'source'],
  ['app_user_legacy_id_mappings', 'first_seen_at'],
  ['app_user_legacy_id_mappings', 'last_seen_at'],
  ['app_user_sessions', 'user_id'],
  ['app_user_sessions', 'session_token_hash'],
  ['app_user_sessions', 'expires_at'],
  ['app_user_email_verifications', 'email'],
  ['app_user_email_verifications', 'purpose'],
  ['app_user_email_verifications', 'code_hash'],
  ['app_user_email_verifications', 'expires_at'],
  ['app_user_email_verifications', 'consumed_at'],
  ['app_user_email_verifications', 'last_sent_at'],
  ['admin_users', 'login_name'],
  ['admin_users', 'password_hash'],
  ['admin_users', 'display_name'],
  ['admin_users', 'role'],
  ['admin_user_sessions', 'admin_user_id'],
  ['admin_user_sessions', 'session_token_hash'],
  ['admin_user_sessions', 'expires_at'],
  ['conversation_messages', 'message_key'],
  ['conversation_messages', 'timeline_cursor'],
  ['conversation_messages', 'runtime_generation'],
  ['conversation_messages', 'updated_at'],
  ['task_session_recent_messages', 'message_id'],
  ['task_session_recent_messages', 'message_key'],
  ['task_session_recent_messages', 'timeline_cursor'],
  ['task_session_recent_messages', 'runtime_generation'],
  ['task_session_recent_messages', 'updated_at'],
  ['task_session_runs', 'mcp_tool_snapshot_id'],
  ['task_session_connector_bindings', 'connector_instance_key'],
  ['task_session_connector_bindings', 'profile_id'],
  ['task_session_connector_bindings', 'runtime_provider_id'],
  ['task_session_connector_bindings', 'runtime_env_version'],
  ['task_session_connector_bindings', 'runtime_transport'],
  ['task_session_connector_bindings', 'runtime_attached_tools_json'],
  ['task_session_connector_bindings', 'runtime_last_started_at'],
  ['task_session_connector_bindings', 'runtime_last_stopped_at'],
  ['task_session_connector_bindings', 'recovery_queued_at'],
  ['task_session_connector_bindings', 'recovery_started_at'],
  ['task_session_connector_bindings', 'recovery_completed_at'],
  ['task_session_connector_bindings', 'enabled_tools'],
  ['task_session_connector_bindings', 'session_config_json'],
  ['task_session_connector_bindings', 'definition_snapshot_json'],
  ['task_session_mcp_recovery_jobs', 'recovery_key'],
  ['task_session_mcp_recovery_jobs', 'job_type'],
  ['task_session_mcp_recovery_jobs', 'status'],
  ['task_session_mcp_recovery_jobs', 'attempt_count'],
  ['task_session_mcp_recovery_jobs', 'payload_json'],
  ['task_session_mcp_recovery_jobs', 'next_retry_at'],
  ['task_session_mcp_recovery_jobs', 'started_at'],
  ['task_session_mcp_recovery_jobs', 'completed_at'],
  ['task_session_deployment_sync_jobs', 'sync_key'],
  ['task_session_deployment_sync_jobs', 'job_type'],
  ['task_session_deployment_sync_jobs', 'status'],
  ['task_session_deployment_sync_jobs', 'attempt_count'],
  ['task_session_deployment_sync_jobs', 'payload_json'],
  ['task_session_deployment_sync_jobs', 'next_retry_at'],
  ['task_session_deployment_sync_jobs', 'started_at'],
  ['task_session_deployment_sync_jobs', 'completed_at'],
  ['project_storage_resources', 'user_id'],
  ['project_storage_resources', 'session_id'],
  ['project_storage_resources', 'project_key'],
  ['project_storage_resources', 'provider'],
  ['project_storage_resources', 'railway_bucket_id'],
  ['project_storage_resources', 'railway_project_id'],
  ['project_storage_resources', 'railway_environment_id'],
  ['project_storage_resources', 'bucket_name'],
  ['project_storage_resources', 'endpoint'],
  ['project_storage_resources', 'public_url'],
  ['project_storage_resources', 'access_key_id'],
  ['project_storage_resources', 'secret_access_key_ciphertext'],
  ['project_storage_resources', 'access_model'],
  ['project_storage_resources', 'status'],
  ['project_storage_resources', 'last_checked_at'],
  ['connector_auth_requests', 'profile_id'],
  ['connector_auth_requests', 'profile_draft_json'],
  ['custom_api_definitions', 'owner_user_id'],
  ['custom_api_definitions', 'slug'],
  ['custom_api_definitions', 'base_url'],
  ['custom_api_definitions', 'allowed_hosts_json'],
  ['custom_api_endpoint_tools', 'definition_id'],
  ['custom_api_endpoint_tools', 'tool_slug'],
  ['custom_api_endpoint_tools', 'input_schema_json'],
  ['custom_api_endpoint_tools', 'request_mapping_json'],
  ['custom_api_endpoint_tools', 'response_mapping_json'],
  ['custom_api_endpoint_tools', 'review_status'],
  ['custom_api_endpoint_tools', 'operation_type'],
  ['custom_api_call_audit_logs', 'request_id'],
  ['custom_api_call_audit_logs', 'tool_name'],
  ['custom_api_call_audit_logs', 'effective_risk_level'],
  ['custom_api_call_audit_logs', 'status'],
  ['custom_api_confirmations', 'arguments_hash'],
  ['custom_api_confirmations', 'expires_at'],
  ['platform_skills', 'slug'],
  ['platform_skills', 'metadata_json'],
  ['platform_skills', 'published_revision_id'],
  ['platform_skill_revisions', 'skill_id'],
  ['platform_skill_revisions', 'revision_number'],
  ['platform_skill_revisions', 'body_markdown'],
  ['platform_skill_revision_resources', 'revision_id'],
  ['platform_skill_revision_resources', 'resource_path'],
  ['platform_skill_revision_resources', 'content_markdown'],
  ['platform_skill_revision_entries', 'revision_id'],
  ['platform_skill_revision_entries', 'body_markdown'],
  ['platform_skill_revision_resource_indexes', 'revision_id'],
  ['platform_skill_revision_resource_indexes', 'resource_key'],
  ['platform_skill_revision_resource_indexes', 'resource_path'],
  ['platform_skill_revision_resource_indexes', 'resource_kind'],
  ['platform_skill_revision_resource_indexes', 'title'],
  ['platform_skill_revision_resource_indexes', 'summary'],
  ['platform_skill_revision_resource_indexes', 'content_storage'],
  ['platform_skill_revision_resource_indexes', 'mime_type'],
  ['platform_skill_revision_resource_indexes', 'storage_path'],
  ['platform_skill_revision_resource_indexes', 'storage_locator_json'],
  ['platform_skill_revision_resource_indexes', 'load_stage'],
  ['platform_skill_revision_resource_indexes', 'sort_order'],
  ['platform_skill_revision_resource_bodies', 'resource_index_id'],
  ['platform_skill_revision_resource_bodies', 'content_format'],
  ['platform_skill_revision_resource_bodies', 'content_mode'],
  ['platform_skill_revision_resource_bodies', 'content_size'],
  ['platform_skill_revision_resource_chunks', 'resource_body_id'],
  ['platform_skill_revision_resource_chunks', 'chunk_index'],
  ['platform_skill_revision_resource_chunks', 'chunk_role'],
  ['platform_skill_revision_resource_chunks', 'content_text'],
  ['platform_skill_revision_resource_links', 'revision_id'],
  ['platform_skill_revision_resource_links', 'from_type'],
  ['platform_skill_revision_resource_links', 'from_id'],
  ['platform_skill_revision_resource_links', 'to_resource_index_id'],
  ['user_platform_skill_bindings', 'user_id'],
  ['user_platform_skill_bindings', 'platform_skill_id'],
  ['user_custom_skills', 'user_id'],
  ['user_custom_skills', 'slug'],
  ['user_custom_skills', 'body_markdown'],
  ['user_custom_skill_documents', 'custom_skill_id'],
  ['user_custom_skill_documents', 'document_key'],
  ['user_custom_skill_documents', 'document_path'],
  ['user_custom_skill_documents', 'body_markdown'],
  ['connector_guide_policies', 'connector_key'],
  ['connector_guide_policies', 'published_revision_id'],
  ['connector_guide_revisions', 'policy_id'],
  ['connector_guide_revisions', 'version_number'],
  ['connector_guide_revisions', 'server_instructions_markdown'],
  ['connector_guide_revisions', 'guide_reminder_markdown'],
  ['connector_guide_revisions', 'blocking_rules_markdown'],
  ['task_session_connector_guides', 'task_session_id'],
  ['task_session_connector_guides', 'connector_key'],
  ['task_session_connector_guides', 'policy_id'],
  ['task_session_connector_guides', 'revision_id'],
  ['platform_runtime_artifact_releases', 'artifact_type'],
  ['platform_runtime_artifact_releases', 'platform'],
  ['platform_runtime_artifact_releases', 'arch'],
  ['platform_runtime_artifact_releases', 'version'],
  ['platform_runtime_artifact_releases', 'channel'],
  ['platform_runtime_artifact_releases', 'status'],
  ['platform_runtime_artifact_releases', 'bucket'],
  ['platform_runtime_artifact_releases', 'object_key'],
  ['platform_runtime_artifact_releases', 'manifest_key'],
  ['platform_runtime_artifact_releases', 'sha256'],
  ['platform_runtime_artifact_releases', 'size_bytes'],
  ['platform_runtime_artifact_releases', 'release_notes'],
  ['platform_runtime_artifact_releases', 'uploaded_by'],
  ['platform_runtime_artifact_releases', 'uploaded_at'],
  ['platform_runtime_artifact_releases', 'metadata_json'],
  ['platform_runtime_artifact_channels', 'artifact_type'],
  ['platform_runtime_artifact_channels', 'platform'],
  ['platform_runtime_artifact_channels', 'arch'],
  ['platform_runtime_artifact_channels', 'channel'],
  ['platform_runtime_artifact_channels', 'published_release_id'],
  ['membership_plans', 'code'],
  ['membership_plans', 'name'],
  ['membership_plans', 'status'],
  ['membership_plans', 'default_credits'],
  ['membership_plans', 'is_default'],
  ['membership_plans', 'daily_auto_restore_enabled'],
  ['membership_plans', 'daily_auto_restore_credits'],
  ['user_memberships', 'user_id'],
  ['user_memberships', 'membership_plan_id'],
  ['user_memberships', 'status'],
  ['membership_grants', 'user_id'],
  ['membership_grants', 'membership_plan_id'],
  ['membership_audit_logs', 'action'],
  ['membership_audit_logs', 'target_type'],
  ['membership_daily_restores', 'user_id'],
  ['membership_daily_restores', 'membership_plan_id'],
  ['membership_daily_restores', 'restore_date'],
  ['notifications', 'title'],
  ['notifications', 'content'],
  ['notifications', 'type'],
  ['notifications', 'priority'],
  ['notifications', 'target_type'],
  ['notifications', 'status'],
  ['user_notifications', 'user_id'],
  ['user_notifications', 'notification_id'],
  ['user_notifications', 'is_read'],
  ['ui_promo_banners', 'placement'],
  ['ui_promo_banners', 'display_type'],
  ['ui_promo_banners', 'status'],
  ['ui_promo_banners', 'priority'],
  ['ui_promo_banner_items', 'banner_id'],
  ['ui_promo_banner_items', 'title'],
  ['ui_promo_banner_items', 'link_type'],
  ['ui_promo_banner_events', 'banner_id'],
  ['ui_promo_banner_events', 'event_type'],
  ['session_api_traces', 'session_id'],
  ['session_api_traces', 'trace_type'],
  ['session_api_traces', 'sequence'],
  ['session_api_traces', 'created_at'],
  ['api_request_logs', 'app_user_id'],
  ['api_request_logs', 'method'],
  ['api_request_logs', 'path'],
  ['api_request_logs', 'response_status'],
  ['api_request_logs', 'created_at'],
] as const;

const REQUIRED_INDEXES = [
  'idx_app_users_email',
  'idx_app_user_projects_user_name',
  'idx_app_user_projects_user_id',
  'idx_app_user_projects_user_type_status',
  'idx_app_user_legacy_mappings_legacy_user_id',
  'idx_app_user_sessions_token_hash',
  'idx_app_user_email_verifications_email_purpose',
  'idx_app_user_email_verifications_expires_at',
  'idx_admin_users_login_name',
  'idx_admin_user_sessions_token_hash',
  'idx_conversation_messages_session_message_key',
  'idx_conversation_messages_session_timeline',
  'idx_task_session_recent_messages_session_message_key',
  'idx_task_session_recent_messages_session_timeline',
  'idx_task_session_workspace_cache_session_unique',
  'idx_task_session_run_events_run_sequence',
  'idx_task_session_deliverable_artifacts_storage_key',
  'idx_task_session_sandbox_bindings_session_id',
  'idx_task_session_connector_bindings_session_instance',
  'idx_task_session_connector_bindings_session_connector',
  'idx_task_session_mcp_recovery_jobs_recovery_key',
  'idx_task_session_deployment_sync_jobs_sync_key',
  'idx_project_storage_resources_unique',
  'idx_project_storage_resources_session',
  'idx_task_session_mcp_tool_snapshots_session_id',
  'idx_task_session_connector_runtime_events_session_id',
  'idx_platform_skills_slug',
  'idx_platform_skill_revisions_skill_revision',
  'idx_platform_skill_revision_resources_revision_path',
  'idx_platform_skill_revision_entries_revision_id',
  'idx_platform_skill_resource_indexes_revision_key',
  'idx_platform_skill_resource_bodies_resource_index_id',
  'idx_platform_skill_resource_chunks_body_chunk',
  'idx_user_platform_skill_bindings_user_skill',
  'idx_user_custom_skills_user_slug',
  'idx_user_custom_skill_documents_skill_key',
  'idx_connector_guide_policies_connector_key',
  'idx_connector_guide_revisions_policy_version',
  'idx_task_session_connector_guides_session_connector',
  'idx_custom_api_definitions_owner_slug',
  'idx_custom_api_endpoint_tools_definition_slug',
  'idx_custom_api_call_audit_logs_request_id',
  'idx_custom_api_confirmations_lookup',
  'idx_platform_runtime_artifacts_type_version',
  'idx_platform_runtime_artifact_channels_unique',
  'idx_user_credits_user_id',
  'idx_credit_transactions_user_id',
  'idx_credit_transactions_type',
  'idx_credit_transactions_created_at',
  'idx_token_usage_logs_user_id',
  'idx_token_usage_logs_session_id',
  'idx_token_usage_logs_created_at',
  'idx_model_pricing_model_active',
  'idx_model_pricing_active',
  'idx_cache_pricing_config_provider_active',
  'idx_activation_codes_code',
  'idx_activation_codes_status',
  'idx_activation_codes_group_id',
  'idx_activation_codes_batch_id',
  'idx_activation_codes_expires_at',
  'idx_activation_codes_used_by',
  'idx_activation_code_uses_code_id',
  'idx_activation_code_uses_user_id',
  'idx_activation_code_uses_user_code_unique',
  'idx_activation_code_groups_name',
  'idx_activation_code_groups_status',
  'idx_membership_plans_code',
  'idx_membership_plans_status',
  'idx_membership_plans_sort_order',
  'idx_membership_plans_is_default',
  'idx_user_memberships_user_id',
  'idx_user_memberships_membership_plan_id',
  'idx_user_memberships_status',
  'idx_user_memberships_user_active',
  'idx_membership_grants_user_id',
  'idx_membership_grants_membership_plan_id',
  'idx_membership_grants_created_at',
  'idx_membership_grants_credit_transaction_id',
  'idx_membership_audit_logs_actor_id',
  'idx_membership_audit_logs_target_type_target_id',
  'idx_membership_audit_logs_created_at',
  'idx_membership_daily_restores_user_id',
  'idx_membership_daily_restores_membership_plan_id',
  'idx_membership_daily_restores_restore_date',
  'idx_membership_daily_restores_unique',
  'idx_membership_daily_restores_credit_transaction_id',
  'idx_notifications_type',
  'idx_notifications_status',
  'idx_notifications_created_at',
  'idx_user_notifications_user_notification',
  'idx_user_notifications_user_id',
  'idx_user_notifications_notification_id',
  'idx_user_notifications_user_read',
  'idx_ui_promo_banners_placement',
  'idx_ui_promo_banners_status',
  'idx_ui_promo_banners_priority',
  'idx_ui_promo_banners_active_sort',
  'idx_ui_promo_banner_items_banner_id',
  'idx_ui_promo_banner_items_sort_order',
  'idx_ui_promo_banner_events_banner_id',
  'idx_ui_promo_banner_events_user_id',
  'idx_ui_promo_banner_events_type',
  'idx_session_api_traces_session_id',
  'idx_session_api_traces_session_type',
  'idx_session_api_traces_session_sequence',
  'idx_session_api_traces_run_id',
  'idx_session_api_traces_tool_name',
  'idx_session_api_traces_created_at',
  'idx_session_api_traces_type_created_at',
  'idx_api_request_logs_user_id',
  'idx_api_request_logs_user_created_at',
  'idx_api_request_logs_path',
  'idx_api_request_logs_status',
  'idx_api_request_logs_session_id',
  'idx_api_request_logs_created_at',
] as const;

/**
 * 创建数据库表的 SQL 语句
 */
const connectorTablesSQL = `
-- 用户级连接器配置表
CREATE TABLE IF NOT EXISTS user_connector_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  connector_key TEXT NOT NULL,
  auth_mode TEXT NOT NULL,
  auth_status TEXT NOT NULL DEFAULT 'not_configured',
  display_name TEXT,
  config_json JSONB,
  secret_ciphertext TEXT,
  last_auth_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_connector_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  connector_key TEXT NOT NULL,
  profile_name TEXT NOT NULL,
  display_name TEXT,
  auth_mode TEXT NOT NULL,
  auth_status TEXT NOT NULL DEFAULT 'not_configured',
  config_json JSONB,
  secret_ciphertext TEXT,
  metadata_json JSONB,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  last_auth_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 任务会话连接器绑定表
CREATE TABLE IF NOT EXISTS task_session_connector_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_session_id TEXT NOT NULL,
  connector_key TEXT NOT NULL,
  connector_instance_key TEXT NOT NULL,
  profile_id TEXT,
  desired_state TEXT NOT NULL DEFAULT 'detached',
  runtime_status TEXT NOT NULL DEFAULT 'unknown',
  orchestrator_session_id TEXT,
  server_name TEXT,
  runtime_provider_id TEXT,
  runtime_env_version INTEGER NOT NULL DEFAULT 0,
  runtime_transport TEXT,
  runtime_attached_tools_json JSONB,
  runtime_last_started_at TIMESTAMP,
  runtime_last_stopped_at TIMESTAMP,
  recovery_queued_at TIMESTAMP,
  recovery_started_at TIMESTAMP,
  recovery_completed_at TIMESTAMP,
  enabled_tools JSONB,
  session_config_json JSONB,
  definition_snapshot_json JSONB,
  last_used_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connector_guide_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  trigger_mode TEXT NOT NULL DEFAULT 'on_attach',
  description TEXT NOT NULL DEFAULT '',
  published_revision_id UUID,
  created_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connector_guide_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES connector_guide_policies(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  server_instructions_markdown TEXT NOT NULL DEFAULT '',
  guide_reminder_markdown TEXT NOT NULL DEFAULT '',
  blocking_rules_markdown TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  published_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_session_connector_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_session_id TEXT NOT NULL,
  connector_key TEXT NOT NULL,
  policy_id UUID NOT NULL REFERENCES connector_guide_policies(id) ON DELETE CASCADE,
  revision_id UUID NOT NULL REFERENCES connector_guide_revisions(id) ON DELETE CASCADE,
  trigger_mode TEXT NOT NULL,
  resolved_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_session_mcp_recovery_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_session_id TEXT NOT NULL,
  orchestrator_session_id TEXT NOT NULL,
  recovery_key TEXT NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'session_reconcile',
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  payload_json JSONB,
  next_retry_at TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_session_deployment_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_session_id TEXT NOT NULL,
  orchestrator_session_id TEXT NOT NULL,
  sync_key TEXT NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'deployment_panel_sync',
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  payload_json JSONB,
  next_retry_at TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_storage_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  project_key TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'railway_bucket',
  railway_bucket_id TEXT NOT NULL,
  railway_project_id TEXT NOT NULL,
  railway_environment_id TEXT NOT NULL,
  bucket_name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  public_url TEXT,
  access_key_id TEXT NOT NULL,
  secret_access_key_ciphertext TEXT NOT NULL,
  access_model TEXT NOT NULL DEFAULT 'public_and_private',
  status TEXT NOT NULL DEFAULT 'ready',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_checked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- OAuth 请求事务表
CREATE TABLE IF NOT EXISTS connector_auth_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  connector_key TEXT NOT NULL,
  profile_id TEXT,
  provider TEXT NOT NULL,
  state TEXT NOT NULL,
  code_verifier TEXT,
  profile_draft_json JSONB,
  return_to_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS platform_runtime_artifact_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_type TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  version TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'stable',
  status TEXT NOT NULL DEFAULT 'uploaded',
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL,
  manifest_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  release_notes TEXT NOT NULL DEFAULT '',
  source_commit TEXT,
  uploaded_by TEXT,
  published_by TEXT,
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  published_at TIMESTAMP,
  archived_at TIMESTAMP,
  metadata_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_runtime_artifact_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_type TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  channel TEXT NOT NULL,
  published_release_id UUID NOT NULL REFERENCES platform_runtime_artifact_releases(id) ON DELETE CASCADE,
  updated_by TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_connector_accounts_user_connector ON user_connector_accounts(user_id, connector_key);
CREATE INDEX IF NOT EXISTS idx_user_connector_accounts_user_id ON user_connector_accounts(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_connector_profiles_user_connector_profile
  ON user_connector_profiles(user_id, connector_key, profile_name);
CREATE INDEX IF NOT EXISTS idx_user_connector_profiles_user_id ON user_connector_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_connector_profiles_user_connector ON user_connector_profiles(user_id, connector_key);
CREATE INDEX IF NOT EXISTS idx_task_session_connector_bindings_task_session_id
  ON task_session_connector_bindings(task_session_id);
CREATE INDEX IF NOT EXISTS idx_task_session_connector_bindings_orchestrator_session_id
  ON task_session_connector_bindings(orchestrator_session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_guide_policies_connector_key
  ON connector_guide_policies(connector_key);
CREATE INDEX IF NOT EXISTS idx_connector_guide_policies_status
  ON connector_guide_policies(status);
CREATE INDEX IF NOT EXISTS idx_connector_guide_policies_published_revision_id
  ON connector_guide_policies(published_revision_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_guide_revisions_policy_version
  ON connector_guide_revisions(policy_id, version_number);
CREATE INDEX IF NOT EXISTS idx_connector_guide_revisions_policy_id
  ON connector_guide_revisions(policy_id);
CREATE INDEX IF NOT EXISTS idx_connector_guide_revisions_status
  ON connector_guide_revisions(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_connector_guides_session_connector
  ON task_session_connector_guides(task_session_id, connector_key);
CREATE INDEX IF NOT EXISTS idx_task_session_connector_guides_task_session_id
  ON task_session_connector_guides(task_session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_mcp_recovery_jobs_recovery_key
  ON task_session_mcp_recovery_jobs(recovery_key);
CREATE INDEX IF NOT EXISTS idx_task_session_mcp_recovery_jobs_session_status
  ON task_session_mcp_recovery_jobs(task_session_id, status);
CREATE INDEX IF NOT EXISTS idx_task_session_mcp_recovery_jobs_orchestrator_session_id
  ON task_session_mcp_recovery_jobs(orchestrator_session_id);
CREATE INDEX IF NOT EXISTS idx_task_session_mcp_recovery_jobs_next_retry_at
  ON task_session_mcp_recovery_jobs(next_retry_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_deployment_sync_jobs_sync_key
  ON task_session_deployment_sync_jobs(sync_key);
CREATE INDEX IF NOT EXISTS idx_task_session_deployment_sync_jobs_session_status
  ON task_session_deployment_sync_jobs(task_session_id, status);
CREATE INDEX IF NOT EXISTS idx_task_session_deployment_sync_jobs_orchestrator_session_id
  ON task_session_deployment_sync_jobs(orchestrator_session_id);
CREATE INDEX IF NOT EXISTS idx_task_session_deployment_sync_jobs_next_retry_at
  ON task_session_deployment_sync_jobs(next_retry_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_storage_resources_unique
  ON project_storage_resources(user_id, project_key, provider);
CREATE INDEX IF NOT EXISTS idx_project_storage_resources_session
  ON project_storage_resources(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_auth_requests_state ON connector_auth_requests(state);
CREATE INDEX IF NOT EXISTS idx_connector_auth_requests_user_id ON connector_auth_requests(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_runtime_artifacts_type_version
  ON platform_runtime_artifact_releases(artifact_type, platform, arch, version);
CREATE INDEX IF NOT EXISTS idx_platform_runtime_artifacts_channel
  ON platform_runtime_artifact_releases(artifact_type, platform, arch, channel);
CREATE INDEX IF NOT EXISTS idx_platform_runtime_artifacts_status
  ON platform_runtime_artifact_releases(status);
CREATE INDEX IF NOT EXISTS idx_platform_runtime_artifacts_uploaded_at
  ON platform_runtime_artifact_releases(uploaded_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_runtime_artifact_channels_unique
  ON platform_runtime_artifact_channels(artifact_type, platform, arch, channel);
CREATE INDEX IF NOT EXISTS idx_platform_runtime_artifact_channels_published_release_id
  ON platform_runtime_artifact_channels(published_release_id);

ALTER TABLE IF EXISTS task_session_connector_bindings
  ADD COLUMN IF NOT EXISTS connector_instance_key TEXT,
  ADD COLUMN IF NOT EXISTS profile_id TEXT,
  ADD COLUMN IF NOT EXISTS runtime_provider_id TEXT,
  ADD COLUMN IF NOT EXISTS runtime_env_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS runtime_transport TEXT,
  ADD COLUMN IF NOT EXISTS runtime_attached_tools_json JSONB,
  ADD COLUMN IF NOT EXISTS runtime_last_started_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS runtime_last_stopped_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS recovery_queued_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS recovery_started_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS recovery_completed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS enabled_tools JSONB,
  ADD COLUMN IF NOT EXISTS session_config_json JSONB,
  ADD COLUMN IF NOT EXISTS definition_snapshot_json JSONB;

UPDATE task_session_connector_bindings
SET connector_instance_key =
  CASE
    WHEN connector_key = 'custom_mcp' AND profile_id IS NOT NULL AND profile_id <> ''
      THEN connector_key || ':' || profile_id
    ELSE connector_key
  END
WHERE connector_instance_key IS NULL OR connector_instance_key = '';

UPDATE task_session_connector_bindings
SET desired_state = 'detached',
    runtime_status = 'disconnected',
    runtime_provider_id = NULL,
    runtime_attached_tools_json = '[]'::jsonb,
    runtime_last_stopped_at = COALESCE(runtime_last_stopped_at, NOW()),
    recovery_queued_at = NULL,
    recovery_started_at = NULL,
    recovery_completed_at = NULL,
    last_error = 'custom_mcp_profile_missing_after_instance_key_migration'
WHERE connector_key = 'custom_mcp'
  AND (profile_id IS NULL OR profile_id = '');

ALTER TABLE IF EXISTS task_session_connector_bindings
  ALTER COLUMN connector_instance_key SET NOT NULL;

DROP INDEX IF EXISTS idx_task_session_connector_bindings_session_connector;
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_connector_bindings_session_instance
  ON task_session_connector_bindings(task_session_id, connector_instance_key);
CREATE INDEX IF NOT EXISTS idx_task_session_connector_bindings_session_connector
  ON task_session_connector_bindings(task_session_id, connector_key);

ALTER TABLE IF EXISTS connector_guide_policies
  ADD COLUMN IF NOT EXISTS connector_key TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS trigger_mode TEXT NOT NULL DEFAULT 'on_attach',
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS published_revision_id UUID,
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE IF EXISTS connector_guide_revisions
  ADD COLUMN IF NOT EXISTS policy_id UUID,
  ADD COLUMN IF NOT EXISTS version_number INTEGER,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS server_instructions_markdown TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS guide_reminder_markdown TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS blocking_rules_markdown TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMP;

ALTER TABLE IF EXISTS task_session_connector_guides
  ADD COLUMN IF NOT EXISTS task_session_id TEXT,
  ADD COLUMN IF NOT EXISTS connector_key TEXT,
  ADD COLUMN IF NOT EXISTS policy_id UUID,
  ADD COLUMN IF NOT EXISTS revision_id UUID,
  ADD COLUMN IF NOT EXISTS trigger_mode TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE IF EXISTS task_session_mcp_recovery_jobs
  ADD COLUMN IF NOT EXISTS recovery_key TEXT,
  ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'session_reconcile',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS payload_json JSONB,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE IF EXISTS task_session_deployment_sync_jobs
  ADD COLUMN IF NOT EXISTS sync_key TEXT,
  ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'deployment_panel_sync',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS payload_json JSONB,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE IF EXISTS connector_auth_requests
  ADD COLUMN IF NOT EXISTS profile_id TEXT,
  ADD COLUMN IF NOT EXISTS profile_draft_json JSONB;

INSERT INTO user_connector_profiles (
  user_id,
  connector_key,
  profile_name,
  display_name,
  auth_mode,
  auth_status,
  config_json,
  secret_ciphertext,
  metadata_json,
  is_default,
  last_auth_at,
  last_error,
  created_at,
  updated_at
)
SELECT
  user_id,
  connector_key,
  COALESCE(NULLIF(display_name, ''), initcap(connector_key) || ' Default'),
  display_name,
  auth_mode,
  auth_status,
  config_json,
  secret_ciphertext,
  '{}'::jsonb,
  TRUE,
  last_auth_at,
  last_error,
  created_at,
  updated_at
FROM user_connector_accounts legacy
WHERE NOT EXISTS (
  SELECT 1
  FROM user_connector_profiles profiles
  WHERE profiles.user_id = legacy.user_id
    AND profiles.connector_key = legacy.connector_key
)
ON CONFLICT DO NOTHING;

UPDATE task_session_connector_bindings bindings
SET profile_id = profiles.id::text
FROM task_creation_sessions sessions,
     user_connector_profiles profiles
WHERE bindings.profile_id IS NULL
  AND sessions.id::text = bindings.task_session_id
  AND profiles.user_id = sessions.user_id
  AND profiles.connector_key = bindings.connector_key
  AND profiles.is_default = TRUE;

UPDATE task_session_connector_bindings
SET connector_instance_key =
  CASE
    WHEN connector_key = 'custom_mcp' AND profile_id IS NOT NULL AND profile_id <> ''
      THEN connector_key || ':' || profile_id
    ELSE connector_key
  END
WHERE connector_instance_key IS NULL
   OR connector_instance_key = ''
   OR connector_instance_key = 'custom_mcp';
`;

const customApiTablesSQL = `
CREATE TABLE IF NOT EXISTS custom_api_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'user',
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL,
  auth_mode TEXT NOT NULL DEFAULT 'none',
  default_headers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  allowed_hosts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_api_endpoint_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id UUID NOT NULL REFERENCES custom_api_definitions(id) ON DELETE CASCADE,
  tool_slug TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL,
  path_template TEXT NOT NULL,
  operation_type TEXT NOT NULL DEFAULT 'read',
  input_schema_json JSONB NOT NULL,
  request_mapping_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_mapping_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_level TEXT NOT NULL DEFAULT 'low',
  computed_risk_level TEXT NOT NULL DEFAULT 'low',
  risk_report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmation_policy TEXT NOT NULL DEFAULT 'none',
  review_status TEXT NOT NULL DEFAULT 'draft',
  reviewed_by TEXT,
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_api_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  task_session_id TEXT NOT NULL,
  endpoint_tool_id UUID NOT NULL REFERENCES custom_api_endpoint_tools(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  effective_risk_level TEXT NOT NULL,
  confirmation_text TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_api_call_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  task_session_id TEXT NOT NULL,
  run_id TEXT,
  definition_id UUID REFERENCES custom_api_definitions(id) ON DELETE SET NULL,
  endpoint_tool_id UUID REFERENCES custom_api_endpoint_tools(id) ON DELETE SET NULL,
  connector_profile_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  method TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  request_id TEXT NOT NULL,
  caller_type TEXT NOT NULL DEFAULT 'agent',
  declared_risk_level TEXT NOT NULL,
  computed_risk_level TEXT NOT NULL,
  runtime_risk_level TEXT NOT NULL,
  effective_risk_level TEXT NOT NULL,
  resolved_url_hash TEXT,
  resolved_url_redacted TEXT,
  request_body_hash TEXT,
  request_body_redacted_preview TEXT,
  response_body_redacted_preview TEXT,
  response_status INTEGER,
  duration_ms INTEGER,
  confirmation_id TEXT,
  actor_context_json JSONB,
  status TEXT NOT NULL DEFAULT 'started',
  result_summary TEXT,
  error_code TEXT,
  debug_expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_api_definitions_owner_slug
  ON custom_api_definitions (owner_user_id, slug);
CREATE INDEX IF NOT EXISTS idx_custom_api_definitions_owner_status
  ON custom_api_definitions (owner_user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_api_endpoint_tools_definition_slug
  ON custom_api_endpoint_tools (definition_id, tool_slug);
CREATE INDEX IF NOT EXISTS idx_custom_api_endpoint_tools_review_status
  ON custom_api_endpoint_tools (review_status);
CREATE INDEX IF NOT EXISTS idx_custom_api_endpoint_tools_definition_status
  ON custom_api_endpoint_tools (definition_id, review_status);
CREATE INDEX IF NOT EXISTS idx_custom_api_confirmations_lookup
  ON custom_api_confirmations (user_id, task_session_id, endpoint_tool_id);
CREATE INDEX IF NOT EXISTS idx_custom_api_call_audit_logs_session_created
  ON custom_api_call_audit_logs (task_session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_custom_api_call_audit_logs_tool_created
  ON custom_api_call_audit_logs (endpoint_tool_id, created_at);
CREATE INDEX IF NOT EXISTS idx_custom_api_call_audit_logs_request_id
  ON custom_api_call_audit_logs (request_id);
`;

const createTablesSQL = `
CREATE SEQUENCE IF NOT EXISTS conversation_message_timeline_cursor_seq;

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  profile_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMP
);
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS profile_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS avatar_storage_key TEXT;
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS avatar_source TEXT NOT NULL DEFAULT 'default';
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS app_user_oauth_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  provider_email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE app_user_oauth_accounts
  ADD COLUMN IF NOT EXISTS provider_email TEXT;
ALTER TABLE app_user_oauth_accounts
  ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE app_user_oauth_accounts
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

CREATE TABLE IF NOT EXISTS app_user_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  project_type TEXT NOT NULL DEFAULT 'standard',
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE app_user_projects
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE app_user_projects
  ADD COLUMN IF NOT EXISTS project_type TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE app_user_projects
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE app_user_projects
  ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS app_user_legacy_id_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  legacy_user_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'auth_bootstrap',
  first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_user_email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'register',
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP,
  last_sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  login_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email ON app_users(email);
CREATE INDEX IF NOT EXISTS idx_app_users_status ON app_users(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_oauth_accounts_provider_subject
  ON app_user_oauth_accounts(provider, provider_subject);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_oauth_accounts_user_provider
  ON app_user_oauth_accounts(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_app_user_oauth_accounts_user_id
  ON app_user_oauth_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_app_user_oauth_accounts_provider
  ON app_user_oauth_accounts(provider);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_projects_user_name
  ON app_user_projects(user_id, name);
CREATE INDEX IF NOT EXISTS idx_app_user_projects_user_id ON app_user_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_app_user_projects_user_type_status
  ON app_user_projects(user_id, project_type, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_legacy_mappings_legacy_user_id
  ON app_user_legacy_id_mappings(legacy_user_id);
CREATE INDEX IF NOT EXISTS idx_app_user_legacy_mappings_app_user_id
  ON app_user_legacy_id_mappings(app_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_sessions_token_hash ON app_user_sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_app_user_sessions_user_id ON app_user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_app_user_sessions_expires_at ON app_user_sessions(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_email_verifications_email_purpose
  ON app_user_email_verifications(email, purpose);
CREATE INDEX IF NOT EXISTS idx_app_user_email_verifications_expires_at
  ON app_user_email_verifications(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_login_name ON admin_users(login_name);
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON admin_users(role);
CREATE INDEX IF NOT EXISTS idx_admin_users_status ON admin_users(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_user_sessions_token_hash ON admin_user_sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_user_sessions_admin_user_id ON admin_user_sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_user_sessions_expires_at ON admin_user_sessions(expires_at);

-- 任务创建会话表
CREATE TABLE IF NOT EXISTS task_creation_sessions (
  id UUID PRIMARY KEY,
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);
ALTER TABLE task_creation_sessions
  ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 连接器相关表与补丁必须在 runtime_events 外键表之前创建
${connectorTablesSQL}

-- 对话消息表
CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  message_key TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT,
  metadata JSONB,
  timeline_cursor BIGINT DEFAULT nextval('conversation_message_timeline_cursor_seq'),
  runtime_generation INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 会话最近消息热缓存表
CREATE TABLE IF NOT EXISTS task_session_recent_messages (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  message_id UUID,
  message_key TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT,
  metadata JSONB,
  timeline_cursor BIGINT,
  runtime_generation INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 会话工作区预览缓存表
CREATE TABLE IF NOT EXISTS task_session_workspace_cache (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  tenant_key TEXT NOT NULL,
  cache_type TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Altus managed run 表
CREATE TABLE IF NOT EXISTS task_session_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'managed',
  status TEXT NOT NULL DEFAULT 'queued',
  model TEXT,
  stop_reason TEXT,
  sandbox_binding_id UUID,
  connector_snapshot_id UUID,
  mcp_tool_snapshot_id UUID,
  metadata_json JSONB,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Altus managed run 事件表
CREATE TABLE IF NOT EXISTS task_session_run_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES task_session_runs(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  payload_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Altus managed sandbox binding 表
CREATE TABLE IF NOT EXISTS task_session_sandbox_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  sandbox_id TEXT NOT NULL,
  workspace_root TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  metadata_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Altus managed connector snapshot 表
CREATE TABLE IF NOT EXISTS task_session_connector_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_session_mcp_tool_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_session_connector_runtime_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  binding_id UUID NOT NULL REFERENCES task_session_connector_bindings(id) ON DELETE CASCADE,
  provider_id TEXT,
  event_type TEXT NOT NULL,
  payload_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 平台 skills 主表
CREATE TABLE IF NOT EXISTS platform_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_revision_id UUID,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE platform_skills
  ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 平台 skills revision 表
CREATE TABLE IF NOT EXISTS platform_skill_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID NOT NULL REFERENCES platform_skills(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  slug_snapshot TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  description_snapshot TEXT NOT NULL DEFAULT '',
  category_snapshot TEXT NOT NULL DEFAULT 'general',
  body_markdown TEXT NOT NULL,
  published_at TIMESTAMP,
  created_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_skill_revision_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id UUID NOT NULL REFERENCES platform_skill_revisions(id) ON DELETE CASCADE,
  resource_path TEXT NOT NULL,
  resource_type TEXT NOT NULL DEFAULT 'reference',
  content_markdown TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_skill_revision_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id UUID NOT NULL REFERENCES platform_skill_revisions(id) ON DELETE CASCADE,
  entry_name TEXT NOT NULL,
  entry_description TEXT NOT NULL DEFAULT '',
  allowed_tools_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  body_markdown TEXT NOT NULL,
  render_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_skill_revision_resource_indexes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id UUID NOT NULL REFERENCES platform_skill_revisions(id) ON DELETE CASCADE,
  resource_key TEXT NOT NULL,
  resource_path TEXT NOT NULL,
  resource_kind TEXT NOT NULL DEFAULT 'reference',
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  content_storage TEXT NOT NULL DEFAULT 'database',
  mime_type TEXT NOT NULL DEFAULT 'text/markdown',
  storage_path TEXT,
  storage_locator_json JSONB,
  load_stage TEXT NOT NULL DEFAULT 'on_demand',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_skill_revision_resource_bodies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_index_id UUID NOT NULL REFERENCES platform_skill_revision_resource_indexes(id) ON DELETE CASCADE,
  content_format TEXT NOT NULL DEFAULT 'markdown',
  content_mode TEXT NOT NULL DEFAULT 'inline',
  full_text_hash TEXT,
  content_size INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_skill_revision_resource_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_body_id UUID NOT NULL REFERENCES platform_skill_revision_resource_bodies(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_role TEXT NOT NULL DEFAULT 'body',
  chunk_summary TEXT NOT NULL DEFAULT '',
  content_text TEXT NOT NULL,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_skill_revision_resource_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id UUID NOT NULL REFERENCES platform_skill_revisions(id) ON DELETE CASCADE,
  from_type TEXT NOT NULL,
  from_id UUID NOT NULL,
  to_resource_index_id UUID NOT NULL REFERENCES platform_skill_revision_resource_indexes(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL DEFAULT 'suggested',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_platform_skill_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  platform_skill_id UUID NOT NULL REFERENCES platform_skills(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_custom_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'active',
  body_markdown TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_custom_skill_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_skill_id UUID NOT NULL REFERENCES user_custom_skills(id) ON DELETE CASCADE,
  document_key TEXT NOT NULL,
  document_path TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 意图识别结果表
CREATE TABLE IF NOT EXISTS intent_recognition_results (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  user_input TEXT NOT NULL,
  intent_type TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  key_info JSONB NOT NULL,
  clarification_needed BOOLEAN NOT NULL DEFAULT FALSE,
  clarification_questions JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 任务描述表
CREATE TABLE IF NOT EXISTS task_descriptions (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  intent_result_id UUID NOT NULL REFERENCES intent_recognition_results(id),
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  scope TEXT,
  deliverables JSONB NOT NULL,
  constraints JSONB,
  additional_info JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 执行计划表
CREATE TABLE IF NOT EXISTS execution_plans (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  task_description_id UUID NOT NULL REFERENCES task_descriptions(id),
  project_title TEXT NOT NULL,
  project_description TEXT,
  estimated_total_hours INTEGER,
  managers JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 搜索记录表
CREATE TABLE IF NOT EXISTS search_records (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  results JSONB,
  source TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Sandbox 执行环境表
CREATE TABLE IF NOT EXISTS sandbox_execution_environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL UNIQUE,
  orchestrator_session_id TEXT NOT NULL,
  vm_name TEXT,
  base_image TEXT NOT NULL,
  incremental_storage_dir TEXT NOT NULL,
  incremental_file_name TEXT NOT NULL,
  incremental_file_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating',
  security_profile JSONB NOT NULL,
  network_policy JSONB NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_conversation_messages_session_id ON conversation_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_task_session_recent_messages_session_id
  ON task_session_recent_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_task_session_recent_messages_session_created_at
  ON task_session_recent_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_intent_recognition_results_session_id ON intent_recognition_results(session_id);
CREATE INDEX IF NOT EXISTS idx_task_descriptions_session_id ON task_descriptions(session_id);
CREATE INDEX IF NOT EXISTS idx_execution_plans_session_id ON execution_plans(session_id);
CREATE INDEX IF NOT EXISTS idx_search_records_session_id ON search_records(session_id);
CREATE INDEX IF NOT EXISTS idx_sandbox_execution_environments_session_id ON sandbox_execution_environments(session_id);
CREATE INDEX IF NOT EXISTS idx_sandbox_execution_environments_status ON sandbox_execution_environments(status);
CREATE INDEX IF NOT EXISTS idx_sandbox_execution_environments_created_at ON sandbox_execution_environments(created_at);
DROP INDEX IF EXISTS idx_sandbox_execution_environments_task_session_created_at;
CREATE INDEX IF NOT EXISTS idx_sandbox_execution_environments_task_session_created_at
  ON sandbox_execution_environments(((metadata ->> 'taskSessionId')), created_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_sandbox_execution_environments_task_session_canonical
  ON sandbox_execution_environments(
    ((metadata ->> 'taskSessionId')),
    (
      CASE
        WHEN COALESCE(metadata ->> 'dedupeReplacementSandboxId', '') = '' AND status = 'ready' THEN 5
        WHEN COALESCE(metadata ->> 'dedupeReplacementSandboxId', '') = '' AND status = 'creating' THEN 4
        WHEN COALESCE(metadata ->> 'dedupeReplacementSandboxId', '') = '' AND status = 'closing' THEN 3
        WHEN COALESCE(metadata ->> 'dedupeReplacementSandboxId', '') = '' AND status <> 'closed' THEN 2
        WHEN COALESCE(metadata ->> 'dedupeReplacementSandboxId', '') = '' AND status = 'closed' THEN 1
        ELSE 0
      END
    ),
    created_at,
    updated_at
  );
CREATE INDEX IF NOT EXISTS idx_task_creation_sessions_status ON task_creation_sessions(status);
CREATE INDEX IF NOT EXISTS idx_task_creation_sessions_created_at ON task_creation_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_task_session_runs_session_id ON task_session_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_task_session_runs_session_created_at ON task_session_runs(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_session_runs_status ON task_session_runs(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_run_events_run_sequence
  ON task_session_run_events(run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_task_session_run_events_run_created_at
  ON task_session_run_events(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_session_run_events_session_id ON task_session_run_events(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_sandbox_bindings_session_id
  ON task_session_sandbox_bindings(session_id);
CREATE INDEX IF NOT EXISTS idx_task_session_sandbox_bindings_sandbox_id
  ON task_session_sandbox_bindings(sandbox_id);
CREATE INDEX IF NOT EXISTS idx_task_session_connector_snapshots_session_id
  ON task_session_connector_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_task_session_mcp_tool_snapshots_session_id
  ON task_session_mcp_tool_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_task_session_connector_runtime_events_session_id
  ON task_session_connector_runtime_events(session_id);
CREATE INDEX IF NOT EXISTS idx_task_session_connector_runtime_events_binding_id
  ON task_session_connector_runtime_events(binding_id);
CREATE INDEX IF NOT EXISTS idx_task_session_connector_runtime_events_provider_id
  ON task_session_connector_runtime_events(provider_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_skills_slug
  ON platform_skills(slug);
CREATE INDEX IF NOT EXISTS idx_platform_skills_status
  ON platform_skills(status);
CREATE INDEX IF NOT EXISTS idx_platform_skills_published_revision_id
  ON platform_skills(published_revision_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_skill_revisions_skill_revision
  ON platform_skill_revisions(skill_id, revision_number);
CREATE INDEX IF NOT EXISTS idx_platform_skill_revisions_skill_created_at
  ON platform_skill_revisions(skill_id, created_at);
CREATE INDEX IF NOT EXISTS idx_platform_skill_revisions_published_at
  ON platform_skill_revisions(published_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_skill_revision_resources_revision_path
  ON platform_skill_revision_resources(revision_id, resource_path);
CREATE INDEX IF NOT EXISTS idx_platform_skill_revision_resources_revision_id
  ON platform_skill_revision_resources(revision_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_skill_revision_entries_revision_id
  ON platform_skill_revision_entries(revision_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_skill_resource_indexes_revision_key
  ON platform_skill_revision_resource_indexes(revision_id, resource_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_skill_resource_indexes_revision_path
  ON platform_skill_revision_resource_indexes(revision_id, resource_path);
CREATE INDEX IF NOT EXISTS idx_platform_skill_resource_indexes_revision_sort
  ON platform_skill_revision_resource_indexes(revision_id, sort_order);
ALTER TABLE platform_skill_revision_resource_indexes
  ADD COLUMN IF NOT EXISTS content_storage TEXT NOT NULL DEFAULT 'database';
ALTER TABLE platform_skill_revision_resource_indexes
  ADD COLUMN IF NOT EXISTS mime_type TEXT NOT NULL DEFAULT 'text/markdown';
ALTER TABLE platform_skill_revision_resource_indexes
  ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE platform_skill_revision_resource_indexes
  ADD COLUMN IF NOT EXISTS storage_locator_json JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_skill_resource_bodies_resource_index_id
  ON platform_skill_revision_resource_bodies(resource_index_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_skill_resource_chunks_body_chunk
  ON platform_skill_revision_resource_chunks(resource_body_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_platform_skill_resource_chunks_body_role
  ON platform_skill_revision_resource_chunks(resource_body_id, chunk_role);
CREATE INDEX IF NOT EXISTS idx_platform_skill_resource_links_revision_from
  ON platform_skill_revision_resource_links(revision_id, from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_platform_skill_resource_links_revision_to
  ON platform_skill_revision_resource_links(revision_id, to_resource_index_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_platform_skill_bindings_user_skill
  ON user_platform_skill_bindings(user_id, platform_skill_id);
CREATE INDEX IF NOT EXISTS idx_user_platform_skill_bindings_user_id
  ON user_platform_skill_bindings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_platform_skill_bindings_platform_skill_id
  ON user_platform_skill_bindings(platform_skill_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_custom_skills_user_slug
  ON user_custom_skills(user_id, slug);
CREATE INDEX IF NOT EXISTS idx_user_custom_skills_user_status
  ON user_custom_skills(user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_custom_skills_updated_at
  ON user_custom_skills(updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_custom_skill_documents_skill_key
  ON user_custom_skill_documents(custom_skill_id, document_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_custom_skill_documents_skill_path
  ON user_custom_skill_documents(custom_skill_id, document_path);
CREATE INDEX IF NOT EXISTS idx_user_custom_skill_documents_skill_sort
  ON user_custom_skill_documents(custom_skill_id, sort_order);

-- 会话 API 追踪表
CREATE TABLE IF NOT EXISTS session_api_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  run_id UUID REFERENCES task_session_runs(id) ON DELETE SET NULL,
  trace_type TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  provider TEXT,
  tool_name TEXT,
  service_name TEXT,
  endpoint TEXT,
  request_method TEXT,
  request_headers JSONB,
  request_body JSONB,
  request_body_text TEXT,
  response_status INTEGER,
  response_headers JSONB,
  response_body JSONB,
  response_body_text TEXT,
  duration_ms INTEGER,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  cached_prompt_tokens INTEGER DEFAULT 0,
  cache_creation_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  error_message TEXT,
  error_stack TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_api_traces_session_id
  ON session_api_traces(session_id);
CREATE INDEX IF NOT EXISTS idx_session_api_traces_session_type
  ON session_api_traces(session_id, trace_type);
CREATE INDEX IF NOT EXISTS idx_session_api_traces_session_sequence
  ON session_api_traces(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_session_api_traces_run_id
  ON session_api_traces(run_id);
CREATE INDEX IF NOT EXISTS idx_session_api_traces_tool_name
  ON session_api_traces(tool_name);
CREATE INDEX IF NOT EXISTS idx_session_api_traces_created_at
  ON session_api_traces(created_at);
CREATE INDEX IF NOT EXISTS idx_session_api_traces_type_created_at
  ON session_api_traces(trace_type, created_at);

-- API 请求日志表
CREATE TABLE IF NOT EXISTS api_request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id UUID NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  query_string TEXT,
  request_headers JSONB DEFAULT '{}'::jsonb,
  request_body_summary TEXT,
  response_status INTEGER,
  response_body_summary TEXT,
  duration_ms INTEGER,
  ip_address TEXT,
  user_agent TEXT,
  task_session_id UUID,
  metadata_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_request_logs_user_id
  ON api_request_logs(app_user_id);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_user_created_at
  ON api_request_logs(app_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_path
  ON api_request_logs(path);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_status
  ON api_request_logs(response_status);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_session_id
  ON api_request_logs(task_session_id);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_created_at
  ON api_request_logs(created_at);
`;

const deliverableTablesSQL = `
CREATE TABLE IF NOT EXISTS task_session_deliverable_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES task_creation_sessions(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES task_session_runs(id) ON DELETE CASCADE,
  sandbox_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_session_deliverable_artifacts_run_created_at
  ON task_session_deliverable_artifacts(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_session_deliverable_artifacts_session_created_at
  ON task_session_deliverable_artifacts(session_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_deliverable_artifacts_storage_key
  ON task_session_deliverable_artifacts(storage_key);
`;

const backfillMessageStorageSQL = `
CREATE SEQUENCE IF NOT EXISTS conversation_message_timeline_cursor_seq;

ALTER TABLE IF EXISTS task_session_runs
  ADD COLUMN IF NOT EXISTS mcp_tool_snapshot_id UUID;

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS message_key TEXT,
  ADD COLUMN IF NOT EXISTS timeline_cursor BIGINT,
  ADD COLUMN IF NOT EXISTS runtime_generation INTEGER,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE task_session_recent_messages
  ADD COLUMN IF NOT EXISTS message_id UUID,
  ADD COLUMN IF NOT EXISTS message_key TEXT,
  ADD COLUMN IF NOT EXISTS timeline_cursor BIGINT,
  ADD COLUMN IF NOT EXISTS runtime_generation INTEGER,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

UPDATE conversation_messages
SET message_key = COALESCE(NULLIF(metadata->>'messageKey', ''), 'db:' || id::text)
WHERE message_key IS NULL;

UPDATE conversation_messages
SET runtime_generation = CASE
  WHEN metadata ? 'runtimeGeneration' AND (metadata->>'runtimeGeneration') ~ '^[0-9]+$'
    THEN (metadata->>'runtimeGeneration')::INTEGER
  ELSE runtime_generation
END
WHERE runtime_generation IS NULL;

WITH ranked_duplicates AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY session_id, message_key
      ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC, id DESC
    ) AS rn
  FROM conversation_messages
  WHERE message_key IS NOT NULL
)
DELETE FROM conversation_messages cm
USING ranked_duplicates rd
WHERE cm.id = rd.id
  AND rd.rn > 1;

WITH ranked AS (
  SELECT
    id,
    COALESCE(
      CASE WHEN metadata ? 'timelineCursor' AND (metadata->>'timelineCursor') ~ '^[0-9]+$'
        THEN (metadata->>'timelineCursor')::BIGINT END,
      CASE WHEN metadata ? 'sessionEventSeq' AND (metadata->>'sessionEventSeq') ~ '^[0-9]+$'
        THEN (metadata->>'sessionEventSeq')::BIGINT END,
      ((EXTRACT(EPOCH FROM created_at) * 1000000)::BIGINT
        + ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at ASC, id ASC))
    ) AS resolved_cursor
  FROM conversation_messages
)
UPDATE conversation_messages cm
SET timeline_cursor = ranked.resolved_cursor
FROM ranked
WHERE cm.id = ranked.id
  AND cm.timeline_cursor IS NULL;

ALTER TABLE conversation_messages
  ALTER COLUMN message_key SET NOT NULL,
  ALTER COLUMN timeline_cursor SET NOT NULL,
  ALTER COLUMN timeline_cursor SET DEFAULT nextval('conversation_message_timeline_cursor_seq');

SELECT setval(
  'conversation_message_timeline_cursor_seq',
  COALESCE((SELECT MAX(timeline_cursor) FROM conversation_messages), 1),
  true
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_session_id ON conversation_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_session_timeline
  ON conversation_messages(session_id, timeline_cursor);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_messages_session_message_key
  ON conversation_messages(session_id, message_key);

DELETE FROM task_session_recent_messages;

INSERT INTO task_session_recent_messages (
  id,
  session_id,
  message_id,
  message_key,
  role,
  content,
  message_type,
  metadata,
  timeline_cursor,
  runtime_generation,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  ranked.session_id,
  ranked.id,
  ranked.message_key,
  ranked.role,
  ranked.content,
  ranked.message_type,
  ranked.metadata,
  ranked.timeline_cursor,
  ranked.runtime_generation,
  ranked.created_at,
  COALESCE(ranked.updated_at, NOW())
FROM (
  SELECT
    cm.*,
    ROW_NUMBER() OVER (PARTITION BY cm.session_id ORDER BY cm.timeline_cursor DESC, cm.created_at DESC, cm.id DESC) AS rn
  FROM conversation_messages cm
) ranked
WHERE ranked.rn <= 50;

UPDATE task_session_recent_messages
SET
  message_id = COALESCE(message_id, id),
  message_key = COALESCE(message_key, 'db:' || id::text),
  timeline_cursor = COALESCE(
    timeline_cursor,
    CASE WHEN metadata ? 'timelineCursor' AND (metadata->>'timelineCursor') ~ '^[0-9]+$'
      THEN (metadata->>'timelineCursor')::BIGINT END,
    CASE WHEN metadata ? 'sessionEventSeq' AND (metadata->>'sessionEventSeq') ~ '^[0-9]+$'
      THEN (metadata->>'sessionEventSeq')::BIGINT END,
    (EXTRACT(EPOCH FROM created_at) * 1000000)::BIGINT
  );

ALTER TABLE task_session_recent_messages
  ALTER COLUMN message_id SET NOT NULL,
  ALTER COLUMN message_key SET NOT NULL,
  ALTER COLUMN timeline_cursor SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_session_recent_messages_session_id
  ON task_session_recent_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_task_session_recent_messages_session_timeline
  ON task_session_recent_messages(session_id, timeline_cursor);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_recent_messages_session_message_key
  ON task_session_recent_messages(session_id, message_key);
CREATE INDEX IF NOT EXISTS idx_task_session_recent_messages_session_created_at
  ON task_session_recent_messages(session_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_workspace_cache_session_unique
  ON task_session_workspace_cache(session_id, tenant_key, cache_type, cache_key);
CREATE INDEX IF NOT EXISTS idx_task_session_workspace_cache_session_id
  ON task_session_workspace_cache(session_id);
CREATE INDEX IF NOT EXISTS idx_task_session_workspace_cache_session_type
  ON task_session_workspace_cache(session_id, cache_type);
CREATE INDEX IF NOT EXISTS idx_task_session_workspace_cache_updated_at
  ON task_session_workspace_cache(updated_at);
`;

const billingCoreTablesSQL = `
-- 用户积分余额表
CREATE TABLE IF NOT EXISTS user_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0,
  total_earned INTEGER NOT NULL DEFAULT 0,
  total_consumed INTEGER NOT NULL DEFAULT 0,
  last_recharge_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_credits_user_id ON user_credits(user_id);
DO $$ BEGIN ALTER TABLE user_credits ADD CONSTRAINT check_balance_non_negative CHECK (balance >= 0); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 积分交易记录表
CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  source_id UUID,
  source_type TEXT,
  description TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON credit_transactions(type);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at);

-- Token 使用明细表
CREATE TABLE IF NOT EXISTS token_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES task_creation_sessions(id) ON DELETE SET NULL,
  run_id UUID REFERENCES task_session_runs(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  cached_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  non_cached_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  credits_consumed INTEGER NOT NULL DEFAULT 0,
  pricing_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_token_usage_logs_user_id ON token_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_logs_session_id ON token_usage_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_logs_created_at ON token_usage_logs(created_at);

-- 模型定价配置表
CREATE TABLE IF NOT EXISTS model_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model TEXT NOT NULL,
  model_provider TEXT NOT NULL,
  prompt_price_per_1m_tokens INTEGER NOT NULL,
  completion_price_per_1m_tokens INTEGER NOT NULL,
  multiplier REAL NOT NULL DEFAULT 1.0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
  effective_until TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
DROP INDEX IF EXISTS idx_model_pricing_model_active;
CREATE INDEX IF NOT EXISTS idx_model_pricing_model_active ON model_pricing(model, is_active, effective_from);
CREATE INDEX IF NOT EXISTS idx_model_pricing_active ON model_pricing(is_active);

-- 缓存计费比例配置表
CREATE TABLE IF NOT EXISTS cache_pricing_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  hit_ratio INTEGER NOT NULL,
  creation_ratio INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
  effective_until TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DROP INDEX IF EXISTS idx_cache_pricing_config_provider_active;
CREATE UNIQUE INDEX idx_cache_pricing_config_provider_active
  ON cache_pricing_config(provider)
  WHERE is_active = TRUE;

-- 初始默认配置（向后兼容：确保升级后现有计费不受影响）
INSERT INTO cache_pricing_config (provider, hit_ratio, creation_ratio, is_active)
VALUES
  ('openai', 500, 0, true),
  ('anthropic', 100, 1250, true),
  ('qwen', 200, 1250, true),
  ('agent', 500, 0, true),
  ('sandbox', 500, 0, true)
ON CONFLICT DO NOTHING;

-- 会员类型表
CREATE TABLE IF NOT EXISTS membership_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  default_credits INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  allowed_agent_levels_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  benefits_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  daily_auto_restore_enabled BOOLEAN NOT NULL DEFAULT false,
  daily_auto_restore_credits INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  effective_from TIMESTAMP,
  effective_until TIMESTAMP,
  created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_plans_code ON membership_plans(code);
CREATE INDEX IF NOT EXISTS idx_membership_plans_status ON membership_plans(status);
CREATE INDEX IF NOT EXISTS idx_membership_plans_sort_order ON membership_plans(sort_order);
CREATE INDEX IF NOT EXISTS idx_membership_plans_is_default ON membership_plans(is_default);

-- 会员关联用户表
CREATE TABLE IF NOT EXISTS user_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  membership_plan_id UUID NOT NULL REFERENCES membership_plans(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id UUID,
  assigned_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  assigned_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_memberships_user_id ON user_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_user_memberships_membership_plan_id ON user_memberships(membership_plan_id);
CREATE INDEX IF NOT EXISTS idx_user_memberships_status ON user_memberships(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memberships_user_active ON user_memberships(user_id, status);

-- 会员积分发放记录表
CREATE TABLE IF NOT EXISTS membership_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  membership_plan_id UUID NOT NULL REFERENCES membership_plans(id) ON DELETE RESTRICT,
  grant_credits INTEGER NOT NULL DEFAULT 0,
  grant_reason TEXT NOT NULL DEFAULT '',
  grant_status TEXT NOT NULL DEFAULT 'issued',
  credit_transaction_id UUID REFERENCES credit_transactions(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_membership_grants_user_id ON membership_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_membership_grants_membership_plan_id ON membership_grants(membership_plan_id);
CREATE INDEX IF NOT EXISTS idx_membership_grants_created_at ON membership_grants(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_grants_credit_transaction_id ON membership_grants(credit_transaction_id);

-- 会员操作审计表
CREATE TABLE IF NOT EXISTS membership_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  before_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_membership_audit_logs_actor_id ON membership_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_membership_audit_logs_target_type_target_id ON membership_audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_membership_audit_logs_created_at ON membership_audit_logs(created_at);

-- 会员每日恢复记录（幂等）
CREATE TABLE IF NOT EXISTS membership_daily_restores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  membership_plan_id UUID NOT NULL REFERENCES membership_plans(id) ON DELETE RESTRICT,
  restore_date DATE NOT NULL,
  restore_credits INTEGER NOT NULL DEFAULT 0,
  credit_transaction_id UUID REFERENCES credit_transactions(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_membership_daily_restores_user_id ON membership_daily_restores(user_id);
CREATE INDEX IF NOT EXISTS idx_membership_daily_restores_membership_plan_id ON membership_daily_restores(membership_plan_id);
CREATE INDEX IF NOT EXISTS idx_membership_daily_restores_restore_date ON membership_daily_restores(restore_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_daily_restores_unique ON membership_daily_restores(user_id, membership_plan_id, restore_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_daily_restores_credit_transaction_id ON membership_daily_restores(credit_transaction_id);

ALTER TABLE membership_plans ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE membership_plans ADD COLUMN IF NOT EXISTS daily_auto_restore_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE membership_plans ADD COLUMN IF NOT EXISTS daily_auto_restore_credits INTEGER NOT NULL DEFAULT 0;
`;

const activationCodeTablesSQL = `
-- 积分激活码分组表
CREATE TABLE IF NOT EXISTS credit_activation_code_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activation_code_groups_name ON credit_activation_code_groups(name);
CREATE INDEX IF NOT EXISTS idx_activation_code_groups_status ON credit_activation_code_groups(status);

-- 积分激活码表
CREATE TABLE IF NOT EXISTS credit_activation_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  credits_amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  max_uses INTEGER NOT NULL DEFAULT 1,
  current_uses INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP,
  group_id UUID REFERENCES credit_activation_code_groups(id) ON DELETE SET NULL,
  created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  used_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  used_at TIMESTAMP,
  batch_id TEXT,
  description TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_activation_codes_code ON credit_activation_codes(code);
CREATE INDEX IF NOT EXISTS idx_activation_codes_status ON credit_activation_codes(status);
CREATE INDEX IF NOT EXISTS idx_activation_codes_group_id ON credit_activation_codes(group_id);
CREATE INDEX IF NOT EXISTS idx_activation_codes_batch_id ON credit_activation_codes(batch_id);
CREATE INDEX IF NOT EXISTS idx_activation_codes_expires_at ON credit_activation_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_activation_codes_used_by ON credit_activation_codes(used_by);

-- 积分激活码使用记录表
CREATE TABLE IF NOT EXISTS credit_activation_code_uses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_code_id UUID NOT NULL REFERENCES credit_activation_codes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  credits_granted INTEGER NOT NULL,
  transaction_id UUID REFERENCES credit_transactions(id) ON DELETE SET NULL,
  used_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_activation_code_uses_code_id ON credit_activation_code_uses(activation_code_id);
CREATE INDEX IF NOT EXISTS idx_activation_code_uses_user_id ON credit_activation_code_uses(user_id);
DELETE FROM credit_activation_code_uses a
USING credit_activation_code_uses b
WHERE a.id < b.id
  AND a.activation_code_id = b.activation_code_id
  AND a.user_id = b.user_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_activation_code_uses_user_code_unique ON credit_activation_code_uses(activation_code_id, user_id);
`;

const notificationTablesSQL = `
-- 通知主表
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'system',
  priority TEXT NOT NULL DEFAULT 'normal',
  target_type TEXT NOT NULL DEFAULT 'all',
  target_user_ids JSONB,
  status TEXT NOT NULL DEFAULT 'draft',
  published_at TIMESTAMP,
  expires_at TIMESTAMP,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

-- 用户通知关联表
CREATE TABLE IF NOT EXISTS user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, notification_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_notifications_user_notification ON user_notifications(user_id, notification_id);
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_id ON user_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_user_notifications_notification_id ON user_notifications(notification_id);
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_read ON user_notifications(user_id, is_read);
`;

const promoBannerTablesSQL = `
CREATE TABLE IF NOT EXISTS ui_promo_banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  placement TEXT NOT NULL DEFAULT 'sidebar_bubble',
  display_type TEXT NOT NULL DEFAULT 'single',
  status TEXT NOT NULL DEFAULT 'draft',
  priority INTEGER NOT NULL DEFAULT 0,
  allow_dismiss BOOLEAN NOT NULL DEFAULT TRUE,
  dismiss_reset_on_version BOOLEAN NOT NULL DEFAULT TRUE,
  start_at TIMESTAMP,
  end_at TIMESTAMP,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ui_promo_banners_placement ON ui_promo_banners(placement);
CREATE INDEX IF NOT EXISTS idx_ui_promo_banners_status ON ui_promo_banners(status);
CREATE INDEX IF NOT EXISTS idx_ui_promo_banners_priority ON ui_promo_banners(priority);
CREATE INDEX IF NOT EXISTS idx_ui_promo_banners_active_sort ON ui_promo_banners(placement, status, priority, updated_at);

CREATE TABLE IF NOT EXISTS ui_promo_banner_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banner_id UUID NOT NULL REFERENCES ui_promo_banners(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  subtitle TEXT,
  image_url TEXT,
  cta_text TEXT,
  link_type TEXT NOT NULL DEFAULT 'none',
  link_target TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ui_promo_banner_items_banner_id ON ui_promo_banner_items(banner_id);
CREATE INDEX IF NOT EXISTS idx_ui_promo_banner_items_sort_order ON ui_promo_banner_items(sort_order);

CREATE TABLE IF NOT EXISTS ui_promo_banner_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banner_id UUID NOT NULL REFERENCES ui_promo_banners(id) ON DELETE CASCADE,
  item_id UUID REFERENCES ui_promo_banner_items(id) ON DELETE SET NULL,
  user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ui_promo_banner_events_banner_id ON ui_promo_banner_events(banner_id);
CREATE INDEX IF NOT EXISTS idx_ui_promo_banner_events_user_id ON ui_promo_banner_events(user_id);
CREATE INDEX IF NOT EXISTS idx_ui_promo_banner_events_type ON ui_promo_banner_events(event_type);
`;

export async function inspectDatabaseSchemaReadiness(): Promise<SchemaReadinessReport> {
  await ensureDatabaseConnection({ retries: 3, delayMs: 500 });

  const [tableResult, columnResult, indexResult] = await Promise.all([
    databasePool.query<{ table_name: string }>(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
      `,
      [REQUIRED_TABLES]
    ),
    databasePool.query<{ table_name: string; column_name: string }>(
      `
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = any($1::text[])
      `,
      [Array.from(new Set(REQUIRED_COLUMNS.map(([tableName]) => tableName)))]
    ),
    databasePool.query<{ indexname: string; indexdef: string }>(
      `
        select indexname, indexdef
        from pg_indexes
        where schemaname = 'public'
          and indexname = any($1::text[])
      `,
      [REQUIRED_INDEXES]
    ),
  ]);

  const existingTables = new Set(tableResult.rows.map((row) => row.table_name));
  const existingColumns = new Set(
    columnResult.rows.map((row) => `${row.table_name}.${row.column_name}`)
  );
  const existingIndexes = new Set(indexResult.rows.map((row) => row.indexname));
  const indexDefinitions = new Map(indexResult.rows.map((row) => [row.indexname, row.indexdef]));
  const missing: string[] = [];

  for (const tableName of REQUIRED_TABLES) {
    if (!existingTables.has(tableName)) {
      missing.push(`table:${tableName}`);
    }
  }

  for (const [tableName, columnName] of REQUIRED_COLUMNS) {
    if (!existingColumns.has(`${tableName}.${columnName}`)) {
      missing.push(`column:${tableName}.${columnName}`);
    }
  }

  for (const indexName of REQUIRED_INDEXES) {
    if (!existingIndexes.has(indexName)) {
      missing.push(`index:${indexName}`);
    }
  }

  const cacheConfigActiveIndexDefinition = indexDefinitions.get('idx_cache_pricing_config_provider_active') || '';
  if (
    cacheConfigActiveIndexDefinition &&
    !cacheConfigActiveIndexDefinition.toLowerCase().includes('where (is_active = true)')
  ) {
    missing.push('index:idx_cache_pricing_config_provider_active(partial-active)');
  }

  return {
    ready: missing.length === 0,
    missing,
  };
}

/**
 * 运行数据库迁移
 */
export async function runMigration() {
  try {
    console.log('🚀 开始数据库迁移...');
    await ensureDatabaseConnection({ retries: 5, delayMs: 1200 });
    
    // 执行创建表的 SQL
    await db.execute(sql.raw(createTablesSQL));
    await db.execute(sql.raw(customApiTablesSQL));
    await db.execute(sql.raw(deliverableTablesSQL));
    await db.execute(sql.raw(backfillMessageStorageSQL));
    
    // Step 1: core billing tables
    await db.execute(sql.raw(billingCoreTablesSQL));

    // Step 2: activation code tables (separate - failure does not affect core billing)
    try {
      await db.execute(sql.raw(activationCodeTablesSQL));
    } catch (activationCodeErr) {
      console.error('[MIGRATION] activation code tables failed (non-fatal):', activationCodeErr);
    }

    // Step 3: notification tables (separate - failure does not affect billing)
    try {
      await db.execute(sql.raw(notificationTablesSQL));
    } catch (notificationErr) {
      console.error('[MIGRATION] notification tables failed (non-fatal):', notificationErr);
    }

    try {
      await db.execute(sql.raw(promoBannerTablesSQL));
    } catch (promoBannerErr) {
      console.error('[MIGRATION] promo banner tables failed (non-fatal):', promoBannerErr);
    }

    // 迁移：将定价基础单位从 1k tokens 切换到 1M tokens（必须在插入定价数据之前执行）
    await db.execute(sql.raw(`
      DO $$ BEGIN
        ALTER TABLE model_pricing RENAME COLUMN prompt_price_per_1k_tokens TO prompt_price_per_1m_tokens;
      EXCEPTION WHEN undefined_column THEN NULL;
      END $$;

      DO $$ BEGIN
        ALTER TABLE model_pricing RENAME COLUMN completion_price_per_1k_tokens TO completion_price_per_1m_tokens;
      EXCEPTION WHEN undefined_column THEN NULL;
      END $$;

      UPDATE model_pricing SET prompt_price_per_1m_tokens = prompt_price_per_1m_tokens * 1000
        WHERE prompt_price_per_1m_tokens < 1000;

      UPDATE model_pricing SET completion_price_per_1m_tokens = completion_price_per_1m_tokens * 1000
        WHERE completion_price_per_1m_tokens < 1000;
    `));

    // 插入当前使用的模型默认定价（如不存在）
    await db.execute(sql.raw(`
      WITH seed(model, model_provider, prompt_price_per_1m_tokens, completion_price_per_1m_tokens) AS (
        VALUES
          ('qwen3-max-2026-01-23', 'qwen', 25, 1000),
          ('qwen3-vl-plus', 'qwen', 50, 2000),
          ('claude-haiku-4-5-20251001', 'anthropic', 180, 9000),
          ('gpt-4o', 'openai', 1800, 72000),
          ('gpt-4o-mini', 'openai', 180, 7200),
          ('agent.lite', 'agent', 25, 1000),
          ('agent.pro', 'agent', 180, 9000),
          ('agent.max', 'agent', 1800, 72000),
          ('sandbox.opencode', 'sandbox', 25, 1000),
          ('sandbox.codex', 'sandbox', 180, 9000)
      )
      INSERT INTO model_pricing (model, model_provider, prompt_price_per_1m_tokens, completion_price_per_1m_tokens, is_active, effective_from)
      SELECT seed.model, seed.model_provider, seed.prompt_price_per_1m_tokens, seed.completion_price_per_1m_tokens, true, NOW()
      FROM seed
      WHERE NOT EXISTS (
        SELECT 1
        FROM model_pricing existing
        WHERE existing.model = seed.model
          AND existing.is_active = TRUE
          AND existing.effective_from <= NOW()
          AND (existing.effective_until IS NULL OR existing.effective_until > NOW())
      );

      UPDATE model_pricing
      SET model_provider = 'qwen', updated_at = NOW()
      WHERE LOWER(model) LIKE 'qwen%';
    `));

    // 迁移：添加 multiplier 列
    await db.execute(sql.raw(`
      ALTER TABLE model_pricing ADD COLUMN IF NOT EXISTS multiplier REAL NOT NULL DEFAULT 1.0;
    `));

    // Post-migration verification: ensure critical tables actually exist
    const postCheck = await inspectDatabaseSchemaReadiness();
    if (!postCheck.ready) {
      const criticalMissing = postCheck.missing.filter(m =>
        m.startsWith('table:') || m.startsWith('column:model_pricing')
      );
      if (criticalMissing.length > 0) {
        console.error('[MIGRATION] Post-migration check failed, still missing:', criticalMissing.join(', '));
        throw new Error(`Migration incomplete: ${criticalMissing.join(', ')}`);
      }
      console.warn('[MIGRATION] Post-migration check: non-critical items still missing:', postCheck.missing.join(', '));
    }

    console.log('✅ 数据库迁移完成！');
    
    return true;
  } catch (error) {
    console.error('❌ 数据库迁移失败:', error);
    throw error;
  }
}

export async function runConnectorMigration() {
  try {
    await ensureDatabaseConnection({ retries: 5, delayMs: 1200 });
    await db.execute(sql.raw(connectorTablesSQL));
    await db.execute(sql.raw(customApiTablesSQL));
    return true;
  } catch (error) {
    console.error('❌ 连接器表迁移失败:', error);
    throw error;
  }
}

export async function ensurePlatformSkillGovernanceSchema() {
  await ensureDatabaseConnection({ retries: 5, delayMs: 1200 });
  await db.execute(
    sql.raw(`
      ALTER TABLE platform_skills
        ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;
    `)
  );
}

/**
 * 删除所有表（谨慎使用）
 */
export async function dropAllTables() {
  try {
    console.log('⚠️  开始删除所有表...');
    await ensureDatabaseConnection({ retries: 5, delayMs: 1200 });
    
    await db.execute(sql.raw(`
      DROP TABLE IF EXISTS search_records CASCADE;
      DROP TABLE IF EXISTS execution_plans CASCADE;
      DROP TABLE IF EXISTS task_descriptions CASCADE;
      DROP TABLE IF EXISTS intent_recognition_results CASCADE;
      DROP TABLE IF EXISTS conversation_messages CASCADE;
      DROP TABLE IF EXISTS task_session_recent_messages CASCADE;
      DROP TABLE IF EXISTS task_session_workspace_cache CASCADE;
      DROP TABLE IF EXISTS task_session_deliverable_artifacts CASCADE;
      DROP TABLE IF EXISTS sandbox_execution_environments CASCADE;
      DROP TABLE IF EXISTS task_session_connector_guides CASCADE;
      DROP TABLE IF EXISTS connector_guide_revisions CASCADE;
      DROP TABLE IF EXISTS connector_guide_policies CASCADE;
      DROP TABLE IF EXISTS task_session_connector_bindings CASCADE;
      DROP TABLE IF EXISTS connector_auth_requests CASCADE;
      DROP TABLE IF EXISTS platform_runtime_artifact_channels CASCADE;
      DROP TABLE IF EXISTS platform_runtime_artifact_releases CASCADE;
      DROP TABLE IF EXISTS user_custom_skill_documents CASCADE;
      DROP TABLE IF EXISTS user_custom_skills CASCADE;
      DROP TABLE IF EXISTS user_platform_skill_bindings CASCADE;
      DROP TABLE IF EXISTS app_user_legacy_id_mappings CASCADE;
      DROP TABLE IF EXISTS user_connector_accounts CASCADE;
      DROP TABLE IF EXISTS task_creation_sessions CASCADE;
    `));
    
    console.log('✅ 所有表已删除');
    return true;
  } catch (error) {
    console.error('❌ 删除表失败:', error);
    throw error;
  }
}
