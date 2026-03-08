import { FileText, X } from "lucide-react";

import type { PendingAttachment, UploadedTaskAttachment } from "@/lib/task-attachments";
import { formatAttachmentSize } from "@/lib/task-attachments";
import { cn } from "@/lib/utils";

type AttachmentChipListProps = {
  attachments: Array<
    | PendingAttachment
    | (UploadedTaskAttachment & {
        id?: string;
      })
  >;
  onRemove?: (id: string) => void;
  tone?: "default" | "inverse";
  className?: string;
};

export default function AttachmentChipList({
  attachments,
  onRemove,
  tone = "default",
  className,
}: AttachmentChipListProps) {
  if (!attachments.length) return null;

  const baseTone =
    tone === "inverse"
      ? "border-white/15 bg-white/10 text-white/90"
      : "border-border/70 bg-muted/45 text-foreground";
  const metaTone = tone === "inverse" ? "text-white/60" : "text-muted-foreground";
  const removeTone =
    tone === "inverse"
      ? "text-white/70 hover:bg-white/10 hover:text-white"
      : "text-muted-foreground hover:bg-muted hover:text-foreground";

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {attachments.map((attachment, index) => {
        const id = "id" in attachment && typeof attachment.id === "string"
          ? attachment.id
          : `${attachment.name}:${attachment.size}:${index}`;
        return (
          <div
            key={id}
            className={cn(
              "inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
              baseTone
            )}
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-[180px] truncate font-medium">{attachment.name}</span>
            <span className={cn("shrink-0 text-[11px]", metaTone)}>
              {formatAttachmentSize(attachment.size)}
            </span>
            {onRemove ? (
              <button
                type="button"
                className={cn("rounded-full p-0.5 transition-colors", removeTone)}
                onClick={() => onRemove(id)}
                aria-label={`移除附件 ${attachment.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
