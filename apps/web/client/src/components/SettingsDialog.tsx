import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearch } from 'wouter';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { normalizeLanguage } from '@/i18n';
import {
  ChevronLeft,
  Copy,
  KeyRound,
  LogOut,
  Mail,
  Pencil,
  Plug,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import { ConnectorCenterPanel } from '@/components/ConnectorCenterPanel';
import { UserSkillSettingsPanel } from '@/components/UserSkillSettingsPanel';
import { getCodexRuntimeConfig, updateCodexRuntimeConfig } from '@/lib/task-creation-client';
import { ALTUS_MODE_STORAGE_KEY, DEFAULT_ALTUS_MODE, readAltusMode, type AltusMode } from '@/lib/altus-settings';
import { toast } from 'sonner';
import {
  OPEN_SETTINGS_DIALOG_EVENT,
  type OpenSettingsDialogDetail,
  type SettingsTab,
} from '@/lib/settings-dialog-events';
import type { ConnectorKey } from '@/lib/connectors-client';
import { useAuth } from '@/contexts/AuthContext';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: SettingsTab;
  onActiveTabChange: (tab: SettingsTab) => void;
  connectorTargetSessionId?: string | null;
  highlightedConnector?: ConnectorKey | null;
}

type SettingsPanelProps = {
  activeTab: SettingsTab;
  onActiveTabChange: (tab: SettingsTab) => void;
  connectorTargetSessionId?: string | null;
  highlightedConnector?: ConnectorKey | null;
};

const SETTINGS_TABS: SettingsTab[] = ['account', 'model', 'settings', 'skills', 'connectors'];
const DEFAULT_CODEX_BASE_URL = 'https://llmapi.oneceo.ai';
const DEFAULT_CODEX_MODEL = 'gpt-5.3-codex';
const DEFAULT_CODEX_API_KEY = 'sk-2ea35443a67d931ba178743b155f9627b8e2f81e5bc531d727f53172c3aa5555';
const ACCOUNT_AVATAR_TONES = [
  'bg-emerald-500',
  'bg-sky-500',
  'bg-fuchsia-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
];

function isSettingsTab(value: string | null | undefined): value is SettingsTab {
  return Boolean(value && SETTINGS_TABS.includes(value as SettingsTab));
}

function getAccountInitial(value: string | null | undefined) {
  const source = (value || '').trim();
  return (source.slice(0, 1) || 'U').toUpperCase();
}

function getAccountAvatarTone(seed: string | null | undefined) {
  const value = (seed || '').trim();
  if (!value) {
    return ACCOUNT_AVATAR_TONES[0];
  }
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return ACCOUNT_AVATAR_TONES[hash % ACCOUNT_AVATAR_TONES.length];
}

function getReadableAccountStatus(status: string | undefined, fallback: string) {
  if (!status) {
    return fallback;
  }
  if (status === 'active') {
    return fallback;
  }
  return status.replace(/[_-]/g, ' ');
}

