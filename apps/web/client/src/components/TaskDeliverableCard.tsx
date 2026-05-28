import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  downloadTaskCreationDeliverable,
  type TaskCreationDeliverableArtifact,
} from "@/lib/task-creation-client";
import {
  Check,
  Download,
  FileArchive,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Loader2,
  Presentation,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type TaskDeliverableCardProps = {
  sessionId: string;
  deliverables: TaskCreationDeliverableArtifact[];
  onOpenFiles?: () => void;
};

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function getFileExtension(fileName: string, mimeType: string) {
  const normalized = `${fileName} ${mimeType}`.toLowerCase();
  const extension = fileName.includes(".")
    ? fileName.split(".").pop()?.trim().toUpperCase()
    : "";
  if (extension) return extension;
  if (normalized.includes("pdf")) return "PDF";
  if (normalized.includes("word")) return "DOCX";
  if (normalized.includes("spreadsheet") || normalized.includes("excel"))
    return "XLSX";
  if (normalized.includes("presentation")) return "PPTX";
  if (normalized.includes("zip")) return "ZIP";
  if (normalized.includes("markdown")) return "MD";
  return "FILE";
}

function getFileVisual(fileName: string, mimeType: string) {
  const normalized = `${fileName} ${mimeType}`.toLowerCase();
  if (normalized.includes(".ppt") || normalized.includes("presentation")) {
    return {
      Icon: Presentation,
      iconClass: "bg-amber-50 text-amber-700 ring-amber-200/70",
    };
  }
  if (
    normalized.includes(".xls") ||
    normalized.includes("spreadsheet") ||
    normalized.includes("excel")
  ) {
    return {
      Icon: FileSpreadsheet,
      iconClass: "bg-emerald-50 text-emerald-700 ring-emerald-200/70",
    };
  }
  if (normalized.includes(".zip")) {
    return {
      Icon: FileArchive,
      iconClass: "bg-slate-100 text-slate-700 ring-slate-200",
    };
  }
  if (normalized.includes(".pdf") || normalized.includes("pdf")) {
    return {
      Icon: FileText,
      iconClass: "bg-red-50 text-red-600 ring-red-200/70",
    };
  }
  return {
    Icon: FileText,
    iconClass: "bg-blue-50 text-blue-600 ring-blue-200/70",
  };
}

export default function TaskDeliverableCard({
  sessionId,
  deliverables,
  onOpenFiles,
}: TaskDeliverableCardProps) {
  const { t } = useTranslation();
  const normalizedDeliverables = useMemo(() => {
    const unique = new Map<string, TaskCreationDeliverableArtifact>();
    for (const item of deliverables) {
      const id = String(item.id || "").trim();
      const name = String(item.name || "").trim();
      if (!id || !name || unique.has(id)) continue;
      unique.set(id, item);
    }
    return Array.from(unique.values());
  }, [deliverables]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  if (!normalizedDeliverables.length) {
    return null;
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="grid max-w-[46rem] grid-cols-1 gap-2 sm:grid-cols-2">
        {normalizedDeliverables.map((deliverable) => {
          const { Icon, iconClass } = getFileVisual(
            deliverable.name,
            deliverable.mimeType,
          );
          const isDownloading = downloadingId === deliverable.id;
          const extension = getFileExtension(
            deliverable.name,
            deliverable.mimeType,
          );
          const meta = `${extension} · ${formatSize(deliverable.size)}`;
          const downloadDeliverable = () => {
            setDownloadingId(deliverable.id);
            void downloadTaskCreationDeliverable(sessionId, deliverable)
              .catch((error) => {
                console.error("deliverable download failed", error);
                toast.error(
                  error instanceof Error
                    ? error.message
                    : t("taskDeliverables.downloadFailed"),
                );
              })
              .finally(() => {
                setDownloadingId((current) =>
                  current === deliverable.id ? null : current,
                );
              });
          };

          return (
            <button
              key={deliverable.id}
              type="button"
              disabled={isDownloading}
              onClick={downloadDeliverable}
              aria-label={`${t("taskDeliverables.download")} ${deliverable.name}`}
              className="group flex min-h-[68px] min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-left shadow-[0_1px_0_rgba(15,23,42,0.04)] transition-colors hover:border-slate-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
              title={`${deliverable.name} · ${deliverable.path}`}
            >
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1",
                  iconClass,
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold leading-5 text-slate-900">
                  {deliverable.name}
                </span>
                <span className="block truncate text-[12px] font-medium leading-4 text-slate-500">
                  {meta}
                </span>
              </span>
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors group-hover:bg-slate-100 group-hover:text-slate-700"
                aria-hidden="true"
              >
                {isDownloading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex max-w-[46rem] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {onOpenFiles ? (
          <Button
            type="button"
            variant="outline"
            className="h-[44px] justify-center gap-2 rounded-xl border-slate-200 bg-slate-50/70 px-4 text-sm font-semibold text-slate-800 shadow-none hover:border-slate-300 hover:bg-white sm:min-w-[21.75rem]"
            onClick={onOpenFiles}
          >
            <FolderOpen className="h-4 w-4 text-slate-700" />
            {t("taskDeliverables.viewAllFiles")}
          </Button>
        ) : null}

        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
          <Check className="h-4 w-4" />
          <span>{t("taskDeliverables.title")}</span>
          <span className="text-xs font-medium text-slate-500">
            {t("taskDeliverables.generatedCount", {
              count: normalizedDeliverables.length,
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
