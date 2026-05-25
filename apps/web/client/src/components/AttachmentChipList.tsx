import { useEffect, useRef, useState } from "react";
import { FileText, Image, Loader2, Wrench, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import type {
  PendingAttachment,
  PendingPlatformSkill,
  PendingUploadedAttachment,
} from "@/lib/task-attachments";
import type { TaskCreationUploadedAttachment as UploadedTaskAttachment } from "@/lib/task-creation-client";
import { formatAttachmentSize } from "@/lib/task-attachments";
import { getSkillDisplayName } from "@/lib/skill-display-name";
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
  uploadingIds?: Iterable<string>;
  className?: string;
};

type AttachmentListItem = AttachmentChipListProps["attachments"][number];

function getAttachmentItemId(attachment: AttachmentListItem, index: number) {
  const size =
    typeof (attachment as { size?: unknown }).size === "number"
      ? (attachment as { size: number }).size
      : 0;
  return "id" in attachment && typeof attachment.id === "string"
    ? attachment.id
    : `${attachment.name}:${size}:${index}`;
}

function isPendingFileAttachment(
  attachment: AttachmentListItem,
): attachment is PendingUploadedAttachment {
  return "kind" in attachment && attachment.kind === "file";
}

export default function AttachmentChipList({
  attachments,
  onRemove,
  tone = "default",
  uploadingIds,
  className,
}: AttachmentChipListProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<
    Record<string, string>
  >({});
  const uploadingIdSet = new Set(uploadingIds || []);
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

  useEffect(() => {
    const nextUrls: Record<string, string> = {};
    attachments.forEach((attachment, index) => {
      if (
        isPendingFileAttachment(attachment) &&
        attachment.type.startsWith("image/")
      ) {
        nextUrls[getAttachmentItemId(attachment, index)] = URL.createObjectURL(
          attachment.file,
        );
      }
    });
    setImagePreviewUrls(nextUrls);
    return () => {
      Object.values(nextUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [attachments]);

  if (!attachments.length) return null;

  const baseTone =
    tone === "inverse"
      ? "border-white/15 bg-white/10 text-white/90"
      : "border-border/70 bg-muted/45 text-foreground";
  const metaTone =
    tone === "inverse" ? "text-white/60" : "text-muted-foreground";
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
          "active:cursor-grabbing",
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
          if (
            !element ||
            !state.dragging ||
            state.pointerId !== event.pointerId
          )
            return;
          element.scrollLeft =
            state.startScrollLeft - (event.clientX - state.startX);
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
          const id = getAttachmentItemId(attachment, index);
          const isSkill = "kind" in attachment && attachment.kind === "skill";
          const isFile = "kind" in attachment && attachment.kind === "file";
          const skillAttachment = attachment as PendingPlatformSkill;
          const imagePreviewUrl = isFile ? imagePreviewUrls[id] : "";
          const isUploading = uploadingIdSet.has(id);

          if (isFile) {
            return (
              <div
                key={id}
                className={cn(
                  "group relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border bg-background shadow-sm transition-all duration-500",
                  tone === "inverse" ? "border-white/15" : "border-border/80",
                  isUploading
                    ? "scale-[0.98] opacity-70 brightness-75"
                    : "opacity-100 brightness-100",
                )}
                title={`${attachment.name} · ${formatAttachmentSize(size)}`}
              >
                {imagePreviewUrl ? (
                  <img
                    src={imagePreviewUrl}
                    alt={attachment.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-muted/60 text-muted-foreground">
                    <FileText className="h-5 w-5" />
                    <span className="max-w-[3rem] truncate text-[10px] font-medium">
                      {attachment.name.split(".").pop()?.toUpperCase() ||
                        t(
                          "messageAttachmentReference.preview.kind.unsupported",
                        )}
                    </span>
                  </div>
                )}

                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/70 to-transparent px-1.5 pb-1 pt-5">
                  <div className="truncate text-[10px] font-semibold text-white">
                    {attachment.name}
                  </div>
                </div>

                {isUploading ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/35 backdrop-brightness-110 transition-opacity">
                    <Loader2 className="h-4 w-4 animate-spin text-slate-700" />
                  </div>
                ) : null}

                {onRemove && !isUploading ? (
                  <button
                    type="button"
                    className="absolute right-1 top-1 rounded-full bg-slate-950/70 p-0.5 text-white opacity-0 transition-opacity hover:bg-slate-950 group-hover:opacity-100"
                    onClick={() => onRemove(id)}
                    aria-label={t("attachments.removeAttachment", {
                      name: attachment.name,
                    })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}

                {imagePreviewUrl ? (
                  <Image className="absolute left-1 top-1 h-3 w-3 text-white/85" />
                ) : (
                  <FileText className="absolute left-1 top-1 h-3 w-3 text-white/85" />
                )}
              </div>
            );
          }

          return (
            <div
              key={id}
              className={cn(
                "inline-flex max-w-[260px] shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
                baseTone,
              )}
            >
              {isSkill ? (
                <Wrench className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="max-w-[160px] truncate font-medium">
                {isSkill
                  ? getSkillDisplayName(skillAttachment)
                  : attachment.name}
              </span>
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
                  className={cn(
                    "rounded-full p-0.5 transition-colors",
                    removeTone,
                  )}
                  onClick={() => onRemove(id)}
                  aria-label={t("attachments.removeAttachment", {
                    name: attachment.name,
                  })}
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
