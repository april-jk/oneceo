import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowUpRight,
  Book,
  Check,
  CheckCircle2,
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
import { CONNECTOR_GUIDES } from "@/lib/connector-guides";
import {
  attachSessionConnector,
  detachSessionConnector,
  getGithubProfileRepositories,
  getMyConnectorProfiles,
  getSessionConnectors,
  type ConnectorCatalogItem,
  type ConnectorKey,
  type GithubConnectorRepository,
  type ConnectorProfile,
  type SessionConnectorStatus,
} from "@/lib/connectors-client";
import { resolveConnectorIcon } from "@/lib/connector-ui";
import { openSettingsDialog } from "@/lib/settings-dialog-events";
import { cn } from "@/lib/utils";

interface ConnectorDialogProps {
  sessionId?: string | null;
  className?: string;
}

function formatStatus(value: string | null | undefined) {
  if (!value) return "unknown";
  return value.replaceAll("_", " ");
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

function repositorySelectionKey(connectorKey: ConnectorKey, profileId: string | null) {
  return `${connectorKey}::${profileId || "none"}`;
}

function summarizeRepositoryLabel(fullName: string | null | undefined) {
  if (!fullName) return null;
  const parts = fullName.split("/");
  return parts.length > 1 ? parts[parts.length - 1] : fullName;
}

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
  const [open, setOpen] = useState(false);
  const [detailKey, setDetailKey] = useState<ConnectorKey | null>(null);
  const [catalog, setCatalog] = useState<ConnectorCatalogItem[]>([]);
  const [profiles, setProfiles] = useState<ConnectorProfile[]>([]);
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionConnectorStatus>>(
    {}
  );
  const [profileSelection, setProfileSelection] = useState<
    Partial<Record<ConnectorKey, string | null>>
  >({});
  const [loading, setLoading] = useState(false);
  const [actingKey, setActingKey] = useState<ConnectorKey | null>(null);
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

  const load = async () => {
    if (!open) return;
    setLoading(true);
    try {
      const me = await getMyConnectorProfiles();
      setCatalog(me.catalog);
      setProfiles(me.profiles);

      let nextSessionStatuses: Record<string, SessionConnectorStatus> = {};
      if (sessionId) {
        const sessionData = await getSessionConnectors(sessionId);
        nextSessionStatuses = Object.fromEntries(
          sessionData.items.map((item) => [item.connectorKey, item])
        );
      }
      setSessionStatuses(nextSessionStatuses);

      const profilesByConnector = groupProfilesByConnector(me.profiles);
      setProfileSelection((prev) => {
        const next = { ...prev };
        for (const item of me.catalog) {
          next[item.key] = resolvePreferredProfileId(
            profilesByConnector[item.key] || [],
            nextSessionStatuses[item.key],
            prev[item.key]
          );
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
  }, [open, sessionId]);

  const profilesByConnector = useMemo(
    () => groupProfilesByConnector(profiles),
    [profiles]
  );

  const mergedConnectors = useMemo(
    () =>
      catalog
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
          item,
          session: sessionStatuses[item.key],
          connectorProfiles,
          selectedProfileId,
          selectedProfile,
        };
      }),
    [catalog, profileSelection, profilesByConnector, sessionStatuses]
  );

  const activeGithubConnector = useMemo(
    () =>
      detailKey === "github"
        ? mergedConnectors.find((item) => item.item.key === "github") || null
        : null,
    [detailKey, mergedConnectors]
  );
  const activeDetailConnector = useMemo(
    () => (detailKey ? mergedConnectors.find((item) => item.item.key === detailKey) || null : null),
    [detailKey, mergedConnectors]
  );
  const activeGithubSelectionKey = repositorySelectionKey(
    "github",
    activeGithubConnector?.selectedProfileId || null
  );

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
        toast.error(error instanceof Error ? error.message : "加载 GitHub 仓库失败");
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
  ]);

  useEffect(() => {
    if (!activeGithubConnector?.selectedProfileId) return;
    if ((githubSelectedRepositories[activeGithubSelectionKey] || []).length > 0) return;
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

  const handleAttach = async (
    connectorKey: ConnectorKey,
    profileId: string,
    mode: "attach" | "detach",
    sessionConfig?: Record<string, unknown>
  ) => {
    if (!sessionId) return;
    setActingKey(connectorKey);
    try {
      if (mode === "detach") {
        await detachSessionConnector(sessionId, connectorKey);
        toast.success("连接器已从当前会话移除");
      } else {
        await attachSessionConnector(sessionId, connectorKey, {
          profileId,
          sessionConfig,
        });
        toast.success("连接器已挂载到当前会话");
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "连接器操作失败");
    } finally {
      setActingKey(null);
    }
  };

  const toggleGithubRepository = (selectionKey: string, repositoryFullName: string) => {
    setGithubSelectedRepositories((prev) => {
      const current = prev[selectionKey] || [];
      const exists = current.includes(repositoryFullName);
      return {
        ...prev,
        [selectionKey]: exists ? [] : [repositoryFullName],
      };
    });
  };

  const selectGithubRepository = async (
    connectorKey: ConnectorKey,
    profileId: string | null,
    selectionKey: string,
    repositoryFullName: string,
    canAttach: boolean
  ) => {
    if (!profileId) return;
    setGithubSelectedRepositories((prev) => ({
      ...prev,
      [selectionKey]: [repositoryFullName],
    }));
    if (!sessionId || !canAttach) return;
    await handleAttach(connectorKey, profileId, "attach", {
      repositories: [repositoryFullName],
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
              className={cn("h-9 w-9 rounded-xl hover:bg-muted transition-colors", className)}
            >
              <Plug className="h-4 w-4 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>Connectors</p>
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
              <div className="text-[13px] font-medium text-foreground">Connectors</div>
              {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            </div>

            <div className="min-h-0 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="space-y-0.5 p-1">
                  {mergedConnectors.map(
                    ({ item, session, connectorProfiles, selectedProfileId, selectedProfile }) => {
                      const busy = actingKey === item.key;
                      const checked = Boolean(session?.attached);
                      const attachedToSelected =
                        Boolean(session?.attached) &&
                        session?.attachedProfileId === selectedProfileId;
                      const isGithub = item.key === "github";
                      const DetailIcon = resolveConnectorIcon(item.icon) || Link2;
                      const canAttach =
                        Boolean(sessionId) &&
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
                      const selectedRepositoryName = selectedRepositories[0] || null;
                      const rowDescription = isGithub
                        ? selectedProfile?.displayName
                          ? selectedRepositoryName
                            ? `${selectedProfile.displayName} · ${summarizeRepositoryLabel(selectedRepositoryName)}`
                            : `${selectedProfile.displayName} · 选择仓库`
                          : summarizeRepositoryLabel(selectedRepositoryName) || "选择当前会话仓库"
                        : selectedProfile?.profileName || `${connectorProfiles.length} profiles`;

                      return (
                        <div
                          key={item.key}
                          className="flex items-center justify-between gap-1.5 rounded-[8px] px-1.5 py-1 hover:bg-muted/45"
                        >
                          <button
                            type="button"
                            className={cn(
                              "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[7px] px-1.5 text-left transition hover:bg-muted/35",
                              detailKey === item.key ? "bg-muted/45" : ""
                            )}
                            onClick={() =>
                              setDetailKey((prev) => (prev === item.key ? null : item.key))
                            }
                          >
                            <div className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-muted text-foreground/90">
                              <DetailIcon className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-medium text-foreground">
                                {item.name}
                              </div>
                              <div className="truncate text-[11px] text-muted-foreground">
                                {rowDescription}
                              </div>
                            </div>
                            {checked ? (
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                            ) : null}
                          </button>

                          <button
                            type="button"
                            className="group flex items-center gap-2"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (isGithub) {
                                if (attachedToSelected) {
                                  void handleAttach(item.key, selectedProfileId || "", "detach");
                                } else {
                                  setDetailKey(item.key);
                                }
                                return;
                              }
                              if (!selectedProfileId) {
                                setDetailKey(item.key);
                                return;
                              }
                              if (!attachedToSelected && !canAttach) {
                                setDetailKey(item.key);
                                return;
                              }
                              void handleAttach(
                                item.key,
                                selectedProfileId,
                                attachedToSelected ? "detach" : "attach"
                              );
                            }}
                            aria-label={checked ? "Disable connector" : "Enable connector"}
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
                    <div className="text-[13px] font-medium text-foreground">管理连接器</div>
                    <div className="text-[11px] text-muted-foreground">配置授权与默认项</div>
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>

          {activeDetailConnector ? (
            activeDetailConnector.item.key === "github" ? (
              <div
                className="absolute left-[calc(100%+8px)] top-0 z-20 w-[min(280px,calc(100vw-32px))] overflow-hidden rounded-[12px] border border-border/70 bg-background p-0 shadow-[0px_4px_16px_rgba(15,23,42,0.16)]"
                style={{
                  height:
                    "min(430px, calc(var(--radix-popover-content-available-height, 75vh) - 8px))",
                }}
              >
                {(() => {
                  const { item, session, connectorProfiles, selectedProfileId, selectedProfile } =
                    activeDetailConnector;
                  const busy = actingKey === item.key;
                  const canAttach =
                    Boolean(sessionId) &&
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

                  return (
                    <div className="flex h-full min-w-0 flex-col overflow-hidden">
                      <div className="border-b border-border/70 p-2">
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={githubRepositorySearch[githubRepoSelectionKey] || ""}
                            onChange={(event) =>
                              setGithubRepositorySearch((prev) => ({
                                ...prev,
                                [githubRepoSelectionKey]: event.target.value,
                              }))
                            }
                            placeholder="搜索代码库"
                            className="h-8 rounded-[8px] border-border/70 bg-muted/15 pl-8 text-[13px]"
                          />
                        </div>
                      </div>

                      <ScrollArea className="min-h-0 flex-1">
                        <div className="space-y-1 p-1.5">
                          {!selectedProfileId ? (
                            <div className="rounded-[8px] px-2.5 py-3 text-[11px] leading-5 text-muted-foreground">
                              先选择一个 GitHub 账户，再继续选择仓库。
                            </div>
                          ) : !selectedProfile ? (
                            <div className="rounded-[8px] px-2.5 py-3 text-[11px] leading-5 text-muted-foreground">
                              还没有可用的 GitHub 授权账户，请先完成 GitHub 连接。
                            </div>
                          ) : item.availabilityReason ? (
                            <div className="rounded-[8px] px-2.5 py-3 text-[11px] leading-5 text-destructive">
                              {item.availabilityReason}
                            </div>
                          ) : selectedProfile.lastError ? (
                            <div className="rounded-[8px] px-2.5 py-3 text-[11px] leading-5 text-destructive">
                              {selectedProfile.lastError}
                            </div>
                          ) : githubRepositoriesLoading[selectedProfileId] ? (
                            <div className="flex items-center gap-2 rounded-[8px] px-2.5 py-3 text-[11px] text-muted-foreground">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              正在加载可授权仓库
                            </div>
                          ) : (githubRepositories[selectedProfileId] || []).length === 0 ? (
                            <div className="rounded-[8px] px-2.5 py-3 text-[11px] leading-5 text-muted-foreground">
                              当前 GitHub 账户下没有可读取的仓库，或仓库列表尚未返回。
                            </div>
                          ) : (
                            (() => {
                              const filteredRepositories = (
                                githubRepositories[selectedProfileId] || []
                              ).filter((repository) => {
                                const keyword = (
                                  githubRepositorySearch[githubRepoSelectionKey] || ""
                                )
                                  .trim()
                                  .toLowerCase();
                                if (!keyword) return true;
                                return (
                                  repository.fullName.toLowerCase().includes(keyword) ||
                                  repository.owner.toLowerCase().includes(keyword) ||
                                  repository.name.toLowerCase().includes(keyword)
                                );
                              });

                              if (filteredRepositories.length === 0) {
                                return (
                                  <div className="rounded-[8px] px-2.5 py-3 text-[11px] leading-5 text-muted-foreground">
                                    没有找到匹配的代码库。
                                  </div>
                                );
                              }

                              return filteredRepositories.map((repository) => {
                                const selected = selectedRepositories.includes(repository.fullName);
                                return (
                                  <div
                                    key={repository.id || repository.fullName}
                                    role="button"
                                    tabIndex={0}
                                    className={cn(
                                      "flex items-center gap-2 justify-between rounded-[8px] px-2 py-2 transition outline-none focus-visible:bg-muted/45 focus-visible:ring-0",
                                      selected ? "bg-muted/50" : "hover:bg-muted/35"
                                    )}
                                    onClick={() =>
                                      void selectGithubRepository(
                                        item.key,
                                        selectedProfileId,
                                        githubRepoSelectionKey,
                                        repository.fullName,
                                        canAttach
                                      )
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        void selectGithubRepository(
                                          item.key,
                                          selectedProfileId,
                                          githubRepoSelectionKey,
                                          repository.fullName,
                                          canAttach
                                        );
                                      }
                                    }}
                                    title={repository.fullName}
                                  >
                                    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                                      <Book className="h-4 w-4 shrink-0 text-foreground/80" />
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate text-[13px] leading-5 text-foreground">
                                          {repository.name}
                                        </div>
                                        <div className="truncate text-[11px] text-muted-foreground">
                                          {repository.fullName}
                                        </div>
                                      </div>
                                    </div>
                                    {selected ? (
                                      <Check className="h-4 w-4 shrink-0 text-foreground" />
                                    ) : null}
                                  </div>
                                );
                              });
                            })()
                          )}
                        </div>
                      </ScrollArea>

                      <div className="border-t border-border/70 p-1.5">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between rounded-[8px] px-2 py-2 text-left transition hover:bg-muted/45"
                          onClick={() => openConnectorSettings(item.key)}
                        >
                          <div className="flex items-center gap-2">
                            <div className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-muted text-foreground/90">
                              {(() => {
                                const GithubIcon = resolveConnectorIcon(item.icon);
                                return <GithubIcon className="h-3.5 w-3.5" />;
                              })()}
                            </div>
                            <span className="text-[13px] text-foreground">配置 GitHub</span>
                          </div>
                          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
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
                  const DetailIcon = resolveConnectorIcon(item.icon) || Link2;
                  const guide = CONNECTOR_GUIDES[item.key];
                  const canAttach =
                    Boolean(sessionId) &&
                    item.available &&
                    Boolean(selectedProfileId) &&
                    selectedProfile?.authStatus === "authorized";

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
                            {formatStatus(
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
                              ? formatStatus(session?.runtimeStatus || "connecting")
                              : "detached"}
                          </span>
                          {!item.available ? (
                            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                              unavailable
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <ScrollArea className="min-h-0 flex-1">
                        <div className="space-y-3 px-3 py-3">
                          <div className="rounded-[10px] bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                            <div className="flex items-center justify-between gap-3">
                              <span>配置位置</span>
                              <span className="text-right text-foreground/80">
                                Outside sandbox
                              </span>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-3">
                              <span>当前用途</span>
                              <span className="text-right text-foreground/80">
                                Inside this session
                              </span>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-3">
                              <span>可用 profiles</span>
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
                                Choose profile
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
                                  <SelectValue placeholder="Select a profile" />
                                </SelectTrigger>
                                <SelectContent className="rounded-[12px]">
                                  {connectorProfiles.map((profile) => (
                                    <SelectItem
                                      key={profile.profileId}
                                      value={profile.profileId}
                                      className="rounded-[8px]"
                                    >
                                      {profile.profileName}
                                      {profile.isDefault ? " · default" : ""}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : (
                            <div className="rounded-[10px] border border-dashed border-border/70 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                              这个连接器还没有可用 profile。请先在设置面板完成外部授权或手动凭证配置。
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
                                    default
                                  </span>
                                ) : null}
                              </div>
                              <div className="text-[11px] leading-5 text-muted-foreground">
                                {selectedProfile.displayName ||
                                  selectedProfile.secretSummary ||
                                  "未设置 display name"}
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
                                ? "Detach"
                                : session?.attachedProfileId &&
                                    session.attachedProfileId !== selectedProfileId
                                  ? "Switch Profile"
                                  : "Attach"}
                            </Button>
                          ) : null}

                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-[10px]"
                            onClick={() => openConnectorSettings(item.key)}
                          >
                            <Settings2 className="mr-2 h-4 w-4" />
                            Manage
                          </Button>

                          {guide?.quickLinks?.[0] ? (
                            <Button size="sm" variant="ghost" className="rounded-[10px]" asChild>
                              <a
                                href={guide.quickLinks[0].href}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <ArrowUpRight className="mr-2 h-4 w-4" />
                                Docs
                              </a>
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
