import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowUpRight,
  Book,
  Check,
  CheckCircle2,
  ChevronRight,
  CornerDownRight,
  Link2,
  Loader2,
  Plug,
  Search,
  Settings2,
  Unplug,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getConnectorGuides } from "@/lib/connector-guides";
import {
  attachSessionConnector,
  detachSessionConnector,
  getGithubProfileRepositories,
  getMyConnectorProfiles,
  saveSessionConnectorDraft,
  getSessionConnectors,
  type ConnectorCatalogItem,
  type ConnectorKey,
  type GithubConnectorRepository,
  type ConnectorProfile,
  type SessionConnectorStatus,
} from "@/lib/connectors-client";
import {
  clearSessionConnectorDraftState,
  ensureSessionConnectorDraftId,
  buildConnectorDraftKey,
  listSessionConnectorDraftEntries,
  removeSessionConnectorDraftEntry,
  updateSessionConnectorDraftMetadata,
  upsertSessionConnectorDraftEntry,
} from "@/lib/session-connector-draft";
import { resolveConnectorIcon } from "@/lib/connector-ui";
import { openSettingsDialog } from "@/lib/settings-dialog-events";
import { cn } from "@/lib/utils";

interface ConnectorDialogProps {
  sessionId?: string | null;
  className?: string;
}

