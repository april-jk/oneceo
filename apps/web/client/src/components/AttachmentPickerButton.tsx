import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Cloud,
  Download,
  FolderPlus,
  HardDriveUpload,
  Plus,
  Sparkles,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ATTACHMENT_ACCEPT } from "@/lib/task-attachments";
import {
  openSettingsDialog,
  TASK_CREATION_SKILLS_UPDATED_EVENT,
} from "@/lib/settings-dialog-events";
import {
  fetchRemoteTaskAttachment,
  listTaskCreationSkills,
  type RemoteAttachmentProvider,
  type TaskCreationPlatformSkill,
} from "@/lib/task-creation-client";

type AttachmentPickerButtonProps = {
  onSelectFiles: (files: File[]) => void | Promise<void>;
  onSelectSkills?: (skills: TaskCreationPlatformSkill[]) => void | Promise<void>;
  disabled?: boolean;
};

function formatSkillResourceSummary(
  skill: TaskCreationPlatformSkill,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  const summary = skill.resourceSummary;
  if (!summary || summary.totalCount <= 0) {
    return t("attachmentPicker.skills.noExtraResources");
  }
  return t("attachmentPicker.skills.resourceSummary", {
    referenceCount: summary.referenceCount,
    templateCount: summary.templateCount,
  });
}

