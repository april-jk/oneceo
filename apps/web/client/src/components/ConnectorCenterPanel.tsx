import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Database,
  Github,
  Link2,
  Loader2,
  NotepadText,
  Plus,
  Plug,
  ShieldCheck,
  Slack,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { CONNECTOR_GUIDES } from "@/lib/connector-guides";
import {
  attachSessionConnector,
  clearConnectorAuth,
  completeConnectorOauth,
  getMyConnectorAccounts,
  saveConnectorConfig,
  startConnectorOauth,
  type ConnectorCatalogItem,
  type ConnectorKey,
  type UserConnectorAccount,
} from "@/lib/connectors-client";

type ConnectorCenterPanelProps = {
  targetSessionId?: string | null;
  highlightedConnector?: ConnectorKey | null;
};

type ConnectorFormValues = Record<string, string>;

const iconMap = {
  github: Github,
  slack: Slack,
  notion: NotepadText,
  database: Database,
} as const;

function formatStatus(value: string | null | undefined) {
  if (!value) return "unknown";
  return value.replaceAll("_", " ");
}

function statusTone(value: string) {
  switch (value) {
    case "authorized":
    case "connected":
      return "default";
    case "needs_auth":
    case "not_configured":
      return "secondary";
    case "error":
    case "unavailable":
      return "destructive";
    default:
      return "outline";
  }
}

function buildConnectorRedirectUri(
  location: string,
  search: string,
  connectorKey: ConnectorKey,
  targetSessionId?: string | null
) {
  const url = new URL(location, window.location.origin);
  const params = new URLSearchParams(search);
  [
    "code",
    "state",
    "settings",
    "settingsTab",
    "connector_oauth",
    "connector",
    "targetSessionId",
  ].forEach((key) => params.delete(key));
  params.set("settings", "open");
  params.set("settingsTab", "connectors");
  params.set("connector_oauth", "1");
  params.set("connector", connectorKey);
  if (targetSessionId) {
    params.set("targetSessionId", targetSessionId);
  }
  url.search = params.toString();
  return url.toString();
}

function cleanupConnectorQuery(location: string, search: string) {
  const url = new URL(location, window.location.origin);
  const params = new URLSearchParams(search);
  [
    "code",
    "state",
    "connector_oauth",
    "connector",
    "targetSessionId",
    "settings",
    "settingsTab",
  ].forEach((key) => params.delete(key));
  url.search = params.toString();
  return `${url.pathname}${url.search ? `?${url.searchParams.toString()}` : ""}`;
}

function getFieldValue(
  account: UserConnectorAccount | undefined,
  fieldKey: string,
  previousValue?: string
) {
  if (fieldKey === "displayName") {
    const configDisplayName =
      typeof account?.config?.displayName === "string"
        ? String(account.config.displayName)
        : "";
    return configDisplayName || account?.displayName || previousValue || "";
  }
  if (fieldKey === "accessToken" || fieldKey === "dsn") {
    return previousValue || "";
  }
  const raw = account?.config?.[fieldKey];
  return typeof raw === "string" ? raw : previousValue || "";
}

function buildFormValues(
  item: ConnectorCatalogItem,
  account: UserConnectorAccount | undefined,
  previousValues?: ConnectorFormValues
): ConnectorFormValues {
  const next: ConnectorFormValues = {};
  for (const field of item.configFields) {
    next[field.key] = getFieldValue(account, field.key, previousValues?.[field.key]);
  }
  return next;
}

function buildSavePayload(item: ConnectorCatalogItem, form: ConnectorFormValues) {
  const config: Record<string, unknown> = {};
  const credentials: Record<string, unknown> = {};
  let displayName: string | undefined;

  for (const field of item.configFields) {
    const raw = form[field.key] || "";
    const value = raw.trim();
    if (field.key === "displayName") {
      displayName = value || undefined;
    }
    if (!value) continue;
    if (field.secret) {
      credentials[field.key] = value;
    } else {
      config[field.key] = value;
    }
  }

  return {
    displayName,
    config,
    credentials,
  };
}

