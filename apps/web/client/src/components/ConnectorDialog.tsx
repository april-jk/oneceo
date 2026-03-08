import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowUpRight,
  Database,
  ExternalLink,
  Github,
  Link2,
  Loader2,
  NotepadText,
  Plus,
  Plug,
  Settings2,
  Slack,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CONNECTOR_GUIDES } from "@/lib/connector-guides";
import {
  attachSessionConnector,
  clearConnectorAuth,
  detachSessionConnector,
  getMyConnectorAccounts,
  getSessionConnectors,
  saveConnectorConfig,
  type ConnectorCatalogItem,
  type ConnectorKey,
  type SessionConnectorStatus,
  type UserConnectorAccount,
} from "@/lib/connectors-client";
import { openSettingsDialog } from "@/lib/settings-dialog-events";
import { cn } from "@/lib/utils";

interface ConnectorDialogProps {
  sessionId?: string | null;
  className?: string;
}

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

function buildFormValues(
  item: ConnectorCatalogItem,
  account: UserConnectorAccount | undefined,
  previousValues?: ConnectorFormValues
): ConnectorFormValues {
  const next: ConnectorFormValues = {};
  for (const field of item.configFields) {
    if (field.key === "displayName") {
      const configDisplayName =
        typeof account?.config?.displayName === "string"
          ? String(account.config.displayName)
          : "";
      next[field.key] = configDisplayName || account?.displayName || previousValues?.[field.key] || "";
      continue;
    }
    if (field.secret) {
      next[field.key] = previousValues?.[field.key] || "";
      continue;
    }
    const raw = account?.config?.[field.key];
    next[field.key] = typeof raw === "string" ? raw : previousValues?.[field.key] || "";
  }
  return next;
}

