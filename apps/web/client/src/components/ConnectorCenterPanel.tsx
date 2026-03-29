import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { CONNECTOR_GUIDES } from "@/lib/connector-guides";
import {
  attachSessionConnector,
  clearConnectorProfileAuth,
  completeConnectorProfileOauth,
  createConnectorProfile,
  deleteConnectorProfile,
  getMyConnectorProfiles,
  setDefaultConnectorProfile,
  startConnectorProfileOauth,
  updateConnectorProfile,
  type ConnectorCatalogItem,
  type ConnectorCategory,
  type ConnectorKey,
  type ConnectorProfile,
} from "@/lib/connectors-client";
import {
  connectorStatusText,
  connectorStatusTone,
  formatConnectorStatus,
  resolveConnectorIcon,
} from "@/lib/connector-ui";
import { cn } from "@/lib/utils";

type ConnectorCenterPanelProps = {
  targetSessionId?: string | null;
  highlightedConnector?: ConnectorKey | null;
};

type ConnectorCenterTab = ConnectorCategory;
type ConnectorFormValues = Record<string, string>;

const NEW_PROFILE_ID = "__new__";
const CONNECTOR_TABS: Array<{ key: ConnectorCenterTab; label: string }> = [
  { key: "app", label: "应用" },
  { key: "custom_api", label: "自定义 API" },
  { key: "custom_mcp", label: "自定义 MCP" },
];

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function editorKey(connectorKey: ConnectorKey, profileId: string | null) {
  return `${connectorKey}::${profileId || "new"}`;
}

function groupProfilesByConnector(profiles: ConnectorProfile[]) {
  return profiles.reduce<Record<string, ConnectorProfile[]>>((acc, profile) => {
    if (!acc[profile.connectorKey]) {
      acc[profile.connectorKey] = [];
    }
    acc[profile.connectorKey].push(profile);
    return acc;
  }, {});
}

function resolvePreferredProfileId(
  connectorProfiles: ConnectorProfile[],
  currentSelection?: string | null
) {
  if (currentSelection === NEW_PROFILE_ID) {
    return NEW_PROFILE_ID;
  }
  if (
    currentSelection !== undefined &&
    currentSelection !== null &&
    connectorProfiles.some((profile) => profile.profileId === currentSelection)
  ) {
    return currentSelection;
  }
  return (
    connectorProfiles.find((profile) => profile.isDefault)?.profileId ||
    connectorProfiles[0]?.profileId ||
    null
  );
}

function buildConnectorRedirectUri(
  location: string,
  search: string,
  connectorKey: ConnectorKey,
  profileId: string,
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
    "profileId",
    "targetSessionId",
  ].forEach((key) => params.delete(key));
  params.set("settings", "open");
  params.set("settingsTab", "connectors");
  params.set("connector_oauth", "1");
  params.set("connector", connectorKey);
  params.set("profileId", profileId);
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
    "profileId",
    "targetSessionId",
    "settings",
    "settingsTab",
  ].forEach((key) => params.delete(key));
  url.search = params.toString();
  return `${url.pathname}${url.search ? `?${url.searchParams.toString()}` : ""}`;
}

function getFieldValue(
  profile: ConnectorProfile | undefined,
  fieldKey: string,
  previousValue?: string
) {
  if (fieldKey === "profileName") {
    return profile?.profileName || previousValue || "";
  }
  if (fieldKey === "displayName") {
    return profile?.displayName || previousValue || "";
  }
  if (fieldKey === "accessToken" || fieldKey === "dsn") {
    return previousValue || "";
  }
  const raw = profile?.config?.[fieldKey];
  return typeof raw === "string" ? raw : previousValue || "";
}

function buildFormValues(
  item: ConnectorCatalogItem,
  profile: ConnectorProfile | undefined,
  previousValues?: ConnectorFormValues
) {
  const next: ConnectorFormValues = {};
  for (const field of item.configFields) {
    next[field.key] = getFieldValue(profile, field.key, previousValues?.[field.key]);
  }
  return next;
}

