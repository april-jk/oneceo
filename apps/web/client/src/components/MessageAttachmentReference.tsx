import { FileText, Link2, MoreHorizontal, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  TaskCreationPlatformSkill,
  TaskCreationUploadedAttachment as UploadedTaskAttachment,
} from "@/lib/task-creation-client";
import type { TaskCreationMcpReference } from "@/lib/task-input-metadata";
import { formatAttachmentSize } from "@/lib/task-attachments";
import { getSkillDisplayName } from "@/lib/skill-display-name";
import { cn } from "@/lib/utils";

type MessageReferenceTone = "default" | "inverse";

type MessageInlineReferencesProps = {
  skills?: TaskCreationPlatformSkill[];
  mcpReferences?: TaskCreationMcpReference[];
  tone?: MessageReferenceTone;
  className?: string;
};

type MessageAttachmentFilesProps = {
  attachments?: UploadedTaskAttachment[];
  className?: string;
};

type LegacyMessageAttachmentReferenceProps = MessageInlineReferencesProps &
  MessageAttachmentFilesProps;

function buildAttachmentKey(attachment: UploadedTaskAttachment, index: number) {
  return `${attachment.path || attachment.name}:${attachment.size}:${index}`;
}

function formatAttachmentMeta(attachment: UploadedTaskAttachment) {
  return Number.isFinite(attachment.size) && attachment.size > 0
    ? formatAttachmentSize(attachment.size)
    : "";
}

function renderAttachmentFile(attachment: UploadedTaskAttachment, index: number) {
  const meta = formatAttachmentMeta(attachment);
  return (
    <div
      key={buildAttachmentKey(attachment, index)}
      className="inline-flex h-8 max-w-[15rem] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-700 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
      title={attachment.name || attachment.path}
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />
      <span className="min-w-0 truncate font-medium">
        {attachment.name || attachment.path}
      </span>
      {meta ? (
        <span className="shrink-0 text-[11px] text-slate-400">{meta}</span>
      ) : null}
    </div>
  );
}

export function MessageInlineReferences({
  skills = [],
  mcpReferences = [],
  tone = "default",
  className,
}: MessageInlineReferencesProps) {
  const { t } = useTranslation();
  if (skills.length === 0 && mcpReferences.length === 0) return null;

  const labelClass =
    tone === "inverse" ? "text-white/55" : "text-muted-foreground";
  const skillClass =
    tone === "inverse"
      ? "text-emerald-200"
      : "text-emerald-700";
  const connectorClass =
    tone === "inverse" ? "text-sky-200" : "text-sky-700";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5",
        className,
      )}
    >
      {skills.length ? (
        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <Wrench className={cn("h-3.5 w-3.5 shrink-0", skillClass)} />
          <span className={labelClass}>Skills</span>
          {skills.map((skill, index) => (
            <span
              key={`${skill.skillId}:${skill.revisionId}:${index}`}
              className={cn("font-semibold", skillClass)}
              title={skill.name}
            >
              {getSkillDisplayName(skill)}
              {index < skills.length - 1 ? "," : ""}
            </span>
          ))}
        </span>
      ) : null}

      {skills.length && mcpReferences.length ? (
        <span className={labelClass}>·</span>
      ) : null}

      {mcpReferences.length ? (
        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <Link2 className={cn("h-3.5 w-3.5 shrink-0", connectorClass)} />
          <span className={labelClass}>
            {t("messageAttachmentReference.connectors")}
          </span>
          {mcpReferences.map((reference, index) => (
            <span
              key={`${reference.key}:${reference.name}:${index}`}
              className={cn("font-semibold", connectorClass)}
            >
              {reference.name || reference.key}
              {index < mcpReferences.length - 1 ? "," : ""}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

export function MessageAttachmentFiles({
  attachments = [],
  className,
}: MessageAttachmentFilesProps) {
  if (attachments.length === 0) return null;

  const visibleAttachments = attachments.slice(0, 2);
  const hiddenAttachments = attachments.slice(2);

  return (
    <div className={cn("flex max-w-full flex-wrap justify-end gap-1.5", className)}>
      {visibleAttachments.map(renderAttachmentFile)}
      {hiddenAttachments.length ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="group inline-flex h-8 min-w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-600 shadow-[0_1px_0_rgba(15,23,42,0.04)] transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-900"
              aria-label={`查看其他 ${hiddenAttachments.length} 个文件`}
            >
              <span className="group-hover:hidden">+{hiddenAttachments.length}</span>
              <MoreHorizontal className="hidden h-4 w-4 group-hover:block" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            side="top"
            className="w-[20rem] rounded-xl border-slate-200 p-2 shadow-xl"
          >
            <div className="max-h-[14rem] space-y-1 overflow-y-auto">
              {hiddenAttachments.map((attachment, index) =>
                renderAttachmentFile(attachment, index + 2),
              )}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}

export default function MessageAttachmentReference({
  skills = [],
  attachments = [],
  mcpReferences = [],
  tone = "default",
  className,
}: LegacyMessageAttachmentReferenceProps) {
  if (
    skills.length === 0 &&
    attachments.length === 0 &&
    mcpReferences.length === 0
  ) {
    return null;
  }

  return (
    <div className={cn("space-y-2", className)}>
      <MessageInlineReferences
        skills={skills}
        mcpReferences={mcpReferences}
        tone={tone}
      />
      <MessageAttachmentFiles attachments={attachments} />
    </div>
  );
}
