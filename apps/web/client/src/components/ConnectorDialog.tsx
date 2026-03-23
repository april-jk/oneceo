import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Cloud,
  Database,
  Figma,
  Github,
  Link2,
  Loader2,
  NotepadText,
  Plug,
  Settings2,
  Slack,
  Unplug,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
  getMyConnectorProfiles,
  getSessionConnectors,
  type ConnectorCatalogItem,
  type ConnectorKey,
  type ConnectorProfile,
  type SessionConnectorStatus,
} from "@/lib/connectors-client";
import { openSettingsDialog } from "@/lib/settings-dialog-events";
import { cn } from "@/lib/utils";

interface ConnectorDialogProps {
  sessionId?: string | null;
  className?: string;
}

const iconMap = {
  github: Github,
  slack: Slack,
  notion: NotepadText,
  supabase: Database,
  figma: Figma,
  vercel: Cloud,
  postgres: Database,
} as const;

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
      catalog.map((item) => {
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
    mode: "attach" | "detach"
  ) => {
    if (!sessionId) return;
    setActingKey(connectorKey);
    try {
      if (mode === "detach") {
        await detachSessionConnector(sessionId, connectorKey);
        toast.success("连接器已从当前会话移除");
      } else {
        await attachSessionConnector(sessionId, connectorKey, { profileId });
        toast.success("连接器已挂载到当前会话");
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "连接器操作失败");
    } finally {
      setActingKey(null);
    }
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
        className="w-[min(340px,calc(100vw-24px))] overflow-hidden rounded-[14px] border border-border/70 bg-background p-0 shadow-[0px_4px_16px_rgba(15,23,42,0.16)]"
      >
        <div
          className="grid min-h-[240px] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
          style={{
            maxHeight:
              "min(480px, calc(var(--radix-popover-content-available-height, 70vh) - 8px))",
          }}
        >
          <div className="flex items-center justify-between border-b border-border/70 px-3 py-2.5">
            <div>
              <div className="text-sm font-medium text-foreground">Session Connectors</div>
              <div className="text-[11px] text-muted-foreground">
                外部配置，内部挂载到当前 sandbox 会话
              </div>
            </div>
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>

          <div className="min-h-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="space-y-1 p-1.5">
                {mergedConnectors.map(
                  ({ item, session, connectorProfiles, selectedProfileId, selectedProfile }) => {
                    const busy = actingKey === item.key;
                    const checked = Boolean(session?.attached);
                    const attachedToSelected =
                      Boolean(session?.attached) &&
                      session?.attachedProfileId === selectedProfileId;
                    const DetailIcon = iconMap[item.icon as keyof typeof iconMap] || Link2;
                    const guide = CONNECTOR_GUIDES[item.key];
                    const canAttach =
                      Boolean(sessionId) &&
                      item.available &&
                      Boolean(selectedProfileId) &&
                      selectedProfile?.authStatus === "authorized";

                    return (
                      <div
                        key={item.key}
                        className="flex items-center justify-between gap-2 rounded-[10px] px-2 py-1 hover:bg-muted/55"
                      >
                        <Popover
                          open={detailKey === item.key}
                          onOpenChange={(next) => setDetailKey(next ? item.key : null)}
                        >
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                "flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[8px] px-2 text-left transition hover:bg-muted/45",
                                detailKey === item.key ? "bg-muted/45" : ""
                              )}
                            >
                              <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-muted text-foreground/90">
                                <DetailIcon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-foreground">
                                  {item.name}
                                </div>
                                <div className="truncate text-[11px] text-muted-foreground">
                                  {selectedProfile?.profileName ||
                                    `${connectorProfiles.length} profiles`}
                                </div>
                              </div>
                              {checked ? (
                                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                              ) : null}
                            </button>
                          </PopoverTrigger>

                          <PopoverContent
                            side="right"
                            align="start"
                            sideOffset={8}
                            collisionPadding={12}
                            className="w-[min(310px,calc(100vw-32px))] overflow-hidden rounded-[14px] border border-border/70 bg-background p-0 shadow-[0px_4px_16px_rgba(15,23,42,0.16)]"
                          >
                            <div
                              className="flex min-w-0 flex-col overflow-hidden"
                              style={{
                                maxHeight:
                                  "min(440px, calc(var(--radix-popover-content-available-height, 70vh) - 8px))",
                              }}
                            >
                              <div className="border-b border-border/70 px-3 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-muted text-foreground">
                                    <DetailIcon className="h-4 w-4" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-foreground">
                                      {item.name}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {item.description}
                                    </div>
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
                                        session?.runtimeStatus || (checked ? "connecting" : "idle")
                                      )
                                    )}
                                  >
                                    {checked
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
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="rounded-[10px]"
                                      asChild
                                    >
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
                          </PopoverContent>
                        </Popover>

                        <button
                          type="button"
                          className="group flex items-center gap-2"
                          onClick={(event) => {
                            event.stopPropagation();
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
              className="flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left transition hover:bg-muted/55"
              onClick={() => openConnectorSettings(null)}
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-muted">
                  <Settings2 className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">管理连接器</div>
                  <div className="text-[11px] text-muted-foreground">
                    创建 profile、授权并设置默认项
                  </div>
                </div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
