import * as React from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, FolderOpen, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { resolveConnectorIcon } from "@/lib/connector-ui";
import { openSettingsDialog } from "@/lib/settings-dialog-events";
import {
  getMyConnectorProfiles,
  type ConnectorCatalogItem,
  type ConnectorProfile,
} from "@/lib/connectors-client";
import type {
  TaskCreationProjectDefaultConnector,
  TaskCreationProjectSummary,
} from "@/lib/task-creation-client";

type ProjectEditorDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  project?: TaskCreationProjectSummary | null;
  submitting?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    name: string;
    projectInstruction: string;
    defaultConnectors: Array<{
      connectorKey: TaskCreationProjectDefaultConnector["connectorKey"];
      profileId: string;
    }>;
  }) => Promise<void> | void;
};

type SelectableConnector = TaskCreationProjectDefaultConnector & {
  connectorName?: string | null;
};

function profileDisplayName(profile: Pick<ConnectorProfile, "profileName" | "displayName">) {
  return profile.displayName?.trim() || profile.profileName?.trim() || "";
}

function connectorStatusLabel(
  authStatus: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  const normalized = (authStatus || "").trim().toLowerCase();
  if (normalized === "authorized") return t("projectEditor.connectorAuthorized");
  if (normalized === "deleted") return t("projectEditor.connectorDeleted");
  if (normalized) return t("projectEditor.connectorNeedsAuth");
  return t("projectEditor.connectorUnknown");
}

