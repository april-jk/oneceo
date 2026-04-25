import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearch } from "wouter";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Database,
  ChevronRight,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unplug,
  X,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { getConnectorGuides } from "@/lib/connector-guides";
import {
  attachSessionConnector,
  clearConnectorProfileAuth,
  completeConnectorOauth,
  completeConnectorProfileOauth,
  createConnectorProfile,
  deleteConnectorProfile,
  getMyConnectorProfiles,
  setDefaultConnectorProfile,
  startConnectorOauth,
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
import i18n from "@/i18n";
import { cn } from "@/lib/utils";

type ConnectorCenterPanelProps = {
  targetSessionId?: string | null;
  highlightedConnector?: ConnectorKey | null;
};

type ConnectorCenterTab = ConnectorCategory;
type ConnectorFormValues = Record<string, string>;

const NEW_PROFILE_ID = "__new__";
export const NOTION_FIXED_CALLBACK_PATH = "/notion/callback";
export const SLACK_FIXED_CALLBACK_PATH = "/slack/callback";
export const VERCEL_FIXED_CALLBACK_PATH = "/vercel/callback";
const GITHUB_APP_AUTHORIZATIONS_URL = "https://github.com/settings/apps/authorizations";
const GITHUB_APP_INSTALLATIONS_URL = "https://github.com/settings/installations";
const GITHUB_INSTALLATION_MISSING_PATTERN = /没有任何可用安装|未安装到任何账号|installation/i;
const CONNECTOR_TABS: Array<{ key: ConnectorCenterTab; labelKey: string }> = [
  { key: "app", labelKey: "connectors.tabs.app" },
  { key: "custom_api", labelKey: "connectors.tabs.customApi" },
  { key: "custom_mcp", labelKey: "connectors.tabs.customMcp" },
];

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveBrowserOrigin() {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost";
}

export function normalizeEditableProfileId(profileId: string | null | undefined) {
  const normalized = asText(profileId);
  if (!normalized || normalized === NEW_PROFILE_ID) {
    return null;
  }
  return normalized;
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
  profileId?: string | null,
  targetSessionId?: string | null,
  options?: {
    callbackPath?: string;
  }
) {
  const callbackPath = asText(options?.callbackPath) || location;
  const url = new URL(callbackPath, resolveBrowserOrigin());
  const params = new URLSearchParams(search);
  [
    "code",
    "state",
    "teamId",
    "configurationId",
    "next",
    "source",
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
  if (profileId) {
    params.set("profileId", profileId);
  }
  if (targetSessionId) {
    params.set("targetSessionId", targetSessionId);
  }
  url.search = params.toString();
  return url.toString();
}

function isFixedConnectorCallbackPath(pathname: string) {
  return (
    pathname === NOTION_FIXED_CALLBACK_PATH ||
    pathname === SLACK_FIXED_CALLBACK_PATH ||
    pathname === VERCEL_FIXED_CALLBACK_PATH
  );
}

export function resolveConnectorOauthCallbackContext(location: string, params: URLSearchParams) {
  const currentPath = new URL(location, resolveBrowserOrigin()).pathname;
  const hasOauthCallbackParams = Boolean(params.get("code")) && Boolean(params.get("state"));
  const fixedPathConnector =
    currentPath === NOTION_FIXED_CALLBACK_PATH
      ? "notion"
      : currentPath === SLACK_FIXED_CALLBACK_PATH
        ? "slack"
        : currentPath === VERCEL_FIXED_CALLBACK_PATH
          ? "vercel"
          : null;
  const connector =
    (params.get("connector") as ConnectorKey | null) ||
    (hasOauthCallbackParams ? fixedPathConnector : null);
  const hasConnectorOAuthFlag = params.get("connector_oauth") === "1";
  return {
    connector,
    currentPath,
    isFixedCallback: Boolean(fixedPathConnector && hasOauthCallbackParams),
    shouldHandle: hasConnectorOAuthFlag || Boolean(fixedPathConnector && hasOauthCallbackParams),
  };
}

export function cleanupConnectorQuery(
  location: string,
  search: string,
  options?: {
    targetSessionId?: string | null;
  }
) {
  const url = new URL(location, resolveBrowserOrigin());
  const params = new URLSearchParams(search);
  [
    "code",
    "state",
    "teamId",
    "configurationId",
    "next",
    "source",
    "connector_oauth",
    "connector",
    "profileId",
    "targetSessionId",
    "settings",
    "settingsTab",
  ].forEach((key) => params.delete(key));
  url.search = params.toString();
  const sessionId = asText(options?.targetSessionId);
  const nextPath =
    isFixedConnectorCallbackPath(url.pathname)
      ? sessionId
        ? `/session/${encodeURIComponent(sessionId)}`
        : "/home"
      : url.pathname;
  return `${nextPath}${url.search ? `?${url.searchParams.toString()}` : ""}`;
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
    return profile?.secretSummary ? previousValue || "" : "";
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
        {i18n.t("connectors.comingSoon")}
      </div>
      <h4 className="mt-5 text-lg font-semibold text-foreground">
        {isApi
          ? i18n.t("connectors.empty.customApiReserved")
          : i18n.t("connectors.empty.customMcpReserved")}
      </h4>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        {i18n.t("connectors.empty.intro")}
        {isApi
          ? i18n.t("connectors.empty.customApiDetail")
          : i18n.t("connectors.empty.customMcpDetail")}
      </p>
      <Button disabled className="mt-6 rounded-xl">
        <Plus className="mr-2 h-4 w-4" />
        {isApi
          ? i18n.t("connectors.empty.createCustomApi")
          : i18n.t("connectors.empty.createCustomMcp")}
      </Button>
    </div>
  );
}

function isGithubConnector(item: ConnectorCatalogItem | null | undefined) {
  return item?.key === "github";
}

export function shouldUseConnectorLevelOauth(connectorKey: ConnectorKey | null | undefined) {
  return connectorKey === "notion" || connectorKey === "slack" || connectorKey === "vercel";
}

export function shouldUseUnifiedConnectorCard(connectorKey: ConnectorKey | null | undefined) {
  return connectorKey === "github" || connectorKey === "vercel" || shouldUseConnectorLevelOauth(connectorKey);
}

function getGithubAppReauthHint() {
  return i18n.t("connectors.github.reauthHint");
}

export function ConnectorCenterPanel({
  targetSessionId,
  highlightedConnector,
}: ConnectorCenterPanelProps) {
  const { t } = useTranslation();
  const connectorGuides = useMemo(() => getConnectorGuides(t), [t]);
  const [location, setLocation] = useLocation();
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
  const [supabaseDetailExpanded, setSupabaseDetailExpanded] = useState(false);
  const [supabaseConnectDialogOpen, setSupabaseConnectDialogOpen] = useState(false);
  const [supabaseTokenInput, setSupabaseTokenInput] = useState("");
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
      toast.error(error instanceof Error ? error.message : i18n.t("connectors.errors.loadFailed"));
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
    const callbackContext = resolveConnectorOauthCallbackContext(location, params);
    const connector = callbackContext.connector;
    const profileId = params.get("profileId");
    const useConnectorLevelOauth = shouldUseConnectorLevelOauth(connector);
    const useConnectorLevelCallback = useConnectorLevelOauth;
    if (!callbackContext.shouldHandle) return;
    if (!code || !state || !connector) return;
    if (!useConnectorLevelCallback && !profileId) return;
    if (callbackHandled.current) return;
    callbackHandled.current = true;

    setActiveTab("app");
    setDetailKey(connector);
    setActionKey(`oauth:${connector}`);
    if (profileId) {
      setSelectedProfileIds((prev) => ({
        ...prev,
        [connector]: profileId,
      }));
    }

    void (async () => {
      try {
        const redirectUri = buildConnectorRedirectUri(
          location,
          search,
          connector,
          profileId,
          effectiveTargetSessionId,
          connector === "notion"
            ? {
                callbackPath: NOTION_FIXED_CALLBACK_PATH,
              }
            : connector === "slack"
              ? {
                  callbackPath: SLACK_FIXED_CALLBACK_PATH,
                }
              : connector === "vercel"
                ? {
                    callbackPath: VERCEL_FIXED_CALLBACK_PATH,
                  }
            : undefined
        );
        let completedProfileId = profileId || null;
        let attachTarget: string | null | undefined = effectiveTargetSessionId;
        let authStatus = "";
        let callbackLastError = "";

        if (useConnectorLevelCallback) {
          const result = await completeConnectorOauth(connector, {
            code,
            state,
            redirectUri,
            teamId: asText(params.get("teamId")),
            configurationId: asText(params.get("configurationId")),
            next: asText(params.get("next")),
            source: asText(params.get("source")),
          });
          completedProfileId =
            result.account?.defaultProfileId || result.account?.profileId || completedProfileId;
          attachTarget = result.returnToSessionId || effectiveTargetSessionId;
          authStatus = asText(result.account?.authStatus);
          callbackLastError = asText(result.account?.lastError);
        } else {
          const result = await completeConnectorProfileOauth(profileId!, {
            code,
            state,
            redirectUri,
            teamId: asText(params.get("teamId")),
            configurationId: asText(params.get("configurationId")),
            next: asText(params.get("next")),
            source: asText(params.get("source")),
          });
          completedProfileId =
            result.profile?.profileId || result.account?.profileId || completedProfileId;
          attachTarget = result.returnToSessionId || effectiveTargetSessionId;
          authStatus = asText(result.profile?.authStatus || result.account?.authStatus);
          callbackLastError = asText(result.profile?.lastError || result.account?.lastError);
        }

        let attachError: Error | null = null;
        if (attachTarget && completedProfileId && authStatus === "authorized") {
          try {
            await attachSessionConnector(attachTarget, connector, {
              profileId: completedProfileId,
            });
          } catch (error) {
            attachError = error instanceof Error ? error : new Error(i18n.t("connectors.errors.attachFailed"));
          }
        }

        setLocation(
          cleanupConnectorQuery(location, search, {
            targetSessionId: attachTarget || null,
          })
        );
        
        setSelectedProfileIds((prev) => ({
          ...prev,
          [connector]: completedProfileId,
        }));
        
        await load();

        if (attachError) {
          toast.error(
            i18n.t("connectors.oauth.completedButAttachFailed", {
              message: attachError.message,
            })
          );
        } else if (
          authStatus !== "authorized" &&
          callbackLastError &&
          GITHUB_INSTALLATION_MISSING_PATTERN.test(callbackLastError)
        ) {
          toast.error(callbackLastError);
        } else if (attachTarget) {
          toast.success(i18n.t("connectors.oauth.completedAndAttached"));
        } else {
          toast.success(i18n.t("connectors.oauth.completed"));
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : i18n.t("connectors.errors.oauthCallbackFailed"));
      } finally {
        setActionKey(null);
      }
    })();
  }, [effectiveTargetSessionId, location, params, search, setLocation]);

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
    setSupabaseDetailExpanded(false);
    setSupabaseConnectDialogOpen(false);
    setSupabaseTokenInput("");
  }, [detailKey]);

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
    profileId: string | null,
    formOverride?: ConnectorFormValues
  ) => {
    const editableProfileId = normalizeEditableProfileId(profileId);
    const connectorProfiles = profilesByConnector[item.key] || [];
    const currentProfile =
      connectorProfiles.find((profile) => profile.profileId === editableProfileId) || null;
    const payload = buildSavePayload(
      item,
      formOverride || formState[editorKey(item.key, profileId)] || {}
    );
    const requiresExplicitProfileName =
      item.key !== "github" &&
      item.key !== "supabase" &&
      item.key !== "notion" &&
      item.key !== "vercel";

    if (requiresExplicitProfileName && !payload.profileName) {
      throw new Error(i18n.t("connectors.errors.profileNameRequired"));
    }

    const hasExistingSecret = Boolean(currentProfile?.secretSummary);
    const hasNewCredential = Object.keys(payload.credentials).length > 0;
    if (!hasExistingSecret && !hasNewCredential && !item.oauth?.supported) {
      throw new Error(i18n.t("connectors.errors.credentialsRequired"));
    }

    return editableProfileId
      ? updateConnectorProfile(editableProfileId, payload)
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
          attachError = error instanceof Error ? error : new Error(i18n.t("connectors.errors.attachFailed"));
        }
      }

      await load();

      if (attachError) {
        toast.error(
          i18n.t("connectors.profile.savedButAttachFailed", {
            message: attachError.message,
          })
        );
      } else if (effectiveTargetSessionId && saved.authStatus === "authorized") {
        toast.success(i18n.t("connectors.profile.savedAndAttached"));
      } else {
        toast.success(i18n.t("connectors.profile.saved"));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n.t("connectors.errors.saveFailed"));
    } finally {
      setActionKey(null);
    }
  };

  const handleSupabaseConnect = async () => {
    if (!detailItem || detailItem.key !== "supabase") return;
    const token = supabaseTokenInput.trim();
    if (!token) {
      toast.error(i18n.t("connectors.supabase.tokenRequired"));
      return;
    }

    const profileId = activeEditorProfileId;
    const formKey = editorKey(detailItem.key, profileId);
    const nextForm: ConnectorFormValues = {
      ...(formState[formKey] || {}),
      accessToken: token,
    };

    setActionKey(`save:${detailItem.key}`);
    try {
      const saved = await persistProfile(detailItem, profileId, nextForm);
      setSelectedProfileIds((prev) => ({
        ...prev,
        [detailItem.key]: saved.profileId,
      }));
      setFormState((prev) => ({
        ...prev,
        [editorKey(detailItem.key, saved.profileId)]: nextForm,
      }));

      let attachError: Error | null = null;
      if (effectiveTargetSessionId && saved.authStatus === "authorized") {
        try {
          await attachSessionConnector(effectiveTargetSessionId, detailItem.key, {
            profileId: saved.profileId,
          });
        } catch (error) {
          attachError = error instanceof Error ? error : new Error(i18n.t("connectors.errors.attachFailed"));
        }
      }

      await load();
      setSupabaseConnectDialogOpen(false);

      if (attachError) {
        toast.error(
          i18n.t("connectors.profile.savedButAttachFailed", {
            message: attachError.message,
          })
        );
      } else if (effectiveTargetSessionId && saved.authStatus === "authorized") {
        toast.success(i18n.t("connectors.profile.savedAndAttached"));
      } else {
        toast.success(i18n.t("connectors.supabase.connected"));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n.t("connectors.errors.saveFailed"));
    } finally {
      setActionKey(null);
    }
  };

  const handleOAuth = async () => {
    if (!detailItem) return;
    const githubConnector = isGithubConnector(detailItem);
    const connectorLevelOauth = shouldUseConnectorLevelOauth(detailItem.key);

    if (connectorLevelOauth) {
      setActionKey(`oauth:${detailItem.key}`);
      try {
        const redirectUri =
          detailItem.key === "slack"
            ? new URL(SLACK_FIXED_CALLBACK_PATH, resolveBrowserOrigin()).toString()
            : buildConnectorRedirectUri(
                location,
                search,
                detailItem.key,
                null,
                effectiveTargetSessionId,
                detailItem.key === "notion"
                  ? {
                      callbackPath: NOTION_FIXED_CALLBACK_PATH,
                    }
                  : detailItem.key === "vercel"
                    ? {
                        callbackPath: VERCEL_FIXED_CALLBACK_PATH,
                      }
                  : undefined
              );
        const { authUrl } = await startConnectorOauth(detailItem.key, {
          redirectUri,
          returnToSessionId: effectiveTargetSessionId || undefined,
        });
        window.location.href = authUrl;
        return;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : i18n.t("connectors.errors.oauthStartFailed"));
        setActionKey(null);
        return;
      }
    }
    
    // 如果是 GitHub 且没有选中的 Profile，则自动使用/创建一个默认 Profile
    let profileId = activeEditorProfileId;
    if (detailItem.key === "github" && (!profileId || profileId === NEW_PROFILE_ID)) {
      const defaultProfile = detailConnectorProfiles.find(p => p.profileName === "GitHub Default" || p.isDefault);
      if (defaultProfile) {
        profileId = defaultProfile.profileId;
      } else {
        profileId = NEW_PROFILE_ID;
        setFormState((prev) => ({
          ...prev,
          [editorKey(detailItem.key, profileId)]: {
            ...(prev[editorKey(detailItem.key, profileId)] || {}),
            profileName: "GitHub Default",
          },
        }));
      }
    }

    setActionKey(`oauth:${detailItem.key}`);
    try {
      // 针对自动创建的情况，这里 persistProfile 会自动使用上面的 formState
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
        effectiveTargetSessionId,
        detailItem.key === "vercel"
          ? {
              callbackPath: VERCEL_FIXED_CALLBACK_PATH,
            }
          : undefined
      );
      const { authUrl } = await startConnectorProfileOauth(profile.profileId, {
        redirectUri,
        returnToSessionId: effectiveTargetSessionId || undefined,
      });
      if (githubConnector) {
        toast.info(i18n.t("connectors.github.redirectingHint"));
      }
      window.location.href = authUrl;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n.t("connectors.errors.oauthStartFailed"));
      setActionKey(null);
    }
  };

  const handleSetDefault = async () => {
    if (!selectedDetailProfile) return;
    setActionKey(`default:${selectedDetailProfile.profileId}`);
    try {
      await setDefaultConnectorProfile(selectedDetailProfile.profileId);
      toast.success(i18n.t("connectors.profile.defaultUpdated"));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n.t("connectors.errors.setDefaultFailed"));
    } finally {
      setActionKey(null);
    }
  };

  const handleDisconnect = async () => {
    if (!selectedDetailProfile) return;
    setActionKey(`disconnect:${selectedDetailProfile.profileId}`);
    try {
      const cleared = await clearConnectorProfileAuth(selectedDetailProfile.profileId);
      setFormState((prev) => {
        const key = editorKey(selectedDetailProfile.connectorKey, selectedDetailProfile.profileId);
        const current = prev[key];
        if (!current) return prev;
        const next = { ...prev };
        next[key] = {
          ...current,
          accessToken: "",
          dsn: "",
        };
        return next;
      });
      if (selectedDetailProfile.connectorKey === "github" && cleared.remoteGrantRevoked === false) {
        toast.warning(
          cleared.remoteGrantError
            ? i18n.t("connectors.github.localClearedRemoteUnconfirmedWithError", {
                error: cleared.remoteGrantError,
              })
            : i18n.t("connectors.github.localClearedRemoteUnconfirmed")
        );
      } else {
        toast.success(
          selectedDetailProfile.connectorKey === "github"
            ? i18n.t("connectors.github.localCleared")
            : i18n.t("connectors.profile.authCleared")
        );
      }
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n.t("connectors.errors.disconnectFailed"));
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
      toast.success(i18n.t("connectors.profile.deleted"));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n.t("connectors.errors.deleteFailed"));
    } finally {
      setActionKey(null);
    }
  };

  const renderTargetBanner = () =>
    effectiveTargetSessionId ? (
      <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <div className="flex items-center gap-2 font-medium">
          <ShieldCheck className="h-4 w-4" />
          {t("connectors.targetBanner.title")}
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
                <span className="rounded border border-[var(--brand-border)] bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--brand-soft-foreground)]">
                  {t("connectors.badges.new")}
                </span>
              ) : null}
              {pending ? (
                <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                  {t("connectors.badges.pendingAuth")}
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
                {t("connectors.badges.unavailable")}
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
              <div className="text-sm text-muted-foreground">{t("connectors.featured")}</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {featuredCatalog.map((item) => renderCard(item))}
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            <div className="text-sm text-muted-foreground">{t("connectors.tabs.app")}</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {filteredAppCatalog.map((item) => renderCard(item))}
            </div>
            {!loading && filteredAppCatalog.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
                {t("connectors.empty.noMatches")}
              </div>
            ) : null}
          </section>
        </div>
      </ScrollArea>
    );
  };

  const renderDetailModal = () => {
    if (!detailItem) return null;

    const Icon = resolveConnectorIcon(detailItem.icon);
    const guide = connectorGuides[detailItem.key];
    const githubConnector = isGithubConnector(detailItem);
    const connectorLevelOauth = shouldUseConnectorLevelOauth(detailItem.key);
    const unifiedOauthCard = shouldUseUnifiedConnectorCard(detailItem.key);
    const statusText = connectorStatusText({
      available: detailItem.available,
      authStatus: selectedDetailProfile?.authStatus,
    });
    const busy = Boolean(actionKey);
    const actionBusy =
      actionKey === `save:${detailItem.key}` || actionKey === `oauth:${detailItem.key}`;
    const showGithubPermissionWarning =
      githubConnector &&
      typeof selectedDetailProfile?.lastError === "string" &&
      !GITHUB_INSTALLATION_MISSING_PATTERN.test(selectedDetailProfile.lastError) &&
      /resource not accessible by integration|permission denied|installation/i.test(
        selectedDetailProfile.lastError
      );
    const showGithubInstallationMissingWarning =
      githubConnector &&
      typeof selectedDetailProfile?.lastError === "string" &&
      GITHUB_INSTALLATION_MISSING_PATTERN.test(selectedDetailProfile.lastError);
    const githubStatusHint =
      selectedDetailProfile?.authStatus === "authorized"
        ? t("connectors.github.statusAuthorized")
        : showGithubInstallationMissingWarning
          ? t("connectors.github.installationMissing")
          : getGithubAppReauthHint();

    const isSupabaseConnector = detailItem.key === "supabase";
    const isSupabaseAuthorized =
      isSupabaseConnector && selectedDetailProfile?.authStatus === "authorized";
    const supabaseRuntimeUrl =
      detailItem.runtime?.urlDefault || "https://mcp.supabase.com/mcp";

    return (
      <>
      <Dialog open={Boolean(detailItem)} onOpenChange={(open) => !open && setDetailKey(null)}>
        <DialogContent
          showCloseButton={false}
          className={cn(
            "flex flex-col w-[min(880px,calc(100vw-32px))] max-w-[880px] gap-0 overflow-hidden rounded-[28px] border shadow-xl p-0",
            isSupabaseConnector
              ? "h-[min(400px,calc(100vh-64px))] md:h-[min(440px,calc(100vh-64px))]"
              : "h-[min(400px,calc(100vh-64px))] md:h-[min(440px,calc(100vh-64px))]"
          )}
        >
          <div
            className="flex h-full flex-col items-start justify-start overflow-clip relative w-full"
          >
            <div className="bg-muted/10 flex gap-6 items-center justify-start px-6 py-5 relative shrink-0 w-full border-b border-border/60">
              <div className="basis-0 flex gap-6 grow items-center justify-end min-h-px min-w-px p-0 relative shrink-0">
                <button 
                  onClick={() => setDetailKey(null)}
                  className="inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors active:opacity-80 text-foreground gap-[4px] text-[14px] leading-[18px] min-w-0 hover:opacity-80 bg-inherit h-max rounded-full p-0"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div
              className={cn(
                "min-h-0 flex-1 w-full bg-background",
                isSupabaseConnector
                  ? "overflow-y-auto [scrollbar-gutter:stable] [scrollbar-width:thin] [-ms-overflow-style:auto] [&::-webkit-scrollbar]:w-3 [&::-webkit-scrollbar]:h-3"
                  : "overflow-y-auto",
                isSupabaseConnector && !supabaseDetailExpanded
                  ? "[scrollbar-color:transparent_transparent] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-transparent"
                  : isSupabaseConnector
                    ? "[scrollbar-color:rgba(120,120,120,0.7)_transparent] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-muted-foreground/50 [&::-webkit-scrollbar-thumb]:rounded-full"
                    : ""
              )}
            >
              <div
                className={cn(
                  "flex flex-col items-center justify-start px-6 relative shrink-0 w-full",
                  isSupabaseConnector
                    ? supabaseDetailExpanded
                      ? "gap-6 pb-4 pt-8"
                      : "gap-4 pb-3 pt-6"
                    : "gap-6 pb-4 pt-8"
                )}
              >
                <div className="flex flex-col gap-4 items-center justify-center max-w-[600px] p-0 relative shrink-0 w-full">
                  <div className="bg-background flex items-center justify-center p-[8px] relative rounded-xl shrink-0 size-16 border border-border/60 shadow-sm">
                    <Icon className="h-10 w-10 text-foreground/85" />
                  </div>
                  
                  <div className="flex flex-col gap-2 items-start justify-center leading-[0] p-0 relative shrink-0 text-center w-full">
                    <div className="flex gap-2 items-center justify-center font-semibold overflow-hidden relative shrink-0 text-foreground text-[20px] tracking-[-0.44px] w-full">
                      <p className="leading-[26px] overflow-hidden text-ellipsis">{detailItem.name}</p>
                      {detailItem.isNew ? (
                        <span className="ml-2 rounded-md border border-[var(--brand-border)] bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--brand-soft-foreground)]">{t("connectors.badges.new")}</span>
                      ) : null}
                    </div>
                    <div className="font-normal relative shrink-0 text-muted-foreground tracking-[-0.154px] w-full">
                      <p className="block text-[14px] leading-[20px]">{detailItem.description}</p>
                    </div>
                  </div>

                  {selectedDetailProfile?.authStatus === "authorized" ? (
                    <div className="flex flex-col items-center gap-4 w-full mt-2">
                      <div className="flex items-center justify-center gap-[8px]">
                        <div className="flex items-center gap-[4px]">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 fill-emerald-500/20" />
                          <span className="text-muted-foreground text-center text-sm">{t("connectors.authorizedAccount")}</span>
                        </div>
                        <div className="h-[1px] w-[16px] bg-muted-foreground/30"></div>
                        <div className="flex items-center gap-[4px]">
                          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground text-center text-sm">{t("connectors.authorizedRepo")}</span>
                        </div>
                      </div>
                      
                      <div className="flex gap-2.5">
                        <Button
                          variant="outline"
                          className="h-[36px] min-w-[72px] px-[12px] rounded-[8px] text-sm hover:bg-muted/50 font-medium text-foreground"
                          onClick={() => void handleDisconnect()}
                          disabled={busy}
                        >
                          {actionKey === `disconnect:${selectedDetailProfile.profileId}` ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          {t("connectors.actions.disconnect")}
                        </Button>
                        {!isSupabaseConnector ? (
                          <Button
                            className="h-[36px] min-w-[72px] px-[12px] rounded-[8px] text-sm bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
                            onClick={() => void handleOAuth()}
                            disabled={busy || !detailItem.available}
                          >
                            {actionKey === `oauth:${detailItem.key}` ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            {t("connectors.actions.reconnect")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <>
                      {isSupabaseConnector ? (
                        <div className="mt-2 flex flex-col items-center gap-2">
                          <div className="inline-flex items-center gap-2 rounded-xl bg-muted px-4 py-2 text-sm text-muted-foreground">
                            <AlertCircle className="h-4 w-4" />
                            {t("connectors.requiresExtraConfig")}
                          </div>
                        </div>
                      ) : null}
                      {isSupabaseConnector ? (
                        <div className="mt-2 flex items-center justify-center gap-2.5">
                          <Button
                            className="inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors h-[36px] min-w-[72px] px-[12px] rounded-[8px] gap-[6px] text-sm bg-primary text-primary-foreground hover:bg-primary/90"
                            onClick={() => {
                              setSupabaseTokenInput((activeEditorForm.accessToken || "").trim());
                              setSupabaseConnectDialogOpen(true);
                            }}
                            disabled={busy || !detailItem.available}
                          >
                            {actionKey === `save:${detailItem.key}` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Plus className="h-4 w-4" />
                            )}
                            {t("connectors.actions.connect")}
                          </Button>
                          <a
                            href="https://supabase.com/dashboard/account/tokens"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-[36px] min-w-[72px] items-center justify-center gap-1 rounded-[8px] border border-border/60 bg-background px-[12px] text-sm text-foreground hover:bg-muted/40"
                          >
                            {t("connectors.supabase.goToTokenCreation")}
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      ) : (
                        <Button
                          className="inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors h-[36px] min-w-[72px] px-[12px] rounded-[8px] gap-[6px] text-sm mt-2 bg-primary text-primary-foreground hover:bg-primary/90"
                          onClick={() => {
                            void handleOAuth();
                          }}
                          disabled={busy || !detailItem.available}
                        >
                          {actionKey === `oauth:${detailItem.key}` || actionKey === `save:${detailItem.key}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="h-4 w-4" />
                          )}
                          {t("connectors.actions.connect")}
                        </Button>
                      )}
                    </>
                  )}
                </div>

                {isSupabaseConnector ? (
                  <div className="mt-1 mb-3 flex w-full items-center justify-center">
                    <button
                      className="flex gap-1 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setSupabaseDetailExpanded((prev) => !prev)}
                    >
                      <span className="text-[13px] leading-[18px] tracking-[-0.08px]">
                        {supabaseDetailExpanded ? t("connectors.actions.hideDetails") : t("connectors.actions.showDetails")}
                      </span>
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 transition-transform",
                          supabaseDetailExpanded ? "rotate-90" : "-rotate-90"
                        )}
                      />
                    </button>
                  </div>
                ) : null}

                {renderTargetBanner()}

                <div className="w-full max-w-[720px] space-y-8 mt-4">
                {isSupabaseConnector && supabaseDetailExpanded ? (
                  <div className="space-y-4 rounded-3xl border border-border/70 bg-muted/20 p-5">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Sparkles className="h-4 w-4 text-foreground/70" />
                        {t("connectors.supabase.mcpDetails")}
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {t("connectors.supabase.description")}
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-border/60 bg-background px-4 py-3">
                        <p className="text-xs text-muted-foreground">{t("connectors.supabase.mcpEndpoint")}</p>
                        <p className="mt-1 break-all text-sm font-medium text-foreground">{supabaseRuntimeUrl}</p>
                      </div>
                      <div className="rounded-2xl border border-border/60 bg-background px-4 py-3">
                        <p className="text-xs text-muted-foreground">{t("connectors.supabase.authMethod")}</p>
                        <p className="mt-1 text-sm font-medium text-foreground">{t("connectors.supabase.personalAccessToken")}</p>
                      </div>
                      <div className="rounded-2xl border border-border/60 bg-background px-4 py-3">
                        <p className="text-xs text-muted-foreground">{t("connectors.currentStatus")}</p>
                        <p className="mt-1 text-sm font-medium text-foreground">{statusText}</p>
                      </div>
                      <div className="rounded-2xl border border-border/60 bg-background px-4 py-3">
                        <p className="text-xs text-muted-foreground">{t("connectors.selectedProfile")}</p>
                        <p className="mt-1 text-sm font-medium text-foreground">
                          {selectedDetailProfile?.profileName || t("connectors.supabase.defaultProfile")}
                        </p>
                      </div>
                    </div>

                    {guide?.quickLinks?.length ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">{t("connectors.relatedDocs")}</p>
                        <div className="grid gap-2">
                          {guide.quickLinks.map((link) => (
                            <a
                              key={link.href}
                              href={link.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-between rounded-xl border border-border/60 bg-background px-3 py-2 text-sm text-foreground hover:bg-muted/40"
                            >
                              <span>{link.label}</span>
                              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="space-y-3 rounded-2xl border border-border/60 bg-background px-4 py-3">
                      <p className="text-sm font-medium text-foreground">{t("connectors.supabase.tokenGuideTitle")}</p>
                      <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-6 text-muted-foreground">
                        <li>
                          {t("connectors.actions.open")}
                          <a
                            href="https://supabase.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mx-1 text-foreground underline decoration-muted-foreground/50 underline-offset-2"
                          >
                            supabase.com
                          </a>
                          {t("connectors.supabase.steps.signup")}
                        </li>
                        <li>{t("connectors.supabase.steps.dashboard")}</li>
                        <li>{t("connectors.supabase.steps.accountSettings")}</li>
                        <li>
                          {t("connectors.actions.open")}
                          <a
                            href="https://supabase.com/dashboard/account/tokens"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mx-1 text-foreground underline decoration-muted-foreground/50 underline-offset-2"
                          >
                            {t("connectors.supabase.accessTokensPage")}
                          </a>
                          {t("connectors.supabase.steps.createTokenSuffix")}
                        </li>
                        <li>{t("connectors.supabase.steps.copyToken")}</li>
                      </ol>
                    </div>

                    {!isSupabaseAuthorized ? (
                      <div className="rounded-2xl border border-border/60 bg-background px-4 py-3 text-sm text-muted-foreground">
                        {t("connectors.supabase.connectHint")}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {githubConnector ? (
                  <div className="space-y-4 rounded-3xl border border-border/70 bg-muted/20 p-5">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <ShieldCheck className="h-4 w-4 text-foreground/70" />
                        {t("connectors.github.authGuideTitle")}
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">{githubStatusHint}</p>
                    </div>

                    {showGithubPermissionWarning ? (
                      <div className="flex items-start gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span className="leading-relaxed">
                          {t("connectors.github.permissionWarning")}
                        </span>
                      </div>
                    ) : null}

                    {showGithubInstallationMissingWarning ? (
                      <div className="flex items-start gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span className="leading-relaxed">
                          {t("connectors.github.installationWarning")}
                        </span>
                      </div>
                    ) : null}

                    {selectedDetailProfile?.lastError ? (
                      <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span className="leading-relaxed">{selectedDetailProfile.lastError}</span>
                      </div>
                    ) : null}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <Button
                        variant="outline"
                        className="rounded-xl justify-between bg-background"
                        onClick={() => window.open(GITHUB_APP_AUTHORIZATIONS_URL, "_blank", "noopener,noreferrer")}
                      >
                        {t("connectors.github.manageAuthorization")}
                        <ArrowUpRight className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        className="rounded-xl justify-between bg-background"
                        onClick={() => window.open(GITHUB_APP_INSTALLATIONS_URL, "_blank", "noopener,noreferrer")}
                      >
                        {t("connectors.github.manageInstallation")}
                        <ArrowUpRight className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="rounded-2xl border border-border/60 bg-background px-4 py-3 text-sm text-muted-foreground">
                      <p className="leading-6">
                        {t("connectors.github.reconnectOrder")}
                        {" "}
                        {t("connectors.github.directRedirectHint")}
                      </p>
                    </div>
                  </div>
                ) : null}
                
                {/* 仅在非 GitHub 连接器时显示复杂的 Profile 配置区 */}
                {unifiedOauthCard && !githubConnector && selectedDetailProfile?.lastError ? (
                  <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="leading-relaxed">{selectedDetailProfile.lastError}</span>
                  </div>
                ) : null}

                {unifiedOauthCard && !githubConnector && !detailItem.available && detailItem.availabilityReason ? (
                  <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="leading-relaxed">{detailItem.availabilityReason}</span>
                  </div>
                ) : null}

                {unifiedOauthCard && !githubConnector && guide ? (
                  <div className="space-y-4 rounded-3xl border border-border/70 bg-muted/20 p-5">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <ShieldCheck className="h-4 w-4 text-foreground/70" />
                        {t("connectors.guideTitle", { name: detailItem.name })}
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">{guide.intro}</p>
                    </div>

                    {guide.steps?.length ? (
                      <div className="space-y-3 rounded-2xl border border-border/60 bg-background px-4 py-3">
                        <p className="text-sm font-medium text-foreground">{t("connectors.connectionSteps")}</p>
                        <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-6 text-muted-foreground">
                          {guide.steps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    ) : null}

                    {guide.tips?.length ? (
                      <div className="space-y-3 rounded-2xl border border-border/60 bg-background px-4 py-3">
                        <p className="text-sm font-medium text-foreground">{t("connectors.usageTips")}</p>
                        <div className="space-y-2">
                          {guide.tips.map((tip) => (
                            <p key={tip} className="text-sm leading-6 text-muted-foreground">
                              {tip}
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {guide.quickLinks?.length ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">{t("connectors.relatedDocs")}</p>
                        <div className="grid gap-2">
                          {guide.quickLinks.map((link) => (
                            <a
                              key={link.href}
                              href={link.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background px-3 py-2 text-sm text-foreground hover:bg-muted/40"
                            >
                              <div className="min-w-0">
                                <div>{link.label}</div>
                                <div className="text-xs text-muted-foreground">{link.description}</div>
                              </div>
                              <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {!unifiedOauthCard && detailItem.key !== "supabase" ? (
                  <>
                    <div className="space-y-2">
                      <Label className="text-base font-medium text-foreground">{t("connectors.profileConfigTitle")}</Label>
                      <p className="text-sm text-muted-foreground">
                        {t("connectors.profileConfigDescription")}
                      </p>
                    </div>

                    <div className="space-y-6">
                      <div className="space-y-3">
                        <Label className="text-sm font-medium">{t("connectors.selectProfile")}</Label>
                        <div className="flex flex-col gap-3">
                          <Select
                            value={selectedDetailProfileId || NEW_PROFILE_ID}
                            onValueChange={(value) => {
                              setSelectedProfileIds((prev) => ({
                                ...prev,
                                [detailItem.key]: value,
                              }));
                            }}
                          >
                            <SelectTrigger className="w-full rounded-xl bg-muted/20">
                              <SelectValue placeholder={t("connectors.selectProfilePlaceholder")} />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl">
                              {detailConnectorProfiles.map((profile) => (
                                <SelectItem key={profile.profileId} value={profile.profileId} className="rounded-md">
                                  {profile.profileName}
                                  {profile.isDefault ? ` · ${t("connectors.defaultProfileSuffix")}` : ""}
                                </SelectItem>
                              ))}
                              <SelectItem value={NEW_PROFILE_ID} className="rounded-md">{t("connectors.createNewProfile")}</SelectItem>
                            </SelectContent>
                          </Select>

                          <Button
                            variant="outline"
                            className="w-full sm:w-auto rounded-xl justify-center"
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
                            {t("connectors.createProfile")}
                          </Button>
                        </div>
                      </div>

                      {selectedDetailProfile ? (
                        <div className="space-y-3">
                          <Label className="text-sm font-medium">{t("connectors.profileActions")}</Label>
                          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                            {!selectedDetailProfile.isDefault ? (
                              <Button
                                variant="outline"
                                className="rounded-xl flex-1 sm:flex-none"
                                disabled={busy}
                                onClick={() => void handleSetDefault()}
                              >
                                {actionKey === `default:${selectedDetailProfile.profileId}` ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <Check className="mr-2 h-4 w-4" />
                                )}
                                {t("connectors.actions.setDefault")}
                              </Button>
                            ) : null}
                            <Button
                              variant="outline"
                              className="rounded-xl flex-1 sm:flex-none"
                              disabled={busy || !selectedDetailProfile.secretSummary}
                              onClick={() => void handleDisconnect()}
                            >
                              {actionKey === `disconnect:${selectedDetailProfile.profileId}` ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Unplug className="mr-2 h-4 w-4" />
                              )}
                              {t("connectors.actions.clearAuth")}
                            </Button>
                            <Button
                              variant="outline"
                              className="rounded-xl flex-1 sm:flex-none text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20"
                              disabled={busy}
                              onClick={() => void handleDelete()}
                            >
                              {actionKey === `delete:${selectedDetailProfile.profileId}` ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="mr-2 h-4 w-4" />
                              )}
                              {t("common.delete")}
                            </Button>
                          </div>
                        </div>
                      ) : null}

                      {selectedDetailProfile?.lastError ? (
                        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span className="leading-relaxed">{selectedDetailProfile.lastError}</span>
                        </div>
                      ) : null}

                      {!detailItem.available && detailItem.availabilityReason ? (
                        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span className="leading-relaxed">{detailItem.availabilityReason}</span>
                        </div>
                      ) : null}

                      <div className="space-y-5 rounded-2xl border border-border/60 bg-muted/20 p-5">
                        <div className="space-y-1">
                          <Label className="text-sm font-medium">{t("connectors.configFields")}</Label>
                          <p className="text-xs text-muted-foreground">{t("connectors.configFieldsDescription")}</p>
                        </div>
                        
                        <div className="space-y-4">
                          {detailItem.configFields.map((field) => (
                            <div key={field.key} className="space-y-2">
                              <Label
                                htmlFor={`${detailItem.key}-${field.key}`}
                                className="text-sm font-medium text-foreground"
                              >
                                {field.label}
                                {field.required ? <span className="text-destructive ml-1">*</span> : ""}
                              </Label>
                              {field.type === "textarea" ? (
                                <Textarea
                                  id={`${detailItem.key}-${field.key}`}
                                  value={activeEditorForm[field.key] || ""}
                                  placeholder={field.placeholder}
                                  className="min-h-[120px] rounded-xl bg-background"
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
                                  className="rounded-xl bg-background"
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
                            <p className="text-xs text-muted-foreground">{field.description}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap">
                      <Button
                        className="rounded-xl w-full sm:w-auto"
                        disabled={busy || !detailItem.available}
                        onClick={() => void handleSave()}
                      >
                        {actionKey === `save:${detailItem.key}` ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="mr-2 h-4 w-4" />
                        )}
                        {t("connectors.actions.saveProfile")}
                      </Button>
                      {detailItem.oauth?.supported ? (
                        <Button
                          variant="outline"
                          className="rounded-xl w-full sm:w-auto bg-background"
                          disabled={busy || !detailItem.available}
                          onClick={() => void handleOAuth()}
                        >
                          {actionKey === `oauth:${detailItem.key}` ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <ArrowUpRight className="mr-2 h-4 w-4" />
                          )}
                          {connectorLevelOauth
                            ? detailItem.key === "notion"
                              ? t("connectors.actions.reconnectNotion")
                              : t("connectors.actions.connectNotion")
                            : selectedDetailProfile?.authStatus === "authorized"
                              ? t("connectors.actions.reauthorize")
                              : t("connectors.actions.startOauth")}
                        </Button>
                      ) : null}
                      
                      <div className="flex flex-col gap-2 w-full sm:w-auto">
                        {effectiveTargetSessionId && selectedDetailProfile?.authStatus === "authorized" ? (
                          <Badge variant="secondary" className="rounded-lg px-3 py-1.5 text-xs font-normal justify-center">
                            {t("connectors.saveWillAttach")}
                          </Badge>
                        ) : null}
                        {actionBusy ? (
                          <Badge variant="outline" className="rounded-lg px-3 py-1.5 text-xs font-normal justify-center bg-background">
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            {t("connectors.processing")}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
                </>
              ) : null}
              </div>
            </div>
          </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={supabaseConnectDialogOpen} onOpenChange={setSupabaseConnectDialogOpen}>
        <DialogContent
          showCloseButton={false}
          className="w-[min(620px,calc(100vw-32px))] max-w-[620px] gap-0 overflow-hidden rounded-[28px] border shadow-xl p-0"
        >
          <div className="flex items-center justify-end border-b border-border/60 px-6 py-4">
            <button
              onClick={() => setSupabaseConnectDialogOpen(false)}
              className="inline-flex items-center justify-center text-foreground transition hover:opacity-80"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-6 px-8 pb-8 pt-6">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-border/70 bg-background">
                  <Sparkles className="h-6 w-6 text-foreground/80" />
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
                <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-border/70 bg-background">
                  <Database className="h-6 w-6 text-foreground/80" />
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-2xl font-semibold text-foreground">{t("connectors.supabase.connectTitle")}</h3>
                <p className="text-sm leading-6 text-muted-foreground">
                  {t("connectors.supabase.connectDescriptionPrefix")}
                  <a
                    href="https://supabase.com/dashboard/account/tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mx-1 text-foreground underline decoration-muted-foreground/50 underline-offset-2"
                  >
                    {t("connectors.supabase.officialDocs")}
                  </a>
                  {t("connectors.supabase.connectDescriptionSuffix")}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-base font-medium text-foreground">{t("connectors.supabase.personalAccessToken")}</Label>
              <Input
                type="password"
                value={supabaseTokenInput}
                placeholder="YOUR_SUPABASE_ACCESS_TOKEN"
                className="h-14 rounded-xl bg-muted/30 text-base"
                onChange={(event) => setSupabaseTokenInput(event.target.value)}
              />
            </div>

            <Button
              className="h-14 w-full rounded-xl text-xl font-semibold"
              disabled={Boolean(actionKey) || !supabaseTokenInput.trim()}
              onClick={() => void handleSupabaseConnect()}
            >
              {actionKey === "save:supabase" ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : null}
              {t("connectors.actions.connect")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      </>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-transparent">
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
                {t(tab.labelKey)}
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
              placeholder={t("sidebar.search")}
              className="h-9 rounded-xl"
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1">{renderDirectory()}</div>
      {activeTab === "app" ? renderDetailModal() : null}
    </div>
  );
}
