import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  downloadTaskCreationDeliverable,
  type TaskCreationDeliverableArtifact,
} from "@/lib/task-creation-client";
import { Download, FileArchive, FileSpreadsheet, FileText, Loader2, Presentation } from "lucide-react";
import { toast } from "sonner";

type TaskDeliverableCardProps = {
  sessionId: string;
  deliverables: TaskCreationDeliverableArtifact[];
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

function getFileIcon(fileName: string, mimeType: string) {
  const normalized = `${fileName} ${mimeType}`.toLowerCase();
  if (normalized.includes(".ppt") || normalized.includes("presentation")) {
    return Presentation;
  }
  if (normalized.includes(".xls") || normalized.includes("spreadsheet") || normalized.includes("excel")) {
    return FileSpreadsheet;
  }
  if (normalized.includes(".zip")) {
    return FileArchive;
  }
  return FileText;
}

export default function TaskDeliverableCard({
  sessionId,
  deliverables,
}: TaskDeliverableCardProps) {
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
    <div className="mt-4 rounded-2xl border border-border/70 bg-card/90 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">Task complete</div>
          <div className="text-xs text-muted-foreground">
            已生成 {normalizedDeliverables.length} 个最终交付物
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {normalizedDeliverables.map((deliverable) => {
          const Icon = getFileIcon(deliverable.name, deliverable.mimeType);
          const isDownloading = downloadingId === deliverable.id;
          return (
            <div
              key={deliverable.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/70 px-3 py-3"
            >
              <div className="min-w-0 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {deliverable.name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {deliverable.path}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {deliverable.mimeType} · {formatSize(deliverable.size)}
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isDownloading}
                onClick={() => {
                  setDownloadingId(deliverable.id);
                  void downloadTaskCreationDeliverable(sessionId, deliverable)
                    .catch((error) => {
                      console.error("deliverable download failed", error);
                      toast.error(
                        error instanceof Error ? error.message : "下载交付物失败",
                      );
                    })
                    .finally(() => {
                      setDownloadingId((current) =>
                        current === deliverable.id ? null : current,
                      );
                    });
                }}
              >
                {isDownloading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                下载
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