function translateConnectorStatus(
  t: ReturnType<typeof useTranslation>["t"],
  value: string | null | undefined
) {
  if (!value) return t("connectors.dialog.status.unknown");
  const key = value.toLowerCase();
  switch (key) {
    case "pending_recover":
      return t("connectors.dialog.status.pendingRecover");
    case "recovering":
      return t("connectors.dialog.status.recovering");
    case "authorized":
      return t("connectors.dialog.status.authorized");
    case "connected":
      return t("connectors.dialog.status.connected");
    case "needs_auth":
      return t("connectors.dialog.status.needsAuth");
    case "not_configured":
      return t("connectors.dialog.status.notConfigured");
    case "connecting":
      return t("connectors.dialog.status.connecting");
    case "failed":
      return t("connectors.dialog.status.failed");
    case "error":
      return t("connectors.dialog.status.error");
    case "unavailable":
      return t("connectors.dialog.status.unavailable");
    case "idle":
      return t("connectors.dialog.status.idle");
    case "disconnected":
      return t("connectors.dialog.status.disconnected");
    case "detached":
      return t("connectors.dialog.status.detached");
    default:
      return value.replaceAll("_", " ");
  }
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

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function repositorySelectionKey(connectorKey: ConnectorKey, profileId: string | null) {
  return `${connectorKey}::${profileId || "none"}`;
}

function summarizeRepositoryLabel(fullName: string | null | undefined) {
  if (!fullName) return null;
  const parts = fullName.split("/");
  return parts.length > 1 ? parts[parts.length - 1] : fullName;
}

function normalizeRepositoryFullName(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  const parts = text
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length !== 2) return "";
  return `${parts[0]}/${parts[1]}`;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const normalized = normalizeRepositoryFullName(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export function resolveGithubRepositoryOptions(input: {
  fetched?: GithubConnectorRepository[];
  profile?: ConnectorProfile | null;
  session?: SessionConnectorStatus;
}) {
  const fetched = Array.isArray(input.fetched) ? input.fetched : [];
  if (fetched.length > 0) {
    return fetched;
  }

  const fallbackNames = [
    ...asStringArray(input.profile?.config?.repositories),
    ...asStringArray(input.profile?.metadata?.composioRepositoryNames),
    ...asStringArray(input.session?.authorizedRepositories),
  ];
  const seen = new Set<string>();
  const result: GithubConnectorRepository[] = [];
  fallbackNames.forEach((fullName, index) => {
    const key = fullName.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const [owner, name] = fullName.split("/");
    result.push({
      id: index + 1,
      owner,
      name,
      fullName,
      private: false,
      defaultBranch: null,
      permissions: {
        pull: true,
      },
    });
  });
  return result;
}

function splitSelectedRepositoriesSummary(
  repositories: string[],
  t: ReturnType<typeof useTranslation>["t"]
) {
  if (repositories.length === 0) {
    return {
      primary: t("connectors.dialog.github.noRepositorySelected"),
      extra: null as string | null,
    };
  }
  return {
    primary: summarizeRepositoryLabel(repositories[0]) || repositories[0],
    extra: repositories.length > 1 ? `+${repositories.length - 1}` : null,
  };
}

function normalizeRepositoriesForCompare(repositories?: string[]) {
  return [...(repositories || [])].sort();
}

function sameRepositories(left?: string[], right?: string[]) {
  const leftNormalized = normalizeRepositoriesForCompare(left);
  const rightNormalized = normalizeRepositoriesForCompare(right);
  if (leftNormalized.length !== rightNormalized.length) return false;
  return leftNormalized.every((item, index) => item === rightNormalized[index]);
}

type ConnectorDialogEntry = {
  rowKey: string;
  item: ConnectorCatalogItem;
  session: SessionConnectorStatus | undefined;
  connectorProfiles: ConnectorProfile[];
  selectedProfileId: string | null;
  selectedProfile: ConnectorProfile | null;
};

function resolvePreferredProfileId(
  connectorProfiles: ConnectorProfile[],
  session?: SessionConnectorStatus,
  currentSelection?: string | null
) {
  if (
    currentSelection &&
    connectorProfiles.some((profile) => profile.profileId === currentSelection)
  ) {
    return currentSelection;
  }
  if (
    session?.attachedProfileId &&
    connectorProfiles.some((profile) => profile.profileId === session.attachedProfileId)
  ) {
    return session.attachedProfileId;
  }
  if (
    session?.selectedProfileId &&
    connectorProfiles.some((profile) => profile.profileId === session.selectedProfileId)
  ) {
    return session.selectedProfileId;
  }
  return (
    connectorProfiles.find((profile) => profile.isDefault)?.profileId ||
    connectorProfiles[0]?.profileId ||
    null
  );
}

function statusChipTone(value: string) {
  switch (value) {
    case "authorized":
    case "connected":
      return "bg-emerald-500/10 text-emerald-700";
    case "needs_auth":
    case "not_configured":
    case "connecting":
    case "pending_recover":
    case "recovering":
      return "bg-amber-500/10 text-amber-700";
    case "failed":
    case "error":
    case "unavailable":
      return "bg-destructive/10 text-destructive";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export default function ConnectorDialog({
  sessionId,
  className,
}: ConnectorDialogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [detailKey, setDetailKey] = useState<ConnectorKey | null>(null);
  const [catalog, setCatalog] = useState<ConnectorCatalogItem[]>([]);
  const [profiles, setProfiles] = useState<ConnectorProfile[]>([]);
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionConnectorStatus>>(
    {}
  );
  const [sessionStatusOverrides, setSessionStatusOverrides] = useState<
    Record<string, SessionConnectorStatus | undefined>
  >({});
  const [profileSelection, setProfileSelection] = useState<
    Partial<Record<ConnectorKey, string | null>>
  >({});
  const [loading, setLoading] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [githubRepositories, setGithubRepositories] = useState<
    Record<string, GithubConnectorRepository[]>
  >({});
  const [githubRepositoriesLoading, setGithubRepositoriesLoading] = useState<
    Record<string, boolean>
  >({});
  const [githubRepositorySearch, setGithubRepositorySearch] = useState<
    Partial<Record<string, string>>
  >({});
  const [githubSelectedRepositories, setGithubSelectedRepositories] = useState<
    Partial<Record<string, string[]>>
  >({});
  const connectorGuides = useMemo(() => getConnectorGuides(t), [t]);

  const load = async (options?: { allowClosed?: boolean; silent?: boolean }) => {
    const allowClosed = Boolean(options?.allowClosed);
    const silent = Boolean(options?.silent);
    if (!open && !allowClosed) return;
    if (!silent) {
      setLoading(true);
    }
    try {
      const me = await getMyConnectorProfiles();
      setCatalog(me.catalog);
      setProfiles(me.profiles);

      let nextSessionStatuses: Record<string, SessionConnectorStatus> = {};
      if (sessionId) {
        const sessionData = await getSessionConnectors(sessionId);
        nextSessionStatuses = Object.fromEntries(
          sessionData.items.map((item) => [item.connectorInstanceKey || item.connectorKey, item])
        );
      } else {
        const draftEntries = listSessionConnectorDraftEntries();
        const profilesByConnector = groupProfilesByConnector(me.profiles);
        for (const entry of draftEntries) {
          const catalogItem = me.catalog.find((item) => item.key === entry.connectorKey);
          if (!catalogItem) continue;
          const connectorProfiles = profilesByConnector[entry.connectorKey] || [];
          const selectedProfile =
            connectorProfiles.find((profile) => profile.profileId === entry.profileId) || null;
          const repositories = Array.isArray(entry.sessionConfig?.repositories)
            ? (entry.sessionConfig?.repositories as string[])
            : [];
          const draftKey = buildConnectorDraftKey(entry.connectorKey, entry.profileId);
          if (!draftKey) continue;
          nextSessionStatuses[draftKey] = buildOptimisticSessionStatus({
            item: catalogItem,
            session: undefined,
            connectorProfiles,
            selectedProfileId: selectedProfile?.profileId || null,
            selectedProfile,
            attached: entry.desiredState !== "detached",
            repositories,
          });
        }
      }
      const mergedSessionStatuses = {
        ...nextSessionStatuses,
      } as Record<string, SessionConnectorStatus>;
      for (const [connectorKey, override] of Object.entries(sessionStatusOverrides)) {
        if (!override) continue;
        mergedSessionStatuses[connectorKey] = override;
      }
      setSessionStatuses(mergedSessionStatuses);

      const profilesByConnector = groupProfilesByConnector(me.profiles);
      setProfileSelection((prev) => {
        const next = { ...prev };
        for (const item of me.catalog) {
          next[item.key] = resolvePreferredProfileId(
            profilesByConnector[item.key] || [],
            mergedSessionStatuses[item.key],
            prev[item.key]
          );
        }
        return next;
      });
    } catch (error) {
      if (!silent) {
        toast.error(error instanceof Error ? error.message : t("connectors.errors.loadFailed"));
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!open) {
      setDetailKey(null);
      return;
    }
    void load();
    if (!sessionId) return;
    const timer = window.setInterval(() => {
      void load();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [open, sessionId, t]);

  useEffect(() => {
    void load({ allowClosed: true, silent: true });
  }, [sessionId]);

  const profilesByConnector = useMemo(
    () => groupProfilesByConnector(profiles),
    [profiles]
  );

  const mergedConnectors = useMemo<ConnectorDialogEntry[]>(
    () => {
      const appEntries = catalog
        .filter((item) => item.category === "app")
        .map((item) => {
        const connectorProfiles = profilesByConnector[item.key] || [];
        const selectedProfileId = resolvePreferredProfileId(
          connectorProfiles,
          sessionStatuses[item.key],
          profileSelection[item.key]
        );
        const selectedProfile =
          connectorProfiles.find((profile) => profile.profileId === selectedProfileId) || null;

        return {
          rowKey: item.key,
          item,
          session: sessionStatuses[item.key],
          connectorProfiles,
          selectedProfileId,
          selectedProfile,
        };
      });

      const customMcpCatalogItem = catalog.find((item) => item.key === "custom_mcp");
      const customMcpProfiles = profilesByConnector.custom_mcp || [];
      const customMcpEntries = customMcpCatalogItem
        ? customMcpProfiles.map((profile) => ({
            rowKey: `custom_mcp:${profile.profileId}`,
            item: {
              ...customMcpCatalogItem,
              name: profile.profileName,
              description:
                asText(profile.config?.description) ||
                asText(profile.config?.serverUrl) ||
                customMcpCatalogItem.description,
            },
            session: sessionStatuses[`custom_mcp:${profile.profileId}`],
            connectorProfiles: [profile],
            selectedProfileId: profile.profileId,
            selectedProfile: profile,
          }))
        : [];

      return [...appEntries, ...customMcpEntries];
    },
    [catalog, profileSelection, profilesByConnector, sessionStatuses]
  );

  const githubConnector = useMemo(
    () => mergedConnectors.find((item) => item.item.key === "github") || null,
    [mergedConnectors]
  );
  const activeGithubConnector = detailKey === "github" ? githubConnector : null;
  const activeDetailConnector = useMemo(
    () => (detailKey ? mergedConnectors.find((item) => item.item.key === detailKey) || null : null),
    [detailKey, mergedConnectors]
  );
  const activeGithubSelectionKey = repositorySelectionKey(
    "github",
    activeGithubConnector?.selectedProfileId || null
  );

  useEffect(() => {
    if (!open) return;
    const isGithubChecked = githubConnector?.session?.attached;
    if (!isGithubChecked && detailKey === "github") {
      setDetailKey(null);
    }
  }, [open, detailKey, githubConnector?.session?.attached]);

  useEffect(() => {
    if (!open || detailKey !== "github") return;
    const profileId = activeGithubConnector?.selectedProfileId;
    const selectedProfile = activeGithubConnector?.selectedProfile;
    if (!profileId || selectedProfile?.authStatus !== "authorized") return;
    if (githubRepositories[profileId] || githubRepositoriesLoading[profileId]) return;

    setGithubRepositoriesLoading((prev) => ({
      ...prev,
      [profileId]: true,
    }));
    void getGithubProfileRepositories(profileId)
      .then((items) => {
        setGithubRepositories((prev) => ({
          ...prev,
          [profileId]: items,
        }));
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : t("connectors.dialog.github.loadRepositoriesFailed"));
        void load();
      })
      .finally(() => {
        setGithubRepositoriesLoading((prev) => ({
          ...prev,
          [profileId]: false,
        }));
      });
  }, [
    activeGithubConnector?.selectedProfile,
    activeGithubConnector?.selectedProfileId,
    detailKey,
    githubRepositories,
    githubRepositoriesLoading,
    open,
    t,
  ]);

  useEffect(() => {
    if (!activeGithubConnector?.selectedProfileId) return;
    if (Object.prototype.hasOwnProperty.call(githubSelectedRepositories, activeGithubSelectionKey)) {
      return;
    }
    const sessionRepositories =
      activeGithubConnector.session?.attachedProfileId ===
      activeGithubConnector.selectedProfileId
        ? activeGithubConnector.session?.authorizedRepositories || []
        : [];
    if (sessionRepositories.length === 0) return;
    setGithubSelectedRepositories((prev) => ({
      ...prev,
      [activeGithubSelectionKey]: sessionRepositories,
    }));
  }, [
    activeGithubConnector?.selectedProfileId,
    activeGithubConnector?.session?.authorizedRepositories,
    activeGithubSelectionKey,
    githubSelectedRepositories,
  ]);

  const openConnectorSettings = (connectorKey?: ConnectorKey | null) => {
    openSettingsDialog({
      tab: "connectors",
      targetSessionId: sessionId || null,
      connectorKey: connectorKey || null,
    });
    setDetailKey(null);
    setOpen(false);
  };

  const attachedConnectors = useMemo(
    () =>
      mergedConnectors.filter(({ item, session, selectedProfileId }) =>
        item.key === "custom_mcp"
          ? Boolean(session?.attached && session?.attachedProfileId === selectedProfileId)
          : Boolean(session?.attached)
      ),
    [mergedConnectors]
  );

  const buildOptimisticSessionStatus = ({
    item,
    session,
    connectorProfiles,
    selectedProfileId,
    selectedProfile,
    attached,
    repositories,
  }: {
    item: ConnectorCatalogItem;
    session?: SessionConnectorStatus;
    connectorProfiles: ConnectorProfile[];
    selectedProfileId: string | null;
    selectedProfile: ConnectorProfile | null;
    attached: boolean;
    repositories?: string[];
  }): SessionConnectorStatus => ({
    connectorKey: item.key,
    connectorInstanceKey: buildConnectorDraftKey(item.key, selectedProfileId) || item.key,
    isConnectorInstance: item.key === "custom_mcp" && Boolean(selectedProfileId),
    name: session?.name || item.name,
    icon: session?.icon || item.icon,
    authMode: session?.authMode || item.authMode,
    available: item.available,
    availabilityReason: item.availabilityReason,
    globalAuthStatus: selectedProfile?.authStatus || session?.globalAuthStatus || "not_configured",
    attached,
    desiredState: attached ? "attached" : "detached",
    runtimeStatus: attached ? "connecting" : "disconnected",
    usageStatus: session?.usageStatus || "idle",
    displayName: selectedProfile?.displayName || session?.displayName || null,
    selectedProfileId,
    selectedProfileName: selectedProfile?.profileName || session?.selectedProfileName || null,
    attachedProfileId: attached ? selectedProfileId : null,
    attachedProfileName: attached ? selectedProfile?.profileName || null : null,
    availableProfilesCount: connectorProfiles.length,
    enabledTools: session?.enabledTools || [],
    authorizedRepositories: attached ? repositories || [] : [],
  });

  const applySessionStatusOverride = (status: SessionConnectorStatus) => {
    const key = status.connectorInstanceKey || status.connectorKey;
    setSessionStatusOverrides((prev) => ({
      ...prev,
      [key]: status,
    }));
    setSessionStatuses((prev) => ({
      ...prev,
      [key]: status,
    }));
  };

  const handleAttach = async (
    connectorKey: ConnectorKey,
    profileId: string,
    mode: "attach" | "detach",
    sessionConfig?: Record<string, unknown>
  ) => {
    const actionKey = buildConnectorDraftKey(connectorKey, profileId) || connectorKey;
    const currentSession = sessionStatuses[actionKey] || sessionStatuses[connectorKey];
    setActingKey(actionKey);
    try {
      if (!sessionId) {
        if (mode === "detach") {
          const next = removeSessionConnectorDraftEntry(connectorKey, profileId);
          const draftId = next?.draftId || ensureSessionConnectorDraftId();
          const entries = next ? listSessionConnectorDraftEntries() : [];
          if (next) {
            updateSessionConnectorDraftMetadata({
              source: "manual",
              sourceProjectId: undefined,
              userTouched: true,
            });
          }
          await saveSessionConnectorDraft(draftId, entries);
          applySessionStatusOverride(
            buildOptimisticSessionStatus({
              item: catalog.find((entry) => entry.key === connectorKey) || {
                key: connectorKey,
                name: currentSession?.name || connectorKey,
                icon: currentSession?.icon || "plug",
                authMode: currentSession?.authMode || "oauth",
                available: true,
                category: "app",
              } as ConnectorCatalogItem,
              session: currentSession,
              connectorProfiles: profilesByConnector[connectorKey] || [],
              selectedProfileId: profileId,
              selectedProfile:
                (profilesByConnector[connectorKey] || []).find(
                  (profile) => profile.profileId === profileId
                ) || null,
              attached: false,
              repositories: [],
            })
          );
          toast.success(t("connectors.dialog.toasts.draftRemoved"));
          return;
        }

        const nextState = upsertSessionConnectorDraftEntry(connectorKey, {
          profileId,
          desiredState: "attached",
          sessionConfig: sessionConfig || null,
          enabledTools: [],
        }, {
          source: "manual",
          sourceProjectId: undefined,
          userTouched: true,
        });
        await saveSessionConnectorDraft(nextState.draftId, listSessionConnectorDraftEntries());
        applySessionStatusOverride(
          buildOptimisticSessionStatus({
            item: catalog.find((entry) => entry.key === connectorKey) || {
              key: connectorKey,
              name: currentSession?.name || connectorKey,
              icon: currentSession?.icon || "plug",
              authMode: currentSession?.authMode || "oauth",
              available: true,
              category: "app",
            } as ConnectorCatalogItem,
            session: currentSession,
            connectorProfiles: profilesByConnector[connectorKey] || [],
            selectedProfileId: profileId,
            selectedProfile:
              (profilesByConnector[connectorKey] || []).find(
                (profile) => profile.profileId === profileId
              ) || null,
            attached: true,
            repositories: (sessionConfig?.repositories as string[] | undefined) || [],
          })
        );
        toast.success(t("connectors.dialog.toasts.draftSaved"));
        return;
      }

      if (mode === "detach") {
        applySessionStatusOverride(
          buildOptimisticSessionStatus({
            item: catalog.find((entry) => entry.key === connectorKey) || {
              key: connectorKey,
              name: currentSession?.name || connectorKey,
              icon: currentSession?.icon || "plug",
              authMode: currentSession?.authMode || "oauth",
              available: true,
              category: "app",
            } as ConnectorCatalogItem,
            session: currentSession,
            connectorProfiles: profilesByConnector[connectorKey] || [],
            selectedProfileId: profileId,
            selectedProfile:
              (profilesByConnector[connectorKey] || []).find(
                (profile) => profile.profileId === profileId
              ) || null,
            attached: false,
            repositories: [],
          })
        );
        await detachSessionConnector(sessionId, connectorKey, { profileId });
        if (mode === "detach") {
          const draftState = removeSessionConnectorDraftEntry(connectorKey, profileId);
          if (draftState?.draftId) {
            await saveSessionConnectorDraft(draftState.draftId, listSessionConnectorDraftEntries());
          }
        }
        toast.success(t("connectors.dialog.toasts.detached"));
      } else {
        applySessionStatusOverride(
          buildOptimisticSessionStatus({
            item: catalog.find((entry) => entry.key === connectorKey) || {
              key: connectorKey,
              name: currentSession?.name || connectorKey,
              icon: currentSession?.icon || "plug",
              authMode: currentSession?.authMode || "oauth",
              available: true,
              category: "app",
            } as ConnectorCatalogItem,
            session: currentSession,
            connectorProfiles: profilesByConnector[connectorKey] || [],
            selectedProfileId: profileId,
            selectedProfile:
              (profilesByConnector[connectorKey] || []).find(
                (profile) => profile.profileId === profileId
              ) || null,
            attached: true,
            repositories: (sessionConfig?.repositories as string[] | undefined) || [],
          })
        );
        const attachedStatus = await attachSessionConnector(sessionId, connectorKey, {
          profileId,
          sessionConfig,
        });
        const draftState = removeSessionConnectorDraftEntry(connectorKey, profileId);
        if (draftState?.draftId) {
          await saveSessionConnectorDraft(draftState.draftId, listSessionConnectorDraftEntries());
        } else {
          clearSessionConnectorDraftState();
        }
        toast.success(
          attachedStatus?.runtimeStatus === "pending_recover"
            ? t("connectors.dialog.toasts.attachedPendingRecover")
            : t("connectors.dialog.toasts.attached")
        );
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("connectors.dialog.toasts.actionFailed"));
      void load();
    } finally {
      setActingKey(null);
    }
  };

  const selectGithubRepository = async (
    item: ConnectorCatalogItem,
    connectorKey: ConnectorKey,
    session: SessionConnectorStatus | undefined,
    connectorProfiles: ConnectorProfile[],
    profileId: string | null,
    selectedProfile: ConnectorProfile | null,
    selectionKey: string,
    repositoryFullName: string,
    canAttach: boolean
  ) => {
    if (!profileId) return;

    let nextRepositories: string[] = [];
    setGithubSelectedRepositories((prev) => {
      const current = prev[selectionKey] || [];
      const exists = current.includes(repositoryFullName);
      nextRepositories = exists
        ? current.filter((repository) => repository !== repositoryFullName)
        : [...current, repositoryFullName];

      return {
        ...prev,
        [selectionKey]: nextRepositories,
      };
    });

    applySessionStatusOverride(
      buildOptimisticSessionStatus({
        item,
        session,
        connectorProfiles,
        selectedProfileId: profileId,
        selectedProfile,
        attached: true,
        repositories: nextRepositories,
      })
    );

    if (!canAttach) return;
    await handleAttach(connectorKey, profileId, "attach", {
      repositories: nextRepositories,
    });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setDetailKey(null);
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-9 w-9 rounded-[10px] hover:bg-muted/80 transition-colors", className)}
              aria-label={t("connectors.dialog.triggerLabel")}
            >
              {attachedConnectors.length === 0 ? (
                <Plug className="h-4 w-4 text-muted-foreground" />
              ) : (
                <div className="flex items-center justify-center pl-0.5">
                  {attachedConnectors.slice(0, 3).map(({ rowKey, item }, index) => {
                    const AttachedIcon = resolveConnectorIcon(item.icon) || Link2;
                    return (
                      <span
                        key={rowKey}
                        className={cn(
                          "flex h-4.5 w-4.5 items-center justify-center rounded-[8px] border border-background/90 bg-background ring-1 ring-border/30",
                          index > 0 ? "-ml-1" : ""
                        )}
                      >
                        <AttachedIcon className="h-2.5 w-2.5 text-foreground/85" />
                      </span>
                    );
                  })}
                </div>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t("connectors.dialog.triggerLabel")}</p>
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        collisionPadding={12}
        className="w-[min(308px,calc(100vw-24px))] overflow-visible rounded-[12px] border border-border/70 bg-background p-0 shadow-[0px_4px_16px_rgba(15,23,42,0.16)]"
      >
        <div className="relative">
          <div
            className="grid min-h-[216px] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
            style={{
              maxHeight:
                "min(420px, calc(var(--radix-popover-content-available-height, 70vh) - 8px))",
            }}
          >
            <div className="flex items-center justify-between border-b border-border/70 px-2.5 py-2">
              <div className="text-[13px] font-medium text-foreground">{t("connectors.dialog.title")}</div>
              {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            </div>

            <div className="min-h-0 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="space-y-0.5 p-1">
                  {mergedConnectors.map(
                    ({ rowKey, item, session, connectorProfiles, selectedProfileId, selectedProfile }) => {
                      const busy = actingKey === rowKey;
                      const attachedToSelected =
                        Boolean(session?.attached) &&
                        session?.attachedProfileId === selectedProfileId;
                      const isGithub = item.key === "github";
                      const isCustomMcp = item.key === "custom_mcp";
                      const checked = isCustomMcp ? attachedToSelected : Boolean(session?.attached);
                      const DetailIcon = resolveConnectorIcon(item.icon) || Link2;
                      const canAttach =
                        item.available &&
                        Boolean(selectedProfileId) &&
                        selectedProfile?.authStatus === "authorized";
                      const githubRepoSelectionKey = repositorySelectionKey(
                        item.key,
                        selectedProfileId || null
                      );
                      const attachedAuthorizedRepositories =
                        session?.attachedProfileId === selectedProfileId
                          ? session?.authorizedRepositories || []
                          : [];
                      const selectedRepositories =
                        githubSelectedRepositories[githubRepoSelectionKey] ||
                        attachedAuthorizedRepositories ||
                        [];
                      const selectedRepositoriesSummary = splitSelectedRepositoriesSummary(
                        selectedRepositories,
                        t
                      );

                      return (
                        <div key={rowKey} className="flex flex-col gap-0.5">
                          <div
                            className={cn(
                              "flex h-[36px] items-center justify-between gap-2 rounded-[8px] px-2 pl-1 transition hover:bg-muted/45",
                              detailKey === item.key && !isGithub && !isCustomMcp ? "bg-muted/45" : ""
                            )}
                          >
                            <button
                              type="button"
                              className="flex h-full min-w-0 flex-1 items-center gap-1 text-left"
                              onClick={() => {
                                if (isCustomMcp) {
                                  openSettingsDialog({
                                    tab: "connectors",
                                    connectorKey: "custom_mcp",
                                    targetSessionId: sessionId,
                                  });
                                  setDetailKey(null);
                                  setOpen(false);
                                  return;
                                }
                                if (isGithub) {
                                  if (!selectedProfileId || selectedProfile?.authStatus !== "authorized") {
                                    openSettingsDialog({
                                      tab: "connectors",
                                      connectorKey: "github",
                                      targetSessionId: sessionId,
                                    });
                                    setDetailKey(null);
                                    setOpen(false);
                                    return;
                                  }
                                  return;
                                }
                                setDetailKey((prev) => (prev === item.key ? null : item.key));
                              }}
                            >
                              <div className="flex size-7 shrink-0 items-center justify-center rounded-[4px] text-foreground/90">
                                <DetailIcon className="h-3.5 w-3.5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[14px] leading-5 text-foreground">
                                  {item.name}
                                </div>
                              </div>
                              {checked && !isGithub ? (
                                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                              ) : null}
                            </button>

                            <button
                              type="button"
                              className="group relative z-10 shrink-0 rounded-full p-1 transition hover:bg-muted/45"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (busy) return;
                                if (isGithub) {
                                  if (!selectedProfileId || selectedProfile?.authStatus !== "authorized") {
                                    openSettingsDialog({
                                      tab: "connectors",
                                      connectorKey: "github",
                                      targetSessionId: sessionId,
                                    });
                                    setDetailKey(null);
                                    setOpen(false);
                                    return;
                                  }
                                  const nextMode = attachedToSelected ? "detach" : "attach";
                                  setSessionStatuses((prev) => ({
                                    ...prev,
                                    [item.key]: buildOptimisticSessionStatus({
                                      item,
                                      session,
                                      connectorProfiles,
                                      selectedProfileId,
                                      selectedProfile,
                                      attached: nextMode === "attach",
                                      repositories:
                                        nextMode === "attach" ? selectedRepositories : [],
                                    }),
                                  }));
                                  if (nextMode === "detach") {
                                    setDetailKey(null);
                                  }
                                  void handleAttach(item.key, selectedProfileId, nextMode, {
                                    repositories: nextMode === "attach" ? selectedRepositories : [],
                                  });
                                  return;
                                }

                                if (!selectedProfileId) {
                                  if (isCustomMcp) {
                                    openSettingsDialog({
                                      tab: "connectors",
                                      connectorKey: "custom_mcp",
                                      targetSessionId: sessionId,
                                    });
                                    setDetailKey(null);
                                    setOpen(false);
                                    return;
                                  }
                                  setDetailKey(item.key);
                                  return;
                                }
                                if (!attachedToSelected && !canAttach) {
                                  if (isCustomMcp) {
                                    openSettingsDialog({
                                      tab: "connectors",
                                      connectorKey: "custom_mcp",
                                      targetSessionId: sessionId,
                                    });
                                    setDetailKey(null);
                                    setOpen(false);
                                    return;
                                  }
                                  setDetailKey(item.key);
                                  return;
                                }
                                void handleAttach(
                                  item.key,
                                  selectedProfileId,
                                  attachedToSelected ? "detach" : "attach"
                                );
                              }}
                              aria-label={
                                checked
                                  ? t("connectors.dialog.disableConnector")
                                  : t("connectors.dialog.enableConnector")
                              }
                            >
                              {busy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                              ) : null}
                              <div
                                className={cn(
                                  "h-4 w-[26px] rounded-full px-[1px] transition-colors",
                                  checked ? "bg-primary" : "bg-muted-foreground/30"
                                )}
                              >
                                <span
                                  className={cn(
                                    "mt-[1px] block h-3.5 w-3.5 rounded-full bg-background transition-transform",
                                    checked ? "translate-x-2.5" : "translate-x-0"
                                  )}
                                />
                              </div>
                            </button>
                          </div>

                          {isGithub && checked ? (
                            <button
                              type="button"
                              className={cn(
                                "ml-1 mr-1 mb-2 mt-0.5 flex h-[36px] items-center justify-between gap-2 rounded-[8px] px-2 pl-1 text-left transition",
                                detailKey === "github" ? "bg-muted/45" : "hover:bg-muted/35"
                              )}
                              onClick={() => setDetailKey((prev) => (prev === "github" ? null : "github"))}
                            >
                              <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                                <div className="flex size-7 shrink-0 items-center justify-center">
                                  <CornerDownRight className="h-4 w-4 text-foreground/80" />
                                </div>
                                <div className="flex min-w-0 items-center gap-1 overflow-hidden text-[14px] leading-5 text-foreground">
                                  <span className="truncate">{selectedRepositoriesSummary.primary}</span>
                                  {selectedRepositoriesSummary.extra ? (
                                    <span className="shrink-0 whitespace-nowrap">
                                      {selectedRepositoriesSummary.extra}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                            </button>
                          ) : null}
                        </div>
                      );
                    }
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="shrink-0 border-t border-border/70 p-1.5">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-[8px] px-2 py-2 text-left transition hover:bg-muted/45"
                onClick={() => openConnectorSettings(null)}
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-muted">
                    <Settings2 className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <div className="text-[13px] font-medium text-foreground">{t("connectors.dialog.manageTitle")}</div>
                    <div className="text-[11px] text-muted-foreground">{t("connectors.dialog.manageDescription")}</div>
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>

          {activeDetailConnector ? (
              <div
                className="absolute left-[calc(100%+8px)] top-0 z-20 w-[min(310px,calc(100vw-32px))] overflow-hidden rounded-[14px] border border-border/70 bg-background p-0 shadow-[0px_4px_16px_rgba(15,23,42,0.16)]"
                style={{
                  height:
                    "min(440px, calc(var(--radix-popover-content-available-height, 70vh) - 8px))",
                }}
              >
                {(() => {
                  const { item, session, connectorProfiles, selectedProfileId, selectedProfile } =
                    activeDetailConnector;
                  const busy = actingKey === item.key;
                  const attachedToSelected =
                    Boolean(session?.attached) &&
                    session?.attachedProfileId === selectedProfileId;
                  const isGithubDetail = item.key === "github";
                  const DetailIcon = resolveConnectorIcon(item.icon) || Link2;
                  const guide = connectorGuides[item.key];
                  const canAttach =
                    item.available &&
                    Boolean(selectedProfileId) &&
                    selectedProfile?.authStatus === "authorized";
                  const githubRepoSelectionKey = repositorySelectionKey(
                    item.key,
                    selectedProfileId || null
                  );
                  const attachedAuthorizedRepositories =
                    session?.attachedProfileId === selectedProfileId
                      ? session?.authorizedRepositories || []
                      : [];
                  const selectedRepositories =
                    githubSelectedRepositories[githubRepoSelectionKey] ||
                    attachedAuthorizedRepositories ||
                    [];
                  const githubRepositoryOptions = isGithubDetail
                    ? resolveGithubRepositoryOptions({
                        fetched: githubRepositories[selectedProfileId || ""],
                        profile: selectedProfile,
                        session,
                      })
                    : [];
                  const filteredRepositories = isGithubDetail
                    ? githubRepositoryOptions.filter((repository) => {
                        const keyword = (
                          githubRepositorySearch[githubRepoSelectionKey] || ""
                        ).trim().toLowerCase();
                        if (!keyword) return true;
                        return (
                          repository.fullName.toLowerCase().includes(keyword) ||
                          repository.owner.toLowerCase().includes(keyword) ||
                          repository.name.toLowerCase().includes(keyword)
                        );
                      })
                    : [];

                  if (isGithubDetail) {
                    return (
                      <div className="flex h-full min-w-0 flex-col overflow-hidden">
                        <div className="flex min-h-0 flex-1 flex-col px-3 py-3">
                          <div className="text-xs font-medium text-foreground">{t("connectors.dialog.github.selectRepository")}</div>
                          <div className="relative mt-2">
                            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              value={githubRepositorySearch[githubRepoSelectionKey] || ""}
                              onChange={(event) =>
                                setGithubRepositorySearch((prev) => ({
                                  ...prev,
                                  [githubRepoSelectionKey]: event.target.value,
                                }))
                              }
                              placeholder={t("connectors.dialog.github.searchPlaceholder")}
                              className="h-8 rounded-[8px] border-border/70 bg-background pl-7 text-[12px]"
                            />
                          </div>

                          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pt-2">
                            {!selectedProfileId ? (
                              <div className="px-2 py-2 text-[11px] text-muted-foreground">
                                {t("connectors.dialog.github.selectAccountFirst")}
                              </div>
                            ) : !selectedProfile ? (
                              <div className="px-2 py-2 text-[11px] text-muted-foreground">
                                {t("connectors.dialog.github.noAuthorizedAccount")}
                              </div>
                            ) : item.availabilityReason ? (
                              <div className="px-2 py-2 text-[11px] text-destructive">
                                {item.availabilityReason}
                              </div>
                            ) : selectedProfile.lastError ? (
                              <div className="px-2 py-2 text-[11px] text-destructive">
                                {selectedProfile.lastError}
                              </div>
                            ) : githubRepositoriesLoading[selectedProfileId] ? (
                              <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                {t("connectors.dialog.github.loading")}
                              </div>
                            ) : githubRepositoryOptions.length === 0 ? (
                              <div className="px-2 py-2 text-[11px] text-muted-foreground">
                                {t("connectors.dialog.github.noReadableRepositories")}
                              </div>
                            ) : filteredRepositories.length === 0 ? (
                              <div className="px-2 py-2 text-[11px] text-muted-foreground">
                                {t("connectors.dialog.github.noMatchingRepositories")}
                              </div>
                            ) : (
                              filteredRepositories.map((repository) => {
                                const selected = selectedRepositories.includes(repository.fullName);
                                return (
                                  <div
                                    key={repository.id || repository.fullName}
                                    role="button"
                                    tabIndex={0}
                                    className={cn(
                                      "flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 transition outline-none focus-visible:bg-muted/45",
                                      selected ? "bg-muted/50" : "hover:bg-muted/35"
                                    )}
                                    onClick={() =>
                                      void selectGithubRepository(
                                        item,
                                        item.key,
                                        session,
                                        connectorProfiles,
                                        selectedProfileId,
                                        selectedProfile,
                                        githubRepoSelectionKey,
                                        repository.fullName,
                                        canAttach
                                      )
                                    }
                                  >
                                    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                                      <Book className="h-3.5 w-3.5 shrink-0 text-foreground/80" />
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate text-[12px] leading-tight text-foreground">
                                          {repository.name}
                                        </div>
                                        <div className="truncate text-[10px] text-muted-foreground">
                                          {repository.fullName}
                                        </div>
                                      </div>
                                    </div>
                                    {selected ? (
                                      <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />
                                    ) : null}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>

                        <div className="shrink-0 border-t border-border/70 px-3 py-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-[10px]"
                              onClick={() => openConnectorSettings(item.key)}
                            >
                              <Settings2 className="mr-2 h-4 w-4" />
                              {t("connectors.dialog.configureAuth")}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="flex h-full min-w-0 flex-col overflow-hidden">
                      <div className="border-b border-border/70 px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-muted text-foreground">
                            <DetailIcon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-foreground">
                              {item.name}
                            </div>
                            <div className="text-xs text-muted-foreground">{item.description}</div>
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px]",
                              statusChipTone(
                                selectedProfile?.authStatus ||
                                  session?.globalAuthStatus ||
                                  "not_configured"
                              )
                            )}
                          >
                            {translateConnectorStatus(
                              t,
                              selectedProfile?.authStatus ||
                                session?.globalAuthStatus ||
                                "not_configured"
                            )}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px]",
                              statusChipTone(
                                session?.runtimeStatus ||
                                  (session?.attached ? "connecting" : "idle")
                              )
                            )}
                          >
                            {session?.attached
                              ? translateConnectorStatus(t, session?.runtimeStatus || "connecting")
                              : t("connectors.dialog.status.detached")}
                          </span>
                          {!item.available ? (
                            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                              {t("connectors.dialog.status.unavailable")}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <ScrollArea className="min-h-0 flex-1">
                        <div className="space-y-3 px-3 py-3">
                          <div className="rounded-[10px] bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                            <div className="flex items-center justify-between gap-3">
                              <span>{t("connectors.dialog.info.location")}</span>
                              <span className="text-right text-foreground/80">
                                {t("connectors.dialog.info.outsideSandbox")}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-3">
                              <span>{t("connectors.dialog.info.currentUsage")}</span>
                              <span className="text-right text-foreground/80">
                                {t("connectors.dialog.info.insideSession")}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-3">
                              <span>{t("connectors.dialog.info.availableProfiles")}</span>
                              <span className="text-right text-foreground/80">
                                {connectorProfiles.length}
                              </span>
                            </div>
                          </div>

                          {item.availabilityReason ? (
                            <div className="flex gap-2 rounded-[10px] bg-destructive/10 px-3 py-2 text-[11px] leading-5 text-destructive">
                              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span>{item.availabilityReason}</span>
                            </div>
                          ) : null}

                          {connectorProfiles.length > 0 ? (
                            <div className="space-y-1.5">
                              <div className="text-xs font-medium text-foreground">
                                {t("connectors.selectProfile")}
                              </div>
                              <Select
                                value={selectedProfileId || ""}
                                onValueChange={(value) => {
                                  setProfileSelection((prev) => ({
                                    ...prev,
                                    [item.key]: value,
                                  }));
                                }}
                              >
                                <SelectTrigger className="h-9 rounded-[10px]">
                                  <SelectValue placeholder={t("connectors.selectProfilePlaceholder")} />
                                </SelectTrigger>
                                <SelectContent className="rounded-[12px]">
                                  {connectorProfiles.map((profile) => (
                                    <SelectItem
                                      key={profile.profileId}
                                      value={profile.profileId}
                                      className="rounded-[8px]"
                                    >
                                      {profile.profileName}
                                      {profile.isDefault ? ` · ${t("connectors.defaultProfileSuffix")}` : ""}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : (
                            <div className="rounded-[10px] border border-dashed border-border/70 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                              {t("connectors.dialog.noProfiles")}
                            </div>
                          )}

                          {selectedProfile ? (
                            <div className="space-y-2 rounded-[10px] border border-border/70 bg-background px-3 py-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs font-medium text-foreground">
                                  {selectedProfile.profileName}
                                </div>
                                {selectedProfile.isDefault ? (
                                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                    {t("connectors.defaultProfileSuffix")}
                                  </span>
                                ) : null}
                              </div>
                              <div className="text-[11px] leading-5 text-muted-foreground">
                                {selectedProfile.displayName ||
                                  selectedProfile.secretSummary ||
                                  t("connectors.dialog.noDisplayName")}
                              </div>
                              {selectedProfile.lastError ? (
                                <div className="flex gap-2 rounded-[8px] bg-destructive/10 px-2.5 py-2 text-[11px] leading-5 text-destructive">
                                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                  <span>{selectedProfile.lastError}</span>
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {guide ? (
                            <div className="rounded-[10px] border border-dashed border-border/70 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                              {guide.steps[0]}
                            </div>
                          ) : null}
                        </div>
                      </ScrollArea>

                      <div className="border-t border-border/70 px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          {sessionId && selectedProfileId ? (
                            <Button
                              size="sm"
                              className="rounded-[10px]"
                              disabled={busy || (!attachedToSelected && !canAttach)}
                              onClick={() =>
                                void handleAttach(
                                  item.key,
                                  selectedProfileId,
                                  attachedToSelected ? "detach" : "attach"
                                )
                              }
                            >
                              {busy ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : attachedToSelected ? (
                                <Unplug className="mr-2 h-4 w-4" />
                              ) : (
                                <Plug className="mr-2 h-4 w-4" />
                              )}
                              {attachedToSelected
                                ? t("connectors.dialog.detach")
                                : session?.attachedProfileId &&
                                    session.attachedProfileId !== selectedProfileId
                                  ? t("connectors.dialog.switchProfile")
                                  : t("connectors.dialog.attach")}
                            </Button>
                          ) : null}

                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-[10px]"
                            onClick={() => openConnectorSettings(item.key)}
                          >
                            <Settings2 className="mr-2 h-4 w-4" />
                            {t("connectors.dialog.manageButton")}
                          </Button>

                          {guide?.quickLinks?.[0] ? (
                            <Button size="sm" variant="ghost" className="rounded-[10px]" asChild>
                              <a
                                href={guide.quickLinks[0].href}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <ArrowUpRight className="mr-2 h-4 w-4" />
                                {t("connectors.relatedDocs")}
                              </a>
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