export function ProjectEditorDialog({
  open,
  mode,
  project,
  submitting = false,
  onOpenChange,
  onSubmit,
}: ProjectEditorDialogProps) {
  const { t } = useTranslation();
  const connectorListRef = React.useRef<HTMLDivElement | null>(null);
  const [name, setName] = React.useState("");
  const [projectInstruction, setProjectInstruction] = React.useState("");
  const [connectorPickerOpen, setConnectorPickerOpen] = React.useState(false);
  const [expandedConnectorKeys, setExpandedConnectorKeys] = React.useState<string[]>([]);
  const [selectedConnectors, setSelectedConnectors] = React.useState<SelectableConnector[]>([]);
  const [catalog, setCatalog] = React.useState<ConnectorCatalogItem[]>([]);
  const [profiles, setProfiles] = React.useState<ConnectorProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(project?.name || "");
    setProjectInstruction(project?.projectInstruction || "");
    setConnectorPickerOpen(false);
    setExpandedConnectorKeys(
      Array.isArray(project?.defaultConnectors)
        ? Array.from(new Set(project.defaultConnectors.map((item) => item.connectorKey)))
        : []
    );
    setSelectedConnectors(
      Array.isArray(project?.defaultConnectors)
        ? project!.defaultConnectors.map((item) => ({
            ...item,
            connectorName: null,
          }))
        : []
    );
  }, [open, project, mode]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingProfiles(true);
    void getMyConnectorProfiles()
      .then((result) => {
        if (cancelled) return;
        setCatalog(result.catalog.filter((item) => item.category === "app"));
        setProfiles(result.profiles);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : t("projectEditor.loadConnectorsFailed"));
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingProfiles(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  const connectorNameByKey = React.useMemo(
    () =>
      new Map(
        catalog.map((item) => [item.key, item.name] as const)
      ),
    [catalog]
  );

  const profilesByConnector = React.useMemo(() => {
    const grouped = new Map<string, ConnectorProfile[]>();
    for (const profile of profiles) {
      const current = grouped.get(profile.connectorKey) || [];
      current.push(profile);
      grouped.set(profile.connectorKey, current);
    }
    return grouped;
  }, [profiles]);

  const selectedKeySet = React.useMemo(
    () => new Set(selectedConnectors.map((item) => `${item.connectorKey}:${item.profileId}`)),
    [selectedConnectors]
  );

  const toggleConnectorProfile = React.useCallback(
    (profile: ConnectorProfile) => {
      const selectionKey = `${profile.connectorKey}:${profile.profileId}`;
      setSelectedConnectors((current) => {
        if (current.some((item) => `${item.connectorKey}:${item.profileId}` === selectionKey)) {
          return current.filter((item) => `${item.connectorKey}:${item.profileId}` !== selectionKey);
        }
        return [
          ...current,
          {
            connectorKey: profile.connectorKey,
            profileId: profile.profileId,
            profileName: profile.profileName || null,
            displayName: profile.displayName || null,
            authStatus: profile.authStatus || null,
            connectorName: connectorNameByKey.get(profile.connectorKey) || null,
          },
        ];
      });
    },
    [connectorNameByKey]
  );

  const handleSubmit = React.useCallback(async () => {
    const nextName = name.trim();
    if (!nextName) return;
    await onSubmit({
      name: nextName,
      projectInstruction: projectInstruction.trim(),
      defaultConnectors: selectedConnectors.map((item) => ({
        connectorKey: item.connectorKey,
        profileId: item.profileId,
      })),
    });
  }, [name, onSubmit, projectInstruction, selectedConnectors]);

  const renderedSelectedConnectors = React.useMemo(
    () =>
      selectedConnectors.map((item) => ({
        ...item,
        connectorName: item.connectorName || connectorNameByKey.get(item.connectorKey) || item.connectorKey,
      })),
    [connectorNameByKey, selectedConnectors]
  );

  const selectedConnectorIcons = React.useMemo(
    () =>
      renderedSelectedConnectors.map((item) => {
        const catalogItem = catalog.find((entry) => entry.key === item.connectorKey);
        return {
          ...item,
          icon: resolveConnectorIcon(catalogItem?.icon || ""),
        };
      }),
    [catalog, renderedSelectedConnectors]
  );

  const handleOpenConnectorSettings = React.useCallback(
    (connectorKey: ConnectorCatalogItem["key"]) => {
      setConnectorPickerOpen(false);
      openSettingsDialog({
        tab: "connectors",
        connectorKey,
      });
    },
    []
  );

  const toggleConnectorGroup = React.useCallback((connectorKey: string) => {
    setExpandedConnectorKeys((current) =>
      current.includes(connectorKey)
        ? current.filter((item) => item !== connectorKey)
        : [...current, connectorKey]
    );
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/60">
            <FolderOpen className="h-8 w-8 text-foreground" />
          </div>
          <DialogTitle className="text-center">
            {mode === "create" ? t("sidebar.createProjectTitle") : t("sidebar.projectEditTitle")}
          </DialogTitle>
          <DialogDescription className="text-center">
            {mode === "create"
              ? t("projectEditor.createDescription")
              : t("projectEditor.editDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="project-editor-name">{t("sidebar.projectNameLabel")}</Label>
            <Input
              id="project-editor-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("sidebar.projectNamePlaceholder")}
              maxLength={80}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-editor-instruction">{t("projectEditor.projectInstructionLabel")}</Label>
            <Textarea
              id="project-editor-instruction"
              value={projectInstruction}
              onChange={(event) => setProjectInstruction(event.target.value.slice(0, 8000))}
              placeholder={t("projectEditor.projectInstructionPlaceholder")}
              maxLength={8000}
              className="min-h-[170px] resize-none"
            />
          </div>

          <div className="space-y-3">
            <Popover open={connectorPickerOpen} onOpenChange={setConnectorPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-[36px] min-w-[72px] w-full items-center justify-between gap-[6px] whitespace-nowrap rounded-[8px] bg-transparent px-[12px] py-[8px] text-sm font-medium text-[var(--text-primary)] outline outline-1 -outline-offset-1 outline-[var(--Button-border-secondary)] transition-colors hover:bg-[var(--fill-tsp-white-light)] hover:opacity-90 active:opacity-80"
                >
                  <div className="text-[13px]">
                    <span className="text-[var(--text-primary)]">
                      {t("projectEditor.defaultConnectorsLabel")}
                    </span>
                    <span className="ms-[4px] text-[var(--text-tertiary)]">
                      {t("projectEditor.optionalSuffix")}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-[4px]">
                    {selectedConnectorIcons.length > 0 ? (
                      <div className="flex items-center gap-[4px]">
                        {selectedConnectorIcons.slice(0, 4).map((item) => {
                          const Icon = item.icon || Link2;
                          return (
                            <span
                              key={`${item.connectorKey}:${item.profileId}`}
                              className="flex h-[18px] w-[18px] items-center justify-center"
                              title={`${item.connectorName}: ${item.displayName || item.profileName || item.profileId}`}
                            >
                              <Icon className="h-[18px] w-[18px] text-[var(--icon-primary)]" />
                            </span>
                          );
                        })}
                        {selectedConnectorIcons.length > 4 ? (
                          <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--fill-tsp-white-light)] px-1 text-[10px] font-medium text-[var(--text-secondary)]">
                            +{selectedConnectorIcons.length - 4}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-[var(--text-tertiary)]">
                        {t("projectEditor.emptySelectionShort")}
                      </span>
                    )}
                    {loadingProfiles ? (
                      <Loader2 className="h-[16px] w-[16px] animate-spin text-[var(--icon-secondary)]" />
                    ) : (
                      <ChevronRight className="h-[16px] w-[16px] text-[var(--icon-secondary)]" />
                    )}
                  </div>
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-[var(--radix-popover-trigger-width)] min-w-[24rem] max-h-[min(20rem,var(--radix-popover-content-available-height))] overflow-hidden p-0"
              >
                <div
                  ref={connectorListRef}
                  className="max-h-[min(20rem,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain p-3"
                  onWheel={(event) => {
                    const element = connectorListRef.current;
                    if (!element) return;
                    if (element.scrollHeight <= element.clientHeight) return;
                    element.scrollTop += event.deltaY;
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                    {catalog.length === 0 && !loadingProfiles ? (
                      <div className="text-sm text-muted-foreground">
                        {t("projectEditor.noConnectorProfiles")}
                      </div>
                    ) : (
                      catalog.map((item) => {
                        const connectorProfiles = [...(profilesByConnector.get(item.key) || [])].sort(
                          (left, right) =>
                            profileDisplayName(left).localeCompare(profileDisplayName(right), "zh-CN")
                        );
                        const authorizedProfiles = connectorProfiles.filter(
                          (profile) => profile.authStatus === "authorized"
                        );
                        const singleAuthorizedProfile =
                          authorizedProfiles.length === 1 ? authorizedProfiles[0] : null;
                        const ConnectorIcon = resolveConnectorIcon(item.icon);
                        const hasProfiles = connectorProfiles.length > 0;
                        const expanded = expandedConnectorKeys.includes(item.key);
                        const selectedCount = selectedConnectors.filter(
                          (connector) => connector.connectorKey === item.key
                        ).length;
                        return (
                          <div key={item.key}>
                            <button
                              type="button"
                              className="flex w-full items-center gap-3 rounded-[8px] px-2 py-2 text-left transition-colors hover:bg-[var(--fill-tsp-white-main)]"
                              onClick={() => {
                                if (!hasProfiles) {
                                  handleOpenConnectorSettings(item.key);
                                  return;
                                }
                                if (singleAuthorizedProfile) {
                                  toggleConnectorProfile(singleAuthorizedProfile);
                                  return;
                                }
                                if (authorizedProfiles.length === 0) {
                                  handleOpenConnectorSettings(item.key);
                                  return;
                                }
                                toggleConnectorGroup(item.key);
                              }}
                            >
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                                <ConnectorIcon className="h-5 w-5 text-[var(--icon-primary)]" />
                              </span>
                              <span className="min-w-0 flex-1 space-y-0.5">
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="text-[14px] leading-[20px] text-[var(--text-primary)]">
                                    {item.name}
                                  </span>
                                  {selectedCount > 0 ? (
                                    <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px]">
                                      {t("projectEditor.selectedCount", { count: selectedCount })}
                                    </Badge>
                                  ) : null}
                                </span>
                                {hasProfiles ? (
                                  <span className="block text-xs text-muted-foreground">
                                    {t("projectEditor.connectorProfileCount", {
                                      count: connectorProfiles.length,
                                    })}
                                  </span>
                                ) : null}
                              </span>
                              <ChevronRight
                                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                                  hasProfiles && authorizedProfiles.length !== 1 && expanded ? "rotate-90" : ""
                                }`}
                              />
                            </button>
                            {hasProfiles && authorizedProfiles.length !== 1 && expanded ? (
                              <div className="pl-7">
                                {connectorProfiles.map((profile) => {
                                  const selectionKey = `${profile.connectorKey}:${profile.profileId}`;
                                  const checked = selectedKeySet.has(selectionKey);
                                  return (
                                    <label
                                      key={selectionKey}
                                      className="flex cursor-pointer items-center gap-3 rounded-[8px] px-2 py-2 transition-colors hover:bg-[var(--fill-tsp-white-main)]"
                                    >
                                      <Checkbox
                                        checked={checked}
                                        onCheckedChange={() => toggleConnectorProfile(profile)}
                                      />
                                      <div className="min-w-0 flex-1 space-y-0.5">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="text-[14px] leading-[20px] text-[var(--text-primary)]">
                                            {profileDisplayName(profile)}
                                          </span>
                                          <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px]">
                                            {connectorStatusLabel(profile.authStatus, t)}
                                          </Badge>
                                          {checked ? (
                                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary">
                                              <Check className="h-3 w-3" />
                                            </span>
                                          ) : null}
                                        </div>
                                        <div className="text-[12px] text-[var(--text-secondary)]">
                                          {profile.profileName}
                                        </div>
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting || !name.trim()}>
            {submitting
              ? t("sidebar.saving")
              : mode === "create"
                ? t("sidebar.createProjectAction")
                : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
