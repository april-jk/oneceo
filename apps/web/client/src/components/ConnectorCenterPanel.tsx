import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Database,
  Figma,
  Github,
  Link2,
  Loader2,
  NotepadText,
  Plus,
  Plug,
  ShieldCheck,
  Slack,
  Star,
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
  clearConnectorProfileAuth,
  completeConnectorProfileOauth,
  createConnectorProfile,
  getMyConnectorProfiles,
  setDefaultConnectorProfile,
  startConnectorProfileOauth,
  updateConnectorProfile,
  type ConnectorCatalogItem,
  type ConnectorKey,
  type ConnectorProfile,
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
  supabase: Database,
  figma: Figma,
  vercel: Cloud,
  postgres: Database,
} as const;

const NEW_PROFILE_ID = "__new__";

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
    case "connecting":
      return "secondary";
    case "error":
    case "failed":
    case "unavailable":
      return "destructive";
    default:
      return "outline";
  }
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
): ConnectorFormValues {
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
  const [selectedKey, setSelectedKey] = useState<ConnectorKey | null>(
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
    if (effectiveHighlightedConnector) {
      setSelectedKey(effectiveHighlightedConnector);
    }
  }, [effectiveHighlightedConnector]);

  useEffect(() => {
    if (!effectiveHighlightedConnector || !effectiveHighlightedProfileId) return;
    setSelectedProfileIds((prev) => ({
      ...prev,
      [effectiveHighlightedConnector]: effectiveHighlightedProfileId,
    }));
  }, [effectiveHighlightedConnector, effectiveHighlightedProfileId]);

  useEffect(() => {
    if (!selectedKey) return;
    if (catalog.some((item) => item.key === selectedKey)) return;
    setSelectedKey(null);
  }, [catalog, selectedKey]);

  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");
    const connector = params.get("connector") as ConnectorKey | null;
    const profileId = params.get("profileId");
    if (params.get("connector_oauth") !== "1") return;
    if (!code || !state || !connector || !profileId) return;
    if (callbackHandled.current) return;
    callbackHandled.current = true;

    setActionKey(`oauth:${connector}`);
    setSelectedKey(connector);
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
            attachError =
              error instanceof Error ? error : new Error("连接器挂载失败");
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

  const profilesByConnector = useMemo(
    () => groupProfilesByConnector(profiles),
    [profiles]
  );

  const getEditorValues = (connectorKey: ConnectorKey, profileId: string | null) =>
    formState[editorKey(connectorKey, profileId)] || {};

  const ensureProfileDraft = (item: ConnectorCatalogItem, profileId: string | null) => {
    setFormState((prev) => {
      const key = editorKey(item.key, profileId);
      if (prev[key]) return prev;
      return {
        ...prev,
        [key]: buildFormValues(
          item,
          (profilesByConnector[item.key] || []).find((profile) => profile.profileId === profileId),
          prev[key]
        ),
      };
    });
  };

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
    selectedProfileId: string | null
  ) => {
    const connectorProfiles = profilesByConnector[item.key] || [];
    const currentProfile =
      connectorProfiles.find((profile) => profile.profileId === selectedProfileId) || null;
    const payload = buildSavePayload(item, getEditorValues(item.key, selectedProfileId));

    if (!payload.profileName) {
      throw new Error("请先填写 profile name");
    }

    const hasExistingSecret = Boolean(currentProfile?.secretSummary);
    const hasNewCredential = Object.keys(payload.credentials).length > 0;
    if (!hasExistingSecret && !hasNewCredential && !item.oauth?.supported) {
      throw new Error("请先粘贴 token、secret 或必需凭证");
    }

    return selectedProfileId
      ? updateConnectorProfile(selectedProfileId, payload)
      : createConnectorProfile(item.key, payload);
  };

  const handleSave = async (item: ConnectorCatalogItem) => {
    const selectedProfileId =
      selectedProfileIds[item.key] === NEW_PROFILE_ID
        ? null
        : (selectedProfileIds[item.key] ?? null);
    setActionKey(`save:${item.key}`);
    try {
      const saved = await persistProfile(item, selectedProfileId);
      setSelectedProfileIds((prev) => ({
        ...prev,
        [item.key]: saved.profileId,
      }));

      let attachError: Error | null = null;
      if (effectiveTargetSessionId && saved.authStatus === "authorized") {
        try {
          await attachSessionConnector(effectiveTargetSessionId, item.key, {
            profileId: saved.profileId,
          });
        } catch (error) {
          attachError =
            error instanceof Error ? error : new Error("连接器挂载失败");
        }
      }

      await load();

      if (attachError) {
        toast.error(`profile 已保存，但挂载失败：${attachError.message}`);
      } else if (effectiveTargetSessionId && saved.authStatus === "authorized") {
        toast.success("profile 已保存，并挂载到目标会话");
      } else if (item.oauth?.supported && saved.authStatus !== "authorized") {
        toast.success("profile 已保存，下一步可以直接发起 OAuth 授权");
      } else {
        toast.success("profile 已保存");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save connector failed");
    } finally {
      setActionKey(null);
    }
  };

  const handleOAuth = async (item: ConnectorCatalogItem) => {
    const selectedProfileId =
      selectedProfileIds[item.key] === NEW_PROFILE_ID
        ? null
        : (selectedProfileIds[item.key] ?? null);
    setActionKey(`oauth:${item.key}`);
    try {
      const profile = await persistProfile(item, selectedProfileId);
      setSelectedProfileIds((prev) => ({
        ...prev,
        [item.key]: profile.profileId,
      }));

      const redirectUri = buildConnectorRedirectUri(
        location,
        search,
        item.key,
        profile.profileId,
        effectiveTargetSessionId
      );
      const { authUrl } = await startConnectorProfileOauth(profile.profileId, {
        redirectUri,
        returnToSessionId: effectiveTargetSessionId || undefined,
      });
      window.location.href = authUrl;
    } catch (error) {
      setActionKey(null);
      toast.error(error instanceof Error ? error.message : "OAuth start failed");
    }
  };

  const handleDisconnect = async (profile: ConnectorProfile) => {
    setActionKey(`disconnect:${profile.profileId}`);
    try {
      await clearConnectorProfileAuth(profile.profileId);
      toast.success("连接器授权已清除");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Disconnect failed");
    } finally {
      setActionKey(null);
    }
  };

  const handleSetDefault = async (profile: ConnectorProfile) => {
    setActionKey(`default:${profile.profileId}`);
    try {
      await setDefaultConnectorProfile(profile.profileId);
      toast.success("默认 profile 已更新");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Set default failed");
    } finally {
      setActionKey(null);
    }
  };

  const cards = useMemo(
    () =>
      catalog.map((item) => {
        const connectorProfiles = profilesByConnector[item.key] || [];
        const selectedProfileId = resolvePreferredProfileId(
          connectorProfiles,
          selectedProfileIds[item.key]
        );
        const selectedProfile =
          connectorProfiles.find((profile) => profile.profileId === selectedProfileId) || null;
        const defaultProfile =
          connectorProfiles.find((profile) => profile.isDefault) || connectorProfiles[0] || null;

        return {
          item,
          connectorProfiles,
          selectedProfileId,
          selectedProfile,
          defaultProfile,
          form: getEditorValues(
            item.key,
            selectedProfileId === NEW_PROFILE_ID ? null : selectedProfileId
          ),
        };
      }),
    [catalog, formState, profilesByConnector, selectedProfileIds]
  );

  const selectedCard = cards.find(({ item }) => item.key === selectedKey) || null;

  const renderTargetBanner = () =>
    effectiveTargetSessionId ? (
      <div className="mx-6 mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <div className="flex items-center gap-2 font-medium">
          <ShieldCheck className="h-4 w-4" />
          当前正在为目标会话选择可挂载 profile
        </div>
        <p className="mt-1 text-emerald-700">Session ID: {effectiveTargetSessionId}</p>
      </div>
    ) : null;

  const openSuggestedConnector = () => {
    const preferred =
      cards.find(
        ({ item, defaultProfile }) =>
          item.available && defaultProfile?.authStatus !== "authorized"
      ) ||
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
          <h3 className="text-[18px] font-medium leading-7 text-foreground">连接器中心</h3>
          <p className="text-sm text-muted-foreground">
            在平台外部管理连接器 profile，并将已授权能力投影到 sandbox 内会话
          </p>
        </div>
      </div>

      {renderTargetBanner()}

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col px-6">
          {cards.map(({ item, defaultProfile, connectorProfiles }) => {
            const Icon = iconMap[item.icon as keyof typeof iconMap] || Link2;
            const isAuthorized = defaultProfile?.authStatus === "authorized";
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
                  <div className="hidden text-right sm:block">
                    <div className="text-xs font-medium text-foreground">
                      {defaultProfile?.profileName || "No profile"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {connectorProfiles.length} profiles
                    </div>
                  </div>
                  <Badge
                    variant={statusTone(
                      defaultProfile?.authStatus ||
                        (item.available ? "not_configured" : "unavailable")
                    )}
                  >
                    {formatStatus(
                      defaultProfile?.authStatus ||
                        (item.available ? "not_configured" : "unavailable")
                    )}
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
          添加或管理连接器
        </Button>
      </div>

      <Dialog open={Boolean(selectedCard)} onOpenChange={(open) => !open && setSelectedKey(null)}>
        {selectedCard ? (() => {
          const { item, connectorProfiles, selectedProfileId, selectedProfile, form } =
            selectedCard;
          const Icon = iconMap[item.icon as keyof typeof iconMap] || Link2;
          const guide = CONNECTOR_GUIDES[item.key];
          const isNewProfile = selectedProfileId === NEW_PROFILE_ID || !selectedProfile;
          const busy =
            actionKey === `save:${item.key}` ||
            actionKey === `oauth:${item.key}` ||
            actionKey === `disconnect:${selectedProfile?.profileId}` ||
            actionKey === `default:${selectedProfile?.profileId}` ||
            actionKey === `attach:${selectedProfile?.profileId}`;
          const supportsManual = item.configFields.length > 0;
          const isAuthorized = selectedProfile?.authStatus === "authorized";

          return (
            <DialogContent className="max-h-[82vh] max-w-5xl overflow-hidden rounded-[28px] border border-border/70 p-0">
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
                      <Badge
                        variant={statusTone(
                          selectedProfile?.authStatus ||
                            (item.available ? "not_configured" : "unavailable")
                        )}
                      >
                        {formatStatus(
                          selectedProfile?.authStatus ||
                            (item.available ? "not_configured" : "unavailable")
                        )}
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
                  <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
                    <div className="space-y-4">
                      <div className="rounded-3xl border border-border/70 bg-background px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">Profiles</p>
                            <p className="text-xs leading-5 text-muted-foreground">
                              外部配置可复用档案，sandbox 只使用你挂载进去的 profile。
                            </p>
                          </div>
                          <Badge variant="outline">{connectorProfiles.length}</Badge>
                        </div>

                        <div className="mt-3 space-y-2">
                          {connectorProfiles.map((profile) => {
                            const active = profile.profileId === selectedProfileId;
                            return (
                              <button
                                key={profile.profileId}
                                type="button"
                                onClick={() => {
                                  setSelectedProfileIds((prev) => ({
                                    ...prev,
                                    [item.key]: profile.profileId,
                                  }));
                                  ensureProfileDraft(item, profile.profileId);
                                }}
                                className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                                  active
                                    ? "border-foreground/70 bg-muted/60"
                                    : "border-border/70 hover:bg-muted/30"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="truncate text-sm font-medium text-foreground">
                                    {profile.profileName}
                                  </div>
                                  {profile.isDefault ? (
                                    <Star className="h-4 w-4 shrink-0 text-amber-500" />
                                  ) : null}
                                </div>
                                <div className="mt-1 truncate text-xs text-muted-foreground">
                                  {profile.displayName ||
                                    profile.secretSummary ||
                                    "未设置 display name"}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  <Badge variant={statusTone(profile.authStatus)}>
                                    {formatStatus(profile.authStatus)}
                                  </Badge>
                                </div>
                              </button>
                            );
                          })}

                          <Button
                            variant="outline"
                            className="w-full rounded-2xl"
                            onClick={() => {
                              setSelectedProfileIds((prev) => ({
                                ...prev,
                                [item.key]: NEW_PROFILE_ID,
                              }));
                              ensureProfileDraft(item, null);
                            }}
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            新建 Profile
                          </Button>
                        </div>
                      </div>

                      <div className="rounded-2xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                        <div className="flex items-center justify-between gap-3">
                          <span>配置位置</span>
                          <span className="text-right text-foreground/80">Outside sandbox</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <span>运行位置</span>
                          <span className="text-right text-foreground/80">Inside sandbox</span>
                        </div>
                        {selectedProfile?.lastAuthAt ? (
                          <div className="mt-2 flex items-center justify-between gap-3">
                            <span>最近授权</span>
                            <span className="text-right text-foreground/80">
                              {new Date(selectedProfile.lastAuthAt).toLocaleString()}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="space-y-5">
                      <div className="rounded-3xl border border-border/70 bg-background px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">快速开始</p>
                            <p className="mt-1 text-sm leading-6 text-muted-foreground">
                              {guide.intro}
                            </p>
                          </div>
                          <Badge variant="outline">
                            {item.oauth?.supported ? "OAuth + 手动配置" : "手动配置"}
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
                      </div>

                      {item.availabilityReason ? (
                        <div className="flex gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{item.availabilityReason}</span>
                        </div>
                      ) : null}

                      {selectedProfile?.lastError ? (
                        <div className="flex gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{selectedProfile.lastError}</span>
                        </div>
                      ) : null}

                      {supportsManual ? (
                        <div className="space-y-3 rounded-3xl border border-border/70 bg-background px-4 py-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                {isNewProfile ? "创建 Profile" : "编辑 Profile"}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                保存后的 profile 会复用到其他会话；会话里只做挂载，不在 sandbox 内录入凭证。
                              </p>
                            </div>
                            {isAuthorized ? (
                              <Badge variant="secondary">留空 secret 则保留当前凭证</Badge>
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
                              id: `${item.key}-${selectedProfileId || "new"}-${field.key}`,
                              value: form[field.key] || "",
                              onChange: (
                                event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
                              ) =>
                                handleFieldChange(
                                  item.key,
                                  selectedProfileId === NEW_PROFILE_ID
                                    ? null
                                    : selectedProfileId,
                                  field.key,
                                  event.target.value
                                ),
                              placeholder: field.placeholder,
                            };

                            return (
                              <div key={field.key} className="space-y-2">
                                <Label htmlFor={commonProps.id}>{field.label}</Label>
                                {field.type === "textarea" ? (
                                  <Textarea {...commonProps} className="min-h-28 rounded-2xl" />
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
                          OAuth 已启用，授权完成后平台会保存 profile，后续任意 session
                          都可直接复用。
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
                            {actionKey === `save:${item.key}` ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <ShieldCheck className="mr-2 h-4 w-4" />
                            )}
                            {isNewProfile ? "创建 Profile" : "保存 Profile"}
                          </Button>
                        ) : null}

                        {item.oauth?.supported ? (
                          <Button
                            className="rounded-2xl"
                            disabled={Boolean(actionKey) || !item.available}
                            onClick={() => void handleOAuth(item)}
                          >
                            {actionKey === `oauth:${item.key}` ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <ArrowUpRight className="mr-2 h-4 w-4" />
                            )}
                            {isAuthorized ? "重新授权" : "发起 OAuth"}
                          </Button>
                        ) : null}

                        {selectedProfile && !selectedProfile.isDefault ? (
                          <Button
                            variant="outline"
                            className="rounded-2xl"
                            disabled={Boolean(actionKey)}
                            onClick={() => void handleSetDefault(selectedProfile)}
                          >
                            {actionKey === `default:${selectedProfile.profileId}` ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Star className="mr-2 h-4 w-4" />
                            )}
                            设为默认 Profile
                          </Button>
                        ) : null}

                        {effectiveTargetSessionId &&
                        selectedProfile &&
                        selectedProfile.authStatus === "authorized" ? (
                          <Button
                            variant="secondary"
                            className="rounded-2xl"
                            disabled={Boolean(actionKey)}
                            onClick={async () => {
                              setActionKey(`attach:${selectedProfile.profileId}`);
                              try {
                                await attachSessionConnector(
                                  effectiveTargetSessionId,
                                  item.key,
                                  {
                                    profileId: selectedProfile.profileId,
                                  }
                                );
                                toast.success("已挂载到目标会话");
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

                        {selectedProfile ? (
                          <Button
                            variant="outline"
                            className="rounded-2xl"
                            disabled={Boolean(actionKey)}
                            onClick={() => void handleDisconnect(selectedProfile)}
                          >
                            {actionKey === `disconnect:${selectedProfile.profileId}` ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Unplug className="mr-2 h-4 w-4" />
                            )}
                            清除当前 Profile 授权
                          </Button>
                        ) : null}
                      </div>
                    </div>
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
