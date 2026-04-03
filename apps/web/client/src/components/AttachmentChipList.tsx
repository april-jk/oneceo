import { useRef } from "react";
import { FileText, Wrench, X } from "lucide-react";

import type {
  PendingAttachment,
  PendingPlatformSkill,
} from "@/lib/task-attachments";
import type { TaskCreationUploadedAttachment as UploadedTaskAttachment } from "@/lib/task-creation-client";
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

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number | null;
    startX: number;
    startScrollLeft: number;
    dragging: boolean;
  }>({
    pointerId: null,
    startX: 0,
    startScrollLeft: 0,
    dragging: false,
  });

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
    <div className={cn("relative min-w-0", className)}>
      <div
        ref={scrollRef}
        className={cn(
          "flex min-w-0 gap-2 overflow-x-auto overflow-y-hidden whitespace-nowrap pb-1",
          "cursor-grab select-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
          "active:cursor-grabbing"
        )}
        style={{ touchAction: "pan-x" }}
        onWheel={(event) => {
          const element = scrollRef.current;
          if (!element) return;
          if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
          if (element.scrollWidth <= element.clientWidth) return;
          element.scrollLeft += event.deltaY;
          event.preventDefault();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const target = event.target as HTMLElement | null;
          if (target?.closest("button")) return;
          const element = scrollRef.current;
          if (!element || element.scrollWidth <= element.clientWidth) return;
          dragStateRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startScrollLeft: element.scrollLeft,
            dragging: true,
          };
          element.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const element = scrollRef.current;
          const state = dragStateRef.current;
          if (!element || !state.dragging || state.pointerId !== event.pointerId) return;
          element.scrollLeft = state.startScrollLeft - (event.clientX - state.startX);
        }}
        onPointerUp={(event) => {
          const element = scrollRef.current;
          if (element?.hasPointerCapture(event.pointerId)) {
            element.releasePointerCapture(event.pointerId);
          }
          dragStateRef.current.dragging = false;
          dragStateRef.current.pointerId = null;
        }}
        onPointerCancel={(event) => {
          const element = scrollRef.current;
          if (element?.hasPointerCapture(event.pointerId)) {
            element.releasePointerCapture(event.pointerId);
          }
          dragStateRef.current.dragging = false;
          dragStateRef.current.pointerId = null;
        }}
      >
        {attachments.map((attachment, index) => {
          const size =
            typeof (attachment as { size?: unknown }).size === "number"
              ? (attachment as { size: number }).size
              : 0;
          const id = "id" in attachment && typeof attachment.id === "string"
            ? attachment.id
            : `${attachment.name}:${size}:${index}`;
          const isSkill = "kind" in attachment && attachment.kind === "skill";
          const skillAttachment = attachment as PendingPlatformSkill;
          return (
            <div
              key={id}
              className={cn(
                "inline-flex max-w-[260px] shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
                baseTone
              )}
            >
              {isSkill ? (
                <Wrench className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="max-w-[160px] truncate font-medium">{attachment.name}</span>
              {isSkill ? (
                <span className={cn("shrink-0 text-[11px]", metaTone)}>
                  rev.{skillAttachment.revisionNumber}
                </span>
              ) : (
                <span className={cn("shrink-0 text-[11px]", metaTone)}>
                  {formatAttachmentSize(size)}
                </span>
              )}
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
    </div>
  );
}