function buildQuickSavePayload(item: ConnectorCatalogItem, form: ConnectorFormValues) {
  const config: Record<string, unknown> = {};
  const credentials: Record<string, unknown> = {};
  let displayName: string | undefined;

  for (const field of item.configFields) {
    const value = (form[field.key] || "").trim();
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

function ConnectorToggle({
  checked,
  busy,
  onClick,
}: {
  checked: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="group flex items-center gap-2"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={checked ? "Disable connector" : "Enable connector"}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
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
  );
}

export default function ConnectorDialog({
  sessionId,
  className,
}: ConnectorDialogProps) {
  const [open, setOpen] = useState(false);
  const [detailKey, setDetailKey] = useState<ConnectorKey | null>(null);
  const [catalog, setCatalog] = useState<ConnectorCatalogItem[]>([]);
  const [accounts, setAccounts] = useState<Record<string, UserConnectorAccount>>({});
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionConnectorStatus>>(
    {}
  );
  const [formState, setFormState] = useState<Record<string, ConnectorFormValues>>({});
  const [loading, setLoading] = useState(false);
  const [actingKey, setActingKey] = useState<ConnectorKey | null>(null);

  const mergedConnectors = useMemo(
    () =>
      catalog.map((item) => ({
        item,
        account: accounts[item.key],
        session: sessionStatuses[item.key],
        form: formState[item.key] || {},
      })),
    [accounts, catalog, formState, sessionStatuses]
  );

  const load = async () => {
    if (!open) return;
    setLoading(true);
    try {
      const me = await getMyConnectorAccounts();
      setCatalog(me.catalog);
      const nextAccounts = Object.fromEntries(
        me.accounts.map((item) => [item.connectorKey, item])
      );
      setAccounts(nextAccounts);
      setFormState((prev) => {
        const next = { ...prev };
        for (const item of me.catalog) {
          next[item.key] = buildFormValues(item, nextAccounts[item.key], prev[item.key]);
        }
        return next;
      });
      if (sessionId) {
        const sessionData = await getSessionConnectors(sessionId);
        setSessionStatuses(
          Object.fromEntries(sessionData.items.map((item) => [item.connectorKey, item]))
        );
      } else {
        setSessionStatuses({});
      }
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

  const handleFieldChange = (
    connectorKey: ConnectorKey,
    fieldKey: string,
    value: string
  ) => {
    setFormState((prev) => ({
      ...prev,
      [connectorKey]: {
        ...(prev[connectorKey] || {}),
        [fieldKey]: value,
      },
    }));
  };

  const closeAllPopovers = () => {
    setDetailKey(null);
    setOpen(false);
  };

  const openConnectorSettings = (withSessionBinding: boolean) => {
    openSettingsDialog({
      tab: "connectors",
      targetSessionId: withSessionBinding ? sessionId || null : null,
      connectorKey: null,
    });
    closeAllPopovers();
  };

  const handleToggle = async (connectorKey: ConnectorKey) => {
    const item = catalog.find((entry) => entry.key === connectorKey);
    const account = accounts[connectorKey];
    const session = sessionStatuses[connectorKey];

    if (!item) return;
    if (!sessionId || !item.available || account?.authStatus !== "authorized") {
      setDetailKey(connectorKey);
      return;
    }

    setActingKey(connectorKey);
    try {
      if (session?.attached) {
        await detachSessionConnector(sessionId, connectorKey);
        toast.success("连接器已禁用");
      } else {
        await attachSessionConnector(sessionId, connectorKey);
        toast.success("连接器已启用");
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "连接器操作失败");
    } finally {
      setActingKey(null);
    }
  };

  const handleQuickSave = async (item: ConnectorCatalogItem) => {
    const payload = buildQuickSavePayload(item, formState[item.key] || {});
    const hasExistingSecret = Boolean(accounts[item.key]?.secretSummary);
    const hasNewCredential = Object.keys(payload.credentials).length > 0;

    if (!hasExistingSecret && !hasNewCredential) {
      toast.error(item.key === "postgres" ? "请先粘贴数据库连接串" : "请先粘贴 token 或 secret");
      return;
    }

    setActingKey(item.key);
    try {
      await saveConnectorConfig(item.key, {
        displayName: payload.displayName,
        config: payload.config,
        credentials: payload.credentials,
      });
      toast.success("配置已保存，可通过右侧开关启用");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存连接器失败");
    } finally {
      setActingKey(null);
    }
  };

  const handleClearAuth = async (connectorKey: ConnectorKey) => {
    setActingKey(connectorKey);
    try {
      await clearConnectorAuth(connectorKey);
      toast.success("连接器授权已清除");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "清除授权失败");
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
              <Plug className="w-4 h-4 text-muted-foreground" />
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
        className="w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-[14px] border border-border/70 bg-background p-0 shadow-[0px_4px_16px_rgba(15,23,42,0.16)]"
      >
        <div
          className="grid min-h-[220px] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
          style={{
            maxHeight:
              "min(460px, calc(var(--radix-popover-content-available-height, 70vh) - 8px))",
          }}
        >
          <div className="flex items-center justify-between border-b border-border/70 px-3 py-2.5">
            <div className="text-sm font-medium text-foreground">Session Connectors</div>
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>

          <div className="min-h-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-1.5">
                <div className="space-y-1">
                  {mergedConnectors.map(({ item, account, session, form }) => {
                    const busy = actingKey === item.key;
                  const guide = CONNECTOR_GUIDES[item.key];
                  const checked = Boolean(session?.attached);
                  const DetailIcon = iconMap[item.icon as keyof typeof iconMap] || Link2;

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
                              "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[8px] px-2 text-left transition hover:bg-muted/45",
                              detailKey === item.key ? "bg-muted/45" : ""
                            )}
                          >
                            <div className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-muted text-foreground/90">
                              <DetailIcon className="h-3.5 w-3.5" />
                            </div>
                            <div className="truncate text-sm font-medium text-foreground">
                              {item.name}
                            </div>
                          </button>
                          </PopoverTrigger>

                          <PopoverContent
                            side="right"
                            align="start"
                            sideOffset={8}
                            collisionPadding={12}
                            className="w-[min(290px,calc(100vw-32px))] overflow-hidden rounded-[14px] border border-border/70 bg-background p-0 shadow-[0px_4px_16px_rgba(15,23,42,0.16)]"
                          >
                            <div
                              className="flex min-w-0 flex-col overflow-hidden"
                              style={{
                                maxHeight:
                                  "min(420px, calc(var(--radix-popover-content-available-height, 70vh) - 8px))",
                              }}
                            >
                              <div className="border-b border-border/70 px-3 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-muted text-foreground">
                                    <DetailIcon className="h-4 w-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-foreground">
                                      {item.name}
                                    </div>
                                    <div className="truncate text-xs text-muted-foreground">
                                      {item.description}
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {!item.available ? (
                                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                                      unavailable
                                    </span>
                                  ) : null}
                                  {account?.authStatus ? (
                                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                      {formatStatus(account.authStatus)}
                                    </span>
                                  ) : null}
                                  {session?.runtimeStatus &&
                                  !["unknown", "disconnected"].includes(session.runtimeStatus) ? (
                                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                      {formatStatus(session.runtimeStatus)}
                                    </span>
                                  ) : null}
                                </div>
                              </div>

                              <ScrollArea className="min-h-0 flex-1">
                                <div className="space-y-3 px-3 py-3">
                                  <div className="rounded-[10px] bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                                    <div className="flex items-center justify-between gap-3">
                                      <span>Current account</span>
                                      <span className="truncate text-right text-foreground/80">
                                        {account?.displayName || account?.secretSummary || "Not configured"}
                                      </span>
                                    </div>
                                    {sessionId ? (
                                      <div className="mt-1 flex items-center justify-between gap-3">
                                        <span>Session state</span>
                                        <span className="text-right text-foreground/80">
                                          {checked ? "Enabled" : "Disabled"}
                                        </span>
                                      </div>
                                    ) : null}
                                  </div>

                                  <div className="flex flex-wrap gap-2">
                                    {guide.quickLinks.slice(0, 2).map((link) => (
                                      <a
                                        key={link.href}
                                        href={link.href}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2.5 py-1 text-[11px] text-foreground transition hover:bg-muted/50"
                                        title={link.description}
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                        {link.label}
                                      </a>
                                    ))}
                                    {guide.exampleValue && guide.exampleLabel ? (
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2.5 py-1 text-[11px] text-foreground transition hover:bg-muted/50"
                                        onClick={async () => {
                                          try {
                                            await navigator.clipboard.writeText(guide.exampleValue || "");
                                            toast.success("模板已复制到剪贴板");
                                          } catch {
                                            toast.error("复制失败，请手动复制模板");
                                          }
                                        }}
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                        {guide.exampleLabel}
                                      </button>
                                    ) : null}
                                  </div>

                                  <div className="space-y-2">
                                    {item.configFields.map((field) => (
                                      <div key={field.key} className="space-y-1.5">
                                        <Label htmlFor={`${item.key}-${field.key}`} className="text-xs">
                                          {field.label}
                                        </Label>
                                        <Input
                                          id={`${item.key}-${field.key}`}
                                          value={form[field.key] || ""}
                                          onChange={(event) =>
                                            handleFieldChange(item.key, field.key, event.target.value)
                                          }
                                          placeholder={field.placeholder}
                                          className="h-9 rounded-[10px]"
                                          type={
                                            field.secret
                                              ? "password"
                                              : field.type === "url"
                                                ? "url"
                                                : "text"
                                          }
                                        />
                                        {field.description ? (
                                          <p className="text-[11px] leading-4 text-muted-foreground">
                                            {field.description}
                                          </p>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>

                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      className="flex-1 rounded-[10px]"
                                      disabled={busy}
                                      onClick={() => void handleQuickSave(item)}
                                    >
                                      {busy ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      ) : null}
                                      保存配置
                                    </Button>
                                    {account?.authStatus === "authorized" || account?.secretSummary ? (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="rounded-[10px]"
                                        disabled={busy}
                                        onClick={() => void handleClearAuth(item.key)}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    ) : null}
                                  </div>

                                  <div className="rounded-[10px] border border-dashed border-border/70 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                                    {guide.steps[0]}
                                  </div>
                                </div>
                              </ScrollArea>
                            </div>
                          </PopoverContent>
                        </Popover>

                        <ConnectorToggle
                          checked={checked}
                          busy={busy}
                          onClick={() => void handleToggle(item.key)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </ScrollArea>
          </div>

          <div className="shrink-0 border-t border-border/70 p-1.5">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left transition hover:bg-muted/55"
              onClick={() => openConnectorSettings(true)}
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-muted">
                  <Plus className="h-4 w-4" />
                </div>
                <div className="text-sm font-medium text-foreground">添加连接器</div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
            </button>

            <button
              type="button"
              className="mt-1 flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left transition hover:bg-muted/55"
              onClick={() => openConnectorSettings(false)}
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-muted">
                  <Settings2 className="h-4 w-4" />
                </div>
                <div className="text-sm font-medium text-foreground">管理连接器</div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