export function SettingsPanel({
  activeTab,
  onActiveTabChange,
  connectorTargetSessionId,
  highlightedConnector,
}: SettingsPanelProps) {
  const { t, i18n } = useTranslation();
  const [, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(true);
  const [theme, setTheme] = useState('light');
  const [executor, setExecutor] = useState('opencode');
  const [codexExecutionMode, setCodexExecutionMode] = useState('sdk');
  const [codexBaseUrl, setCodexBaseUrl] = useState(DEFAULT_CODEX_BASE_URL);
  const [codexModel, setCodexModel] = useState(DEFAULT_CODEX_MODEL);
  const [codexApiKey, setCodexApiKey] = useState(DEFAULT_CODEX_API_KEY);
  const [codexConfigToml, setCodexConfigToml] = useState('');
  const [codexAuthJson, setCodexAuthJson] = useState('');
  const [codexConfigDirty, setCodexConfigDirty] = useState(false);
  const [codexAuthDirty, setCodexAuthDirty] = useState(false);
  const [codexConfigLoading, setCodexConfigLoading] = useState(false);
  const [codexConfigSaving, setCodexConfigSaving] = useState(false);
  const [codexConfigError, setCodexConfigError] = useState('');
  const [codexConfigUpdatedAt, setCodexConfigUpdatedAt] = useState('');
  const [codexConfigLoaded, setCodexConfigLoaded] = useState(false);
  const [accountDisplayNameDraft, setAccountDisplayNameDraft] = useState('');
  const [accountView, setAccountView] = useState<'overview' | 'details'>('overview');
  // Altus 控制模式：
  // - sandbox: 直通模式，前端输入直接转发到 sandbox 内执行器（当前为 OpenCode）。
  // - managed: Altus 接管模式，走三层智能体编排。
  // 预留后续 claudecode/codex 直通模式扩展，保持此枚举语义稳定。
  const [altusMode, setAltusMode] = useState<AltusMode>(DEFAULT_ALTUS_MODE);
  const accountNameInputRef = useRef<HTMLInputElement | null>(null);
  const EXECUTOR_STORAGE_KEY = 'altus_executor';
  const CODEX_EXECUTION_MODE_STORAGE_KEY = 'codex_execution_mode';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedExecutor = window.localStorage.getItem(EXECUTOR_STORAGE_KEY);
    const storedCodexExecutionMode = window.localStorage.getItem(CODEX_EXECUTION_MODE_STORAGE_KEY);
    if (storedExecutor) {
      setExecutor(storedExecutor);
    } else {
      window.localStorage.setItem(EXECUTOR_STORAGE_KEY, executor);
    }
    setAltusMode(readAltusMode());
    if (storedCodexExecutionMode === 'sdk' || storedCodexExecutionMode === 'ws') {
      setCodexExecutionMode(storedCodexExecutionMode);
    } else {
      window.localStorage.setItem(CODEX_EXECUTION_MODE_STORAGE_KEY, codexExecutionMode);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(EXECUTOR_STORAGE_KEY, executor);
    window.localStorage.setItem(ALTUS_MODE_STORAGE_KEY, altusMode);
    window.localStorage.setItem(CODEX_EXECUTION_MODE_STORAGE_KEY, codexExecutionMode);
    window.dispatchEvent(
      new CustomEvent('altus-settings-changed', {
        detail: { executor, altusMode, codexExecutionMode },
      })
    );
  }, [executor, altusMode, codexExecutionMode]);

  const shouldShowExecutorSettings = altusMode === 'sandbox';
  const shouldShowCodexLlmSettings = executor === 'codex' && altusMode === 'sandbox';
  const accountInitial = getAccountInitial(user?.displayName || user?.email);
  const accountAvatarTone = getAccountAvatarTone(user?.email || user?.displayName);
  const accountStatusText = getReadableAccountStatus(user?.status, t('account.statusActive'));
  const currentLanguage = normalizeLanguage(i18n.resolvedLanguage || i18n.language);
  const accountDisplayNameChanged =
    accountDisplayNameDraft.trim() !== (user?.displayName || '').trim();

  const handleLanguageChange = (lang: string) => {
    void i18n.changeLanguage(normalizeLanguage(lang));
  };

  useEffect(() => {
    if (!shouldShowCodexLlmSettings || codexConfigLoaded) return;
    let cancelled = false;
    setCodexConfigLoading(true);
    setCodexConfigError('');
    getCodexRuntimeConfig()
      .then((config) => {
        if (cancelled) return;
        setCodexBaseUrl(config.baseUrl || DEFAULT_CODEX_BASE_URL);
        setCodexModel(config.model || DEFAULT_CODEX_MODEL);
        setCodexApiKey(config.apiKey || DEFAULT_CODEX_API_KEY);
        setCodexConfigToml(config.configToml || '');
        setCodexAuthJson(config.authJson || '');
        setCodexConfigUpdatedAt(config.updatedAt || '');
        setCodexConfigDirty(false);
        setCodexAuthDirty(false);
        setCodexConfigLoaded(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setCodexConfigError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setCodexConfigLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [codexConfigLoaded, shouldShowCodexLlmSettings]);

  useEffect(() => {
    if (codexConfigDirty) return;
    setCodexConfigToml(
      [
        'model_provider = "OpenAI"',
        `model = ${JSON.stringify(codexModel || DEFAULT_CODEX_MODEL)}`,
        `review_model = ${JSON.stringify(codexModel || DEFAULT_CODEX_MODEL)}`,
        'model_reasoning_effort = "high"',
        'disable_response_storage = true',
        'network_access = "enabled"',
        'windows_wsl_setup_acknowledged = true',
        'model_context_window = 1000000',
        'model_auto_compact_token_limit = 900000',
        '',
        '[model_providers.OpenAI]',
        'name = "OpenAI"',
        `base_url = ${JSON.stringify(codexBaseUrl || DEFAULT_CODEX_BASE_URL)}`,
        'wire_api = "responses"',
        'supports_websockets = true',
        'requires_openai_auth = true',
        '',
        '[features]',
        'responses_websockets_v2 = true',
        '',
      ].join('\n')
    );
  }, [codexBaseUrl, codexModel, codexConfigDirty]);

  useEffect(() => {
    if (codexAuthDirty) return;
    setCodexAuthJson(
      JSON.stringify(
        {
          OPENAI_API_KEY: codexApiKey || DEFAULT_CODEX_API_KEY,
        },
        null,
        2
      )
    );
  }, [codexApiKey, codexAuthDirty]);

  useEffect(() => {
    setAccountDisplayNameDraft(user?.displayName || '');
  }, [user?.displayName]);

  useEffect(() => {
    if (activeTab !== 'account') {
      setAccountView('overview');
    }
  }, [activeTab]);

  const handleSaveCodexConfig = async () => {
    try {
      setCodexConfigSaving(true);
      setCodexConfigError('');
      const saved = await updateCodexRuntimeConfig({
        baseUrl: codexBaseUrl,
        model: codexModel,
        apiKey: codexApiKey,
        configToml: codexConfigToml,
        authJson: codexAuthJson,
      });
      setCodexBaseUrl(saved.baseUrl || DEFAULT_CODEX_BASE_URL);
      setCodexModel(saved.model || DEFAULT_CODEX_MODEL);
      setCodexApiKey(saved.apiKey || DEFAULT_CODEX_API_KEY);
      setCodexConfigToml(saved.configToml || '');
      setCodexAuthJson(saved.authJson || '');
      setCodexConfigUpdatedAt(saved.updatedAt || '');
      setCodexConfigDirty(false);
      setCodexAuthDirty(false);
      setCodexConfigLoaded(true);
    } catch (error) {
      setCodexConfigError(error instanceof Error ? error.message : String(error));
    } finally {
      setCodexConfigSaving(false);
    }
  };

  const handleCopyUserId = async () => {
    if (!user?.id) return;
    try {
      await navigator.clipboard.writeText(user.id);
      toast.success(t('account.userIdCopied'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('account.userIdCopyFailed'));
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      toast.success(t('account.logoutSuccess'));
      setLocation('/login');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('account.logoutFailed'));
    }
  };

  const handleUnavailableAction = (message: string) => {
    toast.error(message);
  };

  const handleOpenAccountDetails = () => {
    setAccountView('details');
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        accountNameInputRef.current?.focus();
      }, 0);
    }
  };

  return (
    <div className="h-full">
      <Tabs
        value={activeTab}
        onValueChange={(value) => onActiveTabChange(value as SettingsTab)}
        className="h-full"
      >
        <div className="flex h-full flex-col md:flex-row">
          <aside className="md:w-[240px] shrink-0 border-b md:border-b-0 md:border-r border-border bg-muted/30 flex flex-col min-h-0">
            <div className="hidden md:flex items-center px-6 pt-6 pb-4">
              <div className="text-base font-semibold text-foreground">{t('settings.title')}</div>
            </div>
            <div className="px-4 md:px-3 pb-4 md:pb-6 flex-1 min-h-0">
              <TabsList className="flex h-full flex-shrink-0 items-start justify-start self-stretch px-1.5 overflow-x-auto md:overflow-x-visible md:overflow-y-auto w-full md:flex-col md:gap-3 gap-3 bg-transparent">
                <div className="flex md:gap-2 gap-3 md:flex-col items-start self-stretch">
                  <TabsTrigger
                    value="account"
                    className="flex px-2 py-2.5 items-center text-[14px] leading-5 text-foreground max-md:whitespace-nowrap md:h-9 md:gap-2 md:self-stretch md:px-4 md:rounded-lg hover:bg-muted/60 data-[state=active]:bg-muted/60 data-[state=active]:font-medium max-md:border-b-2 max-md:border-foreground"
                  >
                    <span className="hidden md:block text-muted-foreground data-[state=active]:text-foreground">
                      <UserRound className="h-4 w-4" />
                    </span>
                    <span className="truncate">{t('settings.accountTab')}</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="model"
                    className="flex px-2 py-2.5 items-center text-[14px] leading-5 text-foreground max-md:whitespace-nowrap md:h-9 md:gap-2 md:self-stretch md:px-4 md:rounded-lg hover:bg-muted/60 data-[state=active]:bg-muted/60 data-[state=active]:font-medium max-md:border-b-2 max-md:border-foreground"
                  >
                    <span className="hidden md:block text-muted-foreground data-[state=active]:text-foreground">
                      <SlidersHorizontal className="h-4 w-4" />
                    </span>
                    <span className="truncate">{t('settings.modelTab')}</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="settings"
                    className="flex px-2 py-2.5 items-center text-[14px] leading-5 text-foreground max-md:whitespace-nowrap md:h-9 md:gap-2 md:self-stretch md:px-4 md:rounded-lg hover:bg-muted/60 data-[state=active]:bg-muted/60 data-[state=active]:font-medium max-md:border-b-2 max-md:border-foreground"
                  >
                    <span className="hidden md:block text-muted-foreground data-[state=active]:text-foreground">
                      <Settings2 className="h-4 w-4" />
                    </span>
                    <span className="truncate">{t('settings.settingsTab')}</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="skills"
                    className="flex px-2 py-2.5 items-center text-[14px] leading-5 text-foreground max-md:whitespace-nowrap md:h-9 md:gap-2 md:self-stretch md:px-4 md:rounded-lg hover:bg-muted/60 data-[state=active]:bg-muted/60 data-[state=active]:font-medium max-md:border-b-2 max-md:border-foreground"
                  >
                    <span className="hidden md:block text-muted-foreground data-[state=active]:text-foreground">
                      <Wrench className="h-4 w-4" />
                    </span>
                    <span className="truncate">{t('settings.skillsTab')}</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="connectors"
                    className="flex px-2 py-2.5 items-center text-[14px] leading-5 text-foreground max-md:whitespace-nowrap md:h-9 md:gap-2 md:self-stretch md:px-4 md:rounded-lg hover:bg-muted/60 data-[state=active]:bg-muted/60 data-[state=active]:font-medium max-md:border-b-2 max-md:border-foreground"
                  >
                    <span className="hidden md:block text-muted-foreground data-[state=active]:text-foreground">
                      <Plug className="h-4 w-4" />
                    </span>
                    <span className="truncate">{t('settings.connectorsTab')}</span>
                  </TabsTrigger>
                </div>
              </TabsList>
            </div>
          </aside>

          <div className="flex-1 min-w-0 flex flex-col bg-background">
            <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8 md:py-8 space-y-10">
              {/* Settings Tab */}
              <TabsContent value="settings" className="space-y-8 mt-0">
                <div className="space-y-4 pb-6 border-b border-border/60">
                  <div>
                    <Label className="text-sm font-medium">{t('settings.languageLabel')}</Label>
                    <p className="text-sm text-muted-foreground">{t('settings.languageDescription')}</p>
                  </div>
                  <Select value={currentLanguage} onValueChange={handleLanguageChange}>
                    <SelectTrigger className="w-full max-w-xs rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="zh" className="rounded-md">
                        {t('settings.chinese')}
                      </SelectItem>
                      <SelectItem value="en" className="rounded-md">
                        {t('settings.english')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-4 pb-6 border-b border-border/60">
                  <div>
                    <Label className="text-sm font-medium">{t('settings.themeLabel')}</Label>
                    <p className="text-sm text-muted-foreground">{t('settings.themeDescription')}</p>
                  </div>
                  <Select value={theme} onValueChange={setTheme}>
                    <SelectTrigger className="w-full max-w-xs rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="light" className="rounded-md">
                        {t('settings.light')}
                      </SelectItem>
                      <SelectItem value="dark" className="rounded-md">
                        {t('settings.dark')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium">{t('settings.notificationsLabel')}</Label>
                    <p className="text-sm text-muted-foreground">{t('settings.notificationsDescription')}</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="email-notifications" className="text-sm">
                      {t('settings.emailNotifications')}
                    </Label>
                    <Switch
                      id="email-notifications"
                      checked={emailNotifications}
                      onCheckedChange={setEmailNotifications}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="push-notifications" className="text-sm">
                      {t('settings.pushNotifications')}
                    </Label>
                    <Switch
                      id="push-notifications"
                      checked={pushNotifications}
                      onCheckedChange={setPushNotifications}
                    />
                  </div>
                </div>
              </TabsContent>

              {/* Model Tab */}
              <TabsContent value="model" className="space-y-8 mt-0">
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium">{t('settings.altusControlLabel')}</Label>
                    <p className="text-sm text-muted-foreground">{t('settings.altusControlDescription')}</p>
                  </div>
                  <Select value={altusMode} onValueChange={(value) => setAltusMode(value as AltusMode)}>
                    <SelectTrigger className="w-full max-w-xs rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="sandbox" className="rounded-md">
                        {t('settings.altusSandboxDirect')}
                      </SelectItem>
                      <SelectItem value="managed" className="rounded-md">
                        {t('settings.altusManaged')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {shouldShowExecutorSettings ? (
                  <div className="space-y-4 border-t border-border/60 pt-6">
                    <div>
                      <Label className="text-sm font-medium">{t('settings.executorLabel')}</Label>
                      <p className="text-sm text-muted-foreground">{t('settings.executorDescription')}</p>
                    </div>
                    <Select value={executor} onValueChange={setExecutor}>
                      <SelectTrigger className="w-full max-w-xs rounded-xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        <SelectItem value="opencode" className="rounded-md">
                          {t('settings.executorOpencode')}
                        </SelectItem>
                        <SelectItem value="claudecode" className="rounded-md">
                          {t('settings.executorClaudecode')}
                        </SelectItem>
                        <SelectItem value="codex" className="rounded-md">
                          {t('settings.executorCodex')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {executor === 'codex' && altusMode === 'sandbox' ? (
                    <div className="space-y-4 rounded-2xl border border-border/60 bg-muted/20 p-4">
                      <div>
                        <Label className="text-sm font-medium">{t('settings.codexModeLabel')}</Label>
                        <p className="text-sm text-muted-foreground">{t('settings.codexModeDescription')}</p>
                      </div>
                      <Select value={codexExecutionMode} onValueChange={setCodexExecutionMode}>
                        <SelectTrigger className="w-full max-w-xs rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          <SelectItem value="sdk" className="rounded-md">
                            {t('settings.codexModeSdk')}
                          </SelectItem>
                          <SelectItem value="ws" className="rounded-md">
                            {t('settings.codexModeWs')}
                          </SelectItem>
                        </SelectContent>
                      </Select>

                      <div className="space-y-4 rounded-2xl border border-border/60 bg-background/80 p-4">
                        <div className="space-y-1">
                          <Label className="text-sm font-medium">{t('settings.codexLlmSettingsLabel')}</Label>
                          <p className="text-sm text-muted-foreground">
                            {t('settings.codexLlmSettingsDescription')}
                          </p>
                          <p className="text-xs text-amber-600">
                            {t('settings.codexLlmTodo')}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t('settings.codexLlmSandboxOnly')}
                          </p>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label className="text-sm">{t('settings.codexLlmBaseUrl')}</Label>
                            <Input
                              value={codexBaseUrl}
                              onChange={(event) => setCodexBaseUrl(event.target.value)}
                              placeholder={DEFAULT_CODEX_BASE_URL}
                              className="rounded-xl"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm">{t('settings.codexLlmModel')}</Label>
                            <Input
                              value={codexModel}
                              onChange={(event) => setCodexModel(event.target.value)}
                              placeholder={DEFAULT_CODEX_MODEL}
                              className="rounded-xl"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-sm">{t('settings.codexLlmApiKey')}</Label>
                          <Input
                            value={codexApiKey}
                            onChange={(event) => setCodexApiKey(event.target.value)}
                            placeholder="sk-..."
                            className="rounded-xl"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label className="text-sm">{t('settings.codexConfigTomlLabel')}</Label>
                          <Textarea
                            value={codexConfigToml}
                            onChange={(event) => {
                              setCodexConfigToml(event.target.value);
                              setCodexConfigDirty(true);
                            }}
                            rows={12}
                            className="rounded-xl font-mono text-xs"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label className="text-sm">{t('settings.codexAuthJsonLabel')}</Label>
                          <Textarea
                            value={codexAuthJson}
                            onChange={(event) => {
                              setCodexAuthJson(event.target.value);
                              setCodexAuthDirty(true);
                            }}
                            rows={8}
                            className="rounded-xl font-mono text-xs"
                          />
                        </div>

                        {codexConfigError ? (
                          <p className="text-sm text-destructive">{codexConfigError}</p>
                        ) : null}

                        {codexConfigUpdatedAt ? (
                          <p className="text-xs text-muted-foreground">
                            {t('settings.codexLlmUpdatedAt')}: {codexConfigUpdatedAt}
                          </p>
                        ) : null}

                        <div className="flex items-center gap-3">
                          <Button
                            type="button"
                            onClick={handleSaveCodexConfig}
                            disabled={codexConfigLoading || codexConfigSaving}
                            className="rounded-xl bg-foreground hover:bg-foreground/90 text-background"
                          >
                            {codexConfigSaving ? t('common.loading') : t('common.save')}
                          </Button>
                          {codexConfigLoading ? (
                            <span className="text-sm text-muted-foreground">{t('common.loading')}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                ) : null}
              </TabsContent>

              {/* Account Tab */}
              <TabsContent value="account" className="mt-0 h-full">
                <div className="flex min-h-full flex-col px-0 md:px-2">
                  <div className="flex min-h-full w-full flex-1 flex-col md:mx-auto md:max-w-[768px]">
                    <div className="flex flex-1 flex-col items-start self-stretch pb-4 pt-2 md:pt-2">
                      {accountView === 'overview' ? (
                        <div className="flex w-full flex-col gap-5">
                          <div className="flex flex-col justify-between gap-4 border-b border-border/60 pb-6 md:flex-row md:items-center">
                            <div className="flex min-w-0 flex-1 items-center gap-4">
                              <Avatar className="h-16 w-16 border border-border/70">
                                <AvatarImage
                                  src={user?.email ? `https://avatar.vercel.sh/${encodeURIComponent(user.email)}` : undefined}
                                  alt={user?.displayName || user?.email || t('account.title')}
                                />
                                <AvatarFallback
                                  className={cn(
                                    'text-[32px] font-bold text-white',
                                    accountAvatarTone
                                  )}
                                >
                                  {accountInitial}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[22px] font-semibold leading-[28px] text-foreground">
                                  {user?.displayName || user?.email || t('account.unknownUser')}
                                </div>
                                <div className="truncate pt-1 text-sm leading-6 text-muted-foreground">
                                  {user?.email || t('account.noEmail')}
                                </div>
                              </div>
                            </div>

                            <div className="flex gap-2 self-start md:self-center">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={handleOpenAccountDetails}
                                className="h-9 w-9 rounded-lg border-border bg-background shadow-none"
                                aria-label={t('account.editProfile')}
                              >
                                <Pencil className="h-4 w-4 text-muted-foreground" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => void handleLogout()}
                                className="h-9 w-9 rounded-lg border-border bg-background text-destructive shadow-none"
                                aria-label={t('account.logout')}
                              >
                                <LogOut className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          <div className="rounded-lg border border-border bg-muted/20 px-4">
                            <div className="flex flex-col gap-3 border-b border-border/70 py-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex flex-col gap-1">
                                <div className="text-base font-semibold leading-6 text-foreground">
                                  {t('account.planFree')}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {t('account.planDescription')}
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() =>
                                  handleUnavailableAction(t('account.upgradeUnavailable'))
                                }
                                className="h-8 rounded-lg border-foreground bg-foreground px-3 text-sm text-background hover:bg-foreground/90 hover:text-background"
                              >
                                {t('account.upgrade')}
                              </Button>
                            </div>

                            <div className="grid gap-4 py-4 sm:grid-cols-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                                  <span>{t('account.accountStatus')}</span>
                                </div>
                                <div className="text-sm text-muted-foreground">{accountStatusText}</div>
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                  <Mail className="h-4 w-4 text-muted-foreground" />
                                  <span>{t('account.authMethod')}</span>
                                </div>
                                <div className="text-sm text-muted-foreground">{t('account.authMethodEmail')}</div>
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                                  <span>{t('account.sessionIsolation')}</span>
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {t('account.sessionIsolationEnabled')}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex w-full flex-col gap-5">
                          <div className="flex items-center gap-3 border-b border-border/60 pb-5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setAccountView('overview')}
                              className="h-8 w-8 rounded-md"
                              aria-label={t('account.backToOverview')}
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <div>
                              <div className="text-lg font-semibold leading-6 text-foreground">
                                {t('account.detailsTitle')}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {t('account.detailsDescription')}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col">
                            <div className="flex flex-col gap-6 border-b border-border/60 py-4 sm:flex-row sm:items-center">
                              <div className="group relative h-20 w-20 overflow-hidden rounded-full border border-border/70">
                                <Avatar className="h-20 w-20 rounded-full">
                                  <AvatarImage
                                    src={user?.email ? `https://avatar.vercel.sh/${encodeURIComponent(user.email)}` : undefined}
                                    alt={user?.displayName || user?.email || t('account.title')}
                                  />
                                  <AvatarFallback
                                    className={cn(
                                      'text-[40px] font-bold text-white',
                                      accountAvatarTone
                                    )}
                                  >
                                    {accountInitial}
                                  </AvatarFallback>
                                </Avatar>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUnavailableAction(t('account.avatarUploadUnavailable'))
                                  }
                                  className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                                  aria-label={t('account.editAvatar')}
                                >
                                  <Pencil className="h-5 w-5 text-white" />
                                </button>
                              </div>

                              <div className="flex min-w-0 flex-1 flex-col gap-2">
                                <span className="text-sm leading-6 text-muted-foreground">
                                  {t('account.usernameLabel')}
                                </span>
                                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                                  <div className="group flex h-10 flex-1 items-center gap-3 rounded-lg border border-border bg-muted/30 px-4">
                                    <input
                                      ref={accountNameInputRef}
                                      maxLength={20}
                                      value={accountDisplayNameDraft}
                                      onChange={(event) => setAccountDisplayNameDraft(event.target.value)}
                                      className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
                                      placeholder={t('account.usernamePlaceholder')}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setAccountDisplayNameDraft('')}
                                      className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                                      aria-label={t('account.clearDisplayName')}
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() =>
                                      handleUnavailableAction(t('account.profileUpdateUnavailable'))
                                    }
                                    disabled={!accountDisplayNameChanged}
                                    className="h-10 rounded-lg px-4"
                                  >
                                    {t('account.updateProfile')}
                                  </Button>
                                </div>
                                <p className="text-xs leading-5 text-muted-foreground">
                                  {t('account.profileUpdateHint')}
                                </p>
                              </div>
                            </div>

                            <div className="flex flex-col gap-3 border-b border-border/60 py-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex flex-col gap-1">
                                <div className="text-sm leading-6 text-foreground">
                                  {t('account.emailLabel')}
                                </div>
                                <div className="break-all text-xs text-muted-foreground">
                                  {user?.email || t('account.noEmail')}
                                </div>
                              </div>
                              <div className="flex gap-2 sm:justify-end">
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled
                                  className="h-8 rounded-lg px-3 text-sm"
                                >
                                  {t('account.emailReadonly')}
                                </Button>
                              </div>
                            </div>

                            <div className="flex flex-col gap-3 border-b border-border/60 py-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex flex-col gap-1">
                                <div className="text-sm leading-6 text-foreground">
                                  {t('account.userIdLabel')}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span className="break-all">{user?.id || t('account.noUserId')}</span>
                                  {user?.id ? (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      onClick={() => void handleCopyUserId()}
                                      className="h-6 w-6 rounded-md"
                                      aria-label={t('account.copyUserId')}
                                    >
                                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-col gap-3 border-b border-border/60 py-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex flex-col gap-1">
                                <div className="text-sm leading-6 text-foreground">
                                  {t('account.changePasswordLabel')}
                                </div>
                                <div className="flex items-center gap-1.5 pt-1">
                                  {Array.from({ length: 10 }).map((_, index) => (
                                    <span
                                      key={`account-password-dot-${index}`}
                                      className="h-2 w-2 rounded-full bg-muted-foreground/70"
                                    />
                                  ))}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {t('account.passwordHint')}
                                </div>
                              </div>
                              <div className="flex gap-2 sm:justify-end">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() =>
                                    handleUnavailableAction(t('account.passwordUpdateUnavailable'))
                                  }
                                  className="h-8 rounded-lg px-3 text-sm"
                                >
                                  <KeyRound className="h-4 w-4" />
                                  {t('account.changePassword')}
                                </Button>
                              </div>
                            </div>

                            <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex flex-col gap-1">
                                <div className="text-sm leading-6 text-foreground">
                                  {t('account.deleteAccount')}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {t('account.deleteAccountWarning')}
                                </div>
                              </div>
                              <div className="flex gap-2 sm:justify-end">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() =>
                                    handleUnavailableAction(t('account.deleteAccountUnavailable'))
                                  }
                                  className="h-8 rounded-lg border-destructive/40 px-3 text-sm text-destructive hover:bg-destructive/8 hover:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  {t('account.deleteAccount')}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="skills" className="space-y-8 mt-0">
                <UserSkillSettingsPanel onError={(message) => toast.error(message)} />
              </TabsContent>

              <TabsContent value="connectors" className="mt-0 h-full">
                <ConnectorCenterPanel
                  targetSessionId={connectorTargetSessionId}
                  highlightedConnector={highlightedConnector}
                />
              </TabsContent>
            </div>
          </div>
        </div>
      </Tabs>
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  activeTab,
  onActiveTabChange,
  connectorTargetSessionId,
  highlightedConnector,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col w-[min(921px,calc(100vw-32px))] max-w-[921px] md:w-[min(973px,calc(100vw-32px))] md:max-w-[973px] h-[min(576px,calc(100vh-64px))] md:h-[min(608px,calc(100vh-64px))] rounded-[28px] p-0 overflow-hidden border shadow-xl"
      >
        <button
          onClick={() => onOpenChange(false)}
          className="absolute right-6 top-6 z-10 rounded-md p-1 hover:bg-muted transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="flex-1 min-h-0">
          <SettingsPanel
            activeTab={activeTab}
            onActiveTabChange={onActiveTabChange}
            connectorTargetSessionId={connectorTargetSessionId}
            highlightedConnector={highlightedConnector}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function GlobalSettingsDialogHost() {
  const [location] = useLocation();
  const search = useSearch();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>('settings');
  const [connectorTargetSessionId, setConnectorTargetSessionId] = useState<string | null>(null);
  const [highlightedConnector, setHighlightedConnector] = useState<ConnectorKey | null>(null);

  const searchState = useMemo(() => {
    const params = new URLSearchParams(search);
    const callbackPath = new URL(location, window.location.origin).pathname;
    const hasOauthCallbackParams = Boolean(params.get('code')) && Boolean(params.get('state'));
    const isNotionCallback = callbackPath === '/notion/callback' && hasOauthCallbackParams;
    const isSlackCallback = callbackPath === '/slack/callback' && hasOauthCallbackParams;
    return {
      shouldOpen:
        params.get('settings') === 'open' ||
        params.get('settingsTab') === 'connectors' ||
        params.get('connector_oauth') === '1' ||
        isNotionCallback ||
        isSlackCallback,
      settingsTab: isNotionCallback || isSlackCallback ? 'connectors' : params.get('settingsTab'),
      targetSessionId: params.get('targetSessionId'),
      connector: isNotionCallback ? 'notion' : isSlackCallback ? 'slack' : params.get('connector'),
    };
  }, [location, search]);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail =
        (event as CustomEvent<OpenSettingsDialogDetail>).detail || {};
      setOpen(true);
      setActiveTab(detail.tab || 'settings');
      setConnectorTargetSessionId(detail.targetSessionId || null);
      setHighlightedConnector((detail.connectorKey as ConnectorKey | null) || null);
    };
    window.addEventListener(OPEN_SETTINGS_DIALOG_EVENT, handleOpen as EventListener);
    return () => {
      window.removeEventListener(OPEN_SETTINGS_DIALOG_EVENT, handleOpen as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!searchState.shouldOpen) return;
    setOpen(true);
    setActiveTab(
      isSettingsTab(searchState.settingsTab) ? searchState.settingsTab : 'connectors'
    );
    setConnectorTargetSessionId(searchState.targetSessionId || null);
    setHighlightedConnector(
      (searchState.connector as ConnectorKey | null) || null
    );
  }, [searchState]);

  return (
    <SettingsDialog
      open={open}
      onOpenChange={setOpen}
      activeTab={activeTab}
      onActiveTabChange={setActiveTab}
      connectorTargetSessionId={connectorTargetSessionId}
      highlightedConnector={highlightedConnector}
    />
  );
}
