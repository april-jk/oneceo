import { useState, useEffect, useCallback } from 'react';
import { BillingStatsDashboard } from './BillingStatsDashboard';
import { BillingUsageLogs } from './BillingUsageLogs';
import { BillingDebugPanel } from './BillingDebugPanel';
import { getBillingErrorMessage, readBillingResponseError, type BillingNotify } from './billing-feedback';
import { AdminButton, AdminDetailShell, AdminStickyInspector, AdminTabs, AuditTimeline, DangerConfirmDialog, DiffDrawer, IdToken, StatusBadge, getAdminActionIcon, getAdminModuleIcon } from './admin-ui';

interface Pricing {
  id: string;
  model: string;
  modelProvider: string;
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
  if (provider === 'qwen') return 'Qwen / 通义千问';
  if (provider === 'anthropic') return 'Anthropic';
  if (provider === 'deepseek') return 'DeepSeek';
  if (provider === 'google') return 'Google';
  if (provider === 'xai') return 'xAI';
  return 'OpenAI';
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
      fetchPricing();
      fetchModelCandidates();
      fetchCacheConfig();
    }
  }, [activeTab, fetchPricing, fetchModelCandidates, fetchCacheConfig]);

  const tabs = [
    { key: 'stats' as const, label: '平台统计' },
    { key: 'pricing' as const, label: '定价配置' },
    { key: 'logs' as const, label: '使用明细' },
    { key: 'debug' as const, label: '调试工具' },
  ];

  const activePricing = pricing.filter((item) => item.isActive);

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
          <section className="sub-panel user-management-list-panel">
            <div className="user-management-list-head">
              <div>
                <p className="section-tag">定价配置</p>
                <p className="panel-caption">共 {activePricing.length} 条生效规则</p>
              </div>
              <div className="user-management-filter-actions">
                <AdminButton variant="secondary" onClick={() => openPricingForm()}>
                  + 新建定价
                </AdminButton>
              </div>
            </div>

            <div className="table-wrap user-management-table-wrap" aria-live="polite">
              <table className="user-management-table">
                <colgroup>
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '14%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th><span className="runtime-th-label">模型</span></th>
                    <th><span className="runtime-th-label">提供商</span></th>
                    <th><span className="runtime-th-label">输入单价</span></th>
                    <th><span className="runtime-th-label">输出单价</span></th>
                    <th><span className="runtime-th-label">缓存比例</span></th>
                    <th><span className="runtime-th-label">状态</span></th>
                    <th className="runtime-col-actions"><span className="runtime-th-label">操作</span></th>
                  </tr>
                </thead>
                <tbody>
                  {activePricing.length === 0 ? (
                    <tr><td colSpan={7} className="empty">暂无定价数据</td></tr>
                  ) : (
                    activePricing.map((p) => {
                      const normalizedProvider = normalizePricingProvider(p.model, p.modelProvider);
                      return (
                      <tr key={p.id}>
                        <td>
                          <div className="user-management-table-user">
                            <div className="user-management-table-user-head">
                              <strong>{p.model}</strong>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack">
                            <StatusBadge tone={normalizedProvider === 'openai' ? 'success' : 'neutral'}>
                              {providerLabel(normalizedProvider)}
                            </StatusBadge>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack user-management-table-metric">
                            <strong>{p.promptPricePer1kTokens}</strong>
                            <small>/ 1k tokens</small>
                            {p.effectiveFrom ? <small>生效 {new Date(p.effectiveFrom).toLocaleString('zh-CN', { hour12: false })}</small> : null}
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack user-management-table-metric">
                            <strong>{p.completionPricePer1kTokens}</strong>
                            <small>/ 1k tokens</small>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack">
                            {p.cacheHitRatio > 0 && (
                              <span>命中 {(p.cacheHitRatio * 100).toFixed(0)}%</span>
                            )}
                            {p.cacheCreationRatio > 0 && (
                              <span>创建 {(p.cacheCreationRatio * 100).toFixed(0)}%</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-cell-stack">
                            <StatusBadge tone={p.isActive ? 'success' : 'danger'}>
                              {p.isActive ? '生效中' : '已删除'}
                            </StatusBadge>
                          </div>
                        </td>
                        <td>
                          <div className="user-management-table-actions">
                            <button
                              type="button"
                              className="table-btn"
                              onClick={() => openPricingDetail(p)}
                            >
                              详情
                            </button>
                          </div>
                        </td>
                      </tr>
                    );})
                  )}
                </tbody>
              </table>
            </div>
            <div className="admin-mobile-card-list" aria-label="定价配置移动列表">
              {activePricing.length === 0 ? <p className="empty">暂无定价数据</p> : activePricing.map((p) => (
                <article key={p.id} className="admin-mobile-card">
                  <div className="admin-mobile-card-head"><strong>{p.model}</strong><StatusBadge tone={p.isActive ? 'success' : 'danger'}>{p.isActive ? '生效中' : '已删除'}</StatusBadge></div>
                  <div className="admin-mobile-card-meta"><span>{providerLabel(normalizePricingProvider(p.model, p.modelProvider))}</span><span>输入 {p.promptPricePer1kTokens}</span><span>输出 {p.completionPricePer1kTokens}</span></div>
                  <AdminButton variant="link" onClick={() => openPricingDetail(p)}>详情</AdminButton>
                </article>
              ))}
            </div>
          </section>

          {/* Pricing Form Modal */}
          {pricingFormOpen && (
            <div className="modal-backdrop" onClick={() => setPricingFormOpen(false)}>
              <aside
                className="pricing-form-modal"
                role="dialog"
                aria-modal="true"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="pricing-form-modal-header">
                  <div className="pricing-form-modal-heading">
                    <p className="section-tag">定价配置</p>
                    <h2>{pricingFormMode === 'update' ? '更新定价配置（创建新版本）' : '新建定价配置'}</h2>
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
                      {pricingFormMode === 'create' ? (
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

          {pricingDetailOpen && selectedPricing && (
            <>
            <AdminDetailShell open={pricingDetailOpen} onClose={() => setPricingDetailOpen(false)} eyebrow="定价详情" title={selectedPricing.model} subtitle="查看当前定价快照，并在此更新或删除该规则。" icon={getAdminModuleIcon('billing')} entityType="Billing Pricing" lastUpdated={`生效 ${selectedPricing.effectiveFrom ? new Date(selectedPricing.effectiveFrom).toLocaleString('zh-CN', { hour12: false }) : '-'}`} risk={selectedPricing.isActive ? '风险：影响新请求计费' : '风险：已删除规则'} metrics={[{ label: '输入单价', value: selectedPricing.promptPricePer1kTokens }, { label: '输出单价', value: selectedPricing.completionPricePer1kTokens }, { label: '缓存命中', value: `${(selectedPricing.cacheHitRatio * 100).toFixed(0)}%` }, { label: '缓存创建', value: `${(selectedPricing.cacheCreationRatio * 100).toFixed(0)}%` }]} status={<StatusBadge tone={selectedPricing.isActive ? 'success' : 'danger'}>{selectedPricing.isActive ? '生效中' : '已删除'}</StatusBadge>} size="lg" moreActions={<AdminButton variant="secondary" icon={getAdminActionIcon('logs')} onClick={() => setPricingDiffOpen(true)}>查看 Diff</AdminButton>} inspector={<AdminStickyInspector compact title="Actionable Inspector" sections={[{ key: 'risk', title: '当前风险', children: <div className="signal-list"><p>{selectedPricing.isActive ? '影响新请求计费，更新会创建新版本。' : '规则已删除，不参与新请求计费。'}</p></div> }, { key: 'impact', title: '影响范围', children: <div className="signal-list"><p>新请求计费。</p><p>历史 usage 与账单不回写。</p></div> }, { key: 'recent', title: '最近操作', children: <AuditTimeline compact emptyText="暂无定价历史事件。" items={[...(selectedPricing.effectiveFrom ? [{ id: 'effective-from', title: selectedPricing.isActive ? '当前定价生效' : '定价记录生效', time: new Date(selectedPricing.effectiveFrom).toLocaleString('zh-CN', { hour12: false }), tone: selectedPricing.isActive ? 'success' as const : 'neutral' as const, meta: [{ label: '生效状态', value: selectedPricing.isActive ? '生效中' : '已删除' }] }] : []), ...(selectedPricing.effectiveUntil ? [{ id: 'effective-until', title: '定价结束', time: new Date(selectedPricing.effectiveUntil).toLocaleString('zh-CN', { hour12: false }), tone: 'warning' as const }] : [])]} /> }, { key: 'blockers', title: '阻断原因', children: <div className="signal-list"><p>{selectedPricing.isActive ? '当前无前端可见阻断。' : '已删除规则不能继续更新。'}</p></div> }, { key: 'recommend', title: '推荐动作', children: <div className="signal-list"><p>{selectedPricing.isActive ? '更新前查看规则 Diff，确认新请求计费影响。' : '如需恢复请新建定价规则。'}</p></div> }, { key: 'actions', title: '快捷动作', children: <AdminButton variant="secondary" size="sm" onClick={() => setPricingDiffOpen(true)}>查看规则 Diff</AdminButton> }]} />} footer={<><AdminButton variant="secondary" onClick={() => setPricingDetailOpen(false)}>关闭</AdminButton><AdminButton variant="primary" onClick={() => openPricingUpdate(selectedPricing)} disabled={!selectedPricing.isActive}>更新定价</AdminButton></>} dangerZone={<AdminButton variant="dangerSoft" onClick={() => setDeletePricingTarget(selectedPricing)} disabled={!selectedPricing.isActive}>删除</AdminButton>}>
                <div className="admin-detail-section-stack pricing-detail-stack">
                  <section className="admin-detail-section pricing-detail-section">
                    <h3 className="pricing-detail-section-title">审计摘要</h3>
                    <div className="pricing-detail-grid">
                      <div className="pricing-detail-item">
                        <span className="pricing-detail-label">模型</span>
                        <IdToken label="模型" value={selectedPricing.model} head={18} tail={10} />
                      </div>
                      <div className="pricing-detail-item">
                        <span className="pricing-detail-label">提供商</span>
                        <span className="pricing-detail-value">{providerLabel(normalizePricingProvider(selectedPricing.model, selectedPricing.modelProvider))}</span>
                      </div>
                      <div className="pricing-detail-item">
                        <span className="pricing-detail-label">状态</span>
                        <StatusBadge tone={selectedPricing.isActive ? 'success' : 'danger'}>{selectedPricing.isActive ? '生效中' : '已删除'}</StatusBadge>
                      </div>
                      <div className="pricing-detail-item">
                        <span className="pricing-detail-label">生效时间</span>
                        <span className="pricing-detail-value">{selectedPricing.effectiveFrom ? new Date(selectedPricing.effectiveFrom).toLocaleString('zh-CN', { hour12: false }) : '立即生效'}</span>
                      </div>
                    </div>
                  </section>

                  <section className="admin-detail-section pricing-detail-section">
                    <h3 className="pricing-detail-section-title">定价事件</h3>
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
                  </section>

                  <section className="admin-detail-section pricing-detail-section">
                    <h3 className="pricing-detail-section-title">计费规则</h3>
                    <div className="pricing-detail-grid pricing-detail-grid-metrics">
                      <div className="pricing-detail-metric">
                        <span className="pricing-detail-label">输入单价</span>
                        <div className="pricing-detail-metric-body">
                          <span className="pricing-detail-number">{selectedPricing.promptPricePer1kTokens}</span>
                          <span className="pricing-detail-unit">credits / 1k tokens</span>
                        </div>
                      </div>
                      <div className="pricing-detail-metric">
                        <span className="pricing-detail-label">输出单价</span>
                        <div className="pricing-detail-metric-body">
                          <span className="pricing-detail-number">{selectedPricing.completionPricePer1kTokens}</span>
                          <span className="pricing-detail-unit">credits / 1k tokens</span>
                        </div>
                      </div>
                      <div className="pricing-detail-metric">
                        <span className="pricing-detail-label">缓存命中</span>
                        <div className="pricing-detail-metric-body">
                          <span className="pricing-detail-number">{(selectedPricing.cacheHitRatio * 100).toFixed(0)}</span>
                          <span className="pricing-detail-unit">%</span>
                        </div>
                      </div>
                      <div className="pricing-detail-metric">
                        <span className="pricing-detail-label">缓存创建</span>
                        <div className="pricing-detail-metric-body">
                          <span className="pricing-detail-number">{(selectedPricing.cacheCreationRatio * 100).toFixed(0)}</span>
                          <span className="pricing-detail-unit">%</span>
                        </div>
                      </div>
                    </div>
                  </section>
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
        <BillingStatsDashboard onNotify={onNotify} />
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
