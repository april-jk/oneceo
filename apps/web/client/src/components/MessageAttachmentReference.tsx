import { FileText, Paperclip, Wrench } from "lucide-react";

import type {
  TaskCreationPlatformSkill,
  TaskCreationUploadedAttachment as UploadedTaskAttachment,
} from "@/lib/task-creation-client";
import { formatAttachmentSize } from "@/lib/task-attachments";
import { cn } from "@/lib/utils";

type MessageAttachmentReferenceProps = {
  skills?: TaskCreationPlatformSkill[];
  attachments?: UploadedTaskAttachment[];
  tone?: "default" | "inverse";
  className?: string;
};

function buildReferenceSummary(
  skills: TaskCreationPlatformSkill[],
  attachments: UploadedTaskAttachment[],
) {
  if (skills.length && attachments.length) return "Skills 与附件";
  if (skills.length) return "Skills";
  return "附件";
}

export default function MessageAttachmentReference({
  skills = [],
  attachments = [],
  tone = "default",
  className,
}: MessageAttachmentReferenceProps) {
  if (skills.length === 0 && attachments.length === 0) return null;

  const inverse = tone === "inverse";
  const containerClass = inverse
    ? "border-white/18 bg-white/10 text-white"
    : "border-slate-200/90 bg-slate-50/90 text-slate-900";
  const accentClass = inverse ? "bg-white/70" : "bg-slate-400";
  const titleClass = inverse ? "text-white/72" : "text-slate-500";
  const summaryClass = inverse ? "text-white" : "text-slate-900";
  const sectionLabelClass = inverse ? "text-white/78" : "text-slate-600";
  const itemClass = inverse
    ? "border-white/12 bg-white/8 text-white"
    : "border-slate-200/80 bg-white/80 text-slate-900";
  const metaClass = inverse ? "text-white/60" : "text-slate-500";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border px-3 py-2.5",
        containerClass,
        className,
      )}
    >
      <div className={cn("absolute inset-y-2 left-0.5 w-0.5 rounded-full", accentClass)} />
      <div className="pl-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={cn("text-[10px] font-semibold uppercase tracking-[0.24em]", titleClass)}>
              已附加
            </div>
            <div className={cn("mt-1 text-sm font-semibold", summaryClass)}>
              {buildReferenceSummary(skills, attachments)}
            </div>
          </div>
          <div className={cn("shrink-0 text-[11px]", metaClass)}>
            {skills.length + attachments.length} 项
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {skills.length ? (
            <div className="space-y-1.5">
              <div className={cn("flex items-center gap-1.5 text-[11px] font-medium", sectionLabelClass)}>
                <Wrench className="h-3.5 w-3.5" />
                <span>Skills</span>
                <span className={metaClass}>· {skills.length}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {skills.map((skill) => (
                  <div
                    key={`${skill.skillId}:${skill.revisionId}`}
                    className={cn(
                      "inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs",
                      itemClass,
                    )}
                  >
                    <Wrench className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate font-medium">{skill.name}</span>
                    {skill.revisionNumber !== null ? (
                      <span className={cn("shrink-0 text-[11px]", metaClass)}>
                        rev.{skill.revisionNumber}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {attachments.length ? (
            <div className="space-y-1.5">
              <div className={cn("flex items-center gap-1.5 text-[11px] font-medium", sectionLabelClass)}>
                <Paperclip className="h-3.5 w-3.5" />
                <span>附件</span>
                <span className={metaClass}>· {attachments.length}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {attachments.map((attachment) => (
                  <div
                    key={`${attachment.path || attachment.name}:${attachment.size}`}
                    className={cn(
                      "inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs",
                      itemClass,
                    )}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate font-medium">{attachment.name || attachment.path}</span>
                    <span className={cn("shrink-0 text-[11px]", metaClass)}>
                      {formatAttachmentSize(attachment.size)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