export default function AttachmentPickerButton({
  onSelectFiles,
  onSelectSkills,
  disabled = false,
}: AttachmentPickerButtonProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogProvider, setDialogProvider] = useState<RemoteAttachmentProvider | null>(null);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [isImportingRemote, setIsImportingRemote] = useState(false);
  const [skills, setSkills] = useState<TaskCreationPlatformSkill[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);

  const cloudProviderItems = useMemo(
    () =>
      [
        {
          provider: "google-drive",
          label: "Google Drive",
          description: t("attachmentPicker.cloud.googleDriveDescription"),
        },
        {
          provider: "onedrive",
          label: "OneDrive",
          description: t("attachmentPicker.cloud.oneDriveDescription"),
        },
        {
          provider: "website",
          label: t("attachmentPicker.cloud.websiteLabel"),
          description: t("attachmentPicker.cloud.websiteDescription"),
        },
      ] as Array<{
        provider: RemoteAttachmentProvider;
        label: string;
        description: string;
      }>,
    [t]
  );

  const getProviderLabel = useCallback(
    (provider: RemoteAttachmentProvider) =>
      cloudProviderItems.find((item) => item.provider === provider)?.label || provider,
    [cloudProviderItems]
  );

  const dialogCopy = useMemo(() => {
    if (!dialogProvider) return null;
    if (dialogProvider === "website") {
      return {
        title: t("attachmentPicker.dialog.website.title"),
        description: t("attachmentPicker.dialog.website.description"),
        placeholder: "https://example.com/files/spec.pdf",
      };
    }
    if (dialogProvider === "google-drive") {
      return {
        title: t("attachmentPicker.dialog.googleDrive.title"),
        description: t("attachmentPicker.dialog.googleDrive.description"),
        placeholder: "https://drive.google.com/file/d/xxx/view?usp=sharing",
      };
    }
    return {
      title: t("attachmentPicker.dialog.oneDrive.title"),
      description: t("attachmentPicker.dialog.oneDrive.description"),
      placeholder: "https://1drv.ms/u/s!example",
    };
  }, [dialogProvider, t]);

  const handleLocalSelect = async (files: File[]) => {
    await Promise.resolve(onSelectFiles(files));
  };

  const refreshSkills = useCallback(async () => {
    if (!onSelectSkills) return;
    setSkillsLoading(true);
    try {
      const data = await listTaskCreationSkills();
      setSkills(data);
      setSkillsLoaded(true);
    } catch (error) {
      console.warn("[AttachmentPickerButton] load skills failed:", error);
      setSkills([]);
      setSkillsLoaded(true);
    } finally {
      setSkillsLoading(false);
    }
  }, [onSelectSkills]);

  useEffect(() => {
    if (!onSelectSkills) return;
    const handleSkillsUpdated = () => {
      void refreshSkills();
    };
    window.addEventListener(TASK_CREATION_SKILLS_UPDATED_EVENT, handleSkillsUpdated);
    return () => {
      window.removeEventListener(TASK_CREATION_SKILLS_UPDATED_EVENT, handleSkillsUpdated);
    };
  }, [onSelectSkills, refreshSkills]);

  useEffect(() => {
    if (!onSelectSkills || !menuOpen) return;
    void refreshSkills();
  }, [menuOpen, onSelectSkills, refreshSkills]);

  const handleSkillImport = async (skill: TaskCreationPlatformSkill) => {
    if (!onSelectSkills) return;
    try {
      setMenuOpen(false);
      await Promise.resolve(onSelectSkills([skill]));
      toast.success(t("attachmentPicker.toasts.skillAdded", { name: skill.name }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("attachmentPicker.toasts.skillAddFailed");
      toast.error(message);
    }
  };

  const handleRemoteImport = async () => {
    const trimmedUrl = remoteUrl.trim();
    if (!dialogProvider || !trimmedUrl) {
      toast.error(t("attachmentPicker.toasts.urlRequired"));
      return;
    }
    setIsImportingRemote(true);
    try {
      const file = await fetchRemoteTaskAttachment({
        provider: dialogProvider,
        url: trimmedUrl,
      });
      await handleLocalSelect([file]);
      toast.success(
        t("attachmentPicker.toasts.remoteAdded", {
          provider: getProviderLabel(dialogProvider),
          name: file.name,
        })
      );
      setDialogProvider(null);
      setRemoteUrl("");
    } catch (error) {
      const message = error instanceof Error ? error.message : t("attachmentPicker.toasts.remoteAddFailed");
      toast.error(message);
    } finally {
      setIsImportingRemote(false);
    }
  };

  return (
    <>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          if (files.length > 0) {
            void handleLocalSelect(files).catch((error) => {
              const message =
                error instanceof Error ? error.message : t("attachmentPicker.toasts.localAddFailed");
              toast.error(message);
            });
          }
          event.target.value = "";
        }}
      />

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-xl hover:bg-muted transition-colors"
                disabled={disabled}
                aria-label={t("attachmentPicker.triggerAriaLabel")}
                data-testid="attachment-picker-trigger"
              >
                <Plus className="w-4 h-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t("attachmentPicker.triggerLabel")}</p>
          </TooltipContent>
        </Tooltip>

        <DropdownMenuContent
          align="start"
          className="w-64 rounded-2xl border-border/70 p-2 shadow-xl"
          data-testid="attachment-picker-menu"
        >
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="rounded-xl px-3 py-2">
              <Cloud className="h-4 w-4" />
              <div className="flex min-w-0 flex-1 flex-col items-start">
                <span className="text-sm font-medium">{t("attachmentPicker.cloud.title")}</span>
                <span className="text-xs text-muted-foreground">{t("attachmentPicker.cloud.description")}</span>
              </div>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-72 rounded-2xl border-border/70 p-2 shadow-xl">
              {cloudProviderItems.map((item) => (
                <DropdownMenuItem
                  key={item.provider}
                  className="rounded-xl px-3 py-2"
                  onSelect={() => {
                    setMenuOpen(false);
                    setDialogProvider(item.provider);
                    setRemoteUrl("");
                  }}
                >
                  <Download className="h-4 w-4" />
                  <div className="flex min-w-0 flex-1 flex-col items-start">
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="text-xs text-muted-foreground">{item.description}</span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {onSelectSkills ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="rounded-xl px-3 py-2">
                <Sparkles className="h-4 w-4" />
                <div className="flex min-w-0 flex-1 flex-col items-start">
                  <span className="text-sm font-medium">{t("attachmentPicker.skills.title")}</span>
                  <span className="text-xs text-muted-foreground">{t("attachmentPicker.skills.description")}</span>
                </div>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-72 rounded-2xl border-border/70 p-2 shadow-xl">
                {skills.length > 0 ? (
                  skills.map((item) => (
                    <DropdownMenuItem
                      key={`${item.skillId}:${item.revisionId}`}
                      className="rounded-xl px-3 py-2"
                      onSelect={() => {
                        void handleSkillImport(item);
                      }}
                    >
                      <Wrench className="h-4 w-4" />
                      <div className="flex min-w-0 flex-1 flex-col items-start">
                        <span className="text-sm font-medium">{item.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {t(
                            item.sourceType === "custom"
                              ? "attachmentPicker.skills.sourceCustom"
                              : "attachmentPicker.skills.sourceTemplate"
                          )}{" "}
                          · {item.description} · {formatSkillResourceSummary(item, t)}
                        </span>
                      </div>
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem
                    className="rounded-xl px-3 py-2"
                    disabled={skillsLoading}
                    onSelect={(event) => {
                      if (skillsLoading) return;
                      event.preventDefault();
                      setMenuOpen(false);
                      openSettingsDialog({ tab: "skills" });
                    }}
                  >
                    <Wrench className="h-4 w-4" />
                    <div className="flex min-w-0 flex-1 flex-col items-start">
                      <span className="text-sm font-medium">
                        {skillsLoading || !skillsLoaded
                          ? t("attachmentPicker.skills.loading")
                          : t("attachmentPicker.skills.empty")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {skillsLoading || !skillsLoaded
                          ? t("attachmentPicker.skills.loadingDescription")
                          : t("attachmentPicker.skills.emptyDescription")}
                      </span>
                    </div>
                  </DropdownMenuItem>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}

          <DropdownMenuItem
            className="rounded-xl px-3 py-2"
            onSelect={() => {
              setMenuOpen(false);
              inputRef.current?.click();
            }}
          >
            <HardDriveUpload className="h-4 w-4" />
            <div className="flex min-w-0 flex-1 flex-col items-start">
              <span className="text-sm font-medium">{t("attachmentPicker.local.title")}</span>
              <span className="text-xs text-muted-foreground">{t("attachmentPicker.local.description")}</span>
            </div>
            <FolderPlus className="ml-2 h-4 w-4 text-muted-foreground" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={Boolean(dialogProvider)}
        onOpenChange={(open) => {
          if (open || isImportingRemote) return;
          setDialogProvider(null);
          setRemoteUrl("");
        }}
      >
        <DialogContent className="max-w-md rounded-3xl p-0" showCloseButton={!isImportingRemote}>
          <DialogHeader className="border-b px-6 pt-6 pb-4">
            <DialogTitle>{dialogCopy?.title || t("attachmentPicker.dialog.defaultTitle")}</DialogTitle>
            <DialogDescription>{dialogCopy?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 py-5">
            <label className="space-y-2 text-sm font-medium text-foreground">
              <span>{t("attachmentPicker.dialog.urlLabel")}</span>
              <Input
                value={remoteUrl}
                onChange={(event) => setRemoteUrl(event.target.value)}
                placeholder={dialogCopy?.placeholder}
                autoFocus
                data-testid="remote-attachment-url-input"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !isImportingRemote) {
                    event.preventDefault();
                    void handleRemoteImport();
                  }
                }}
              />
            </label>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("attachmentPicker.dialog.hint")}
            </p>
          </div>
          <DialogFooter className="border-t px-6 py-4">
            <Button
              variant="outline"
              onClick={() => {
                setDialogProvider(null);
                setRemoteUrl("");
              }}
              disabled={isImportingRemote}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void handleRemoteImport()} disabled={isImportingRemote || !remoteUrl.trim()}>
              {isImportingRemote ? t("attachmentPicker.dialog.importing") : t("attachmentPicker.dialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
