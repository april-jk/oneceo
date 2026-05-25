import { useEffect, useMemo, useState } from "react";
import {
  Download,
  FileText,
  Image,
  Link2,
  Loader2,
  MoreHorizontal,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  TaskCreationPlatformSkill,
  TaskCreationUploadedAttachment as UploadedTaskAttachment,
  WorkspaceFile,
} from "@/lib/task-creation-client";
import {
  getWorkspaceFile,
  getWorkspaceRawFileUrl,
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

export type AttachmentPreviewKind = "image" | "text" | "pdf" | "unsupported";

const TEXT_EXTENSIONS = new Set([
  "c",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "go",
  "h",
  "html",
  "java",
  "js",
  "json",
  "jsonl",
  "jsx",
  "kt",
  "log",
  "md",
  "mdx",
  "mjs",
  "py",
  "rb",
  "rs",
  "sh",
  "sql",
  "swift",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
]);

function getAttachmentExtension(attachment: UploadedTaskAttachment) {
  const value = attachment.name || attachment.path || "";
  const match = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(value);
  return match ? match[1].toLowerCase() : "";
}

export function classifyAttachmentPreview(
  attachment: UploadedTaskAttachment,
): AttachmentPreviewKind {
  const mimeType = (attachment.mimeType || "").toLowerCase();
  const extension = getAttachmentExtension(attachment);

  if (mimeType.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (mimeType === "application/pdf" || extension === "pdf") {
    return "pdf";
  }
  if (
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    mimeType.includes("xml") ||
    mimeType.includes("yaml") ||
    mimeType === "application/javascript" ||
    TEXT_EXTENSIONS.has(extension)
  ) {
    return "text";
  }
  return "unsupported";
}

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
  onPreview: (attachment: UploadedTaskAttachment) => void,
) {
  const meta = formatAttachmentMeta(attachment);
  const kind = classifyAttachmentPreview(attachment);
  const iconClass =
    kind === "image"
      ? "text-emerald-600"
      : kind === "pdf"
        ? "text-rose-600"
        : kind === "text"
          ? "text-sky-600"
          : "text-slate-500";
  const Icon = kind === "image" ? Image : FileText;
  return (
    <button
      key={buildAttachmentKey(attachment, index)}
      type="button"
      className="inline-flex h-8 max-w-[15rem] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-left text-xs text-slate-700 shadow-[0_1px_0_rgba(15,23,42,0.04)] transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
      title={attachment.name || attachment.path}
      onClick={() => onPreview(attachment)}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", iconClass)} />
      <span className="min-w-0 truncate font-medium">
        {attachment.name || attachment.path}
      </span>
      {meta ? (
        <span className="shrink-0 text-[11px] text-slate-400">{meta}</span>
      ) : null}
    </button>
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
  sessionId,
  className,
}: MessageAttachmentFilesProps) {
  const { t } = useTranslation();
  const [previewAttachment, setPreviewAttachment] =
    useState<UploadedTaskAttachment | null>(null);
  const [previewFile, setPreviewFile] = useState<WorkspaceFile | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const previewKind = previewAttachment
    ? classifyAttachmentPreview(previewAttachment)
    : "unsupported";
  const previewRawUrl =
    previewAttachment && sessionId
      ? getWorkspaceRawFileUrl(sessionId, previewAttachment.path)
      : "";
  const previewTitle =
    previewAttachment?.name || previewAttachment?.path || "附件预览";
  const previewMeta = previewAttachment
    ? [
        t(`messageAttachmentReference.preview.kind.${previewKind}`),
        formatAttachmentMeta(previewAttachment),
        previewAttachment.mimeType,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  useEffect(() => {
    if (!previewAttachment || !sessionId || previewKind !== "text") {
      setPreviewFile(null);
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewFile(null);
    getWorkspaceFile(sessionId, previewAttachment.path)
      .then((file) => {
        if (cancelled) return;
        setPreviewFile(file);
        if (file.isBinary || file.previewType === "binary") {
          setPreviewError(t("messageAttachmentReference.preview.notText"));
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setPreviewError(
          error instanceof Error
            ? error.message
            : t("messageAttachmentReference.preview.readFailed"),
        );
      })
      .finally(() => {
        if (cancelled) return;
        setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [previewAttachment, previewKind, sessionId, t]);

  const renderedTextContent = useMemo(() => {
    if (
      !previewFile ||
      previewFile.isBinary ||
      previewFile.previewType === "binary"
    ) {
      return "";
    }
    return previewFile.content || "";
  }, [previewFile]);

  if (attachments.length === 0) return null;

  const visibleAttachments = attachments.slice(0, 2);
  const hiddenAttachments = attachments.slice(2);
  const openPreview = (attachment: UploadedTaskAttachment) => {
    setPreviewAttachment(attachment);
  };

  return (
    <>
      <div
        className={cn(
          "flex max-w-full flex-wrap justify-end gap-1.5",
          className,
        )}
      >
        {visibleAttachments.map((attachment, index) =>
          renderAttachmentFile(attachment, index, openPreview),
        )}
        {hiddenAttachments.length ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="group inline-flex h-8 min-w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-600 shadow-[0_1px_0_rgba(15,23,42,0.04)] transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-900"
                aria-label={t("messageAttachmentReference.preview.moreFiles", {
                  count: hiddenAttachments.length,
                })}
              >
                <span className="group-hover:hidden">
                  +{hiddenAttachments.length}
                </span>
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
                  renderAttachmentFile(attachment, index + 2, openPreview),
                )}
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>

      <Dialog
        open={Boolean(previewAttachment)}
        onOpenChange={(open) => {
          if (!open) setPreviewAttachment(null);
        }}
      >
        <DialogContent className="flex max-h-[82vh] max-w-4xl flex-col gap-0 overflow-hidden rounded-xl border-slate-200 p-0">
          <DialogHeader className="border-b border-slate-200 px-5 py-4">
            <DialogTitle className="min-w-0 truncate pr-8 text-base">
              {previewTitle}
            </DialogTitle>
            {previewMeta ? (
              <DialogDescription className="text-xs">
                {previewMeta}
              </DialogDescription>
            ) : null}
          </DialogHeader>

          <div className="min-h-[18rem] overflow-auto bg-slate-50/80 p-4">
            {!sessionId ? (
              <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white text-sm text-slate-500">
                {t("messageAttachmentReference.preview.noSession")}
              </div>
            ) : previewKind === "image" ? (
              <div className="flex min-h-[18rem] items-center justify-center rounded-lg border border-slate-200 bg-white p-3">
                <img
                  src={previewRawUrl}
                  alt={previewTitle}
                  className="max-h-[62vh] max-w-full rounded-md object-contain"
                />
              </div>
            ) : previewKind === "pdf" ? (
              <iframe
                title={previewTitle}
                src={previewRawUrl}
                className="h-[62vh] w-full rounded-lg border border-slate-200 bg-white"
              />
            ) : previewKind === "text" ? (
              <div className="rounded-lg border border-slate-200 bg-slate-950 text-slate-100">
                {previewLoading ? (
                  <div className="flex h-64 items-center justify-center gap-2 text-sm text-slate-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("messageAttachmentReference.preview.loading")}
                  </div>
                ) : previewError ? (
                  <div className="flex h-64 items-center justify-center px-6 text-center text-sm text-rose-200">
                    {previewError}
                  </div>
                ) : (
                  <pre className="max-h-[62vh] overflow-auto whitespace-pre-wrap break-words p-4 text-xs leading-5">
                    {renderedTextContent}
                    {previewFile?.truncated
                      ? `\n\n${t("messageAttachmentReference.preview.truncated")}`
                      : ""}
                  </pre>
                )}
              </div>
            ) : (
              <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-200 bg-white px-6 text-center">
                <FileText className="h-9 w-9 text-slate-400" />
                <div>
                  <div className="text-sm font-medium text-slate-800">
                    {t("messageAttachmentReference.preview.unsupportedTitle")}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {t(
                      "messageAttachmentReference.preview.unsupportedDescription",
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {sessionId && previewRawUrl ? (
            <div className="flex justify-end border-t border-slate-200 bg-white px-5 py-3">
              <a
                href={previewRawUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                {t("messageAttachmentReference.preview.openOriginal")}
              </a>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
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
