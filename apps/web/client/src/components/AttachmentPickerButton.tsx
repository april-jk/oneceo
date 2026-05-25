import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderPlus, HardDriveUpload, Plus, Sparkles, Wrench } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ATTACHMENT_ACCEPT } from "@/lib/task-attachments";
import {
  openSettingsDialog,
  TASK_CREATION_SKILLS_UPDATED_EVENT,
} from "@/lib/settings-dialog-events";
import { listTaskCreationSkills, type TaskCreationPlatformSkill } from "@/lib/task-creation-client";

type AttachmentPickerButtonProps = {
  onSelectFiles: (files: File[]) => void | Promise<void>;
  onSelectSkills?: (skills: TaskCreationPlatformSkill[]) => void | Promise<void>;
  selectedSkills?: TaskCreationPlatformSkill[];
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
  selectedSkills = [],
  disabled = false,
}: AttachmentPickerButtonProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [skills, setSkills] = useState<TaskCreationPlatformSkill[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const selectedSkillKeys = useMemo(
    () => new Set(selectedSkills.map((item) => `${item.skillId}:${item.revisionId}`)),
    [selectedSkills]
  );

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
    const skillKey = `${skill.skillId}:${skill.revisionId}`;
    if (selectedSkillKeys.has(skillKey)) {
      setMenuOpen(false);
      toast.info(`已添加技能：${skill.name}`);
      return;
    }
    try {
      setMenuOpen(false);
      await Promise.resolve(onSelectSkills([skill]));
      toast.success(t("attachmentPicker.toasts.skillAdded", { name: skill.name }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("attachmentPicker.toasts.skillAddFailed");
      toast.error(message);
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
                  skills.map((item) => {
                    const skillKey = `${item.skillId}:${item.revisionId}`;
                    const alreadySelected = selectedSkillKeys.has(skillKey);
                    return (
                      <DropdownMenuItem
                        key={skillKey}
                        className="rounded-xl px-3 py-2"
                        disabled={alreadySelected}
                        onSelect={() => {
                          if (alreadySelected) return;
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
                        {alreadySelected ? (
                          <span className="text-xs text-muted-foreground">已添加</span>
                        ) : null}
                      </DropdownMenuItem>
                    );
                  })
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
    </>
  );
}
