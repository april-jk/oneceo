import { useState, useEffect, useCallback } from 'react';
import { BillingStatsDashboard } from './BillingStatsDashboard';
import { BillingUsageLogs } from './BillingUsageLogs';
import { BillingDebugPanel } from './BillingDebugPanel';
import { getBillingErrorMessage, readBillingResponseError, type BillingNotify } from './billing-feedback';
import { AdminButton, AdminDetailShell, AdminTabs, AuditTimeline, DangerConfirmDialog, DiffDrawer, IdToken, StatusBadge, getAdminActionIcon, getAdminModuleIcon } from './admin-ui';

interface Pricing {
  id: string;
  model: string;
  modelProvider: string;
  displayName?: string;
  billingTargetKey?: string;
  actualModel?: string | null;
  baseUrlHost?: string | null;
  apiType?: string | null;
  tokenState?: 'configured' | 'inherited' | 'missing';
  runtimeConfigAnchor?: string | null;
  promptPricePer1kTokens: number;
  completionPricePer1kTokens: number;
  isActive: boolean;
  cacheHitRatio: number;
  cacheCreationRatio: number;
  effectiveFrom?: string;
  effectiveUntil?: string | null;
}

interface ModelCandidate {
  model: string;
  provider: string;
  lastSeenAt: string | null;
  hasActivePricing: boolean;
}

interface CacheConfig {
  id: string;
  provider: string;
  hitRatio: number;
  creationRatio: number;
  effectiveFrom: string;
}

interface RuntimeConfigItem {
  kind: 'agent' | 'sandbox';
  key: string;
  displayName: string;
  model: string;
  baseUrl?: string;
  baseUrlHost: string | null;
  apiType: 'openai' | 'anthropic';
  tokenState: 'configured' | 'inherited' | 'missing';
  enabled: boolean;
  runtimeConfigAnchor: string;
}

interface RuntimeConfigTestResult {
  key: string;
  status: 'success' | 'failed';
  latencyMs: number;
  model: string;
  baseUrlHost: string | null;
  apiType: 'openai' | 'anthropic';
  tokenState: RuntimeConfigItem['tokenState'];
  checkedAt: string;
  errorCode?: string;
  errorMessage?: string;
  responsePreview?: string;
  responseDetails?: Record<string, unknown>;
  safeRawResponse?: unknown;
  rawResponseTruncated?: boolean;
}

interface AvailableModel {
  id: string;
  object: string;
  created?: number;
  ownedBy?: string;
}

interface RuntimeConfigModelsResult {
  key: string;
  status: 'success' | 'failed';
  models: AvailableModel[];
  latencyMs: number;
  checkedAt: string;
  errorCode?: string;
  errorMessage?: string;
}

interface BillingManagementSectionProps {
  onOpenUser?: (userId: string) => void;
  onOpenConversation?: (sessionId: string) => void;
  onNotify?: BillingNotify;
}

function normalizePricingProvider(model: string, provider: string) {
  const normalizedModel = String(model || '').toLowerCase();
  if (normalizedModel.startsWith('qwen') || normalizedModel.includes('/qwen')) return 'qwen';
  return provider || 'openai';
}

function providerLabel(provider: string) {
  if (provider === 'agent') return 'Agent SKU';
  if (provider === 'sandbox') return 'Sandbox SKU';
  if (provider === 'qwen') return 'Qwen / 通义千问';
  if (provider === 'anthropic') return 'Anthropic';
  if (provider === 'deepseek') return 'DeepSeek';
  if (provider === 'google') return 'Google';
  if (provider === 'xai') return 'xAI';
  return 'OpenAI';
}

function tokenStateLabel(state?: RuntimeConfigItem['tokenState']) {
  if (state === 'configured') return '已配置';
  if (state === 'inherited') return '继承默认';
  return '未配置';
}

function tokenStateTone(state?: RuntimeConfigItem['tokenState']) {
  if (state === 'configured') return 'success' as const;
  if (state === 'inherited') return 'warning' as const;
  return 'danger' as const;
}

function runtimeTestTone(result?: RuntimeConfigTestResult) {
  if (!result) return 'neutral' as const;
  return result.status === 'success' ? 'success' as const : 'danger' as const;
}

function runtimeTestTitle(result?: RuntimeConfigTestResult) {
  if (!result) return '等待测试';
  return result.status === 'success' ? '模型连通性测试通过' : '模型连通性测试失败';
}

function runtimeTestFriendlyMessage(result?: RuntimeConfigTestResult) {
  if (!result) return '点击测试后，这里会展示模型响应、延时与错误摘要。';
  if (result.status === 'success') return '模型已返回有效响应，当前已保存配置可用于后续新任务。';
  if (result.errorCode === 'token_missing') return 'API Token 未配置。请先在运行配置中保存 Token 后再测试。';
  if (result.errorCode === 'upstream_unauthorized') return '上游鉴权失败。请检查 Token 是否有效、是否匹配当前接口与模型。';
  if (result.errorCode === 'timeout' || result.errorCode === 'upstream_timeout') return '上游响应超时。请检查 Base URL 网络连通性、模型服务状态或适当提高超时时间。';
  if (result.errorCode === 'base_url_missing') return '接口 Base URL 未配置。请先保存可访问的模型接口地址。';
  if (result.errorCode === 'model_missing') return '模型名称未配置。请先保存模型名称。';
  if (result.errorCode === 'empty_response') return '模型请求成功但返回为空。请检查模型名称或上游兼容协议。';
  return result.errorMessage || '模型测试失败，请根据错误摘要检查运行配置。';
}

function formatRuntimeJson(value: unknown) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatRuntimeDetailValue(value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'object') return formatRuntimeJson(value);
  return String(value);
}

