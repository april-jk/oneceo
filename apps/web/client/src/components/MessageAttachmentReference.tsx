import { FileText, Link2, MoreHorizontal, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  sessionId?: string | null;
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

function renderAttachmentFile(
  attachment: UploadedTaskAttachment,
  index: number,
  variant: "tile" | "row" = "tile",
) {
  const meta = formatAttachmentMeta(attachment);
  const filename = attachment.name || attachment.path;
  if (variant === "row") {
    return (
      <div
        key={buildAttachmentKey(attachment, index)}
        className="flex min-w-0 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
        title={filename}
      >
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white">
          <FileText className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
          {filename}
        </span>
        {meta ? (
          <span className="shrink-0 text-xs font-medium text-slate-400">
            {meta}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      key={buildAttachmentKey(attachment, index)}
      className="flex h-16 w-40 shrink-0 items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-left text-xs text-slate-700 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
      title={filename}
    >
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white shadow-sm">
        <FileText className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold leading-4 text-slate-800">
          {filename}
        </span>
        {meta ? (
          <span className="mt-0.5 block text-[11px] font-medium leading-none text-slate-400">
            {meta}
          </span>
        ) : null}
      </span>
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
    tone === "inverse" ? "text-emerald-200" : "text-emerald-700";
  const connectorClass = tone === "inverse" ? "text-sky-200" : "text-sky-700";

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
  const { t } = useTranslation();
  if (attachments.length === 0) return null;

  const visibleAttachments = attachments.slice(0, 2);
  const hiddenAttachments = attachments.slice(2);

  return (
    <>
      <div
        className={cn(
          "flex max-w-full items-center justify-end gap-2 overflow-visible",
          className,
        )}
      >
        {visibleAttachments.map((attachment, index) =>
          renderAttachmentFile(attachment, index),
        )}
        {hiddenAttachments.length ? (
          <Dialog>
            <DialogTrigger asChild>
              <button
                type="button"
                className="group flex h-16 w-14 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-600 shadow-[0_1px_0_rgba(15,23,42,0.04)] transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-900"
                aria-label={t("messageAttachmentReference.preview.moreFiles", {
                  count: hiddenAttachments.length,
                })}
              >
                <span className="text-sm group-hover:hidden">
                  +{hiddenAttachments.length}
                </span>
                <MoreHorizontal className="hidden h-4 w-4 group-hover:block" />
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-xl rounded-xl border-slate-200 p-0 shadow-2xl">
              <DialogHeader className="border-b border-slate-200 px-5 py-4">
                <DialogTitle className="text-base">
                  {t("messageAttachmentReference.attachments")}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {t("messageAttachmentReference.itemCount", {
                    count: attachments.length,
                  })}
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[22rem] space-y-2 overflow-y-auto p-4">
                {attachments.map((attachment, index) =>
                  renderAttachmentFile(attachment, index, "row"),
                )}
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </>
  );
}

export default function MessageAttachmentReference({
  skills = [],
  attachments = [],
  mcpReferences = [],
  sessionId,
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
      <MessageAttachmentFiles attachments={attachments} sessionId={sessionId} />
    </div>
  );
}