function buildSavePayload(item: ConnectorCatalogItem, form: ConnectorFormValues) {
  const config: Record<string, unknown> = {};
  const credentials: Record<string, unknown> = {};
  let profileName: string | undefined;
  let displayName: string | undefined;

  for (const field of item.configFields) {
    const value = (form[field.key] || "").trim();
    if (field.key === "profileName") {
      profileName = value || undefined;
      continue;
    }
    if (field.key === "displayName") {
      displayName = value || undefined;
      continue;
    }
    if (!value) continue;
    if (field.secret) {
      credentials[field.key] = value;
    } else {
      config[field.key] = value;
    }
  }

  return {
    profileName,
    displayName,
    config,
    credentials,
  };
}

function getDirectoryStatus(
  item: ConnectorCatalogItem,
  connectorProfiles: ConnectorProfile[]
) {
  if (!item.available) {
    return "unavailable";
  }
  if (connectorProfiles.some((profile) => profile.authStatus === "authorized")) {
    return "authorized";
  }
  if (connectorProfiles.length > 0) {
    return connectorProfiles.some((profile) => profile.authStatus === "needs_auth")
      ? "needs_auth"
      : connectorProfiles[0]?.authStatus || "not_configured";
  }
  return "not_configured";
}

function renderEmptyTab(tab: ConnectorCenterTab) {
  const isApi = tab === "custom_api";
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
      <div className="rounded-2xl border border-border/70 bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
        后续实现位
      </div>
      <h4 className="mt-5 text-lg font-semibold text-foreground">
        {isApi ? "自定义 API" : "自定义 MCP"} 入口已预留
      </h4>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        本轮先统一应用连接器目录、profile 规范和会话挂载边界。
        {isApi
          ? " 自定义 API 的 schema 导入与运行时装配将在下一阶段补齐。"
          : " 自定义 MCP 的创建表单和运行时装配将在下一阶段补齐。"}
      </p>
      <Button disabled className="mt-6 rounded-xl">
        <Plus className="mr-2 h-4 w-4" />
        {isApi ? "创建自定义 API" : "创建自定义 MCP"}
      </Button>
    </div>
  );
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
  const effectiveHighlightedProfileId = params.get("profileId");

  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ConnectorCenterTab>("app");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [detailKey, setDetailKey] = useState<ConnectorKey | null>(
    effectiveHighlightedConnector || null
  );
  const [catalog, setCatalog] = useState<ConnectorCatalogItem[]>([]);
  const [profiles, setProfiles] = useState<ConnectorProfile[]>([]);
  const [selectedProfileIds, setSelectedProfileIds] = useState<
    Partial<Record<ConnectorKey, string | null>>
  >({});
  const [formState, setFormState] = useState<Record<string, ConnectorFormValues>>({});

  const load = async () => {
    setLoading(true);
    try {
      const result = await getMyConnectorProfiles();
      setCatalog(result.catalog);
      setProfiles(result.profiles);

      const profilesByConnector = groupProfilesByConnector(result.profiles);
      setSelectedProfileIds((prev) => {
        const next = { ...prev };
        for (const item of result.catalog) {
          next[item.key] = resolvePreferredProfileId(
            profilesByConnector[item.key] || [],
            prev[item.key]
          );
        }
        return next;
      });

      setFormState((prev) => {
        const next = { ...prev };
        for (const item of result.catalog) {
          const connectorProfiles = profilesByConnector[item.key] || [];
          next[editorKey(item.key, null)] = buildFormValues(
            item,
            undefined,
            prev[editorKey(item.key, null)]
          );
          for (const profile of connectorProfiles) {
            const key = editorKey(item.key, profile.profileId);
            next[key] = buildFormValues(item, profile, prev[key]);
          }
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
    if (!effectiveHighlightedConnector) return;
    setActiveTab("app");
    setDetailKey(effectiveHighlightedConnector);
  }, [effectiveHighlightedConnector]);

  useEffect(() => {
    if (!effectiveHighlightedConnector || !effectiveHighlightedProfileId) return;
    setSelectedProfileIds((prev) => ({
      ...prev,
      [effectiveHighlightedConnector]: effectiveHighlightedProfileId,
    }));
  }, [effectiveHighlightedConnector, effectiveHighlightedProfileId]);

  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");
    const connector = params.get("connector") as ConnectorKey | null;
    const profileId = params.get("profileId");
    if (params.get("connector_oauth") !== "1") return;
    if (!code || !state || !connector || !profileId) return;
    if (callbackHandled.current) return;
    callbackHandled.current = true;

    setActiveTab("app");
    setDetailKey(connector);
    setActionKey(`oauth:${connector}`);
    setSelectedProfileIds((prev) => ({
      ...prev,
      [connector]: profileId,
    }));

    void (async () => {
      try {
        const redirectUri = buildConnectorRedirectUri(
          location,
          search,
          connector,
          profileId,
          effectiveTargetSessionId
        );
        const result = await completeConnectorProfileOauth(profileId, {
          code,
          state,
          redirectUri,
        });
        const completedProfileId =
          result.profile?.profileId || result.account?.profileId || profileId;
        const attachTarget = result.returnToSessionId || effectiveTargetSessionId;

        let attachError: Error | null = null;
        if (attachTarget && completedProfileId) {
          try {
            await attachSessionConnector(attachTarget, connector, {
              profileId: completedProfileId,
            });
          } catch (error) {
            attachError = error instanceof Error ? error : new Error("连接器挂载失败");
          }
        }

        window.history.replaceState(null, "", cleanupConnectorQuery(location, search));
        setSelectedProfileIds((prev) => ({
          ...prev,
          [connector]: completedProfileId,
        }));
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
  }, [effectiveTargetSessionId, location, params, search]);

  const profilesByConnector = useMemo(() => groupProfilesByConnector(profiles), [profiles]);

  const appCatalog = useMemo(
    () =>
      catalog
        .filter((item) => item.category === "app")
        .sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0)),
    [catalog]
  );

  const filteredAppCatalog = useMemo(() => {
    const keyword = deferredQuery.trim().toLowerCase();
    if (!keyword) return appCatalog;
    return appCatalog.filter((item) => {
      const haystack = [item.name, item.description, item.key].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [appCatalog, deferredQuery]);

  const featuredCatalog = useMemo(
    () => filteredAppCatalog.filter((item) => item.featured),
    [filteredAppCatalog]
  );

  const detailItem = useMemo(
    () => appCatalog.find((item) => item.key === detailKey) || null,
    [appCatalog, detailKey]
  );

  const detailConnectorProfiles = detailItem ? profilesByConnector[detailItem.key] || [] : [];
  const selectedDetailProfileId =
    detailItem === null
      ? null
      : resolvePreferredProfileId(
          detailConnectorProfiles,
          selectedProfileIds[detailItem.key]
        );
  const selectedDetailProfile =
    detailItem && selectedDetailProfileId
      ? detailConnectorProfiles.find((profile) => profile.profileId === selectedDetailProfileId) ||
        null
      : null;
  const activeEditorProfileId =
    selectedDetailProfileId === NEW_PROFILE_ID ? null : selectedDetailProfileId;
  const activeEditorForm =
    detailItem && activeEditorProfileId !== undefined
      ? formState[editorKey(detailItem.key, activeEditorProfileId)] || {}
      : {};

  useEffect(() => {
    if (!detailItem) return;
    const key = editorKey(detailItem.key, activeEditorProfileId);
    if (formState[key]) return;
    setFormState((prev) => ({
      ...prev,
      [key]: buildFormValues(detailItem, selectedDetailProfile || undefined, prev[key]),
    }));
  }, [activeEditorProfileId, detailItem, formState, selectedDetailProfile]);

  const handleFieldChange = (
    connectorKey: ConnectorKey,
    profileId: string | null,
    field: string,
    value: string
  ) => {
    setFormState((prev) => ({
      ...prev,
      [editorKey(connectorKey, profileId)]: {
        ...(prev[editorKey(connectorKey, profileId)] || {}),
        [field]: value,
      },
    }));
  };

  const persistProfile = async (
    item: ConnectorCatalogItem,
    profileId: string | null
  ) => {
    const connectorProfiles = profilesByConnector[item.key] || [];
    const currentProfile =
      connectorProfiles.find((profile) => profile.profileId === profileId) || null;
    const payload = buildSavePayload(item, formState[editorKey(item.key, profileId)] || {});
    const requiresExplicitProfileName = item.key !== "github";

    if (requiresExplicitProfileName && !payload.profileName) {
      throw new Error("请先填写 profile name");
    }

    const hasExistingSecret = Boolean(currentProfile?.secretSummary);
    const hasNewCredential = Object.keys(payload.credentials).length > 0;
    if (!hasExistingSecret && !hasNewCredential && !item.oauth?.supported) {
      throw new Error("请先填写必需凭证");
    }

    return profileId
      ? updateConnectorProfile(profileId, payload)
      : createConnectorProfile(item.key, payload);
  };

  const handleSave = async () => {
    if (!detailItem) return;
    const profileId = activeEditorProfileId;
    setActionKey(`save:${detailItem.key}`);
    try {
      const saved = await persistProfile(detailItem, profileId);
      setSelectedProfileIds((prev) => ({
        ...prev,
        [detailItem.key]: saved.profileId,
      }));

      let attachError: Error | null = null;
      if (effectiveTargetSessionId && saved.authStatus === "authorized") {
        try {
          await attachSessionConnector(effectiveTargetSessionId, detailItem.key, {
            profileId: saved.profileId,
          });
        } catch (error) {
          attachError = error instanceof Error ? error : new Error("连接器挂载失败");
        }
      }

      await load();

      if (attachError) {
        toast.error(`profile 已保存，但挂载失败：${attachError.message}`);
      } else if (effectiveTargetSessionId && saved.authStatus === "authorized") {
        toast.success("profile 已保存，并挂载到目标会话");
      } else {
        toast.success("profile 已保存");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save connector failed");
    } finally {
      setActionKey(null);
    }
  };

  const handleOAuth = async () => {
    if (!detailItem) return;
    const profileId = activeEditorProfileId;
    setActionKey(`oauth:${detailItem.key}`);
    try {
      const profile = await persistProfile(detailItem, profileId);
      setSelectedProfileIds((prev) => ({
        ...prev,
        [detailItem.key]: profile.profileId,
      }));

      const redirectUri = buildConnectorRedirectUri(
        location,
        search,
        detailItem.key,
        profile.profileId,
        effectiveTargetSessionId
      );
      const { authUrl } = await startConnectorProfileOauth(profile.profileId, {
        redirectUri,
        returnToSessionId: effectiveTargetSessionId || undefined,
      });
      window.location.href = authUrl;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "OAuth start failed");
      setActionKey(null);
    }
  };

  const handleSetDefault = async () => {
    if (!selectedDetailProfile) return;
    setActionKey(`default:${selectedDetailProfile.profileId}`);
    try {
      await setDefaultConnectorProfile(selectedDetailProfile.profileId);
      toast.success("默认 profile 已更新");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Set default failed");
    } finally {
      setActionKey(null);
    }
  };

  const handleDisconnect = async () => {
    if (!selectedDetailProfile) return;
    setActionKey(`disconnect:${selectedDetailProfile.profileId}`);
    try {
      await clearConnectorProfileAuth(selectedDetailProfile.profileId);
      toast.success("连接器授权已清除");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Disconnect failed");
    } finally {
      setActionKey(null);
    }
  };

  const handleDelete = async () => {
    if (!selectedDetailProfile || !detailItem) return;
    setActionKey(`delete:${selectedDetailProfile.profileId}`);
    try {
      await deleteConnectorProfile(selectedDetailProfile.profileId);
      setSelectedProfileIds((prev) => ({
        ...prev,
        [detailItem.key]: null,
      }));
      toast.success("profile 已删除");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete profile failed");
    } finally {
      setActionKey(null);
    }
  };

  const renderTargetBanner = () =>
    effectiveTargetSessionId ? (
      <div className="mx-6 mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <div className="flex items-center gap-2 font-medium">
          <ShieldCheck className="h-4 w-4" />
          当前正在为目标会话准备连接器 profile
        </div>
        <p className="mt-1 text-emerald-700">Session ID: {effectiveTargetSessionId}</p>
      </div>
    ) : null;

  const renderDirectory = () => {
    if (activeTab !== "app") {
      return renderEmptyTab(activeTab);
    }

    const renderCard = (item: ConnectorCatalogItem) => {
      const Icon = resolveConnectorIcon(item.icon);
      const connectorProfiles = profilesByConnector[item.key] || [];
      const status = getDirectoryStatus(item, connectorProfiles);
      const connected = status === "authorized";
      const pending = status === "needs_auth";

      return (
        <button
          key={`${item.key}-${item.featured ? "featured" : "list"}`}
          type="button"
          onClick={() => {
            setDetailKey(item.key);
            setActiveTab("app");
          }}
          className="group flex min-h-[88px] w-full items-center gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3 text-left transition hover:border-foreground/15 hover:bg-muted/35"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background">
            <Icon className="h-5 w-5 text-foreground/80" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
              {item.isNew ? (
                <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                  新
                </span>
              ) : null}
              {pending ? (
                <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                  待授权
                </span>
              ) : null}
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {item.description}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {connected ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : null}
            {!item.available ? (
              <Badge variant="destructive" className="hidden sm:inline-flex">
                不可用
              </Badge>
            ) : null}
            <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" />
          </div>
        </button>
      );
    };

    return (
      <ScrollArea className="h-full">
        <div className="space-y-6 px-6 pb-6">
          {featuredCatalog.length > 0 ? (
            <section className="space-y-3">
              <div className="text-sm text-muted-foreground">推荐</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {featuredCatalog.map((item) => renderCard(item))}
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            <div className="text-sm text-muted-foreground">应用</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {filteredAppCatalog.map((item) => renderCard(item))}
            </div>
            {!loading && filteredAppCatalog.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
                没有找到匹配的连接器
              </div>
            ) : null}
          </section>
        </div>
      </ScrollArea>
    );
  };

  const renderDetail = () => {
    if (!detailItem) return null;

    const Icon = resolveConnectorIcon(detailItem.icon);
    const guide = CONNECTOR_GUIDES[detailItem.key];
    const statusText = connectorStatusText({
      available: detailItem.available,
      authStatus: selectedDetailProfile?.authStatus,
    });
    const profileCount = detailConnectorProfiles.length;
    const busy = Boolean(actionKey);
    const actionBusy =
      actionKey === `save:${detailItem.key}` || actionKey === `oauth:${detailItem.key}`;

    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border/70 px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <Button
              variant="ghost"
              className="rounded-xl px-3 text-muted-foreground hover:text-foreground"
              onClick={() => setDetailKey(null)}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回目录
            </Button>
            <Badge variant={connectorStatusTone(statusText)}>{formatConnectorStatus(statusText)}</Badge>
          </div>
        </div>

        <ScrollArea className="h-full">
          <div className="px-6 pb-6 pt-5">
            {renderTargetBanner()}

            <div className="rounded-[24px] border border-border/70 bg-card p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-background">
                    <Icon className="h-7 w-7 text-foreground/85" />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-semibold text-foreground">{detailItem.name}</h3>
                      {detailItem.isNew ? (
                        <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                          新
                        </span>
                      ) : null}
                      {detailItem.featured ? (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                          <Sparkles className="h-3 w-3" />
                          推荐
                        </span>
                      ) : null}
                    </div>
                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      {detailItem.description}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{profileCount} 个 profile</Badge>
                      {selectedDetailProfile?.isDefault ? (
                        <Badge variant="secondary">默认 profile</Badge>
                      ) : null}
                      {selectedDetailProfile?.secretSummary ? (
                        <Badge variant="outline">{selectedDetailProfile.secretSummary}</Badge>
                      ) : null}
                    </div>
                  </div>
                </div>

                {guide?.quickLinks?.length ? (
                  <div className="flex flex-wrap gap-2 lg:max-w-[320px] lg:justify-end">
                    {guide.quickLinks.slice(0, 2).map((link) => (
                      <a
                        key={link.href}
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-xl border border-border/70 px-3 py-2 text-xs text-muted-foreground transition hover:border-foreground/15 hover:text-foreground"
                      >
                        {link.label}
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_320px]">
              <div className="space-y-6">
                <section className="rounded-[24px] border border-border/70 bg-card p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-foreground">Profile</div>
                      <p className="text-sm text-muted-foreground">
                        设置页只负责创建、编辑和授权 profile；会话页只选择并挂载它。
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => {
                        setSelectedProfileIds((prev) => ({
                          ...prev,
                          [detailItem.key]: NEW_PROFILE_ID,
                        }));
                        setFormState((prev) => ({
                          ...prev,
                          [editorKey(detailItem.key, null)]: buildFormValues(
                            detailItem,
                            undefined,
                            prev[editorKey(detailItem.key, null)]
                          ),
                        }));
                      }}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      新建 profile
                    </Button>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="space-y-2">
                      <Label className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                        当前编辑
                      </Label>
                      <Select
                        value={selectedDetailProfileId || NEW_PROFILE_ID}
                        onValueChange={(value) => {
                          setSelectedProfileIds((prev) => ({
                            ...prev,
                            [detailItem.key]: value,
                          }));
                        }}
                      >
                        <SelectTrigger className="rounded-xl">
                          <SelectValue placeholder="选择一个 profile" />
                        </SelectTrigger>
                        <SelectContent>
                          {detailConnectorProfiles.map((profile) => (
                            <SelectItem key={profile.profileId} value={profile.profileId}>
                              {profile.profileName}
                              {profile.isDefault ? " · 默认" : ""}
                            </SelectItem>
                          ))}
                          <SelectItem value={NEW_PROFILE_ID}>创建新 profile</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {selectedDetailProfile ? (
                      <div className="flex flex-wrap gap-2">
                        {!selectedDetailProfile.isDefault ? (
                          <Button
                            variant="outline"
                            className="rounded-xl"
                            disabled={busy}
                            onClick={() => void handleSetDefault()}
                          >
                            {actionKey === `default:${selectedDetailProfile.profileId}` ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Check className="mr-2 h-4 w-4" />
                            )}
                            设为默认
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          className="rounded-xl"
                          disabled={busy || !selectedDetailProfile.secretSummary}
                          onClick={() => void handleDisconnect()}
                        >
                          {actionKey === `disconnect:${selectedDetailProfile.profileId}` ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Unplug className="mr-2 h-4 w-4" />
                          )}
                          清除授权
                        </Button>
                        <Button
                          variant="outline"
                          className="rounded-xl text-destructive hover:text-destructive"
                          disabled={busy}
                          onClick={() => void handleDelete()}
                        >
                          {actionKey === `delete:${selectedDetailProfile.profileId}` ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="mr-2 h-4 w-4" />
                          )}
                          删除
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {selectedDetailProfile?.lastError ? (
                    <div className="mt-4 flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{selectedDetailProfile.lastError}</span>
                    </div>
                  ) : null}

                  {!detailItem.available && detailItem.availabilityReason ? (
                    <div className="mt-4 flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{detailItem.availabilityReason}</span>
                    </div>
                  ) : null}

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    {detailItem.configFields.map((field) => (
                      <div
                        key={field.key}
                        className={cn("space-y-2", field.type === "textarea" ? "md:col-span-2" : "")}
                      >
                        <Label
                          htmlFor={`${detailItem.key}-${field.key}`}
                          className="text-sm text-foreground"
                        >
                          {field.label}
                          {field.required ? " *" : ""}
                        </Label>
                        {field.type === "textarea" ? (
                          <Textarea
                            id={`${detailItem.key}-${field.key}`}
                            value={activeEditorForm[field.key] || ""}
                            placeholder={field.placeholder}
                            className="min-h-[104px] rounded-2xl"
                            onChange={(event) =>
                              handleFieldChange(
                                detailItem.key,
                                activeEditorProfileId,
                                field.key,
                                event.target.value
                              )
                            }
                          />
                        ) : (
                          <Input
                            id={`${detailItem.key}-${field.key}`}
                            type={field.type === "password" ? "password" : "text"}
                            value={activeEditorForm[field.key] || ""}
                            placeholder={field.placeholder}
                            className="rounded-2xl"
                            onChange={(event) =>
                              handleFieldChange(
                                detailItem.key,
                                activeEditorProfileId,
                                field.key,
                                event.target.value
                              )
                            }
                          />
                        )}
                        {field.description ? (
                          <p className="text-xs leading-5 text-muted-foreground">
                            {field.description}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <Button
                      className="rounded-xl"
                      disabled={busy || !detailItem.available}
                      onClick={() => void handleSave()}
                    >
                      {actionKey === `save:${detailItem.key}` ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="mr-2 h-4 w-4" />
                      )}
                      保存 profile
                    </Button>
                    {detailItem.oauth?.supported ? (
                      <Button
                        variant="outline"
                        className="rounded-xl"
                        disabled={busy || !detailItem.available}
                        onClick={() => void handleOAuth()}
                      >
                        {actionKey === `oauth:${detailItem.key}` ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <ArrowUpRight className="mr-2 h-4 w-4" />
                        )}
                        {selectedDetailProfile?.authStatus === "authorized" ? "重新授权" : "发起 OAuth"}
                      </Button>
                    ) : null}
                    {effectiveTargetSessionId && selectedDetailProfile?.authStatus === "authorized" ? (
                      <Badge variant="secondary" className="rounded-xl px-3 py-2 text-xs">
                        保存后将自动挂载到目标会话
                      </Badge>
                    ) : null}
                    {actionBusy ? (
                      <Badge variant="outline" className="rounded-xl px-3 py-2 text-xs">
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        正在处理
                      </Badge>
                    ) : null}
                  </div>
                </section>
              </div>

              <aside className="space-y-6">
                {guide ? (
                  <section className="rounded-[24px] border border-border/70 bg-card p-5">
                    <div className="text-sm font-medium text-foreground">配置指引</div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{guide.intro}</p>

                    {guide.steps.length > 0 ? (
                      <>
                        <Separator className="my-4" />
                        <div className="space-y-3">
                          {guide.steps.map((step, index) => (
                            <div key={`${detailItem.key}-step-${index}`} className="flex gap-3">
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                                {index + 1}
                              </div>
                              <p className="text-sm leading-6 text-muted-foreground">{step}</p>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : null}

                    {guide.tips?.length ? (
                      <>
                        <Separator className="my-4" />
                        <div className="space-y-2">
                          <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                            Tips
                          </div>
                          {guide.tips.map((tip, index) => (
                            <p key={`${detailItem.key}-tip-${index}`} className="text-sm leading-6 text-muted-foreground">
                              {tip}
                            </p>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </section>
                ) : null}

                <section className="rounded-[24px] border border-border/70 bg-card p-5">
                  <div className="text-sm font-medium text-foreground">使用边界</div>
                  <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
                    <p>设置页只保存 profile 和授权状态，不处理会话挂载。</p>
                    <p>会话页只会选择 profile 并 attach，不会再弹出 token 表单。</p>
                    <p>sandbox runtime 只消费已经物化后的连接器配置。</p>
                  </div>
                </section>
              </aside>
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card">
      <div className="border-b border-border/70 px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold leading-6 text-foreground">连接器</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              设置页管理 profile 和授权，会话页只负责选择并挂载。
            </p>
          </div>
          {loading ? <Loader2 className="mt-1 h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>
      </div>

      <div className="border-b border-border/70 px-6 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            {CONNECTOR_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setActiveTab(tab.key);
                  setDetailKey(null);
                }}
                className={cn(
                  "relative rounded-none px-2 py-3 text-sm font-medium text-muted-foreground transition hover:text-foreground",
                  activeTab === tab.key && "text-foreground"
                )}
              >
                {tab.label}
                {activeTab === tab.key ? (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-foreground" />
                ) : null}
              </button>
            ))}
          </div>
          <div className="w-full sm:w-[220px]">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索"
              className="h-9 rounded-xl"
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {detailItem && activeTab === "app" ? renderDetail() : renderDirectory()}
      </div>
    </div>
  );
}
