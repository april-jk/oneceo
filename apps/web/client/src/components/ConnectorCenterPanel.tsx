import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearch } from "wouter";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Plus,
  ShieldCheck,
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
import { CustomMcpManagementPanel } from "@/components/connectors/CustomMcpManagementPanel";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";

type ConnectorCenterPanelProps = {
  targetSessionId?: string | null;
  highlightedConnector?: ConnectorKey | null;
};

type ConnectorCenterTab = ConnectorCategory;
type ConnectorFormValues = Record<string, string>;

const NEW_PROFILE_ID = "__new__";
export const GITHUB_FIXED_CALLBACK_PATH = "/github/callback";
export const NOTION_FIXED_CALLBACK_PATH = "/notion/callback";
export const SUPABASE_FIXED_CALLBACK_PATH = "/supabase/callback";
export const SLACK_FIXED_CALLBACK_PATH = "/slack/callback";
export const FIGMA_FIXED_CALLBACK_PATH = "/figma/callback";
export const GOOGLE_SUPER_FIXED_CALLBACK_PATH = "/google-super/callback";
export const VERCEL_FIXED_CALLBACK_PATH = "/vercel/callback";
const GITHUB_INSTALLATION_MISSING_PATTERN = /没有任何可用安装|未安装到任何账号|installation/i;
const CONNECTOR_TABS: Array<{ key: ConnectorCenterTab; labelKey: string }> = [
  { key: "app", labelKey: "connectors.tabs.app" },
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
    pathname === GITHUB_FIXED_CALLBACK_PATH ||
    pathname === NOTION_FIXED_CALLBACK_PATH ||
    pathname === SUPABASE_FIXED_CALLBACK_PATH ||
    pathname === SLACK_FIXED_CALLBACK_PATH ||
    pathname === FIGMA_FIXED_CALLBACK_PATH ||
    pathname === GOOGLE_SUPER_FIXED_CALLBACK_PATH ||
    pathname === VERCEL_FIXED_CALLBACK_PATH
  );
}

export function resolveConnectorOauthCallbackContext(location: string, params: URLSearchParams) {
  const currentPath = new URL(location, resolveBrowserOrigin()).pathname;
  const hasOauthCallbackParams = Boolean(params.get("code")) && Boolean(params.get("state"));
  const fixedPathConnector =
    currentPath === GITHUB_FIXED_CALLBACK_PATH
      ? "github"
      : currentPath === NOTION_FIXED_CALLBACK_PATH
      ? "notion"
      : currentPath === SUPABASE_FIXED_CALLBACK_PATH
        ? "supabase"
      : currentPath === SLACK_FIXED_CALLBACK_PATH
        ? "slack"
        : currentPath === FIGMA_FIXED_CALLBACK_PATH
          ? "figma"
        : currentPath === GOOGLE_SUPER_FIXED_CALLBACK_PATH
          ? "google_super"
        : currentPath === VERCEL_FIXED_CALLBACK_PATH
          ? "vercel"
          : null;
  const connector =
    (params.get("connector") as ConnectorKey | null) ||
    (params.get("state") ? fixedPathConnector : null);
  const hasConnectorOAuthFlag = params.get("connector_oauth") === "1";
  return {
    connector,
    currentPath,
    isFixedCallback: Boolean(fixedPathConnector && params.get("state")),
    shouldHandle: hasConnectorOAuthFlag || Boolean(fixedPathConnector && params.get("state")),
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
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
      <div className="rounded-2xl border border-border/70 bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
        {i18n.t("connectors.comingSoon")}
      </div>
      <h4 className="mt-5 text-lg font-semibold text-foreground">
        {i18n.t("connectors.empty.customMcpReserved")}
      </h4>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        {i18n.t("connectors.empty.intro")}
        {i18n.t("connectors.empty.customMcpDetail")}
      </p>
      <Button disabled className="mt-6 rounded-xl">
        <Plus className="mr-2 h-4 w-4" />
        {i18n.t("connectors.empty.createCustomMcp")}
      </Button>
    </div>
  );
}

function isGithubConnector(item: ConnectorCatalogItem | null | undefined) {
  return item?.key === "github";
}

export function shouldUseConnectorLevelOauth(connectorKey: ConnectorKey | null | undefined) {
  return (
    connectorKey === "github" ||
    connectorKey === "notion" ||
    connectorKey === "supabase" ||
    connectorKey === "figma" ||
    connectorKey === "google_super" ||
    connectorKey === "slack" ||
    connectorKey === "vercel"
  );
}

export function shouldUseUnifiedConnectorCard(connectorKey: ConnectorKey | null | undefined) {
  return connectorKey === "github" || connectorKey === "vercel" || shouldUseConnectorLevelOauth(connectorKey);
}

