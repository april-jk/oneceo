import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getWorkspaceFile,
  getWorkspaceRawFileUrl,
  type WorkspaceFile,
} from "@/lib/task-creation-client";
import { cn } from "@/lib/utils";
import {
  Code2,
  ExternalLink,
  Loader2,
  Monitor,
  Rocket,
} from "lucide-react";

export type AltusArtifactFile = {
  path: string;
  previewType: "web" | "code";
};

type AltusArtifactPreviewCardProps = {
  sessionId: string;
  artifacts: AltusArtifactFile[];
  displayMode?: "artifact-browser" | "web-preview";
  onOpenViewer?: (path: string) => void;
  onDeployRequested?: (path: string) => Promise<void> | void;
};

function getFilename(path: string): string {
  const normalized = String(path || "").replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function isWebArtifact(path: string): boolean {
  return /\.(html?)$/i.test(path);
}

export default function AltusArtifactPreviewCard({
  sessionId,
  artifacts,
  displayMode = "artifact-browser",
  onOpenViewer,
  onDeployRequested,
}: AltusArtifactPreviewCardProps) {
  const normalizedArtifacts = useMemo(() => {
    const unique = new Map<string, AltusArtifactFile>();
    for (const artifact of artifacts) {
      const normalizedPath = String(artifact.path || "").trim().replace(/\\/g, "/");
      if (!normalizedPath) continue;
      if (!unique.has(normalizedPath)) {
        unique.set(normalizedPath, {
          path: normalizedPath,
          previewType: artifact.previewType,
        });
      }
    }
    return Array.from(unique.values());
  }, [artifacts]);

  const visibleArtifacts = useMemo(() => {
    if (displayMode === "web-preview") {
      return normalizedArtifacts.filter((artifact) => isWebArtifact(artifact.path));
    }
    return normalizedArtifacts;
  }, [displayMode, normalizedArtifacts]);

  const defaultPath =
    visibleArtifacts.find((artifact) => isWebArtifact(artifact.path))?.path ||
    visibleArtifacts[0]?.path ||
    "";
  const defaultTab = visibleArtifacts.some((artifact) => isWebArtifact(artifact.path))
    ? "preview"
    : "code";
  const [selectedPath, setSelectedPath] = useState(defaultPath);
  const [activeTab, setActiveTab] = useState<"preview" | "code">(defaultTab);
  const [codeFile, setCodeFile] = useState<WorkspaceFile | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);

  useEffect(() => {
    setSelectedPath(defaultPath);
    setActiveTab(defaultTab);
  }, [defaultPath, defaultTab]);

  useEffect(() => {
    if (activeTab !== "code" || !selectedPath) {
      return;
    }
    let cancelled = false;
    setCodeLoading(true);
    setCodeError(null);
    setCodeFile(null);
    getWorkspaceFile(sessionId, selectedPath)
      .then((file) => {
        if (cancelled) return;
        setCodeFile(file);
      })
      .catch((error) => {
        if (cancelled) return;
        setCodeFile(null);
        setCodeError(error instanceof Error ? error.message : "读取文件失败");
      })
      .finally(() => {
        if (cancelled) return;
        setCodeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedPath, sessionId]);

  const selectedArtifact =
    visibleArtifacts.find((artifact) => artifact.path === selectedPath) ||
    visibleArtifacts[0] ||
    null;
  const previewPath =
    selectedArtifact && isWebArtifact(selectedArtifact.path)
      ? selectedArtifact.path
      : "";
  const rawPreviewUrl = previewPath ? getWorkspaceRawFileUrl(sessionId, previewPath) : "";
  const rawSelectedUrl = selectedArtifact
    ? getWorkspaceRawFileUrl(sessionId, selectedArtifact.path)
    : "";
  const selectedIsWebArtifact = Boolean(
    selectedArtifact && isWebArtifact(selectedArtifact.path),
  );
  const hasPreviewTab = Boolean(previewPath);
  const frameClass = selectedIsWebArtifact
    ? "group relative w-full overflow-hidden rounded-xl border bg-card pt-10 min-h-[240px] sm:h-[400px] max-h-[640px]"
    : "group relative w-full overflow-hidden rounded-xl border bg-card pt-10 min-h-[320px]";

  const handleDeploy = async () => {
    if (!selectedArtifact || !onDeployRequested || deploying) {
      return;
    }
    try {
      setDeploying(true);
      await Promise.resolve(onDeployRequested(selectedArtifact.path));
    } finally {
      setDeploying(false);
    }
  };

  if (visibleArtifacts.length === 0) {
    return null;
  }

  return (
    <div className="w-full">
      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <span>Task complete</span>
          <span className="text-xs">
            ({visibleArtifacts.length} file{visibleArtifacts.length === 1 ? "" : "s"})
          </span>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-3 isolate">
            <div className="relative group overflow-visible w-full">
              <div className={frameClass}>
                <div className="absolute top-0 left-0 right-0 z-10 flex h-10 items-center justify-between border-b bg-accent px-3">
                  <div className="min-w-0 text-sm font-medium truncate">
                    {getFilename(selectedArtifact?.path || previewPath || "artifact")}
                  </div>
                  {selectedArtifact && onDeployRequested ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full"
                      onClick={() => void handleDeploy()}
                      disabled={deploying}
                      title="Deploy website"
                    >
                      {deploying ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Rocket className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  ) : selectedArtifact && onOpenViewer ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full"
                      onClick={() => onOpenViewer(selectedArtifact.path)}
                      title="Open in viewer"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <div className="text-[11px] font-medium text-muted-foreground">
                      {selectedIsWebArtifact ? "Web Preview" : "Source Code"}
                    </div>
                  )}
                </div>

                <Tabs
                  value={activeTab}
                  onValueChange={(value) => setActiveTab(value as "preview" | "code")}
                  className="h-full w-full gap-0"
                >
                  <div className="absolute left-2 top-2 z-10 flex items-center gap-2">
                    <TabsList className="h-8 gap-1 rounded-2xl bg-background/85 px-1 backdrop-blur-sm">
                      {hasPreviewTab ? (
                        <TabsTrigger
                          value="preview"
                          className="h-6 rounded-xl px-3 text-xs"
                        >
                          <Monitor className="h-3.5 w-3.5" />
                          Preview
                        </TabsTrigger>
                      ) : null}
                      <TabsTrigger value="code" className="h-6 rounded-xl px-3 text-xs">
                        <Code2 className="h-3.5 w-3.5" />
                        Code
                      </TabsTrigger>
                    </TabsList>
                    {rawSelectedUrl ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-2xl border-border/70 bg-background/80 text-xs backdrop-blur-sm"
                        onClick={() => window.open(rawSelectedUrl, "_blank", "noopener,noreferrer")}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open
                      </Button>
                    ) : null}
                  </div>

                  <TabsContent value="preview" className="relative h-full data-[state=inactive]:hidden">
                    {previewPath ? (
                      <div className="absolute inset-0">
                        <iframe
                          src={rawPreviewUrl}
                          title={`${getFilename(previewPath)} preview`}
                          className="absolute inset-0 h-full w-full border-0"
                          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
                          style={{ background: "white" }}
                        />
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-muted/20 px-6 text-center text-sm text-muted-foreground">
                        当前产物里没有可直接预览的 HTML 页面，请切换到 Code 查看文件内容。
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="code" className="relative h-full data-[state=inactive]:hidden">
                    <div
                      className={cn(
                        "overflow-auto bg-slate-950 px-4 py-4 text-slate-100",
                        selectedIsWebArtifact ? "absolute inset-0" : "min-h-[320px]",
                      )}
                    >
                      {codeLoading ? (
                        <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-slate-300">
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          正在加载文件内容
                        </div>
                      ) : codeError ? (
                        <div className="flex h-full min-h-[220px] items-center justify-center px-6 text-center text-sm text-rose-300">
                          {codeError}
                        </div>
                      ) : (
                        <pre className="min-h-[220px] whitespace-pre-wrap break-all font-mono text-xs leading-6">
                          {codeFile?.content || "暂无内容"}
                        </pre>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </div>

            {visibleArtifacts.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                {visibleArtifacts.map((artifact) => {
                  const active = artifact.path === (selectedArtifact?.path || previewPath);
                  return (
                    <button
                      key={artifact.path}
                      type="button"
                      onClick={() => {
                        setSelectedPath(artifact.path);
                        if (isWebArtifact(artifact.path)) {
                          setActiveTab("preview");
                          return;
                        }
                        setActiveTab("code");
                      }}
                      className={cn(
                        "inline-flex max-w-full items-center rounded-full border px-3 py-1 text-xs transition",
                        active
                          ? "border-foreground/15 bg-foreground text-background"
                          : "border-border/70 bg-card text-foreground/80 hover:bg-muted/50"
                      )}
                    >
                      <span className="truncate">{artifact.path}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
