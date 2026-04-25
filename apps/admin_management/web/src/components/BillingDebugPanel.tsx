import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBillingErrorMessage, readBillingResponseError, type BillingNotify } from './billing-feedback';

interface ModelCandidate {
  model: string;
  provider: string;
  hasActivePricing: boolean;
}

interface BillingDebugPanelProps {
  onNotify?: BillingNotify;
}

const LONG_PREFIX = Array.from({ length: 140 }, (_, index) => (
  `稳定缓存前缀 ${index + 1}: OneCEO billing debug cache verification content. ` +
  'This paragraph is intentionally repeated to exceed the explicit cache minimum token threshold.'
)).join('\n');

const SHORT_PREFIX = '你是 oneceo 计费调试助手。请保持回答简短。';

const UPSTREAM_LABEL = 'DashScope 兼容接口';
const UPSTREAM_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

function formatJson(value: unknown) {
  if (value === null || value === undefined) return 'null';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

type RequestTab = 'params' | 'body';
type ResponseTab = 'summary' | 'usage' | 'calculation' | 'raw';

export function BillingDebugPanel({ onNotify }: BillingDebugPanelProps) {
  const [modelCandidates, setModelCandidates] = useState<ModelCandidate[]>([]);
  const [model, setModel] = useState('qwen3-vl-plus');
  const [cacheMode, setCacheMode] = useState<'none' | 'implicit' | 'explicit'>('explicit');
  const [mode, setMode] = useState<'request_only' | 'dry_run'>('request_only');
  const [systemPrompt, setSystemPrompt] = useState(LONG_PREFIX);
  const [userPrompt, setUserPrompt] = useState('请只回答：收到。');
  const [maxTokens, setMaxTokens] = useState('64');
  const [temperature, setTemperature] = useState('0');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [requestTab, setRequestTab] = useState<RequestTab>('params');
  const [responseTab, setResponseTab] = useState<ResponseTab>('summary');
  const [systemExpanded, setSystemExpanded] = useState(true);
  const [userExpanded, setUserExpanded] = useState(true);

  const promptChars = systemPrompt.length + userPrompt.length;
  const canSubmit = Boolean(model.trim()) && Boolean(systemPrompt.trim()) && Boolean(userPrompt.trim()) && !loading;

  const activeCandidates = useMemo(() => (
    modelCandidates.filter((item) => item.hasActivePricing)
  ), [modelCandidates]);

  const fetchModelCandidates = useCallback(async () => {
    try {
      const response = await fetch('/api/internal/billing/pricing/model-candidates', { credentials: 'include' });
      if (!response.ok) {
        onNotify?.('error', '加载失败', await readBillingResponseError(response, '无法获取模型候选'));
        return;
      }
      const data = await response.json();
      const items: ModelCandidate[] = data.items || [];
      setModelCandidates(items);
      const preferred = items.find((item) => item.model === 'qwen3-vl-plus') || items.find((item) => item.hasActivePricing);
      if (preferred) setModel((prev) => prev || preferred.model);
    } catch (error) {
      onNotify?.('error', '加载失败', getBillingErrorMessage(error, '无法获取模型候选'));
    }
  }, [onNotify]);

  useEffect(() => {
    void fetchModelCandidates();
  }, [fetchModelCandidates]);

  const applyPreset = (preset: 'short' | 'implicit' | 'explicit') => {
    if (preset === 'short') {
      setCacheMode('none');
      setSystemPrompt(SHORT_PREFIX);
      setUserPrompt('请只回答：短请求。');
      return;
    }
    if (preset === 'implicit') {
      setCacheMode('implicit');
      setSystemPrompt(LONG_PREFIX);
      setUserPrompt('请只回答：隐式缓存测试。');
      return;
    }
    setCacheMode('explicit');
    setSystemPrompt(LONG_PREFIX);
    setUserPrompt('请只回答：显式缓存测试。');
  };

  const runDebugRequest = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
      const response = await fetch('/api/internal/billing/debug/llm-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          model: model.trim(),
          cacheMode,
          mode,
          systemPrompt,
          userPrompt,
          maxTokens: Number(maxTokens) || 64,
          temperature: Number(temperature) || 0,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        onNotify?.('error', '调试失败', data?.error || data?.message || '调试请求失败');
      }
      setResult(data);
    } catch (error) {
      onNotify?.('error', '调试失败', getBillingErrorMessage(error, '调试请求失败'));
    } finally {
      setLoading(false);
    }
  };

  const requestTabs: { key: RequestTab; label: string }[] = [
    { key: 'params', label: '参数' },
    { key: 'body', label: '请求体' },
  ];

  const responseTabs: { key: ResponseTab; label: string }[] = [
    { key: 'summary', label: '概览' },
    { key: 'usage', label: 'Usage' },
    { key: 'calculation', label: '计费' },
    { key: 'raw', label: 'Raw JSON' },
  ];

  return (
    <section className="sub-panel billing-debug-panel">
      {/* Header */}
      <div className="user-management-list-head" style={{ padding: '14px 16px 0' }}>
        <div>
          <p className="section-tag">计费调试工具</p>
          <p className="panel-caption">主动请求 DashScope 兼容接口，查看 usage、缓存字段与积分 dry-run 计算。</p>
        </div>
      </div>

      {/* Warning Banner */}
      <div className="sub-panel" style={{
        margin: '12px 16px 0',
        padding: '10px 14px',
        borderColor: 'color-mix(in srgb, var(--theme-warning, #f59e0b) 35%, var(--border))',
      }}>
        <strong>调试请求会产生真实上游模型成本；默认不会扣用户积分。</strong>
        <p className="panel-caption" style={{ marginTop: '4px' }}>
          首版只支持"只请求不扣费"和"模拟扣费"，不会写入用户消费记录。
        </p>
      </div>

      {/* URL Bar */}
      <div className="billing-debug-url-bar">
        <div className="billing-debug-url-line">
          <div className="billing-debug-url-internal">
            <span className="billing-debug-method-badge">POST</span>
            <code className="billing-debug-endpoint">/api/internal/billing/debug/llm-request</code>
          </div>
          <button type="button" className="secondary-btn billing-debug-send-btn" onClick={runDebugRequest} disabled={!canSubmit}>
            {loading ? '请求中...' : '发送请求'}
          </button>
        </div>
        <div className="billing-debug-url-upstream">
          <span className="billing-debug-upstream-label">上游</span>
          <span className="billing-debug-upstream-name">{UPSTREAM_LABEL}</span>
          <code className="billing-debug-upstream-url">{UPSTREAM_URL}</code>
        </div>
      </div>

      {/* Main Content */}
      <div className="billing-debug-layout">
        {/* Left: Request */}
        <section className="sub-panel billing-debug-request-panel">
          <div className="billing-debug-panel-head">
            <p className="section-tag">请求配置</p>
            <div className="billing-debug-tabbar">
              {requestTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`secondary-btn ${requestTab === tab.key ? 'active' : ''}`}
                  onClick={() => setRequestTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {requestTab === 'params' && (
            <div className="billing-debug-section-body">
              <div className="user-management-filter-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                <label>
                  <span>模型</span>
                  <select value={model} onChange={(event) => setModel(event.target.value)}>
                    {activeCandidates.length === 0 ? <option value={model}>{model}</option> : null}
                    {activeCandidates.map((candidate) => (
                      <option key={candidate.model} value={candidate.model}>{candidate.model} · {candidate.provider}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>请求模式</span>
                  <select value={mode} onChange={(event) => setMode(event.target.value as 'request_only' | 'dry_run')}>
                    <option value="request_only">只请求不扣费</option>
                    <option value="dry_run">模拟扣费</option>
                  </select>
                </label>
                <label>
                  <span>缓存模式</span>
                  <select value={cacheMode} onChange={(event) => setCacheMode(event.target.value as 'none' | 'implicit' | 'explicit')}>
                    <option value="none">不主动启用</option>
                    <option value="implicit">隐式缓存观测</option>
                    <option value="explicit">显式缓存 cache_control</option>
                  </select>
                </label>
                <label>
                  <span>最大输出 tokens</span>
                  <input type="number" min={1} max={512} value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} />
                </label>
                <label>
                  <span>temperature</span>
                  <input type="number" min={0} max={2} step="0.1" value={temperature} onChange={(event) => setTemperature(event.target.value)} />
                </label>
                <label>
                  <span>Prompt 长度</span>
                  <input type="text" readOnly value={`${promptChars.toLocaleString()} 字符`} />
                </label>
              </div>

              <div className="user-management-filter-actions" style={{ justifyContent: 'flex-start', marginTop: '12px', flexWrap: 'wrap' }}>
                <button type="button" className="secondary-btn" onClick={() => applyPreset('short')}>短请求</button>
                <button type="button" className="secondary-btn" onClick={() => applyPreset('implicit')}>隐式缓存样例</button>
                <button type="button" className="secondary-btn" onClick={() => applyPreset('explicit')}>显式缓存样例</button>
              </div>
            </div>
          )}

          {requestTab === 'body' && (
            <div className="billing-debug-section-body">
              {/* System Prompt - Collapsible */}
              <div className="billing-debug-collapsible">
                <button
                  type="button"
                  className="billing-debug-collapsible-head"
                  onClick={() => setSystemExpanded((v) => !v)}
                >
                  <span className="billing-debug-collapsible-title">
                    <span className="billing-debug-collapsible-icon">{systemExpanded ? '▼' : '▶'}</span>
                    System prompt
                  </span>
                  <span className="billing-debug-collapsible-meta">{systemPrompt.length.toLocaleString()} 字符</span>
                </button>
                {systemExpanded && (
                  <div className="billing-debug-collapsible-body">
                    <textarea
                      value={systemPrompt}
                      onChange={(event) => setSystemPrompt(event.target.value)}
                      className="billing-debug-textarea"
                      rows={5}
                    />
                  </div>
                )}
              </div>

              {/* User Prompt - Collapsible */}
              <div className="billing-debug-collapsible">
                <button
                  type="button"
                  className="billing-debug-collapsible-head"
                  onClick={() => setUserExpanded((v) => !v)}
                >
                  <span className="billing-debug-collapsible-title">
                    <span className="billing-debug-collapsible-icon">{userExpanded ? '▼' : '▶'}</span>
                    User prompt
                  </span>
                  <span className="billing-debug-collapsible-meta">{userPrompt.length.toLocaleString()} 字符</span>
                </button>
                {userExpanded && (
                  <div className="billing-debug-collapsible-body">
                    <textarea
                      value={userPrompt}
                      onChange={(event) => setUserPrompt(event.target.value)}
                      className="billing-debug-textarea"
                      rows={3}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

        </section>

        {/* Right: Response */}
        <section className="sub-panel billing-debug-response-panel">
          <div className="billing-debug-panel-head">
            <p className="section-tag">响应结果</p>
            <div className="billing-debug-tabbar">
              {responseTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`secondary-btn ${responseTab === tab.key ? 'active' : ''}`}
                  onClick={() => setResponseTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {!result ? (
            <div className="empty" style={{ minHeight: 120, display: 'grid', placeItems: 'center' }}>
              尚未发起调试请求
            </div>
          ) : (
            <div className="billing-debug-section-body">
              {responseTab === 'summary' && (
                <div style={{ display: 'grid', gap: '12px' }}>
                  <div className="user-management-summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                    <article className="user-management-summary-card">
                      <span>状态</span>
                      <strong>{result.upstream?.status || '—'}</strong>
                      <small>{result.upstream?.latencyMs ? `${result.upstream.latencyMs}ms` : '—'}</small>
                    </article>
                    <article className="user-management-summary-card">
                      <span>用户端预览</span>
                      <strong>{result.userVisiblePreview || '无法计算'}</strong>
                      <small>{result.charged ? '已扣费' : '未扣费'}</small>
                    </article>
                    <article className="user-management-summary-card">
                      <span>缓存命中</span>
                      <strong>{result.normalizedUsage?.cachedPromptTokens?.toLocaleString?.() || 0}</strong>
                      <small>创建 {result.normalizedUsage?.cacheCreationTokens?.toLocaleString?.() || 0}</small>
                    </article>
                  </div>

                  {Array.isArray(result.warnings) && result.warnings.length > 0 ? (
                    <div className="sub-panel" style={{ padding: '10px' }}>
                      <strong>Warnings</strong>
                      <ul style={{ margin: '8px 0 0 18px' }}>
                        {result.warnings.map((warning: string, index: number) => <li key={`${warning}-${index}`}>{warning}</li>)}
                      </ul>
                    </div>
                  ) : null}

                  <div className="billing-debug-json-block">
                    <div className="billing-debug-json-label">Request / Upstream / Error</div>
                    <pre className="billing-debug-json-pre">{formatJson({ upstream: result.upstream, request: result.request, error: result.error })}</pre>
                  </div>
                </div>
              )}

              {responseTab === 'usage' && (
                <div className="billing-debug-json-block">
                  <div className="billing-debug-json-label">Normalized Usage</div>
                  <pre className="billing-debug-json-pre">{formatJson(result.normalizedUsage)}</pre>
                  <div className="billing-debug-json-label" style={{ marginTop: '10px' }}>Raw Usage</div>
                  <pre className="billing-debug-json-pre">{formatJson(result.rawUsage)}</pre>
                </div>
              )}

              {responseTab === 'calculation' && (
                <div className="billing-debug-json-block">
                  <div className="billing-debug-json-label">Calculation</div>
                  <pre className="billing-debug-json-pre">{formatJson(result.calculation)}</pre>
                  <div className="billing-debug-json-label" style={{ marginTop: '10px' }}>Pricing</div>
                  <pre className="billing-debug-json-pre">{formatJson(result.pricing)}</pre>
                </div>
              )}

              {responseTab === 'raw' && (
                <div className="billing-debug-json-block">
                  <div className="billing-debug-json-label">完整响应 JSON</div>
                  <pre className="billing-debug-json-pre">{formatJson(result)}</pre>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