function resolveAuthorizedAccountLabel(
  connectorKey: ConnectorKey,
  profile: ConnectorProfile | null | undefined
) {
  if (connectorKey === "vercel") {
    return "Vercel";
  }
  return (
    asText(profile?.displayName) ||
    asText(profile?.profileName) ||
    i18n.t("connectors.authorizedAccount")
  );
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const text = asText(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

export function resolveAuthorizedRepositoryLabel(profile: ConnectorProfile | null | undefined) {
  const repositories = asStringArray(profile?.config?.repositories);
  if (repositories.length === 1) return repositories[0];
  if (repositories.length > 1) return `${repositories[0]} +${repositories.length - 1}`;
  return asText(profile?.displayName) || asText(profile?.profileName) || i18n.t("connectors.authorizedRepo");
}

function resolveConnectorDisplayText(
  item: ConnectorCatalogItem,
  field: "name" | "description",
  fallback: string
) {
  return i18n.t(`connectors.catalog.${item.key}.${field}`, {
    defaultValue: fallback,
  });
}

export function ConnectorCenterPanel({
  targetSessionId,
  highlightedConnector,
}: ConnectorCenterPanelProps) {
  const { t } = useTranslation();
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
    if (!state || !connector) return;
    if (!code && connector !== "github" && connector !== "notion" && connector !== "slack" && connector !== "figma" && connector !== "google_super" && connector !== "supabase") return;
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
            : connector === "github"
              ? {
                  callbackPath: GITHUB_FIXED_CALLBACK_PATH,
                }
            : connector === "supabase"
              ? {
                  callbackPath: SUPABASE_FIXED_CALLBACK_PATH,
                }
              : connector === "slack"
                ? {
                    callbackPath: SLACK_FIXED_CALLBACK_PATH,
                  }
              : connector === "figma"
                ? {
                    callbackPath: FIGMA_FIXED_CALLBACK_PATH,
                  }
              : connector === "google_super"
                ? {
                    callbackPath: GOOGLE_SUPER_FIXED_CALLBACK_PATH,
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
            code: code || "",
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
            code: code || "",
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
      const displayName = resolveConnectorDisplayText(item, "name", item.name);
      const displayDescription = resolveConnectorDisplayText(
        item,
        "description",
        item.description
      );
      const haystack = [displayName, displayDescription, item.key].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [appCatalog, deferredQuery, t]);

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
      item.key !== "figma" &&
      item.key !== "google_super" &&
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
            : detailItem.key === "github"
              ? buildConnectorRedirectUri(
                  location,
                  "",
                  detailItem.key,
                  null,
                  effectiveTargetSessionId,
                  {
                    callbackPath: GITHUB_FIXED_CALLBACK_PATH,
                  }
                )
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
                  : detailItem.key === "figma"
                    ? {
                      callbackPath: FIGMA_FIXED_CALLBACK_PATH,
                    }
                  : detailItem.key === "google_super"
                    ? {
                        callbackPath: GOOGLE_SUPER_FIXED_CALLBACK_PATH,
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
    if (activeTab === "custom_mcp") {
      return (
        <CustomMcpManagementPanel
          profiles={profilesByConnector.custom_mcp || []}
          query={deferredQuery}
          targetSessionId={effectiveTargetSessionId}
          onProfilesChanged={load}
        />
      );
    }
    if (activeTab !== "app") {
      return renderEmptyTab(activeTab);
    }

    const renderCard = (item: ConnectorCatalogItem) => {
      const Icon = resolveConnectorIcon(item.icon);
      const connectorProfiles = profilesByConnector[item.key] || [];
      const status = getDirectoryStatus(item, connectorProfiles);
      const connected = status === "authorized";
      const pending = status === "needs_auth";
      const displayName = resolveConnectorDisplayText(item, "name", item.name);
      const displayDescription = resolveConnectorDisplayText(
        item,
        "description",
        item.description
      );

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
              <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
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
              {displayDescription}
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
        <div data-tour="connectors-directory" className="space-y-6 px-6 pb-6">
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
    const githubConnector = isGithubConnector(detailItem);
    const connectorLevelOauth = shouldUseConnectorLevelOauth(detailItem.key);
    const unifiedOauthCard = shouldUseUnifiedConnectorCard(detailItem.key);
    const busy = Boolean(actionKey);
    const actionBusy =
      actionKey === `save:${detailItem.key}` || actionKey === `oauth:${detailItem.key}`;
    const detailDisplayName = resolveConnectorDisplayText(detailItem, "name", detailItem.name);
    const detailDisplayDescription = resolveConnectorDisplayText(
      detailItem,
      "description",
      detailItem.description
    );
    const authorizedAccountLabel = resolveAuthorizedAccountLabel(
      detailItem.key,
      selectedDetailProfile
    );
    const authorizedRepositoryLabel = githubConnector
      ? resolveAuthorizedRepositoryLabel(selectedDetailProfile)
      : t("connectors.authorizedRepo");

    const isSupabaseConnector = detailItem.key === "supabase";
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
          <DialogHeader className="sr-only">
            <DialogTitle>{detailDisplayName}</DialogTitle>
            <DialogDescription>{detailDisplayDescription}</DialogDescription>
          </DialogHeader>
          <div
            className="relative flex h-full w-full flex-col items-start justify-start overflow-clip"
          >
            <button
              onClick={() => setDetailKey(null)}
              className="absolute right-5 top-5 z-10 inline-flex items-center justify-center rounded-full border border-border/60 bg-background/90 p-2 text-foreground shadow-sm transition-colors hover:bg-muted/80"
              aria-label={t("common.close")}
            >
              <X className="h-4 w-4" />
            </button>

            <div
              className={cn(
                "min-h-0 flex-1 w-full bg-background",
                isSupabaseConnector
                  ? "overflow-y-auto [scrollbar-gutter:stable] [scrollbar-width:thin] [-ms-overflow-style:auto] [scrollbar-color:rgba(120,120,120,0.7)_transparent] [&::-webkit-scrollbar]:w-3 [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/50"
                  : "overflow-y-auto"
              )}
            >
              <div
                className={cn(
                  "relative flex w-full shrink-0 flex-col items-center px-6",
                  unifiedOauthCard
                    ? "min-h-full justify-center gap-5 pt-12 pb-8"
                    : "justify-start gap-5 pb-4 pt-10"
                )}
              >
                <div className="flex w-full max-w-[600px] shrink-0 flex-col items-center justify-center gap-3.5 p-0 relative">
                  <div className="bg-background flex items-center justify-center p-[8px] relative rounded-xl shrink-0 size-14 border border-border/60 shadow-sm">
                    <Icon className="h-10 w-10 text-foreground/85" />
                  </div>
                  
                  <div className="flex flex-col gap-2 items-start justify-center leading-[0] p-0 relative shrink-0 text-center w-full">
                    <div className="flex gap-2 items-center justify-center font-semibold overflow-hidden relative shrink-0 text-foreground text-[20px] tracking-[-0.44px] w-full">
                      <p className="leading-[26px] overflow-hidden text-ellipsis">{detailDisplayName}</p>
                      {detailItem.isNew ? (
                        <span className="ml-2 rounded-md border border-[var(--brand-border)] bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--brand-soft-foreground)]">{t("connectors.badges.new")}</span>
                      ) : null}
                    </div>
                    <div className="font-normal relative shrink-0 text-muted-foreground tracking-[-0.154px] w-full">
                      <p className="block text-[14px] leading-[20px]">{detailDisplayDescription}</p>
                    </div>
                  </div>

                  {selectedDetailProfile?.authStatus === "authorized" ? (
                    <div className="flex flex-col items-center gap-4 w-full mt-2">
                      <div className="flex items-center justify-center gap-[8px]">
                        <div className="flex items-center gap-[4px]">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 fill-emerald-500/20" />
                          <span className="max-w-[220px] truncate text-center text-sm text-muted-foreground" title={authorizedAccountLabel}>
                            {authorizedAccountLabel}
                          </span>
                        </div>
                        <div className="h-[1px] w-[16px] bg-muted-foreground/30"></div>
                        <div className="flex items-center gap-[4px]">
                          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                          <span className="max-w-[260px] truncate text-center text-sm text-muted-foreground" title={authorizedRepositoryLabel}>
                            {authorizedRepositoryLabel}
                          </span>
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
                      </div>
                    </div>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>

                {renderTargetBanner()}

                <div className="mt-4 w-full max-w-[720px] space-y-8">
                {/* 仅在已授权态显示必要错误，未授权态不展示错误提示 */}
                {unifiedOauthCard &&
                !githubConnector &&
                selectedDetailProfile?.authStatus === "authorized" &&
                selectedDetailProfile?.lastError ? (
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
                            ? selectedDetailProfile?.authStatus === "authorized"
                              ? t("connectors.actions.reconnectConnector", { name: detailDisplayName })
                              : t("connectors.actions.connectConnector", { name: detailDisplayName })
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
      </>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-transparent">
      <div className="border-b border-border/70 px-6 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div data-tour="connectors-tabs" className="flex items-center gap-2">
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
          <div data-tour="connectors-search" className="w-full sm:w-[220px]">
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