export function ConnectorCenterPanel({
  targetSessionId,
  highlightedConnector,
}: ConnectorCenterPanelProps) {
  const [location] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const callbackHandled = useRef(false);

  const effectiveTargetSessionId = targetSessionId || params.get("targetSessionId");
  const effectiveHighlightedConnector =
    highlightedConnector || ((params.get("connector") || "") as ConnectorKey | null);

  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<ConnectorKey | null>(
    effectiveHighlightedConnector || null
  );
  const [catalog, setCatalog] = useState<ConnectorCatalogItem[]>([]);
  const [accounts, setAccounts] = useState<Record<string, UserConnectorAccount>>({});
  const [formState, setFormState] = useState<Record<string, ConnectorFormValues>>({});

  const load = async () => {
    setLoading(true);
    try {
      const result = await getMyConnectorAccounts();
      setCatalog(result.catalog);
      const accountMap = Object.fromEntries(
        result.accounts.map((item) => [item.connectorKey, item])
      );
      setAccounts(accountMap);
      setFormState((prev) => {
        const next = { ...prev };
        for (const item of result.catalog) {
          const account = accountMap[item.key];
          next[item.key] = buildFormValues(item, account, prev[item.key]);
        }
        return next;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load connectors");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (effectiveHighlightedConnector) {
      setSelectedKey(effectiveHighlightedConnector);
    }
  }, [effectiveHighlightedConnector]);

  useEffect(() => {
    if (!selectedKey) return;
    if (catalog.some((item) => item.key === selectedKey)) return;
    setSelectedKey(null);
  }, [catalog, selectedKey]);

  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");
    const connector = params.get("connector") as ConnectorKey | null;
    if (params.get("connector_oauth") !== "1") return;
    if (!code || !state || !connector) return;
    if (callbackHandled.current) return;
    callbackHandled.current = true;
    setActionKey(`oauth:${connector}`);
    void (async () => {
      try {
        const redirectUri = buildConnectorRedirectUri(
          location,
          search,
          connector,
          effectiveTargetSessionId
        );
        const result = await completeConnectorOauth(connector, {
          code,
          state,
          redirectUri,
        });
        const attachTarget = result.returnToSessionId || effectiveTargetSessionId;
        let attachError: Error | null = null;
        if (attachTarget) {
          try {
            await attachSessionConnector(attachTarget, connector);
          } catch (error) {
            attachError =
              error instanceof Error ? error : new Error("连接器挂载失败");
          }
        }
        window.history.replaceState(
          null,
          "",
          cleanupConnectorQuery(location, search)
        );
        await load();
        if (attachError) {
          toast.error(`授权已完成，但挂载失败：${attachError.message}`);
        } else if (attachTarget) {
          toast.success("授权完成，连接器已挂载到目标会话");
        } else {
          toast.success("授权完成");
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "OAuth callback failed");
      } finally {
        setActionKey(null);
      }
    })();
  }, [effectiveTargetSessionId, load, location, params, search]);

  const handleFieldChange = (
    connectorKey: ConnectorKey,
    field: string,
    value: string
  ) => {
    setFormState((prev) => ({
      ...prev,
      [connectorKey]: {
        ...(prev[connectorKey] || {}),
        [field]: value,
      },
    }));
  };

  const handleSave = async (item: ConnectorCatalogItem) => {
    setActionKey(`save:${item.key}`);
    try {
      const state = formState[item.key] || {};
      const payload = buildSavePayload(item, state);
      const hasExistingSecret = Boolean(accounts[item.key]?.secretSummary);
      const hasNewCredential = Object.keys(payload.credentials).length > 0;
      if (!hasExistingSecret && !hasNewCredential) {
        throw new Error(
          item.key === "postgres"
            ? "请先粘贴数据库连接串"
            : "请先粘贴 token 或 secret"
        );
      }
      await saveConnectorConfig(item.key, {
        displayName: payload.displayName,
        config: payload.config,
        credentials: payload.credentials,
      });
      let attachError: Error | null = null;
      if (effectiveTargetSessionId) {
        try {
          await attachSessionConnector(effectiveTargetSessionId, item.key);
        } catch (error) {
          attachError =
            error instanceof Error ? error : new Error("连接器挂载失败");
        }
      }
      await load();
      if (attachError) {
        toast.error(`连接器配置已保存，但挂载失败：${attachError.message}`);
      } else if (effectiveTargetSessionId) {
        toast.success("配置已保存，并已挂载到目标会话");
      } else {
        toast.success("连接器配置已保存");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save connector failed");
    } finally {
      setActionKey(null);
    }
  };

  const handleOAuth = async (item: ConnectorCatalogItem) => {
    setActionKey(`oauth:${item.key}`);
    try {
      const redirectUri = buildConnectorRedirectUri(
        location,
        search,
        item.key,
        effectiveTargetSessionId
      );
      const { authUrl } = await startConnectorOauth(item.key, {
        redirectUri,
        returnToSessionId: effectiveTargetSessionId || undefined,
      });
      window.location.href = authUrl;
    } catch (error) {
      setActionKey(null);
      toast.error(error instanceof Error ? error.message : "OAuth start failed");
    }
  };

  const handleDisconnect = async (connectorKey: ConnectorKey) => {
    setActionKey(`disconnect:${connectorKey}`);
    try {
      await clearConnectorAuth(connectorKey);
      toast.success("连接器授权已清除");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Disconnect failed");
    } finally {
      setActionKey(null);
    }
  };

  const cards = useMemo(
    () =>
      catalog.map((item) => ({
        item,
        account: accounts[item.key],
        form: formState[item.key] || {},
      })),
    [accounts, catalog, formState]
  );

  const selectedCard =
    cards.find(({ item }) => item.key === selectedKey) || null;

  const renderTargetBanner = () =>
    effectiveTargetSessionId ? (
      <div className="mx-6 mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <div className="flex items-center gap-2 font-medium">
          <ShieldCheck className="h-4 w-4" />
          正在为目标会话准备挂载
        </div>
        <p className="mt-1 text-emerald-700">Session ID: {effectiveTargetSessionId}</p>
      </div>
    ) : null;

  const openSuggestedConnector = () => {
    const preferred =
      cards.find(({ account, item }) => item.available && account?.authStatus !== "authorized") ||
      cards.find(({ item }) => item.available) ||
      cards[0];
    if (preferred) {
      setSelectedKey(preferred.item.key);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[28px] border border-border/70 bg-card">
      <div className="hidden items-center gap-1 border-b border-border/70 px-6 py-5 md:flex">
        <div className="flex flex-col">
          <h3 className="text-[18px] font-medium leading-7 text-foreground">连接器</h3>
          <p className="text-sm text-muted-foreground">统一管理用户级授权与密钥配置</p>
        </div>
      </div>

      {renderTargetBanner()}

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col px-6">
          {cards.map(({ item, account }) => {
            const Icon = iconMap[item.icon as keyof typeof iconMap] || Link2;
            const isAuthorized = account?.authStatus === "authorized";
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSelectedKey(item.key)}
                className="flex w-full items-center gap-3 overflow-hidden border-b border-border/70 px-0 py-4 text-left transition hover:bg-muted/30"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background">
                  <Icon className="h-5 w-5 text-foreground/80" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-sm font-medium text-foreground">
                      {item.name}
                    </div>
                    {isAuthorized ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    ) : null}
                  </div>
                  <div className="truncate text-xs leading-5 text-muted-foreground">
                    {item.description}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge variant={statusTone(account?.authStatus || "not_configured")}>
                    {formatStatus(account?.authStatus || "not_configured")}
                  </Badge>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </div>
              </button>
            );
          })}

          {!loading && cards.length === 0 ? (
            <div className="py-10 text-sm text-muted-foreground">暂无可用连接器</div>
          ) : null}
        </div>
      </ScrollArea>

      <div className="border-t border-border/70 px-6 py-4">
        <Button
          variant="outline"
          className="rounded-xl"
          onClick={openSuggestedConnector}
          disabled={loading || cards.length === 0}
        >
          <Plus className="mr-2 h-4 w-4" />
          添加连接器
        </Button>
      </div>

      <Dialog open={Boolean(selectedCard)} onOpenChange={(open) => !open && setSelectedKey(null)}>
        {selectedCard ? (() => {
          const { item, account, form } = selectedCard;
          const Icon = iconMap[item.icon as keyof typeof iconMap] || Link2;
          const guide = CONNECTOR_GUIDES[item.key];
          const busy =
            actionKey === `save:${item.key}` ||
            actionKey === `oauth:${item.key}` ||
            actionKey === `disconnect:${item.key}` ||
            actionKey === `attach:${item.key}`;
          const supportsManual = item.configFields.length > 0;
          const isAuthorized = account?.authStatus === "authorized";

          return (
            <DialogContent className="max-h-[82vh] max-w-4xl overflow-hidden rounded-[28px] border border-border/70 p-0">
              <DialogHeader className="border-b border-border/70 px-6 py-5 text-left">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-background">
                    <Icon className="h-5 w-5 text-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <DialogTitle className="text-xl font-semibold text-foreground">
                        {item.name}
                      </DialogTitle>
                      <Badge variant={statusTone(account?.authStatus || "not_configured")}>
                        {formatStatus(account?.authStatus || "not_configured")}
                      </Badge>
                    </div>
                    <DialogDescription className="mt-2 text-sm leading-6 text-muted-foreground">
                      {item.description}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <ScrollArea className="max-h-[calc(82vh-96px)]">
                <div className="space-y-5 px-6 py-5">
                  <div className="rounded-2xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <span>当前账号</span>
                      <span className="truncate text-right text-foreground/80">
                        {account?.displayName || account?.secretSummary || "未配置"}
                      </span>
                    </div>
                    {account?.lastAuthAt ? (
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <span>最近授权</span>
                        <span className="text-right text-foreground/80">
                          {new Date(account.lastAuthAt).toLocaleString()}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-3xl border border-border/70 bg-background px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">快速开始</p>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          {guide.intro}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {item.oauth?.supported ? "推荐 OAuth" : "推荐手动配置"}
                      </Badge>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {guide.quickLinks.map((link) => (
                        <Button
                          key={link.href}
                          asChild
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                        >
                          <a
                            href={link.href}
                            target="_blank"
                            rel="noreferrer"
                            title={link.description}
                          >
                            <ArrowUpRight className="h-4 w-4" />
                            {link.label}
                          </a>
                        </Button>
                      ))}
                      {guide.exampleValue && guide.exampleLabel ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(guide.exampleValue || "");
                              toast.success("模板已复制到剪贴板");
                            } catch {
                              toast.error("复制失败，请手动复制示例");
                            }
                          }}
                        >
                          <ShieldCheck className="h-4 w-4" />
                          {guide.exampleLabel}
                        </Button>
                      ) : null}
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                          How To Get It
                        </p>
                        <ol className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                          {guide.steps.map((step, index) => (
                            <li key={step} className="flex gap-2">
                              <span className="font-medium text-foreground">{index + 1}.</span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ol>
                      </div>

                      {guide.tips?.length ? (
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                            Tips
                          </p>
                          <div className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                            {guide.tips.map((tip) => (
                              <p key={tip}>• {tip}</p>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {guide.exampleValue ? (
                      <div className="mt-4 rounded-2xl bg-muted/50 px-3 py-3 font-mono text-xs text-foreground/80">
                        {guide.exampleValue}
                      </div>
                    ) : null}
                  </div>

                  {item.availabilityReason ? (
                    <div className="flex gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{item.availabilityReason}</span>
                    </div>
                  ) : null}

                  {account?.lastError ? (
                    <div className="flex gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{account.lastError}</span>
                    </div>
                  ) : null}

                  {supportsManual ? (
                    <div className="space-y-3 rounded-3xl border border-border/70 bg-background px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">手动配置</p>
                          <p className="text-sm text-muted-foreground">
                            {item.oauth?.supported
                              ? "除了 OAuth，也可以直接保存现有 token / key。"
                              : "从官方后台复制后直接保存到当前用户配置。"}
                          </p>
                        </div>
                        {isAuthorized ? (
                          <Badge variant="secondary">留空则保留当前 secret</Badge>
                        ) : null}
                      </div>

                      {item.configFields.map((field) => {
                        const fieldDescription = [
                          field.description,
                          field.secret && isAuthorized
                            ? "留空则保留当前已保存的 secret。"
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" ");

                        const commonProps = {
                          id: `${item.key}-${field.key}`,
                          value: form[field.key] || "",
                          onChange: (
                            event: React.ChangeEvent<
                              HTMLInputElement | HTMLTextAreaElement
                            >
                          ) => handleFieldChange(item.key, field.key, event.target.value),
                          placeholder: field.placeholder,
                        };

                        return (
                          <div key={field.key} className="space-y-2">
                            <Label htmlFor={`${item.key}-${field.key}`}>{field.label}</Label>
                            {field.type === "textarea" ? (
                              <Textarea
                                {...commonProps}
                                className="min-h-28 rounded-2xl"
                              />
                            ) : (
                              <Input
                                {...commonProps}
                                className="h-11 rounded-2xl"
                                type={field.secret ? "password" : field.type}
                              />
                            )}
                            {fieldDescription ? (
                              <p className="text-xs leading-5 text-muted-foreground">
                                {fieldDescription}
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                      OAuth 已启用，授权完成后会把用户级 token 统一保存，后续任意
                      session 都可直接复用。
                    </div>
                  )}

                  <Separator />

                  <div className="flex flex-wrap gap-3">
                    {supportsManual ? (
                      <Button
                        variant={item.oauth?.supported ? "secondary" : "default"}
                        className="rounded-2xl"
                        disabled={busy || !item.available}
                        onClick={() => void handleSave(item)}
                      >
                        {busy && actionKey === `save:${item.key}` ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="mr-2 h-4 w-4" />
                        )}
                        {item.key === "postgres"
                          ? "保存 DSN"
                          : item.oauth?.supported
                            ? "保存手动凭证"
                            : "保存配置"}
                      </Button>
                    ) : null}

                    {item.oauth?.supported ? (
                      <Button
                        className="rounded-2xl"
                        disabled={busy || !item.available}
                        onClick={() => void handleOAuth(item)}
                      >
                        {busy && actionKey === `oauth:${item.key}` ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <ArrowUpRight className="mr-2 h-4 w-4" />
                        )}
                        {isAuthorized ? "重新授权" : "去授权"}
                      </Button>
                    ) : null}

                    {effectiveTargetSessionId && isAuthorized ? (
                      <Button
                        variant="secondary"
                        className="rounded-2xl"
                        disabled={busy}
                        onClick={async () => {
                          setActionKey(`attach:${item.key}`);
                          try {
                            await attachSessionConnector(effectiveTargetSessionId, item.key);
                            toast.success("连接器已挂载到目标会话");
                          } catch (error) {
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : "Attach connector failed"
                            );
                          } finally {
                            setActionKey(null);
                          }
                        }}
                      >
                        <Plug className="mr-2 h-4 w-4" />
                        挂载到当前会话
                      </Button>
                    ) : null}

                    {isAuthorized ? (
                      <Button
                        variant="outline"
                        className="rounded-2xl"
                        disabled={busy}
                        onClick={() => void handleDisconnect(item.key)}
                      >
                        <Unplug className="mr-2 h-4 w-4" />
                        清除授权
                      </Button>
                    ) : null}
                  </div>
                </div>
              </ScrollArea>
            </DialogContent>
          );
        })() : null}
      </Dialog>

      {loading ? (
        <div className="border-t border-border/70 px-6 py-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载连接器配置
          </div>
        </div>
      ) : null}
    </div>
  );
}