function formatPercentInput(value: number) {
  if (!Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

const MAX_CACHE_HIT_PERCENT = 100;
const MAX_CACHE_CREATION_PERCENT = 1000;

export function BillingManagementSection({ onOpenUser, onOpenConversation, onNotify }: BillingManagementSectionProps) {
  const [activeTab, setActiveTab] = useState<'pricing' | 'stats' | 'logs' | 'debug'>('stats');
  const [pricing, setPricing] = useState<Pricing[]>([]);
  const [modelCandidates, setModelCandidates] = useState<ModelCandidate[]>([]);
  const [runtimeConfig, setRuntimeConfig] = useState<{ agent: RuntimeConfigItem[]; sandbox: RuntimeConfigItem[] }>({ agent: [], sandbox: [] });
  const [runtimeConfigLoading, setRuntimeConfigLoading] = useState(false);
  const [runtimeFormOpen, setRuntimeFormOpen] = useState(false);
  const [runtimeFormTarget, setRuntimeFormTarget] = useState<RuntimeConfigItem | null>(null);
  const [runtimeForm, setRuntimeForm] = useState({ model: '', baseUrl: '', apiType: 'openai', apiKey: '' });
  const [runtimeFormLoading, setRuntimeFormLoading] = useState(false);
  const [runtimeTestingKey, setRuntimeTestingKey] = useState<string | null>(null);
  const [runtimeTestResults, setRuntimeTestResults] = useState<Record<string, RuntimeConfigTestResult>>({});
  const [runtimeTestModalOpen, setRuntimeTestModalOpen] = useState(false);
  const [runtimeTestModalTarget, setRuntimeTestModalTarget] = useState<RuntimeConfigItem | null>(null);

  // Available models state
  const [runtimeModelsLoading, setRuntimeModelsLoading] = useState(false);
  const [runtimeModelsResults, setRuntimeModelsResults] = useState<Record<string, RuntimeConfigModelsResult>>({});
  const [runtimeModelsUrls, setRuntimeModelsUrls] = useState<Record<string, string>>({});

  // Pricing form state
  const [pricingFormOpen, setPricingFormOpen] = useState(false);
  const [pricingFormMode, setPricingFormMode] = useState<'create' | 'update'>('create');
  const [pricingDetailOpen, setPricingDetailOpen] = useState(false);
  const [selectedPricing, setSelectedPricing] = useState<Pricing | null>(null);
  const [pricingForm, setPricingForm] = useState({
    model: '',
    modelProvider: 'openai',
    promptPricePer1kTokens: '',
    completionPricePer1kTokens: '',
    effectiveFrom: '',
    cacheHitRatio: '',
    cacheCreationRatio: '',
  });
  const [pricingFormLoading, setPricingFormLoading] = useState(false);
  const [pricingFormTouched, setPricingFormTouched] = useState<Record<string, boolean>>({});
  const [deletePricingTarget, setDeletePricingTarget] = useState<Pricing | null>(null);
  const [deletePricingLoading, setDeletePricingLoading] = useState(false);
  const [updateConfirmOpen, setUpdateConfirmOpen] = useState(false);
  const [pricingDiffOpen, setPricingDiffOpen] = useState(false);

  // Cache config state
  const [cacheConfigs, setCacheConfigs] = useState<CacheConfig[]>([]);
  const [cacheConfigForm, setCacheConfigForm] = useState<Record<string, { hitRatio: string; creationRatio: string }>>({
    openai: { hitRatio: '', creationRatio: '' },
    anthropic: { hitRatio: '', creationRatio: '' },
    qwen: { hitRatio: '', creationRatio: '' },
  });

  const fetchPricing = useCallback(async () => {
    try {
      const response = await fetch('/api/internal/billing/pricing', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setPricing(data.items || []);
      } else {
        onNotify?.('error', '加载失败', await readBillingResponseError(response, '无法获取模型定价列表'));
      }
    } catch (error) {
      console.error('获取定价列表失败:', error);
      onNotify?.('error', '加载失败', getBillingErrorMessage(error, '无法获取模型定价列表'));
    }
  }, [onNotify]);

  const fetchRuntimeConfig = useCallback(async () => {
    setRuntimeConfigLoading(true);
    try {
      const response = await fetch('/api/internal/billing/runtime-config', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setRuntimeConfig({ agent: data.agent || [], sandbox: data.sandbox || [] });
      } else {
        onNotify?.('error', '加载失败', await readBillingResponseError(response, '无法获取运行配置'));
      }
    } catch (error) {
      console.error('获取运行配置失败:', error);
      onNotify?.('error', '加载失败', getBillingErrorMessage(error, '无法获取运行配置'));
    } finally {
      setRuntimeConfigLoading(false);
    }
  }, [onNotify]);

  const fetchModelCandidates = useCallback(async () => {
    try {
      const response = await fetch('/api/internal/billing/pricing/model-candidates', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setModelCandidates(data.items || []);
      } else {
        onNotify?.('error', '加载失败', await readBillingResponseError(response, '无法获取模型候选列表'));
      }
    } catch (error) {
      console.error('获取模型候选失败:', error);
      onNotify?.('error', '加载失败', getBillingErrorMessage(error, '无法获取模型候选列表'));
    }
  }, [onNotify]);

  const fetchCacheConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/internal/billing/cache-config', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        const configs: CacheConfig[] = data.items || [];
        setCacheConfigs(configs);
        // 同步表单初始值
        const formState: Record<string, { hitRatio: string; creationRatio: string }> = {};
        configs.forEach((c) => {
          formState[c.provider] = {
            hitRatio: formatPercentInput(c.hitRatio / 10),
            creationRatio: formatPercentInput(c.creationRatio / 10),
          };
        });
        setCacheConfigForm((prev) => ({ ...prev, ...formState }));
      } else {
        onNotify?.('error', '加载失败', await readBillingResponseError(response, '无法获取缓存配置'));
      }
    } catch (error) {
      console.error('获取缓存配置失败:', error);
      onNotify?.('error', '加载失败', getBillingErrorMessage(error, '无法获取缓存配置'));
    }
  }, [onNotify]);

  useEffect(() => {
    if (activeTab === 'pricing') {
      fetchRuntimeConfig();
      fetchPricing();
      fetchModelCandidates();
      fetchCacheConfig();
    }
  }, [activeTab, fetchRuntimeConfig, fetchPricing, fetchModelCandidates, fetchCacheConfig]);

  const tabs = [
    { key: 'stats' as const, label: '平台统计' },
    { key: 'pricing' as const, label: '定价配置' },
    { key: 'logs' as const, label: '使用明细' },
    { key: 'debug' as const, label: '调试工具' },
  ];

  const pricingTargets = pricing;
  const activePricing = pricing.filter((item) => item.isActive);
  const runtimeItems = [...runtimeConfig.agent, ...runtimeConfig.sandbox];
  const runtimeFormHasUnsavedChanges = Boolean(runtimeFormTarget) && (
    runtimeForm.model.trim() !== (runtimeFormTarget?.model || '') ||
    runtimeForm.baseUrl.trim() !== (runtimeFormTarget?.baseUrl || '') ||
    runtimeForm.apiType !== (runtimeFormTarget?.apiType || 'openai') ||
    Boolean(runtimeForm.apiKey.trim())
  );
  const runtimeTestModalResult = runtimeTestModalTarget ? runtimeTestResults[runtimeTestModalTarget.key] : undefined;
  const runtimeTestResponseDetails = runtimeTestModalResult?.responseDetails;
  const runtimeTestSafeRawResponse = formatRuntimeJson(runtimeTestModalResult?.safeRawResponse);

  const handleUserIdClick = useCallback((userId: string) => {
    if (onOpenUser) {
      onOpenUser(userId);
    }
  }, [onOpenUser]);

  const handleSessionIdClick = useCallback((sessionId: string) => {
    if (onOpenConversation) {
      onOpenConversation(sessionId);
    }
  }, [onOpenConversation]);

  const promptPrice = Number(pricingForm.promptPricePer1kTokens);
  const completionPrice = Number(pricingForm.completionPricePer1kTokens);
  const cacheHitPercent = Number(pricingForm.cacheHitRatio);
  const cacheCreationPercent = Number(pricingForm.cacheCreationRatio);
  const canSubmitPricing = Boolean(pricingForm.model.trim()) &&
    Number.isInteger(promptPrice) &&
    Number.isInteger(completionPrice) &&
    promptPrice > 0 &&
    completionPrice > 0 &&
    Number.isFinite(cacheHitPercent) &&
    Number.isFinite(cacheCreationPercent) &&
    cacheHitPercent >= 0 &&
    cacheHitPercent <= MAX_CACHE_HIT_PERCENT &&
    cacheCreationPercent >= 0 &&
    cacheCreationPercent <= MAX_CACHE_CREATION_PERCENT;

  const pricingFieldErrors = (() => {
    const errors: Record<string, string> = {};
    const promptPrice = Number(pricingForm.promptPricePer1kTokens);
    const completionPrice = Number(pricingForm.completionPricePer1kTokens);
    const cacheHit = Number(pricingForm.cacheHitRatio);
    const cacheCreation = Number(pricingForm.cacheCreationRatio);

    if (pricingForm.promptPricePer1kTokens !== '' && (!Number.isInteger(promptPrice) || promptPrice <= 0)) {
      errors.promptPricePer1kTokens = '请输入大于 0 的正整数';
    }
    if (pricingForm.completionPricePer1kTokens !== '' && (!Number.isInteger(completionPrice) || completionPrice <= 0)) {
      errors.completionPricePer1kTokens = '请输入大于 0 的正整数';
    }
    if (pricingForm.cacheHitRatio !== '' && (!Number.isFinite(cacheHit) || cacheHit < 0 || cacheHit > MAX_CACHE_HIT_PERCENT)) {
      errors.cacheHitRatio = `请输入 0 ~ ${MAX_CACHE_HIT_PERCENT} 之间的数值`;
    }
    if (pricingForm.cacheCreationRatio !== '' && (!Number.isFinite(cacheCreation) || cacheCreation < 0 || cacheCreation > MAX_CACHE_CREATION_PERCENT)) {
      errors.cacheCreationRatio = `请输入 0 ~ ${MAX_CACHE_CREATION_PERCENT} 之间的数值`;
    }
    if (pricingFormMode === 'create' && !pricingForm.model.trim()) {
      errors.model = '请选择或输入模型名称';
    }
    return errors;
  })();

  const shouldShowPricingFieldError = (field: string) => Boolean(pricingFormTouched[field] && pricingFieldErrors[field]);

  const markPricingFieldTouched = (field: string) => {
    setPricingFormTouched((current) => ({ ...current, [field]: true }));
  };

  const getCacheFormForProvider = useCallback((provider: string) => {
    const current = cacheConfigForm[provider];
    if (current) return current;
    const config = cacheConfigs.find((item) => item.provider === provider);
    if (config) {
      return {
        hitRatio: formatPercentInput(config.hitRatio / 10),
        creationRatio: formatPercentInput(config.creationRatio / 10),
      };
    }
    return { hitRatio: '0', creationRatio: '0' };
  }, [cacheConfigForm, cacheConfigs]);

  const openPricingForm = useCallback((initial?: Partial<typeof pricingForm>, mode: 'create' | 'update' = 'create') => {
    const provider = normalizePricingProvider(initial?.model || '', initial?.modelProvider || 'openai');
    const cacheForm = getCacheFormForProvider(provider);
    setPricingFormMode(mode);
    setPricingForm({
      model: initial?.model || '',
      modelProvider: provider,
      promptPricePer1kTokens: initial?.promptPricePer1kTokens || '',
      completionPricePer1kTokens: initial?.completionPricePer1kTokens || '',
      effectiveFrom: initial?.effectiveFrom || '',
      cacheHitRatio: initial?.cacheHitRatio || cacheForm.hitRatio,
      cacheCreationRatio: initial?.cacheCreationRatio || cacheForm.creationRatio,
    });
    setPricingFormTouched({});
    setPricingFormOpen(true);
  }, [getCacheFormForProvider]);

  const openPricingDetail = useCallback((pricingItem: Pricing) => {
    setSelectedPricing(pricingItem);
    setPricingDetailOpen(true);
  }, []);

  const openPricingUpdate = useCallback((pricingItem: Pricing) => {
    const normalizedProvider = normalizePricingProvider(pricingItem.model, pricingItem.modelProvider);
    setPricingDetailOpen(false);
    openPricingForm({
      model: pricingItem.model,
      modelProvider: normalizedProvider,
      promptPricePer1kTokens: String(pricingItem.promptPricePer1kTokens),
      completionPricePer1kTokens: String(pricingItem.completionPricePer1kTokens),
      effectiveFrom: '',
      cacheHitRatio: formatPercentInput((pricingItem.cacheHitRatio || 0) * 100),
      cacheCreationRatio: formatPercentInput((pricingItem.cacheCreationRatio || 0) * 100),
    }, 'update');
  }, [openPricingForm]);

  const openRuntimeForm = useCallback((item: RuntimeConfigItem) => {
    setRuntimeFormTarget(item);
    setRuntimeForm({
      model: item.model || '',
      baseUrl: item.baseUrl || '',
      apiType: item.apiType || 'openai',
      apiKey: '',
    });
    setRuntimeFormOpen(true);
  }, []);

  const submitRuntimeConfig = async () => {
    if (!runtimeFormTarget || !runtimeForm.model.trim()) return;
    setRuntimeFormLoading(true);
    try {
      const endpoint = runtimeFormTarget.kind === 'agent'
        ? `/api/internal/billing/runtime-config/agent/${runtimeFormTarget.key.replace('agent.', '')}`
        : `/api/internal/billing/runtime-config/sandbox/${runtimeFormTarget.key.replace('sandbox.', '')}`;
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          model: runtimeForm.model.trim(),
          baseUrl: runtimeForm.baseUrl.trim(),
          apiType: runtimeForm.apiType,
          apiKey: runtimeForm.apiKey.trim() || undefined,
        }),
      });
      if (!response.ok) {
        onNotify?.('error', '保存失败', await readBillingResponseError(response, '保存运行配置失败'));
        return;
      }
      onNotify?.('success', '运行配置已保存', `${runtimeFormTarget.displayName} 的模型与接口配置已更新，只影响后续新任务。`);
      setRuntimeFormOpen(false);
      setRuntimeFormTarget(null);
      void fetchRuntimeConfig();
      void fetchPricing();
    } catch (error) {
      console.error('保存运行配置失败:', error);
      onNotify?.('error', '保存失败', getBillingErrorMessage(error, '保存运行配置失败'));
    } finally {
      setRuntimeFormLoading(false);
    }
  };

  const testRuntimeConfig = async (item: RuntimeConfigItem) => {
    setRuntimeTestModalTarget(item);
    setRuntimeTestModalOpen(true);
    setRuntimeTestingKey(item.key);
    try {
      const response = await fetch('/api/internal/billing/runtime-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ key: item.key }),
      });
      if (!response.ok) {
        onNotify?.('error', '测试失败', await readBillingResponseError(response, '运行配置测试失败'));
        return;
      }
      const payload = await response.json();
      const result = payload?.data as RuntimeConfigTestResult | undefined;
      if (!result) {
        onNotify?.('error', '测试失败', '运行配置测试没有返回结果');
        return;
      }
      setRuntimeTestResults((current) => ({ ...current, [item.key]: result }));
      if (result.status === 'success') {
        onNotify?.('success', '测试通过', `${item.displayName} · ${result.latencyMs}ms · ${result.baseUrlHost || 'unknown host'}`);
      } else {
        onNotify?.('error', '测试失败', result.errorMessage || result.errorCode || '模型连通性测试失败');
      }
    } catch (error) {
      console.error('测试运行配置失败:', error);
      onNotify?.('error', '测试失败', getBillingErrorMessage(error, '运行配置测试失败'));
    } finally {
      setRuntimeTestingKey(null);
    }
  };

  const fetchRuntimeModels = async (item: RuntimeConfigItem) => {
    setRuntimeModelsLoading(true);
    try {
      const customUrl = runtimeModelsUrls[item.key]?.trim();
      const body: Record<string, string> = { key: item.key };
      if (customUrl) body.modelsUrl = customUrl;
      const response = await fetch('/api/internal/billing/runtime-config/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        onNotify?.('error', '获取失败', await readBillingResponseError(response, '获取可用模型列表失败'));
        return;
      }
      const payload = await response.json();
      const result = payload?.data as RuntimeConfigModelsResult | undefined;
      if (!result) {
        onNotify?.('error', '获取失败', '获取可用模型列表没有返回结果');
        return;
      }
      setRuntimeModelsResults((current) => ({ ...current, [item.key]: result }));
      if (result.status === 'success') {
        onNotify?.('success', '获取成功', `${item.displayName} · 共 ${result.models.length} 个模型`);
      } else {
        onNotify?.('error', '获取失败', result.errorMessage || result.errorCode || '获取可用模型列表失败');
      }
    } catch (error) {
      console.error('获取可用模型列表失败:', error);
      onNotify?.('error', '获取失败', getBillingErrorMessage(error, '获取可用模型列表失败'));
    } finally {
      setRuntimeModelsLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify?.('success', '已复制', `已复制到剪贴板: ${text.slice(0, 20)}${text.length > 20 ? '...' : ''}`);
    } catch {
      onNotify?.('error', '复制失败', '无法复制到剪贴板');
    }
  };

  const submitPricing = async () => {
    if (!canSubmitPricing) return;
    setPricingFormLoading(true);
    try {
      const response = await fetch('/api/internal/billing/pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          model: pricingForm.model.trim(),
          modelProvider: pricingForm.modelProvider,
          promptPricePer1kTokens: promptPrice,
          completionPricePer1kTokens: completionPrice,
          effectiveFrom: pricingForm.effectiveFrom ? new Date(pricingForm.effectiveFrom).toISOString() : undefined,
          cacheHitRatio: Math.round(cacheHitPercent * 10),
          cacheCreationRatio: Math.round(cacheCreationPercent * 10),
        }),
      });
      if (response.ok) {
        const defaultCacheForm = getCacheFormForProvider('openai');
        setPricingForm({
          model: '',
          modelProvider: 'openai',
          promptPricePer1kTokens: '',
          completionPricePer1kTokens: '',
          effectiveFrom: '',
          cacheHitRatio: defaultCacheForm.hitRatio,
          cacheCreationRatio: defaultCacheForm.creationRatio,
        });
        setPricingFormOpen(false);
        onNotify?.('success', pricingFormMode === 'update' ? '新版本已保存' : '定价已创建', `${pricingForm.model.trim()} 的模型定价已${pricingFormMode === 'update' ? '保存为新版本' : '创建'}`);
        void fetchPricing();
        void fetchCacheConfig();
      } else {
        onNotify?.('error', '创建失败', await readBillingResponseError(response, '创建模型定价失败'));
      }
    } catch (error) {
      console.error('保存定价失败:', error);
      onNotify?.('error', '保存失败', getBillingErrorMessage(error, '保存模型定价失败'));
    } finally {
      setPricingFormLoading(false);
    }
  };

  const handleCreatePricing = async () => {
    if (!canSubmitPricing) return;
    if (pricingFormMode === 'update') {
      setUpdateConfirmOpen(true);
      return;
    }
    await submitPricing();
  };

  const handleDeletePricing = async () => {
    if (!deletePricingTarget) return;
    setDeletePricingLoading(true);
    try {
      const response = await fetch(`/api/internal/billing/pricing/${deletePricingTarget.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.ok) {
        onNotify?.('success', '定价已删除', '模型定价已删除，新请求不会再使用该规则');
        setPricingDetailOpen(false);
        setSelectedPricing(null);
        void fetchPricing();
      } else {
        onNotify?.('error', '删除失败', await readBillingResponseError(response, '删除模型定价失败'));
      }
    } catch (error) {
      console.error('删除定价失败:', error);
      onNotify?.('error', '删除失败', getBillingErrorMessage(error, '删除模型定价失败'));
    } finally {
      setDeletePricingLoading(false);
      setDeletePricingTarget(null);
    }
  };

  return (
    <main className="content-stack viewport-lock-page user-management-page billing-management-page">
      {/* Hero */}
      <section className="user-management-hero">
        <div className="user-management-hero-copy">
          <p className="section-tag">计费中心</p>
          <h2>计费管理</h2>
        </div>
        <div className="sandbox-list-header-actions user-management-hero-actions">
          <section className="user-management-summary-strip user-management-live-summary session-status sandbox-live-count" aria-label="计费摘要">
            <span className="sandbox-live-metric sandbox-live-metric-total">
              <span>用户</span>
              <strong>用户详情</strong>
            </span>
            <span className="sandbox-live-metric sandbox-live-metric-running">
              <span>定价规则</span>
              <strong>{activePricing.length}</strong>
            </span>
            <span className="sandbox-live-metric sandbox-live-metric-paused">
              <span>缓存配置</span>
              <strong>{cacheConfigs.length}</strong>
            </span>
            <span className="sandbox-live-metric user-management-live-metric-disabled">
              <span>入口</span>
              <strong>统计/配置</strong>
            </span>
          </section>
        </div>
      </section>

      {/* Tab Bar */}
      <section className="sub-panel user-management-filter-panel billing-management-tab-scroll">
        <AdminTabs value={activeTab} items={tabs} onChange={(value) => setActiveTab(value)} ariaLabel="计费管理分页" />
      </section>

      <div className={`billing-management-tab-content billing-management-tab-content-${activeTab}`}>
      {/* Pricing Tab */}
      {activeTab === 'pricing' && (
        <>
          <section className="sub-panel user-management-list-panel pricing-live">
            <div className="pricing-live-head"><div className="pricing-live-title"><p className="section-tag">定价配置</p><p className="panel-caption">运行配置决定模型与接口，SKU 定价决定扣积分规则。修改运行配置只影响后续新任务。</p></div><div className="pricing-live-actions"><AdminButton variant="primary" onClick={() => openPricingForm()}>新建定价</AdminButton><AdminButton variant="secondary" onClick={async () => { await fetchRuntimeConfig(); await fetchPricing(); onNotify?.('success', '已刷新', '运行配置与定价数据已更新'); }} loading={runtimeConfigLoading}>{runtimeConfigLoading ? '刷新中...' : '刷新配置'}</AdminButton></div></div>
            <div className="pricing-live-rack-compact" aria-busy={runtimeConfigLoading}>{runtimeItems.map((item) => { const testResult = runtimeTestResults[item.key]; const isTesting = runtimeTestingKey === item.key; return (<section key={item.key} id={item.runtimeConfigAnchor} className="pricing-live-runtime-compact"><div className="pricing-live-runtime-top"><span className="pricing-detail-label">{item.kind === 'agent' ? 'Agent' : 'Sandbox'}</span><StatusBadge tone={tokenStateTone(item.tokenState)}>{tokenStateLabel(item.tokenState)}</StatusBadge></div><strong title={item.displayName}>{item.displayName}</strong><small title={`${item.model || '未配置模型'} · ${item.baseUrlHost || '未配置接口'} · ${item.apiType || '-'}`}>{item.model || '未配置模型'}</small>{testResult ? (<button type="button" className={`runtime-test-result runtime-test-result-${testResult.status}`} onClick={() => { setRuntimeTestModalTarget(item); setRuntimeTestModalOpen(true); }} title={`${testResult.latencyMs}ms · ${testResult.model || item.model || '未配置模型'} · ${testResult.baseUrlHost || item.baseUrlHost || '未配置接口'}`}><StatusBadge tone={runtimeTestTone(testResult)}>{testResult.status === 'success' ? '通过' : '失败'}</StatusBadge></button>) : null}<div className="runtime-config-actions"><button type="button" className="table-btn" onClick={() => openRuntimeForm(item)}>调整运行配置</button><button type="button" className="table-btn" onClick={() => void testRuntimeConfig(item)} disabled={isTesting}>{isTesting ? '...' : '测试'}</button></div></section>); })}</div>
            <div className="pricing-live-notice"><span className="pricing-form-tip-icon">ℹ</span><span>运行配置和定价分层展示，先确认执行入口，再处理扣费规则。</span></div>
            <div className="table-wrap user-management-table-wrap pricing-live-table-wrap" aria-live="polite"><table className="user-management-table pricing-live-table"><colgroup><col style={{ width: '22%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /><col style={{ width: '16%' }} /><col style={{ width: '12%' }} /><col style={{ width: '14%' }} /><col style={{ width: '12%' }} /></colgroup><thead><tr><th><span className="runtime-th-label">计费对象</span></th><th><span className="runtime-th-label">输入单价</span></th><th><span className="runtime-th-label">输出单价</span></th><th><span className="runtime-th-label">缓存比例</span></th><th><span className="runtime-th-label">运行状态</span></th><th><span className="runtime-th-label">生效时间</span></th><th className="runtime-col-actions"><span className="runtime-th-label">操作</span></th></tr></thead><tbody>{pricingTargets.length === 0 ? (<tr><td colSpan={7} className="empty">暂无定价数据</td></tr>) : (pricingTargets.map((p) => { const normalizedProvider = normalizePricingProvider(p.model, p.modelProvider); const configured = p.isActive && p.promptPricePer1kTokens > 0 && p.completionPricePer1kTokens > 0; return (<tr key={p.id}><td><div className="user-management-table-user"><div className="user-management-table-user-head"><strong>{p.displayName || p.model}</strong></div><small>{p.billingTargetKey || p.model}</small>{p.actualModel && p.actualModel !== p.model ? (<small className="pricing-runtime-hint" title={`${p.actualModel} · ${p.baseUrlHost || '未配置接口'} · ${p.apiType || '-'}`}>{p.actualModel} · {p.baseUrlHost || '未配置接口'}</small>) : null}</div></td><td><div className="user-management-table-cell-stack user-management-table-metric"><strong>{p.promptPricePer1kTokens}</strong><small>/ 1k tokens</small></div></td><td><div className="user-management-table-cell-stack user-management-table-metric"><strong>{p.completionPricePer1kTokens}</strong><small>/ 1k tokens</small></div></td><td><div className="user-management-table-cell-stack">{p.cacheHitRatio > 0 && (<span>命中 {(p.cacheHitRatio * 100).toFixed(0)}%</span>)}{p.cacheCreationRatio > 0 && (<span>创建 {(p.cacheCreationRatio * 100).toFixed(0)}%</span>)}</div></td><td><StatusBadge tone={tokenStateTone(p.tokenState)}>{tokenStateLabel(p.tokenState)}</StatusBadge></td><td><div className="user-management-table-cell-stack">{p.effectiveFrom ? (<small>{new Date(p.effectiveFrom).toLocaleDateString('zh-CN')}</small>) : (<small>-</small>)}</div></td><td><div className="user-management-table-actions"><button type="button" className="table-btn" onClick={() => configured ? openPricingDetail(p) : openPricingForm({ model: p.model, modelProvider: normalizedProvider }, 'create')}>{configured ? '详情' : '配置'}</button>) : null}</div></td></tr>);}))}</tbody></table></div>
            <div className="admin-mobile-card-list" aria-label="定价配置移动列表">{pricingTargets.length === 0 ? <p className="empty">暂无定价数据</p> : pricingTargets.map((p) => (<article key={p.id} className="admin-mobile-card"><div className="admin-mobile-card-head"><strong>{p.displayName || p.model}</strong><StatusBadge tone={p.isActive ? 'success' : 'warning'}>{p.isActive ? '已定价' : '待配置'}</StatusBadge></div><div className="admin-mobile-card-meta"><span>输入 {p.promptPricePer1kTokens} / 1k</span><span>输出 {p.completionPricePer1kTokens} / 1k</span><span>缓存 {(p.cacheHitRatio * 100).toFixed(0)}% / {(p.cacheCreationRatio * 100).toFixed(0)}%</span></div>{p.isActive ? (
              <AdminButton variant="link" onClick={() => openPricingDetail(p)}>详情</AdminButton>
            ) : p.model?.trim() ? (
              <AdminButton variant="link" onClick={() => openPricingForm({ model: p.model, modelProvider: normalizePricingProvider(p.model, p.modelProvider) }, 'create')}>配置</AdminButton>
            ) : (
              <span className="admin-mobile-card-unavailable">缺少模型信息</span>
            )}</article>))}</div>
          </section>

          {/* Pricing Form Modal */}
          {pricingFormOpen && (
            <div className="modal-backdrop" onClick={() => setPricingFormOpen(false)}>
              <aside
                className="pricing-form-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="billing-pricing-form-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="pricing-form-modal-header">
                  <div className="pricing-form-modal-heading">
                    <p className="section-tag">定价配置</p>
                    <h2 id="billing-pricing-form-title">{pricingFormMode === 'update' ? '更新定价配置（创建新版本）' : '新建定价配置'}</h2>
                    <p className="panel-caption">
                      {pricingFormMode === 'update'
                        ? '保存后会按生效时间创建新版本，历史 usage 不回写。'
                        : '配置模型单价，并为该 provider 设置缓存命中与缓存创建计费比例。'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="pricing-form-modal-close"
                    onClick={() => setPricingFormOpen(false)}
                    aria-label="关闭"
                  >
                    ×
                  </button>
                </div>
                 {/* impeccable-variants-start d3ab82bb */}
                <div data-impeccable-variants="d3ab82bb" data-impeccable-variant-count="4" style={{ display: "contents" }}>
                  {/* Variant 1: Compact Stacked - Dense vertical rhythm with micro-grouping */}
                  <style data-impeccable-css="d3ab82bb">
                    {`
                      @scope ([data-impeccable-variant="1"]) {
                        .runtime-form-compact {
                          padding: 12px 16px;
                          display: flex;
                          flex-direction: column;
                          gap: 10px;
                        }
                        .runtime-form-compact .form-warning {
                          display: flex;
                          align-items: flex-start;
                          gap: 6px;
                          padding: 8px 10px;
                          background: color-mix(in srgb, var(--warning) 6%, transparent);
                          border: 1px solid color-mix(in srgb, var(--warning) 18%, transparent);
                          border-radius: 6px;
                          font-size: 12px;
                          line-height: 1.4;
                          color: var(--text-soft);
                        }
                        .runtime-form-compact .form-warning-icon {
                          color: var(--warning);
                          font-size: 13px;
                          flex-shrink: 0;
                          margin-top: 0.5px;
                        }
                        .runtime-form-compact .form-section {
                          display: flex;
                          flex-direction: column;
                          gap: 8px;
                        }
                        .runtime-form-compact .section-title {
                          font-size: 11px;
                          font-weight: 800;
                          text-transform: uppercase;
                          letter-spacing: 0.06em;
                          color: var(--text-faint);
                          margin: 0;
                          padding-bottom: 2px;
                          border-bottom: 1px solid var(--border);
                        }
                        .runtime-form-compact .field-row {
                          display: flex;
                          gap: 10px;
                          align-items: flex-end;
                        }
                        .runtime-form-compact .field-row .field {
                          flex: 1;
                        }
                        .runtime-form-compact .field-row .field.field-wide {
                          flex: 2;
                        }
                        .runtime-form-compact .field-label {
                          display: block;
                          font-size: 11px;
                          font-weight: 700;
                          color: var(--text-soft);
                          margin-bottom: 3px;
                        }
                        .runtime-form-compact .field-label small {
                          font-weight: 500;
                          color: var(--text-faint);
                          margin-left: 4px;
                        }
                        .runtime-form-compact input,
                        .runtime-form-compact select {
                          width: 100%;
                          height: 32px;
                          padding: 6px 9px;
                          border: 1px solid var(--border);
                          border-radius: 6px;
                          background: var(--surface);
                          font-size: 13px;
                          color: var(--text);
                        }
                        .runtime-form-compact input:focus,
                        .runtime-form-compact select:focus {
                          outline: none;
                          border-color: var(--primary);
                          box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 12%, transparent);
                        }
                        .runtime-form-compact .input-group {
                          display: flex;
                          gap: 6px;
                        }
                        .runtime-form-compact .input-group input {
                          flex: 1;
                        }
                        .runtime-form-compact .btn-micro {
                          height: 32px;
                          padding: 0 10px;
                          font-size: 11px;
                          font-weight: 700;
                          white-space: nowrap;
                          border: 1px solid var(--border);
                          border-radius: 6px;
                          background: var(--surface-muted);
                          color: var(--text);
                          cursor: pointer;
                        }
                        .runtime-form-compact .btn-micro:hover {
                          background: var(--surface);
                          border-color: var(--border-strong);
                        }
                      }
                    `}
                  </style>
                  <div data-impeccable-variant="1" data-impeccable-params='[{"id":"density","kind":"steps","default":"compact","label":"密度","options":[{"value":"compact","label":"紧凑"},{"value":"comfortable","label":"舒适"},{"value":"airy","label":"宽松"}]}]' style={{ display: "none" }}>
                    <div className="runtime-form-compact">
                      <div className="form-warning">
                        <span className="form-warning-icon">⚠</span>
                        <span>Token 不回显。留空表示不修改已有 Token；运行日志只记录 tokenState。</span>
                      </div>
                      <div className="form-section">
                        <h3 className="section-title">模型与接口</h3>
                        <div className="field-row">
                          <div className="field">
                            <label className="field-label">模型名称</label>
                            <div className="input-group">
                              <input type="text" defaultValue="qwen3-max-2026-01-23" placeholder="如 qwen3-max-2026-01-23" />
                              <button className="btn-micro">获取模型</button>
                            </div>
                          </div>
                          <div className="field">
                            <label className="field-label">协议</label>
                            <select defaultValue="openai">
                              <option value="openai">OpenAI</option>
                            </select>
                          </div>
                        </div>
                        <div className="field-row">
                          <div className="field field-wide">
                            <label className="field-label">模型列表接口 <small>可选</small></label>
                            <input type="text" placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1/models" />
                          </div>
                        </div>
                        <div className="field-row">
                          <div className="field field-wide">
                            <label className="field-label">Base URL</label>
                            <input type="text" defaultValue="https://dashscope.aliyuncs.com/compatible-mode/v1" />
                          </div>
                        </div>
                        <div className="field-row">
                          <div className="field field-wide">
                            <label className="field-label">API Token <small>留空不修改</small></label>
                            <input type="password" placeholder="已配置" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Variant 2: Grid Grouping - Two-column layout with visual cards */}
                  <style data-impeccable-css="d3ab82bb">
                    {`
                      @scope ([data-impeccable-variant="2"]) {
                        .runtime-form-grid {
                          padding: 16px 18px;
                          display: grid;
                          grid-template-columns: 1fr 1fr;
                          gap: 12px;
                        }
                        .runtime-form-grid .form-warning {
                          grid-column: 1 / -1;
                          display: flex;
                          align-items: center;
                          gap: 8px;
                          padding: 10px 12px;
                          background: color-mix(in srgb, var(--warning) 5%, transparent);
                          border-left: 3px solid var(--warning);
                          border-radius: 0 8px 8px 0;
                          font-size: 12px;
                          color: var(--text-soft);
                        }
                        .runtime-form-grid .form-card {
                          background: var(--surface);
                          border: 1px solid var(--border);
                          border-radius: 10px;
                          padding: 12px;
                          display: flex;
                          flex-direction: column;
                          gap: 10px;
                        }
                        .runtime-form-grid .form-card.card-wide {
                          grid-column: 1 / -1;
                        }
                        .runtime-form-grid .card-title {
                          font-size: 12px;
                          font-weight: 800;
                          color: var(--text);
                          margin: 0;
                          display: flex;
                          align-items: center;
                          gap: 6px;
                        }
                        .runtime-form-grid .card-title::before {
                          content: "";
                          width: 4px;
                          height: 14px;
                          background: var(--primary);
                          border-radius: 2px;
                        }
                        .runtime-form-grid .field-stack {
                          display: flex;
                          flex-direction: column;
                          gap: 4px;
                        }
                        .runtime-form-grid .field-label {
                          font-size: 11px;
                          font-weight: 700;
                          color: var(--text-soft);
                        }
                        .runtime-form-grid input,
                        .runtime-form-grid select {
                          width: 100%;
                          height: 34px;
                          padding: 7px 10px;
                          border: 1px solid var(--border);
                          border-radius: 7px;
                          background: var(--surface-strong);
                          font-size: 13px;
                        }
                        .runtime-form-grid .input-action {
                          display: flex;
                          gap: 6px;
                        }
                        .runtime-form-grid .input-action input {
                          flex: 1;
                        }
                        .runtime-form-grid .btn-secondary {
                          height: 34px;
                          padding: 0 12px;
                          font-size: 12px;
                          font-weight: 700;
                          border: 1px solid var(--border);
                          border-radius: 7px;
                          background: var(--surface-muted);
                          color: var(--text);
                          cursor: pointer;
                          white-space: nowrap;
                        }
                      }
                    `}
                  </style>
                  <div data-impeccable-variant="2" style={{ display: "none" }}>
                    <div className="runtime-form-grid">
                      <div className="form-warning">
                        <span>⚠</span>
                        <span>Token 不回显。留空表示不修改已有 Token；运行日志只记录 tokenState。</span>
                      </div>
                      <div className="form-card">
                        <h3 className="card-title">模型配置</h3>
                        <div className="field-stack">
                          <label className="field-label">模型名称</label>
                          <div className="input-action">
                            <input type="text" defaultValue="qwen3-max-2026-01-23" />
                            <button className="btn-secondary">获取</button>
                          </div>
                        </div>
                        <div className="field-stack">
                          <label className="field-label">协议类型</label>
                          <select defaultValue="openai">
                            <option value="openai">OpenAI compatible</option>
                          </select>
                        </div>
                      </div>
                      <div className="form-card">
                        <h3 className="card-title">认证</h3>
                        <div className="field-stack">
                          <label className="field-label">API Token</label>
                          <input type="password" placeholder="留空不修改 • 已配置" />
                        </div>
                      </div>
                      <div className="form-card card-wide">
                        <h3 className="card-title">接口端点</h3>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                          <div className="field-stack">
                            <label className="field-label">Base URL</label>
                            <input type="text" defaultValue="https://dashscope.aliyuncs.com/compatible-mode/v1" />
                          </div>
                          <div className="field-stack">
                            <label className="field-label">模型列表接口 <small style={{ fontWeight: 500, color: "var(--text-faint)" }}>可选</small></label>
                            <input type="text" placeholder="自动推导" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Variant 3: Tabbed Sections - Progressive disclosure with tabs */}
                  <style data-impeccable-css="d3ab82bb">
                    {`
                      @scope ([data-impeccable-variant="3"]) {
                        .runtime-form-tabbed {
                          padding: 14px 16px;
                        }
                        .runtime-form-tabbed .form-warning {
                          display: flex;
                          align-items: center;
                          gap: 8px;
                          padding: 9px 12px;
                          background: color-mix(in srgb, var(--warning) 6%, transparent);
                          border-radius: 8px;
                          font-size: 12px;
                          color: var(--text-soft);
                          margin-bottom: 12px;
                        }
                        .runtime-form-tabbed .tab-nav {
                          display: flex;
                          gap: 2px;
                          padding: 3px;
                          background: var(--surface-muted);
                          border-radius: 8px;
                          margin-bottom: 14px;
                        }
                        .runtime-form-tabbed .tab-btn {
                          flex: 1;
                          height: 30px;
                          padding: 0 12px;
                          font-size: 12px;
                          font-weight: 700;
                          border: none;
                          border-radius: 6px;
                          background: transparent;
                          color: var(--text-soft);
                          cursor: pointer;
                          transition: all 0.15s ease;
                        }
                        .runtime-form-tabbed .tab-btn.active {
                          background: var(--surface);
                          color: var(--text);
                          box-shadow: 0 1px 3px color-mix(in srgb, var(--rail) 10%, transparent);
                        }
                        .runtime-form-tabbed .tab-panel {
                          display: flex;
                          flex-direction: column;
                          gap: 12px;
                        }
                        .runtime-form-tabbed .field {
                          display: flex;
                          flex-direction: column;
                          gap: 4px;
                        }
                        .runtime-form-tabbed .field-label {
                          font-size: 12px;
                          font-weight: 700;
                          color: var(--text);
                        }
                        .runtime-form-tabbed .field-hint {
                          font-size: 11px;
                          color: var(--text-faint);
                          font-weight: 500;
                        }
                        .runtime-form-tabbed input,
                        .runtime-form-tabbed select {
                          height: 36px;
                          padding: 8px 11px;
                          border: 1px solid var(--border);
                          border-radius: 8px;
                          background: var(--surface);
                          font-size: 14px;
                        }
                        .runtime-form-tabbed .input-row {
                          display: flex;
                          gap: 8px;
                        }
                        .runtime-form-tabbed .input-row input {
                          flex: 1;
                        }
                        .runtime-form-tabbed .btn {
                          height: 36px;
                          padding: 0 14px;
                          font-size: 12px;
                          font-weight: 700;
                          border: 1px solid var(--border);
                          border-radius: 8px;
                          background: var(--surface-muted);
                          cursor: pointer;
                        }
                      }
                    `}
                  </style>
                  <div data-impeccable-variant="3" style={{ display: "none" }}>
                    <div className="runtime-form-tabbed">
                      <div className="form-warning">
                        <span>⚠</span>
                        <span>Token 不回显。留空表示不修改已有 Token；运行日志只记录 tokenState。</span>
                      </div>
                      <div className="tab-nav">
                        <button className="tab-btn active">基本</button>
                        <button className="tab-btn">端点</button>
                        <button className="tab-btn">认证</button>
                      </div>
                      <div className="tab-panel">
                        <div className="field">
                          <label className="field-label">模型名称</label>
                          <div className="input-row">
                            <input type="text" defaultValue="qwen3-max-2026-01-23" />
                            <button className="btn">获取模型</button>
                          </div>
                        </div>
                        <div className="field">
                          <label className="field-label">协议类型</label>
                          <select defaultValue="openai">
                            <option value="openai">OpenAI compatible</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Variant 4: Integrated Flow - Inline model picker with preview */}
                  <style data-impeccable-css="d3ab82bb">
                    {`
                      @scope ([data-impeccable-variant="4"]) {
                        .runtime-form-integrated {
                          padding: 16px;
                        }
                        .runtime-form-integrated .form-header {
                          display: flex;
                          align-items: flex-start;
                          justify-content: space-between;
                          gap: 12px;
                          padding: 10px 12px;
                          background: color-mix(in srgb, var(--warning) 5%, transparent);
                          border-radius: 8px;
                          margin-bottom: 14px;
                        }
                        .runtime-form-integrated .form-header-text {
                          font-size: 12px;
                          line-height: 1.5;
                          color: var(--text-soft);
                        }
                        .runtime-form-integrated .quick-actions {
                          display: flex;
                          gap: 6px;
                          flex-shrink: 0;
                        }
                        .runtime-form-integrated .quick-actions button {
                          height: 28px;
                          padding: 0 10px;
                          font-size: 11px;
                          font-weight: 700;
                          border: 1px solid var(--border);
                          border-radius: 6px;
                          background: var(--surface);
                          cursor: pointer;
                        }
                        .runtime-form-integrated .main-field {
                          display: flex;
                          flex-direction: column;
                          gap: 6px;
                          margin-bottom: 14px;
                        }
                        .runtime-form-integrated .main-field-label {
                          font-size: 12px;
                          font-weight: 800;
                          color: var(--text);
                        }
                        .runtime-form-integrated .model-selector {
                          display: flex;
                          gap: 8px;
                          align-items: stretch;
                        }
                        .runtime-form-integrated .model-selector input {
                          flex: 1;
                          height: 40px;
                          padding: 10px 12px;
                          font-size: 15px;
                          font-weight: 600;
                          border: 2px solid var(--border);
                          border-radius: 8px;
                          background: var(--surface);
                        }
                        .runtime-form-integrated .model-selector input:focus {
                          outline: none;
                          border-color: var(--primary);
                        }
                        .runtime-form-integrated .model-selector .btn-primary {
                          height: 40px;
                          padding: 0 16px;
                          font-size: 12px;
                          font-weight: 700;
                          border: none;
                          border-radius: 8px;
                          background: var(--primary);
                          color: white;
                          cursor: pointer;
                        }
                        .runtime-form-integrated .secondary-fields {
                          display: grid;
                          grid-template-columns: repeat(3, 1fr);
                          gap: 10px;
                        }
                        .runtime-form-integrated .secondary-field {
                          display: flex;
                          flex-direction: column;
                          gap: 3px;
                        }
                        .runtime-form-integrated .secondary-field label {
                          font-size: 11px;
                          font-weight: 700;
                          color: var(--text-soft);
                        }
                        .runtime-form-integrated .secondary-field input,
                        .runtime-form-integrated .secondary-field select {
                          height: 32px;
                          padding: 6px 9px;
                          border: 1px solid var(--border);
                          border-radius: 6px;
                          background: var(--surface);
                          font-size: 12px;
                        }
                      }
                    `}
                  </style>
                  <div data-impeccable-variant="4" style={{ display: "none" }} data-impeccable-params='[{"id":"showAdvanced","kind":"toggle","default":false,"label":"显示高级选项"}]'>
                    <div className="runtime-form-integrated">
                      <div className="form-header">
                        <span className="form-header-text">Token 不回显。留空表示不修改已有 Token；运行日志只记录 tokenState。</span>
                        <div className="quick-actions">
                          <button>测试连接</button>
                          <button>重置</button>
                        </div>
                      </div>
                      <div className="main-field">
                        <label className="main-field-label">模型</label>
                        <div className="model-selector">
                          <input type="text" defaultValue="qwen3-max-2026-01-23" placeholder="输入模型名称或点击获取" />
                          <button className="btn-primary">获取可用模型</button>
                        </div>
                      </div>
                      <div className="secondary-fields">
                        <div className="secondary-field">
                          <label>协议</label>
                          <select defaultValue="openai">
                            <option value="openai">OpenAI</option>
                          </select>
                        </div>
                        <div className="secondary-field">
                          <label>Base URL</label>
                          <input type="text" defaultValue="dashscope.aliyuncs.com" />
                        </div>
                        <div className="secondary-field">
                          <label>API Token</label>
                          <input type="password" placeholder="••••••••" />
                        </div>
                      </div>
                    </div>
                  </div>

                   {/* Original */}
                   <div data-impeccable-variant="original" style={{ display: "contents" }}>
                      {/* impeccable-variants-start 4b4b384f */}
                     <div data-impeccable-variants="4b4b384f" data-impeccable-variant-count="3" style={{ display: "contents" }}>
                       {/* Variant 1: Command Line Interface - Terminal-inspired precision */}
                       <style data-impeccable-css="4b4b384f">
                         {`
                           @scope ([data-impeccable-variant="1"]) {
                             .runtime-form-cli {
                               padding: 16px;
                               font-family: var(--font-mono);
                             }
                             .runtime-form-cli .cli-header {
                               display: flex;
                               align-items: center;
                               gap: 8px;
                               padding: 8px 10px;
                               background: var(--rail);
                               border-radius: 6px 6px 0 0;
                               color: color-mix(in srgb, var(--surface) 80%, transparent);
                               font-size: 11px;
                             }
                             .runtime-form-cli .cli-dot {
                               width: 8px;
                               height: 8px;
                               border-radius: 50%;
                             }
                             .runtime-form-cli .cli-dot.red { background: var(--danger); }
                             .runtime-form-cli .cli-dot.yellow { background: var(--warning); }
                             .runtime-form-cli .cli-dot.green { background: var(--success); }
                             .runtime-form-cli .cli-body {
                               background: var(--surface);
                               border: 1px solid var(--border);
                               border-top: none;
                               border-radius: 0 0 6px 6px;
                               padding: 14px;
                               display: flex;
                               flex-direction: column;
                               gap: 12px;
                             }
                             .runtime-form-cli .cli-row {
                               display: flex;
                               align-items: center;
                               gap: 10px;
                             }
                             .runtime-form-cli .cli-prompt {
                               color: var(--primary);
                               font-weight: 700;
                               white-space: nowrap;
                               font-size: 12px;
                             }
                             .runtime-form-cli .cli-input {
                               flex: 1;
                               height: 30px;
                               padding: 5px 10px;
                               border: 1px solid var(--border);
                               border-radius: 4px;
                               background: var(--surface-muted);
                               font-family: var(--font-mono);
                               font-size: 12px;
                               color: var(--text);
                             }
                             .runtime-form-cli .cli-input:focus {
                               outline: none;
                               border-color: var(--primary);
                             }
                             .runtime-form-cli .cli-btn {
                               height: 30px;
                               padding: 0 12px;
                               font-size: 11px;
                               font-weight: 700;
                               border: 1px solid var(--primary);
                               border-radius: 4px;
                               background: transparent;
                               color: var(--primary);
                               cursor: pointer;
                               font-family: var(--font-mono);
                             }
                             .runtime-form-cli .cli-btn:hover {
                               background: var(--primary);
                               color: white;
                             }
                             .runtime-form-cli .cli-section {
                               border-top: 1px solid var(--border);
                               padding-top: 10px;
                               margin-top: 2px;
                             }
                             .runtime-form-cli .cli-label {
                               font-size: 11px;
                               color: var(--text-faint);
                               margin-bottom: 4px;
                             }
                           }
                         `}
                       </style>
                        <div data-impeccable-variant="1" style={{ display: "none" }}>
                          <div className="runtime-form-cli">
                           <div className="cli-header">
                             <span className="cli-dot red" />
                             <span className="cli-dot yellow" />
                             <span className="cli-dot green" />
                             <span style={{ marginLeft: 4 }}>runtime-config — {runtimeFormTarget?.displayName || 'Agent Pro'}</span>
                           </div>
                           <div className="cli-body">
                             <div className="cli-row">
                               <span className="cli-prompt">$ model</span>
                               <input className="cli-input" type="text" defaultValue="qwen3-max-2026-01-23" />
                               <button className="cli-btn">list</button>
                             </div>
                             <div className="cli-row">
                               <span className="cli-prompt">$ protocol</span>
                               <select className="cli-input" style={{ width: 'auto', flex: 'none' }} defaultValue="openai">
                                 <option value="openai">openai-compatible</option>
                               </select>
                             </div>
                             <div className="cli-section">
                               <div className="cli-label">ENDPOINT CONFIGURATION</div>
                               <div className="cli-row" style={{ marginTop: 6 }}>
                                 <span className="cli-prompt">$ base_url</span>
                                 <input className="cli-input" type="text" defaultValue="https://dashscope.aliyuncs.com/compatible-mode/v1" />
                               </div>
                               <div className="cli-row">
                                 <span className="cli-prompt">$ models_url</span>
                                 <input className="cli-input" type="text" placeholder="auto-resolve from base_url" />
                               </div>
                               <div className="cli-row">
                                 <span className="cli-prompt">$ api_key</span>
                                 <input className="cli-input" type="password" placeholder="[REDACTED]" />
                               </div>
                             </div>
                           </div>
                         </div>
                       </div>

                       {/* Variant 2: Properties Panel - IDE-style inspector */}
                       <style data-impeccable-css="4b4b384f">
                         {`
                           @scope ([data-impeccable-variant="2"]) {
                             .runtime-form-ide {
                               padding: 0;
                               display: grid;
                               grid-template-columns: 160px 1fr;
                               gap: 0;
                               min-height: 300px;
                             }
                             .runtime-form-ide .ide-sidebar {
                               background: var(--surface-muted);
                               border-right: 1px solid var(--border);
                               padding: 12px 0;
                             }
                             .runtime-form-ide .ide-nav-item {
                               padding: 8px 14px;
                               font-size: 12px;
                               font-weight: 700;
                               color: var(--text-soft);
                               cursor: pointer;
                               border-left: 3px solid transparent;
                             }
                             .runtime-form-ide .ide-nav-item:hover {
                               background: color-mix(in srgb, var(--primary) 5%, transparent);
                               color: var(--text);
                             }
                             .runtime-form-ide .ide-nav-item.active {
                               background: color-mix(in srgb, var(--primary) 8%, transparent);
                               color: var(--primary);
                               border-left-color: var(--primary);
                             }
                             .runtime-form-ide .ide-content {
                               padding: 16px 18px;
                               display: flex;
                               flex-direction: column;
                               gap: 14px;
                             }
                             .runtime-form-ide .ide-field {
                               display: flex;
                               flex-direction: column;
                               gap: 5px;
                             }
                             .runtime-form-ide .ide-field-label {
                               display: flex;
                               align-items: center;
                               justify-content: space-between;
                               font-size: 11px;
                               font-weight: 800;
                               text-transform: uppercase;
                               letter-spacing: 0.04em;
                               color: var(--text-faint);
                             }
                             .runtime-form-ide .ide-field-label .type-tag {
                               font-size: 10px;
                               font-weight: 600;
                               padding: 1px 5px;
                               background: var(--surface-muted);
                               border-radius: 3px;
                               color: var(--text-soft);
                               text-transform: none;
                               letter-spacing: 0;
                             }
                             .runtime-form-ide input,
                             .runtime-form-ide select {
                               height: 34px;
                               padding: 7px 11px;
                               border: 1px solid var(--border);
                               border-radius: 6px;
                               background: var(--surface);
                               font-size: 13px;
                               font-family: var(--font-mono);
                             }
                             .runtime-form-ide input:focus,
                             .runtime-form-ide select:focus {
                               outline: none;
                               border-color: var(--primary);
                               box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 10%, transparent);
                             }
                             .runtime-form-ide .ide-input-row {
                               display: flex;
                               gap: 8px;
                             }
                             .runtime-form-ide .ide-input-row input {
                               flex: 1;
                             }
                             .runtime-form-ide .ide-btn {
                               height: 34px;
                               padding: 0 12px;
                               font-size: 11px;
                               font-weight: 700;
                               border: 1px solid var(--border);
                               border-radius: 6px;
                               background: var(--surface-muted);
                               cursor: pointer;
                             }
                             .runtime-form-ide .ide-status {
                               display: flex;
                               align-items: center;
                               gap: 6px;
                               padding: 8px 10px;
                               background: color-mix(in srgb, var(--warning) 5%, transparent);
                               border-radius: 6px;
                               font-size: 11px;
                               color: var(--text-soft);
                             }
                             .runtime-form-ide .ide-status-dot {
                               width: 6px;
                               height: 6px;
                               border-radius: 50%;
                               background: var(--warning);
                             }
                           }
                         `}
                       </style>
                       <div data-impeccable-variant="2" style={{ display: "none" }}>
                         <div className="runtime-form-ide">
                           <div className="ide-sidebar">
                             <div className="ide-nav-item active">General</div>
                             <div className="ide-nav-item">Endpoint</div>
                             <div className="ide-nav-item">Auth</div>
                             <div className="ide-nav-item">Advanced</div>
                           </div>
                           <div className="ide-content">
                             <div className="ide-status">
                               <span className="ide-status-dot" />
                               <span>Token is masked. Leave empty to preserve existing.</span>
                             </div>
                             <div className="ide-field">
                               <label className="ide-field-label">
                                 <span>model</span>
                                 <span className="type-tag">string</span>
                               </label>
                               <div className="ide-input-row">
                                 <input type="text" defaultValue="qwen3-max-2026-01-23" />
                                 <button className="ide-btn">Fetch</button>
                               </div>
                             </div>
                             <div className="ide-field">
                               <label className="ide-field-label">
                                 <span>protocol</span>
                                 <span className="type-tag">enum</span>
                               </label>
                               <select defaultValue="openai">
                                 <option value="openai">openai-compatible</option>
                               </select>
                             </div>
                             <div className="ide-field">
                               <label className="ide-field-label">
                                 <span>base_url</span>
                                 <span className="type-tag">url</span>
                               </label>
                               <input type="text" defaultValue="https://dashscope.aliyuncs.com/compatible-mode/v1" />
                             </div>
                             <div className="ide-field">
                               <label className="ide-field-label">
                                 <span>api_key</span>
                                 <span className="type-tag">secret</span>
                               </label>
                               <input type="password" placeholder="••••••••••••" />
                             </div>
                           </div>
                         </div>
                       </div>

                       {/* Variant 3: Dashboard Card - Metric-driven control surface */}
                       <style data-impeccable-css="4b4b384f">
                         {`
                           @scope ([data-impeccable-variant="3"]) {
                             .runtime-form-dashboard {
                               padding: 18px;
                               display: flex;
                               flex-direction: column;
                               gap: 16px;
                             }
                             .runtime-form-dashboard .dash-header {
                               display: flex;
                               align-items: center;
                               justify-content: space-between;
                               padding-bottom: 12px;
                               border-bottom: 1px solid var(--border);
                             }
                             .runtime-form-dashboard .dash-title {
                               font-size: 14px;
                               font-weight: 800;
                               color: var(--text);
                             }
                             .runtime-form-dashboard .dash-status {
                               display: flex;
                               align-items: center;
                               gap: 6px;
                               font-size: 11px;
                               font-weight: 700;
                               color: var(--success);
                             }
                             .runtime-form-dashboard .dash-status-dot {
                               width: 7px;
                               height: 7px;
                               border-radius: 50%;
                               background: var(--success);
                             }
                             .runtime-form-dashboard .dash-grid {
                               display: grid;
                               grid-template-columns: repeat(2, 1fr);
                               gap: 12px;
                             }
                             .runtime-form-dashboard .dash-card {
                               background: var(--surface);
                               border: 1px solid var(--border);
                               border-radius: 10px;
                               padding: 12px;
                               display: flex;
                               flex-direction: column;
                               gap: 8px;
                             }
                             .runtime-form-dashboard .dash-card.card-full {
                               grid-column: 1 / -1;
                             }
                             .runtime-form-dashboard .card-label {
                               font-size: 10px;
                               font-weight: 800;
                               text-transform: uppercase;
                               letter-spacing: 0.06em;
                               color: var(--text-faint);
                             }
                             .runtime-form-dashboard .card-value {
                               font-size: 16px;
                               font-weight: 700;
                               color: var(--text);
                               font-family: var(--font-mono);
                             }
                             .runtime-form-dashboard .card-input {
                               height: 32px;
                               padding: 6px 10px;
                               border: 1px solid var(--border);
                               border-radius: 6px;
                               background: var(--surface-strong);
                               font-size: 13px;
                               font-family: var(--font-mono);
                             }
                             .runtime-form-dashboard .card-input:focus {
                               outline: none;
                               border-color: var(--primary);
                             }
                             .runtime-form-dashboard .card-action {
                               display: flex;
                               gap: 8px;
                               margin-top: 4px;
                             }
                             .runtime-form-dashboard .card-btn {
                               height: 28px;
                               padding: 0 10px;
                               font-size: 11px;
                               font-weight: 700;
                               border: 1px solid var(--border);
                               border-radius: 5px;
                               background: var(--surface-muted);
                               cursor: pointer;
                             }
                             .runtime-form-dashboard .card-btn.primary {
                               background: var(--primary);
                               color: white;
                               border-color: var(--primary);
                             }
                           }
                         `}
                       </style>
                       <div data-impeccable-variant="3" style={{ display: "none" }}>
                         <div className="runtime-form-dashboard">
                           <div className="dash-header">
                             <span className="dash-title">Runtime Configuration</span>
                             <span className="dash-status">
                               <span className="dash-status-dot" />
                               Active
                             </span>
                           </div>
                           <div className="dash-grid">
                             <div className="dash-card">
                               <span className="card-label">Model</span>
                               <input className="card-input" type="text" defaultValue="qwen3-max-2026-01-23" />
                               <div className="card-action">
                                 <button className="card-btn primary">Fetch Models</button>
                               </div>
                             </div>
                             <div className="dash-card">
                               <span className="card-label">Protocol</span>
                               <select className="card-input" defaultValue="openai">
                                 <option value="openai">OpenAI Compatible</option>
                               </select>
                             </div>
                             <div className="dash-card card-full">
                               <span className="card-label">Base URL</span>
                               <input className="card-input" type="text" defaultValue="https://dashscope.aliyuncs.com/compatible-mode/v1" />
                             </div>
                             <div className="dash-card card-full">
                               <span className="card-label">API Token</span>
                               <input className="card-input" type="password" placeholder="••••••••••••" />
                             </div>
                           </div>
                         </div>
                       </div>

                        {/* Original */}
                         <div data-impeccable-variant="original" style={{ display: "contents" }}>
                           <div className="pricing-form-modal-body">
                        {pricingFormMode === 'update' && (
                        <div className="pricing-form-tip warning">
                        <span className="pricing-form-tip-icon">⚠</span>
                        <span>当前模型与提供商不可编辑。新保存会创建新版本，历史 usage 不回写。</span>
                        </div>
                        )}
                        
                        <section className="pricing-form-section">
                        <h3 className="pricing-form-section-title">模型范围</h3>
                        <div className="pricing-form-grid">
                        {pricingFormMode === 'create' && modelCandidates.length > 0 ? (
                        <div className="pricing-form-field pricing-form-field-wide">
                        <span className="pricing-form-field-label">候选模型</span>
                        <select
                        value=""
                        onChange={(e) => {
                        const candidate = modelCandidates.find((item) => item.model === e.target.value);
                        if (!candidate) return;
                        const normalizedProvider = normalizePricingProvider(candidate.model, candidate.provider);
                        const existingPricing = pricing.find((item) => item.model === candidate.model && item.isActive);
                        const nextCache = getCacheFormForProvider(normalizedProvider);
                        setPricingForm({
                        ...pricingForm,
                        model: candidate.model,
                        modelProvider: normalizedProvider,
                        promptPricePer1kTokens: existingPricing ? String(existingPricing.promptPricePer1kTokens) : pricingForm.promptPricePer1kTokens,
                        completionPricePer1kTokens: existingPricing ? String(existingPricing.completionPricePer1kTokens) : pricingForm.completionPricePer1kTokens,
                        cacheHitRatio: existingPricing ? formatPercentInput((existingPricing.cacheHitRatio || 0) * 100) : nextCache.hitRatio,
                        cacheCreationRatio: existingPricing ? formatPercentInput((existingPricing.cacheCreationRatio || 0) * 100) : nextCache.creationRatio,
                        });
                        markPricingFieldTouched('model');
                        }}
                        >
                        <option value="">从当前使用模型选择</option>
                        {modelCandidates.map((candidate) => {
                        const normalizedProvider = normalizePricingProvider(candidate.model, candidate.provider);
                        return (
                        <option key={candidate.model} value={candidate.model}>
                        {candidate.model} · {providerLabel(normalizedProvider)}{candidate.hasActivePricing ? ' · 已有定价' : ' · 待配置'}
                        </option>
                        );
                        })}
                        </select>
                        </div>
                        ) : null}
                        <div className={`pricing-form-field ${shouldShowPricingFieldError('model') ? 'has-error' : ''}`}>
                        <span className="pricing-form-field-label">模型名称</span>
                        <input
                        type="text"
                        placeholder="如 gpt-4o"
                        list="billing-model-candidates"
                        value={pricingForm.model}
                        readOnly={pricingFormMode === 'update'}
                        onChange={(e) => {
                        markPricingFieldTouched('model');
                        setPricingForm({ ...pricingForm, model: e.target.value });
                        }}
                        onBlur={() => markPricingFieldTouched('model')}
                        />
                        <datalist id="billing-model-candidates">
                        {modelCandidates.map((candidate) => (
                        <option key={candidate.model} value={candidate.model} />
                        ))}
                        </datalist>
                        {pricingFormMode === 'create' && shouldShowPricingFieldError('model') && <span className="pricing-form-field-error">{pricingFieldErrors.model}</span>}
                        </div>
                        <div className="pricing-form-field">
                        <span className="pricing-form-field-label">提供商</span>
                        <select
                        value={pricingForm.modelProvider}
                        disabled={pricingFormMode === 'update'}
                        onChange={(e) => {
                        const nextProvider = e.target.value;
                        const nextCache = getCacheFormForProvider(nextProvider);
                        setPricingForm({
                        ...pricingForm,
                        modelProvider: nextProvider,
                        cacheHitRatio: nextCache.hitRatio,
                        cacheCreationRatio: nextCache.creationRatio,
                        });
                        }}
                        >
                        <option value="agent">Agent SKU</option>
                        <option value="sandbox">Sandbox SKU</option>
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="qwen">Qwen / 通义千问</option>
                        <option value="deepseek">DeepSeek</option>
                        <option value="google">Google</option>
                        <option value="xai">xAI</option>
                        </select>
                        </div>
                        </div>
                        </section>
                        
                        <section className="pricing-form-section">
                        <h3 className="pricing-form-section-title">基础定价</h3>
                        <div className="pricing-form-grid">
                        <div className={`pricing-form-field ${shouldShowPricingFieldError('promptPricePer1kTokens') ? 'has-error' : ''}`}>
                        <span className="pricing-form-field-label">输入单价 <small>credits / 1k tokens</small></span>
                        <input
                        type="number"
                        min={1}
                        step={1}
                        placeholder="如 25"
                        value={pricingForm.promptPricePer1kTokens}
                        onChange={(e) => {
                        markPricingFieldTouched('promptPricePer1kTokens');
                        setPricingForm({ ...pricingForm, promptPricePer1kTokens: e.target.value });
                        }}
                        onBlur={() => markPricingFieldTouched('promptPricePer1kTokens')}
                        />
                        {shouldShowPricingFieldError('promptPricePer1kTokens') && <span className="pricing-form-field-error">{pricingFieldErrors.promptPricePer1kTokens}</span>}
                        </div>
                        <div className={`pricing-form-field ${shouldShowPricingFieldError('completionPricePer1kTokens') ? 'has-error' : ''}`}>
                        <span className="pricing-form-field-label">输出单价 <small>credits / 1k tokens</small></span>
                        <input
                        type="number"
                        min={1}
                        step={1}
                        placeholder="如 50"
                        value={pricingForm.completionPricePer1kTokens}
                        onChange={(e) => {
                        markPricingFieldTouched('completionPricePer1kTokens');
                        setPricingForm({ ...pricingForm, completionPricePer1kTokens: e.target.value });
                        }}
                        onBlur={() => markPricingFieldTouched('completionPricePer1kTokens')}
                        />
                        {shouldShowPricingFieldError('completionPricePer1kTokens') && <span className="pricing-form-field-error">{pricingFieldErrors.completionPricePer1kTokens}</span>}
                        </div>
                        <div className="pricing-form-field pricing-form-field-wide">
                        <span className="pricing-form-field-label">生效时间 <small>留空立即生效</small></span>
                        <input
                        type="datetime-local"
                        value={pricingForm.effectiveFrom}
                        onChange={(e) => setPricingForm({ ...pricingForm, effectiveFrom: e.target.value })}
                        />
                        </div>
                        </div>
                        </section>
                        
                        <section className="pricing-form-section">
                        <h3 className="pricing-form-section-title">缓存计费</h3>
                        <div className="pricing-form-tip">
                        <span className="pricing-form-tip-icon">ℹ</span>
                        <span>缓存比例按 provider 生效，将影响 {providerLabel(pricingForm.modelProvider)} 下所有模型。Qwen 隐式缓存命中填 20，缓存创建填 125；无缓存创建费用填 0。</span>
                        </div>
                        <div className="pricing-form-grid">
                        <div className={`pricing-form-field ${shouldShowPricingFieldError('cacheHitRatio') ? 'has-error' : ''}`}>
                        <span className="pricing-form-field-label">缓存命中比例 <small>%</small></span>
                        <input
                        type="number"
                        min={0}
                        max={MAX_CACHE_HIT_PERCENT}
                        step="0.1"
                        placeholder="如 20"
                        value={pricingForm.cacheHitRatio}
                        onChange={(e) => {
                        markPricingFieldTouched('cacheHitRatio');
                        setPricingForm({ ...pricingForm, cacheHitRatio: e.target.value });
                        }}
                        onBlur={() => markPricingFieldTouched('cacheHitRatio')}
                        />
                        {shouldShowPricingFieldError('cacheHitRatio') && <span className="pricing-form-field-error">{pricingFieldErrors.cacheHitRatio}</span>}
                        </div>
                        <div className={`pricing-form-field ${shouldShowPricingFieldError('cacheCreationRatio') ? 'has-error' : ''}`}>
                        <span className="pricing-form-field-label">缓存创建比例 <small>%</small></span>
                        <input
                        type="number"
                        min={0}
                        max={MAX_CACHE_CREATION_PERCENT}
                        step="0.1"
                        placeholder="如 125"
                        value={pricingForm.cacheCreationRatio}
                        onChange={(e) => {
                        markPricingFieldTouched('cacheCreationRatio');
                        setPricingForm({ ...pricingForm, cacheCreationRatio: e.target.value });
                        }}
                        onBlur={() => markPricingFieldTouched('cacheCreationRatio')}
                        />
                        {shouldShowPricingFieldError('cacheCreationRatio') && <span className="pricing-form-field-error">{pricingFieldErrors.cacheCreationRatio}</span>}
                        </div>
                        </div>
                        </section>
                        </div>
                      </div>
                      {/* Variants: insert below this line */}
                    </div>
                    {/* impeccable-variants-end 4b4b384f */}
                  </div>
                  {/* Variants: insert below this line */}
                </div>
                {/* impeccable-variants-end d3ab82bb */}
                <div className="pricing-form-actions">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setPricingFormOpen(false)}
                    disabled={pricingFormLoading}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={handleCreatePricing}
                    disabled={pricingFormLoading || !canSubmitPricing}
                  >
                    {pricingFormLoading ? '保存中...' : pricingFormMode === 'update' ? '保存新版本' : '创建定价'}
                  </button>
                </div>
              </aside>
            </div>
          )}

          {runtimeFormOpen && runtimeFormTarget && (
            <div className="modal-backdrop" onClick={() => setRuntimeFormOpen(false)}>
              <aside
                className="pricing-form-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="billing-runtime-form-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="pricing-form-modal-header">
                  <div className="pricing-form-modal-heading">
                    <p className="section-tag">运行配置</p>
                    <h2 id="billing-runtime-form-title">调整 {runtimeFormTarget.displayName}</h2>
                    <p className="panel-caption">配置模型、接口与 Token。保存后只影响后续新任务，历史账单继续使用当时快照。</p>
                  </div>
                  <button type="button" className="pricing-form-modal-close" onClick={() => setRuntimeFormOpen(false)} aria-label="关闭">×</button>
                </div>
                <div className="pricing-form-modal-body">
                  <div className="pricing-form-tip warning">
                    <span className="pricing-form-tip-icon">⚠</span>
                    <span>Token 不回显。留空表示不修改已有 Token；运行日志只记录 tokenState。</span>
                  </div>
                  <section className="pricing-form-section">
                    <h3 className="pricing-form-section-title">模型与接口</h3>
                    <div className="pricing-form-grid">
                      <div className="pricing-form-field">
                        <span className="pricing-form-field-label">模型名称</span>
                        <div className="runtime-model-input-group">
                          <input type="text" value={runtimeForm.model} onChange={(e) => setRuntimeForm({ ...runtimeForm, model: e.target.value })} placeholder="如 qwen3-max-2026-01-23" />
                          <button type="button" className="table-btn" onClick={() => void fetchRuntimeModels(runtimeFormTarget)} disabled={runtimeModelsLoading}>{runtimeModelsLoading ? '获取中...' : '获取可用模型'}</button>
                        </div>
                      </div>
                      <div className="pricing-form-field pricing-form-field-wide">
                        <span className="pricing-form-field-label">模型列表接口 <small>可选，留空则自动推导</small></span>
                        <input
                          type="text"
                          value={runtimeModelsUrls[runtimeFormTarget?.key || ''] || ''}
                          onChange={(e) => setRuntimeModelsUrls((prev) => ({ ...prev, [runtimeFormTarget!.key]: e.target.value }))}
                          placeholder={`${runtimeForm.baseUrl.replace(/\/$/, '').endsWith('/v1') ? runtimeForm.baseUrl.replace(/\/$/, '') + '/models' : runtimeForm.baseUrl.replace(/\/$/, '') + '/v1/models'}`}
                        />
                      </div>
                      <div className="pricing-form-field">
                        <span className="pricing-form-field-label">协议类型</span>
                        <select value={runtimeForm.apiType} onChange={(e) => setRuntimeForm({ ...runtimeForm, apiType: e.target.value })}>
                          <option value="openai">OpenAI compatible</option>
                        </select>
                      </div>
                      <div className="pricing-form-field pricing-form-field-wide">
                        <span className="pricing-form-field-label">接口 Base URL</span>
                        <input type="text" value={runtimeForm.baseUrl} onChange={(e) => setRuntimeForm({ ...runtimeForm, baseUrl: e.target.value })} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
                      </div>
                      <div className="pricing-form-field pricing-form-field-wide">
                        <span className="pricing-form-field-label">API Token <small>留空不修改</small></span>
                        <input type="password" value={runtimeForm.apiKey} onChange={(e) => setRuntimeForm({ ...runtimeForm, apiKey: e.target.value })} placeholder={tokenStateLabel(runtimeFormTarget.tokenState)} />
                      </div>
                    </div>
                  </section>
                  {runtimeModelsResults[runtimeFormTarget?.key || '']?.models.length ? (
                    <section className="pricing-form-section">
                      <h3 className="pricing-form-section-title">可用模型列表 <small>点击复制模型名</small></h3>
                      <div className="runtime-models-grid">
                        {runtimeModelsResults[runtimeFormTarget!.key].models.map((model) => (
                          <button
                            key={model.id}
                            type="button"
                            className="runtime-model-card"
                            onClick={() => {
                              setRuntimeForm({ ...runtimeForm, model: model.id });
                              void copyToClipboard(model.id);
                            }}
                            title={`点击填入并复制: ${model.id}`}
                          >
                            <strong>{model.id}</strong>
                            {model.ownedBy ? <small>{model.ownedBy}</small> : null}
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : runtimeModelsResults[runtimeFormTarget?.key || '']?.status === 'failed' ? (
                    <section className="pricing-form-section">
                      <h3 className="pricing-form-section-title">可用模型列表</h3>
                      <div className="runtime-test-summary">
                        <p>获取失败: {runtimeModelsResults[runtimeFormTarget!.key].errorMessage || '无法获取模型列表'}</p>
                      </div>
                    </section>
                  ) : null}
                </div>
                <div className="pricing-form-actions">
                  <button type="button" className="secondary-btn" onClick={() => setRuntimeFormOpen(false)} disabled={runtimeFormLoading}>取消</button>
                  <button type="button" className="secondary-btn" onClick={() => void testRuntimeConfig(runtimeFormTarget)} disabled={runtimeFormLoading || runtimeTestingKey === runtimeFormTarget.key || runtimeFormHasUnsavedChanges}>{runtimeTestingKey === runtimeFormTarget.key ? '测试中...' : '测试已保存配置'}</button>
                  <button type="button" className="primary-btn" onClick={submitRuntimeConfig} disabled={runtimeFormLoading || !runtimeForm.model.trim()}>{runtimeFormLoading ? '保存中...' : '保存运行配置'}</button>
                </div>
                {runtimeFormHasUnsavedChanges ? <p className="pricing-form-modal-footnote">当前表单存在未保存改动，测试会使用已保存配置；请先保存后测试。</p> : null}
              </aside>
            </div>
          )}

          {runtimeTestModalOpen && runtimeTestModalTarget && (
            <div className="modal-backdrop" onClick={() => setRuntimeTestModalOpen(false)}>
              <aside
                className="pricing-form-modal runtime-test-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="billing-runtime-test-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="pricing-form-modal-header">
                  <div className="pricing-form-modal-heading">
                    <p className="section-tag">模型连通性测试</p>
                    <h2 id="billing-runtime-test-title">{runtimeTestTitle(runtimeTestModalResult)}</h2>
                    <p className="panel-caption">{runtimeTestModalTarget.displayName} · 测试已保存运行配置，不读取当前表单草稿。</p>
                  </div>
                  <button type="button" className="pricing-form-modal-close" onClick={() => setRuntimeTestModalOpen(false)} aria-label="关闭">×</button>
                </div>
                <div className="pricing-form-modal-body">
                  <div className={`runtime-test-hero runtime-test-hero-${runtimeTestModalResult?.status || 'pending'}`}>
                    <StatusBadge tone={runtimeTestingKey === runtimeTestModalTarget.key ? 'processing' : runtimeTestTone(runtimeTestModalResult)}>
                      {runtimeTestingKey === runtimeTestModalTarget.key ? '测试中' : runtimeTestModalResult?.status === 'success' ? '测试通过' : runtimeTestModalResult ? '测试失败' : '等待测试'}
                    </StatusBadge>
                    <p>{runtimeTestingKey === runtimeTestModalTarget.key ? '正在向模型发送最小健康检查请求，请稍候。' : runtimeTestFriendlyMessage(runtimeTestModalResult)}</p>
                  </div>
                  <section className="pricing-form-section">
                    <h3 className="pricing-form-section-title">测试指标</h3>
                    <div className="runtime-test-grid">
                      <div><span>运行对象</span><strong>{runtimeTestModalTarget.key}</strong></div>
                      <div><span>耗时</span><strong>{runtimeTestModalResult ? `${runtimeTestModalResult.latencyMs}ms` : runtimeTestingKey === runtimeTestModalTarget.key ? '测试中' : '-'}</strong></div>
                      <div><span>模型</span><strong>{runtimeTestModalResult?.model || runtimeTestModalTarget.model || '未配置'}</strong></div>
                      <div><span>接口 Host</span><strong>{runtimeTestModalResult?.baseUrlHost || runtimeTestModalTarget.baseUrlHost || '未配置'}</strong></div>
                      <div><span>协议</span><strong>{runtimeTestModalResult?.apiType || runtimeTestModalTarget.apiType}</strong></div>
                      <div><span>Token 状态</span><strong>{tokenStateLabel(runtimeTestModalResult?.tokenState || runtimeTestModalTarget.tokenState)}</strong></div>
                      <div><span>测试时间</span><strong>{runtimeTestModalResult?.checkedAt ? new Date(runtimeTestModalResult.checkedAt).toLocaleString('zh-CN', { hour12: false }) : '-'}</strong></div>
                    </div>
                  </section>
                  <section className="pricing-form-section">
                    <h3 className="pricing-form-section-title">安全摘要</h3>
                    <div className="runtime-test-summary">
                      {runtimeTestModalResult?.errorCode ? <p><strong>错误码：</strong>{runtimeTestModalResult.errorCode}</p> : null}
                      {runtimeTestModalResult?.errorMessage ? <p><strong>错误摘要：</strong>{runtimeTestModalResult.errorMessage}</p> : null}
                      {runtimeTestModalResult?.responsePreview ? <p><strong>模型返回预览：</strong>{runtimeTestModalResult.responsePreview}</p> : null}
                      {!runtimeTestModalResult && runtimeTestingKey !== runtimeTestModalTarget.key ? <p>尚未执行测试。</p> : null}
                      <small>不会展示 Token、tokenSource、env key、Authorization header 或完整请求体。</small>
                    </div>
                  </section>
                  {runtimeTestResponseDetails ? (
                    <section className="pricing-form-section">
                      <h3 className="pricing-form-section-title">响应详情</h3>
                      <div className="runtime-test-grid runtime-test-detail-grid">
                        {Object.entries(runtimeTestResponseDetails).map(([key, value]) => (
                          <div key={key}>
                            <span>{key}</span>
                            <strong title={formatRuntimeDetailValue(value)}>{formatRuntimeDetailValue(value)}</strong>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {runtimeTestSafeRawResponse ? (
                    <section className="pricing-form-section">
                      <h3 className="pricing-form-section-title">脱敏原始响应 JSON</h3>
                      <div className="runtime-test-raw-block">
                        {runtimeTestModalResult?.rawResponseTruncated ? <small>响应内容超过 24KB，已截断展示。</small> : null}
                        <pre>{runtimeTestSafeRawResponse}</pre>
                      </div>
                    </section>
                  ) : null}
                  {runtimeModelsResults[runtimeTestModalTarget.key]?.models.length ? (
                    <section className="pricing-form-section">
                      <h3 className="pricing-form-section-title">可用模型列表 <small>点击复制</small></h3>
                      <div className="runtime-models-grid">
                        {runtimeModelsResults[runtimeTestModalTarget.key].models.map((model) => (
                          <button
                            key={model.id}
                            type="button"
                            className="runtime-model-card"
                            onClick={() => void copyToClipboard(model.id)}
                            title={`点击复制: ${model.id}`}
                          >
                            <strong>{model.id}</strong>
                            {model.ownedBy ? <small>{model.ownedBy}</small> : null}
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
                <div className="pricing-form-actions">
                  <button type="button" className="secondary-btn" onClick={() => setRuntimeTestModalOpen(false)}>关闭</button>
                  <div className="runtime-model-input-group" style={{ flex: 1, maxWidth: 400 }}>
                    <input
                      type="text"
                      value={runtimeModelsUrls[runtimeTestModalTarget.key] || ''}
                      onChange={(e) => setRuntimeModelsUrls((prev) => ({ ...prev, [runtimeTestModalTarget.key]: e.target.value }))}
                      placeholder={`${runtimeTestModalTarget.baseUrl?.replace(/\/$/, '').endsWith('/v1') ? runtimeTestModalTarget.baseUrl.replace(/\/$/, '') + '/models' : (runtimeTestModalTarget.baseUrl?.replace(/\/$/, '') || '') + '/v1/models'}`}
                      style={{ minWidth: 0 }}
                    />
                    <button type="button" className="table-btn" onClick={() => void fetchRuntimeModels(runtimeTestModalTarget)} disabled={runtimeModelsLoading}>{runtimeModelsLoading ? '获取中...' : '获取可用模型'}</button>
                  </div>
                  <button type="button" className="primary-btn" onClick={() => void testRuntimeConfig(runtimeTestModalTarget)} disabled={runtimeTestingKey === runtimeTestModalTarget.key}>{runtimeTestingKey === runtimeTestModalTarget.key ? '测试中...' : '重新测试'}</button>
                </div>
              </aside>
            </div>
          )}

          {pricingDetailOpen && selectedPricing && (
            <>
            <AdminDetailShell open={pricingDetailOpen} onClose={() => setPricingDetailOpen(false)} eyebrow="定价详情" title={selectedPricing.model} subtitle="查看当前定价快照，并在此更新或删除该规则。" icon={getAdminModuleIcon('billing')} entityType="Billing Pricing" lastUpdated={`生效 ${selectedPricing.effectiveFrom ? new Date(selectedPricing.effectiveFrom).toLocaleString('zh-CN', { hour12: false }) : '-'}`} risk={selectedPricing.isActive ? '风险：影响新请求计费' : '风险：已删除规则'} metrics={[{ label: '输入单价', value: selectedPricing.promptPricePer1kTokens }, { label: '输出单价', value: selectedPricing.completionPricePer1kTokens }, { label: '缓存命中', value: `${(selectedPricing.cacheHitRatio * 100).toFixed(0)}%` }, { label: '缓存创建', value: `${(selectedPricing.cacheCreationRatio * 100).toFixed(0)}%` }]} status={<StatusBadge tone={selectedPricing.isActive ? 'success' : 'danger'}>{selectedPricing.isActive ? '生效中' : '已删除'}</StatusBadge>} size="lg" moreActions={<><AdminButton variant="primary" onClick={() => openPricingUpdate(selectedPricing)}>更改定价</AdminButton><AdminButton variant="secondary" icon={getAdminActionIcon('logs')} onClick={() => setPricingDiffOpen(true)}>查看 Diff</AdminButton></>}>
                <div className="pricing-detail-flat">
                  <div className="pricing-detail-meta-row">
                    <div className="pricing-detail-meta-item">
                      <span className="pricing-detail-meta-label">模型</span>
                      <IdToken label="模型" value={selectedPricing.model} head={18} tail={10} />
                    </div>
                    <div className="pricing-detail-meta-item">
                      <span className="pricing-detail-meta-label">提供商</span>
                      <span className="pricing-detail-meta-value">{providerLabel(normalizePricingProvider(selectedPricing.model, selectedPricing.modelProvider))}</span>
                    </div>
                    <div className="pricing-detail-meta-item">
                      <span className="pricing-detail-meta-label">状态</span>
                      <StatusBadge tone={selectedPricing.isActive ? 'success' : 'danger'}>{selectedPricing.isActive ? '生效中' : '已删除'}</StatusBadge>
                    </div>
                    <div className="pricing-detail-meta-item">
                      <span className="pricing-detail-meta-label">生效时间</span>
                      <span className="pricing-detail-meta-value">{selectedPricing.effectiveFrom ? new Date(selectedPricing.effectiveFrom).toLocaleString('zh-CN', { hour12: false }) : '立即生效'}</span>
                    </div>
                  </div>

                  <div className="pricing-detail-events">
                    <h4 className="pricing-detail-events-title">定价事件</h4>
                    <AuditTimeline
                      emptyText="暂无定价历史事件。"
                      items={[
                        ...(selectedPricing.effectiveFrom ? [{
                          id: 'effective-from',
                          title: selectedPricing.isActive ? '当前定价生效' : '定价记录生效',
                          time: new Date(selectedPricing.effectiveFrom).toLocaleString('zh-CN', { hour12: false }),
                          tone: selectedPricing.isActive ? 'success' as const : 'neutral' as const,
                          meta: [{ label: '状态', value: selectedPricing.isActive ? '生效中' : '已删除' }],
                        }] : []),
                        ...(selectedPricing.effectiveUntil ? [{
                          id: 'effective-until',
                          title: '定价结束',
                          time: new Date(selectedPricing.effectiveUntil).toLocaleString('zh-CN', { hour12: false }),
                          tone: 'warning' as const,
                        }] : []),
                      ]}
                    />
                  </div>
                </div>

              </AdminDetailShell>
              <DiffDrawer open={pricingDiffOpen} onClose={() => setPricingDiffOpen(false)} title="Pricing Diff" objectLabel={selectedPricing.model} fields={[{ key: 'prompt', label: '输入单价', before: selectedPricing.promptPricePer1kTokens, after: pricingFormOpen ? pricingForm.promptPricePer1kTokens || '-' : selectedPricing.promptPricePer1kTokens, changeType: pricingFormOpen && String(selectedPricing.promptPricePer1kTokens) !== pricingForm.promptPricePer1kTokens ? 'changed' : 'unchanged' }, { key: 'completion', label: '输出单价', before: selectedPricing.completionPricePer1kTokens, after: pricingFormOpen ? pricingForm.completionPricePer1kTokens || '-' : selectedPricing.completionPricePer1kTokens, changeType: pricingFormOpen && String(selectedPricing.completionPricePer1kTokens) !== pricingForm.completionPricePer1kTokens ? 'changed' : 'unchanged' }, { key: 'cacheHit', label: '缓存命中', before: `${formatPercentInput(selectedPricing.cacheHitRatio * 100)}%`, after: pricingFormOpen ? `${pricingForm.cacheHitRatio || '-'}%` : `${formatPercentInput(selectedPricing.cacheHitRatio * 100)}%`, changeType: pricingFormOpen && formatPercentInput(selectedPricing.cacheHitRatio * 100) !== pricingForm.cacheHitRatio ? 'changed' : 'unchanged' }, { key: 'cacheCreation', label: '缓存创建', before: `${formatPercentInput(selectedPricing.cacheCreationRatio * 100)}%`, after: pricingFormOpen ? `${pricingForm.cacheCreationRatio || '-'}%` : `${formatPercentInput(selectedPricing.cacheCreationRatio * 100)}%`, changeType: pricingFormOpen && formatPercentInput(selectedPricing.cacheCreationRatio * 100) !== pricingForm.cacheCreationRatio ? 'changed' : 'unchanged' }]} impactItems={[selectedPricing.isActive ? '该规则影响新请求计费' : '该规则已删除，不参与新请求计费', '历史 usage 不回写']} rollbackHint="更新会创建新的定价版本；历史 usage 不回写。" syncHint="Before 使用 selectedPricing，After 仅在编辑表单打开时使用 pricingForm，否则保持当前快照。" />
              </>
          )}
          <DangerConfirmDialog open={Boolean(deletePricingTarget)} title="删除模型定价" objectLabel="模型定价" objectId={deletePricingTarget?.id} objectName={deletePricingTarget?.model} actionLabel="删除定价" confirmText="DELETE" reasonRequired loading={deletePricingLoading} reversibility="partially_reversible" impactItems={["该规则不再参与新请求计费", "历史账单不会回写"]} nonImpactItems={["不会删除历史使用明细"]} onCancel={() => setDeletePricingTarget(null)} onConfirm={() => void handleDeletePricing()} />
          <DangerConfirmDialog open={updateConfirmOpen} title="确认更新模型定价" objectLabel="模型定价" objectName={pricingForm.model} actionLabel="保存新版本" confirmText="UPDATE" reasonRequired={false} loading={pricingFormLoading} reversibility="partially_reversible" objectMeta={[{ label: '输入单价', value: `${selectedPricing?.promptPricePer1kTokens ?? '-'} → ${promptPrice}` }, { label: '输出单价', value: `${selectedPricing?.completionPricePer1kTokens ?? '-'} → ${completionPrice}` }, { label: '缓存命中', value: `${selectedPricing ? formatPercentInput(selectedPricing.cacheHitRatio * 100) : '-'}% → ${cacheHitPercent}%` }, { label: '缓存创建', value: `${selectedPricing ? formatPercentInput(selectedPricing.cacheCreationRatio * 100) : '-'}% → ${cacheCreationPercent}%` }]} impactItems={["将创建新的定价版本", "历史 usage 不回写"]} onCancel={() => setUpdateConfirmOpen(false)} onConfirm={async () => { setUpdateConfirmOpen(false); await submitPricing(); }} />
        </>
      )}

      {/* Stats Tab */}
      {activeTab === 'stats' && (
        <div className="billing-stats-layout-rail billing-stats-layout-fill">
          <BillingStatsDashboard onNotify={onNotify} />
        </div>
      )}

      {/* Logs Tab */}
      {activeTab === 'logs' && (
        <BillingUsageLogs
          onOpenUser={handleUserIdClick}
          onOpenConversation={handleSessionIdClick}
          onNotify={onNotify}
        />
      )}

      {/* Debug Tab */}
      {activeTab === 'debug' && (
        <BillingDebugPanel onNotify={onNotify} />
      )}
      </div>

    </main>
  );
}
