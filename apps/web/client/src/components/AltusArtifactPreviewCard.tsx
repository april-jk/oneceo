import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getTaskCreationBrowserActionScreenshotUrl,
  getWorkspaceFile,
  getTaskCreationDeploymentInfo,
  getTaskCreationPreviewSnapshotUrl,
  getWorkspaceRawFileUrl,
  startTaskCreationRuntime,
  type TaskCreationDeploymentInfo,
  type TaskCreationWebsitePreviewSnapshot,
  type WorkspaceFile,
} from "@/lib/task-creation-client";
import { cn } from "@/lib/utils";
import i18n from "@/i18n";
import {
  appendPreviewCacheBust,
  checkWorkspaceHtmlPreviewReady,
  waitWorkspaceHtmlPreviewReady,
  type WorkspaceHtmlPreviewState,
} from "@/lib/workspace-preview";
import { normalizeWorkspaceRelativePath } from "@/lib/workspace-path";
import {
  AlertTriangle,
  Code2,
  ExternalLink,
  Loader2,
  Monitor,
  Rocket,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AltusReplayBrowserScreenshot } from "./AltusRunReplayDrawer";

export type AltusArtifactFile = {
  path: string;
  previewType: "web" | "code";
};

export type AltusArtifactPreviewDisplayMode = "artifact-browser" | "web-preview";

export type AltusArtifactOpenTarget =
  | { kind: "remote-debug" }
  | { kind: "file-url"; url: string }
  | null;

type AltusArtifactPreviewCardProps = {
  sessionId: string;
  runId?: string;
  artifacts: AltusArtifactFile[];
  previewSnapshot?: TaskCreationWebsitePreviewSnapshot | null;
  browserScreenshotFallback?: {
    toolCallId: string;
    screenshot: AltusReplayBrowserScreenshot;
  } | null;
  displayMode?: AltusArtifactPreviewDisplayMode;
  onOpenViewer?: (path: string) => void;
  onOpenRemoteDebug?: () => void;
  onDeployRequested?: (path: string) => Promise<void> | void;
  runtimeSwitchBlocked?: boolean;
};

const WEB_PREVIEW_DESIGN_WIDTH = 1280;
const WEB_PREVIEW_DEFAULT_HEIGHT = 720;

export function getScaledWebPreviewFrame(
  containerWidth: number,
  containerHeight: number,
) {
  if (containerWidth <= 0 || containerHeight <= 0) {
    return {
      width: WEB_PREVIEW_DESIGN_WIDTH,
      height: WEB_PREVIEW_DEFAULT_HEIGHT,
      scale: 1,
    };
  }
  const scale = Math.min(containerWidth / WEB_PREVIEW_DESIGN_WIDTH, 1);
  return {
    width: Math.ceil(containerWidth / scale),
    height: Math.ceil(containerHeight / scale),
    scale,
  };
}

function getFilename(path: string): string {
  const normalized = String(path || "").replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function isWebArtifact(path: string): boolean {
  return /\.(html?)$/i.test(path);
}

export function shouldShowArtifactSourceControls(
  displayMode: AltusArtifactPreviewDisplayMode,
) {
  return displayMode !== "web-preview";
}

export function resolveArtifactOpenTarget({
  displayMode,
  remoteDebugAvailable,
  selectedFileOpenUrl,
}: {
  displayMode: AltusArtifactPreviewDisplayMode;
  remoteDebugAvailable: boolean;
  selectedFileOpenUrl: string;
}): AltusArtifactOpenTarget {
  if (displayMode === "web-preview") {
    return remoteDebugAvailable ? { kind: "remote-debug" } : null;
  }
  const url = selectedFileOpenUrl.trim();
  return url ? { kind: "file-url", url } : null;
}

export function resolveArtifactDeploymentPreviewUrl(
  info: TaskCreationDeploymentInfo | null | undefined,
): string {
  if (!info) return "";
  const selectedDeployment =
    info.deployments.find((deployment) => deployment.id === info.deploymentId) || null;
  const successfulDeployment =
    info.deployments.find(
      (deployment) =>
        deployment.status === "SUCCESS" && Boolean(deployment.staticUrl || deployment.url),
    ) || null;
  return (
    selectedDeployment?.staticUrl ||
    selectedDeployment?.url ||
    successfulDeployment?.staticUrl ||
    successfulDeployment?.url ||
    info.latestStaticUrl ||
    info.latestUrl ||
    info.domains[0] ||
    ""
  );
}

export type WebsitePreviewSnapshotIssue = {
  reasonCode?: string;
  message: string;
  visualStatus?: "failed";
  status?: string;
};

function stripReasonPrefix(message: string, reasonCode?: string) {
  if (!message || !reasonCode) return message;
  const prefix = `${reasonCode}:`;
  return message.startsWith(prefix) ? message.slice(prefix.length).trim() : message;
}

export function getWebsitePreviewSnapshotIssue(
  snapshot: TaskCreationWebsitePreviewSnapshot | null | undefined,
  options: { imageFailed?: boolean; hasPreviewPath?: boolean } = {},
): WebsitePreviewSnapshotIssue | null {
  if (snapshot?.kind !== "website_screenshot") return null;
  const visualFailed = snapshot.visualCheck?.status === "failed";
  const capturedWithoutImage =
    snapshot.status === "captured" && (!snapshot.storageKey || options.imageFailed);
  const unavailableWithoutFallback =
    snapshot.status === "capture_unavailable" && !options.hasPreviewPath;
  const failed =
    snapshot.status === "capture_failed" ||
    snapshot.status === "storage_failed" ||
    visualFailed ||
    capturedWithoutImage ||
    unavailableWithoutFallback;
  if (!failed) return null;

  const reasonCode =
    snapshot.visualCheck?.reasonCode ||
    snapshot.reasonCode ||
    (options.imageFailed ? "snapshot_image_load_failed" : undefined);
  const message = stripReasonPrefix(
    snapshot.visualCheck?.message ||
      snapshot.message ||
      i18n.t("previewPanel.artifactPreview.websiteSnapshotUnavailable"),
    reasonCode,
  );
  return {
    reasonCode,
    message,
    visualStatus: visualFailed ? "failed" : undefined,
    status: snapshot.status,
  };
}

function ScaledWebPreviewFrame({
  src,
  title,
  sandbox,
}: {
  src: string;
  title: string;
  sandbox?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({
    width: 0,
    height: 0,
  });
  const frame = getScaledWebPreviewFrame(
    containerSize.width,
    containerSize.height,
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      const nextSize = {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      setContainerSize((current) => {
        if (
          current.width === nextSize.width &&
          current.height === nextSize.height
        ) {
          return current;
        }
        return nextSize;
      });
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden bg-white">
      <iframe
        src={src}
        title={title}
        className="absolute left-0 top-0 max-w-none border-0"
        sandbox={sandbox}
        scrolling="no"
        style={{
          width: `${frame.width}px`,
          height: `${frame.height}px`,
          transform: `scale(${frame.scale})`,
          transformOrigin: "top left",
          background: "white",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

export default function AltusArtifactPreviewCard({
  sessionId,
  runId,
  artifacts,
  previewSnapshot,
  browserScreenshotFallback,
  displayMode = "artifact-browser",
  onOpenViewer,
  onOpenRemoteDebug,
  onDeployRequested,
  runtimeSwitchBlocked = false,
}: AltusArtifactPreviewCardProps) {
  useTranslation();
  const normalizedArtifacts = useMemo(() => {
    const unique = new Map<string, AltusArtifactFile>();
    for (const artifact of artifacts) {
      const normalizedPath = normalizeWorkspaceRelativePath(
        artifact.path || "",
        sessionId,
      );
      if (!normalizedPath) continue;
      if (!unique.has(normalizedPath)) {
        unique.set(normalizedPath, {
          path: normalizedPath,
          previewType: artifact.previewType,
        });
      }
    }
    return Array.from(unique.values());
  }, [artifacts, sessionId]);

  const visibleArtifacts = useMemo(() => {
    if (displayMode === "web-preview") {
      return normalizedArtifacts.filter((artifact) => isWebArtifact(artifact.path));
    }
    return normalizedArtifacts;
  }, [displayMode, normalizedArtifacts]);
  const hasSnapshotMetadata = Boolean(
    previewSnapshot?.kind === "website_screenshot" || browserScreenshotFallback?.screenshot,
  );

  const defaultPath =
    visibleArtifacts.find((artifact) => isWebArtifact(artifact.path))?.path ||
    visibleArtifacts[0]?.path ||
    "";
  const defaultTab = visibleArtifacts.some((artifact) => isWebArtifact(artifact.path)) || hasSnapshotMetadata
    ? "preview"
    : "code";
  const [selectedPath, setSelectedPath] = useState(defaultPath);
  const [activeTab, setActiveTab] = useState<"preview" | "code">(defaultTab);
  const [codeFile, setCodeFile] = useState<WorkspaceFile | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deploymentPreviewUrl, setDeploymentPreviewUrl] = useState("");
  const [webPreviewState, setWebPreviewState] = useState<WorkspaceHtmlPreviewState>("checking");
  const [webPreviewMessage, setWebPreviewMessage] = useState("");
  const [webPreviewReloading, setWebPreviewReloading] = useState(false);
  const [webPreviewNonce, setWebPreviewNonce] = useState(0);
  const [snapshotImageFailed, setSnapshotImageFailed] = useState(false);

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
        setCodeError(
          error instanceof Error ? error.message : i18n.t("homeWorkspace.readFileFailed"),
        );
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
  const webDeliveryMode = displayMode === "web-preview";
  const showSourceControls = shouldShowArtifactSourceControls(displayMode);
  const effectiveRawPreviewUrl = appendPreviewCacheBust(rawPreviewUrl, webPreviewNonce);
  const effectiveRawSelectedUrl = appendPreviewCacheBust(rawSelectedUrl, webPreviewNonce);
  const selectedPreviewUrl = selectedIsWebArtifact
    ? deploymentPreviewUrl || effectiveRawPreviewUrl
    : "";
  const selectedFileOpenUrl = showSourceControls
    ? selectedIsWebArtifact
      ? deploymentPreviewUrl || effectiveRawSelectedUrl
      : effectiveRawSelectedUrl
    : "";
  const openTarget = resolveArtifactOpenTarget({
    displayMode,
    remoteDebugAvailable: Boolean(onOpenRemoteDebug),
    selectedFileOpenUrl,
  });
  const canOpenArtifact = Boolean(openTarget);
  const fallbackScreenshot = browserScreenshotFallback?.screenshot || null;
  const hasPassedFallbackScreenshot = Boolean(
    runId &&
      browserScreenshotFallback?.toolCallId &&
      fallbackScreenshot?.status === "captured" &&
      fallbackScreenshot?.storageKey &&
      fallbackScreenshot?.visualCheck?.status === "passed",
  );
  const fallbackSnapshotUrl =
    hasPassedFallbackScreenshot && runId && browserScreenshotFallback?.toolCallId
      ? getTaskCreationBrowserActionScreenshotUrl(
          sessionId,
          runId,
          browserScreenshotFallback.toolCallId,
        )
      : "";
  const snapshotHasCapturedMetadata = Boolean(
    runId &&
      previewSnapshot?.kind === "website_screenshot" &&
      previewSnapshot.status === "captured" &&
      previewSnapshot.visualCheck?.status !== "failed",
  );
  const baseSnapshotCaptured = Boolean(snapshotHasCapturedMetadata && previewSnapshot?.storageKey);
  const snapshotIssue = getWebsitePreviewSnapshotIssue(previewSnapshot, {
    imageFailed: snapshotImageFailed && baseSnapshotCaptured,
    hasPreviewPath: Boolean(previewPath),
  });
  const snapshotCaptured = Boolean(!snapshotIssue && baseSnapshotCaptured && !snapshotImageFailed);
  const fallbackScreenshotCaptured = Boolean(
    !snapshotCaptured && hasPassedFallbackScreenshot && fallbackSnapshotUrl && !snapshotImageFailed,
  );
  const snapshotUnavailableForComplexWeb = Boolean(snapshotIssue && !fallbackScreenshotCaptured);
  const snapshotUrl =
    snapshotCaptured && runId
      ? getTaskCreationPreviewSnapshotUrl(sessionId, runId)
      : fallbackScreenshotCaptured
        ? fallbackSnapshotUrl
        : "";
  const hasPreviewTab = Boolean(previewPath || hasSnapshotMetadata);
  const previewCheckEnabled = Boolean(
    activeTab === "preview" &&
      previewPath &&
      !deploymentPreviewUrl &&
      !snapshotCaptured &&
      !snapshotUnavailableForComplexWeb,
  );
  const frameClass = cn(
    "group relative w-full overflow-hidden rounded-xl border bg-card pt-10",
    snapshotUnavailableForComplexWeb && activeTab === "preview"
      ? "min-h-[230px]"
      : selectedIsWebArtifact || hasSnapshotMetadata
        ? "min-h-[240px] sm:h-[400px] max-h-[640px]"
        : "min-h-[320px]",
  );
  const headerLabel = snapshotIssue
    ? visibleArtifacts.length > 0
      ? i18n.t("previewPanel.artifactPreview.artifactGenerated")
      : i18n.t("previewPanel.artifactPreview.websiteSnapshotIssueTitle")
    : i18n.t("previewPanel.artifactPreview.taskComplete");

  useEffect(() => {
    setSnapshotImageFailed(false);
  }, [previewSnapshot?.storageKey, runId]);

  useEffect(() => {
    if (!visibleArtifacts.some((artifact) => isWebArtifact(artifact.path))) {
      setDeploymentPreviewUrl("");
      return;
    }
    if (runtimeSwitchBlocked) {
      setDeploymentPreviewUrl("");
      return;
    }
    let cancelled = false;
    getTaskCreationDeploymentInfo(sessionId)
      .then((info) => {
        if (cancelled) return;
        setDeploymentPreviewUrl(resolveArtifactDeploymentPreviewUrl(info));
      })
      .catch(() => {
        if (cancelled) return;
        setDeploymentPreviewUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [runtimeSwitchBlocked, sessionId, visibleArtifacts]);

  useEffect(() => {
    if (snapshotCaptured || fallbackScreenshotCaptured || snapshotUnavailableForComplexWeb) {
      setWebPreviewState("ready");
      setWebPreviewMessage("");
      return;
    }
    if (deploymentPreviewUrl) {
      setWebPreviewState("ready");
      setWebPreviewMessage("");
      return;
    }
    setWebPreviewState("checking");
    setWebPreviewMessage("");
    setWebPreviewNonce(Date.now());
  }, [
    deploymentPreviewUrl,
    previewPath,
    fallbackScreenshotCaptured,
    snapshotCaptured,
    snapshotUnavailableForComplexWeb,
  ]);

  useEffect(() => {
    if (!previewCheckEnabled || !previewPath) {
      return;
    }
    let cancelled = false;
    setWebPreviewState("checking");
    setWebPreviewMessage("");
    void checkWorkspaceHtmlPreviewReady(sessionId, previewPath).then((mapped) => {
      if (cancelled) return;
      setWebPreviewState(mapped.state);
      setWebPreviewMessage(mapped.message);
    });
    return () => {
      cancelled = true;
    };
  }, [previewCheckEnabled, previewPath, sessionId]);

  const reloadWebPreview = async () => {
    if (!previewPath || webPreviewReloading) {
      return;
    }
    if (runtimeSwitchBlocked) {
      setWebPreviewState("fetch_failed");
      setWebPreviewMessage(i18n.t("previewPanel.runtimeSwitchBlocked"));
      return;
    }
    setWebPreviewReloading(true);
    setWebPreviewState("checking");
    setWebPreviewMessage("");
    try {
      await startTaskCreationRuntime(sessionId);
      const mapped = await waitWorkspaceHtmlPreviewReady(sessionId, previewPath, {
        attempts: 8,
        intervalMs: 600,
      });
      setWebPreviewState(mapped.state);
      setWebPreviewMessage(mapped.message);
      if (mapped.state === "ready") {
        setWebPreviewNonce(Date.now());
      }
    } catch {
      setWebPreviewState("fetch_failed");
      setWebPreviewMessage(i18n.t("previewPanel.previewRestoreFailed"));
    } finally {
      setWebPreviewReloading(false);
    }
  };

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

  const handleOpenArtifact = () => {
    if (openTarget?.kind === "remote-debug") {
      onOpenRemoteDebug?.();
      return;
    }
    if (openTarget?.kind === "file-url") {
      window.open(openTarget.url, "_blank", "noopener,noreferrer");
    }
  };

  const openArtifactLabel = openTarget?.kind === "remote-debug"
    ? i18n.t("previewPanel.artifactPreview.openRemoteDebug")
    : i18n.t("previewPanel.artifactPreview.open");

  if (visibleArtifacts.length === 0 && !hasSnapshotMetadata) {
    return null;
  }

  return (
    <div className="w-full">
      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <span>{headerLabel}</span>
          {visibleArtifacts.length > 0 ? (
            <span className="text-xs">
              ({i18n.t("previewPanel.artifactPreview.fileCount", {
                count: visibleArtifacts.length,
              })})
            </span>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-3 isolate">
            <div className="relative group overflow-visible w-full">
              <div className={frameClass}>
                <div className="absolute top-0 left-0 right-0 z-10 flex h-10 items-center justify-between border-b bg-accent px-3">
                  <div className="min-w-0 text-sm font-medium truncate">
                    {getFilename(
                      selectedArtifact?.path ||
                        previewPath ||
                        i18n.t("previewPanel.artifactPreview.websiteSnapshotTitle"),
                    )}
                  </div>
                  {selectedArtifact && onDeployRequested ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full"
                      onClick={() => void handleDeploy()}
                      disabled={deploying}
                      title={i18n.t("previewPanel.artifactPreview.deployWebsite")}
                    >
                      {deploying ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Rocket className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  ) : selectedArtifact && onOpenViewer && showSourceControls ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full"
                      onClick={() => onOpenViewer(selectedArtifact.path)}
                      title={i18n.t("previewPanel.artifactPreview.openViewer")}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <div className="text-[11px] font-medium text-muted-foreground">
                      {selectedIsWebArtifact || webDeliveryMode
                        ? i18n.t("previewPanel.artifactPreview.webPreview")
                        : i18n.t("previewPanel.artifactPreview.sourceCode")}
                    </div>
                  )}
                </div>

                <Tabs
                  value={activeTab}
                  onValueChange={(value) => {
                    if (value === "code" && !showSourceControls) return;
                    setActiveTab(value as "preview" | "code");
                  }}
                  className="h-full w-full gap-0"
                >
                  <div className="absolute left-2 top-2 z-10 flex items-center gap-2">
                    {showSourceControls ? (
                      <TabsList className="h-8 gap-1 rounded-2xl bg-background/85 px-1 backdrop-blur-sm">
                        {hasPreviewTab ? (
                          <TabsTrigger
                            value="preview"
                            className="h-6 rounded-xl px-3 text-xs"
                          >
                            <Monitor className="h-3.5 w-3.5" />
                            {i18n.t("previewPanel.previewTab")}
                          </TabsTrigger>
                        ) : null}
                        <TabsTrigger value="code" className="h-6 rounded-xl px-3 text-xs">
                          <Code2 className="h-3.5 w-3.5" />
                          {i18n.t("previewPanel.artifactPreview.sourceCode")}
                        </TabsTrigger>
                      </TabsList>
                    ) : null}
                    {canOpenArtifact ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-2xl border-border/70 bg-background/80 text-xs backdrop-blur-sm"
                        onClick={handleOpenArtifact}
                        title={openArtifactLabel}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        {openArtifactLabel}
                      </Button>
                    ) : null}
                  </div>

                  <TabsContent value="preview" className="relative h-full data-[state=inactive]:hidden">
                    {previewPath || hasSnapshotMetadata ? (
                      <div className="absolute inset-0">
                        {(snapshotCaptured || fallbackScreenshotCaptured) && snapshotUrl ? (
                          <div className="absolute inset-0 flex items-center justify-center bg-muted/20">
                            <img
                              src={snapshotUrl}
                              alt={i18n.t("previewPanel.artifactPreview.websiteSnapshotAlt")}
                              className="h-full w-full object-contain"
                              draggable={false}
                              onError={() => setSnapshotImageFailed(true)}
                            />
                          </div>
                        ) : snapshotUnavailableForComplexWeb ? (
                          <div className="absolute inset-0 overflow-auto bg-muted/20 px-4 py-12 sm:px-6">
                            <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 rounded-lg border border-amber-200 bg-background/95 p-4 text-left dark:border-amber-900/60 dark:bg-background/90">
                              <div className="flex items-start gap-3">
                                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                                  <AlertTriangle className="h-4 w-4" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-semibold text-foreground">
                                    {i18n.t("previewPanel.artifactPreview.websiteSnapshotIssueTitle")}
                                  </div>
                                  <div className="mt-1 text-sm leading-6 text-muted-foreground">
                                    {snapshotIssue?.message ||
                                      i18n.t("previewPanel.artifactPreview.websiteSnapshotUnavailable")}
                                  </div>
                                </div>
                              </div>
                              {snapshotIssue?.reasonCode ? (
                                <div className="rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
                                  {i18n.t("previewPanel.artifactPreview.websiteSnapshotIssueReason")}:{" "}
                                  {snapshotIssue.reasonCode}
                                </div>
                              ) : null}
                              <div className="text-xs leading-5 text-muted-foreground">
                                {i18n.t("previewPanel.artifactPreview.websiteSnapshotIssueDescription")}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {showSourceControls ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setActiveTab("code")}
                                  >
                                    {i18n.t("previewPanel.viewSource")}
                                  </Button>
                                ) : null}
                                {canOpenArtifact ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={handleOpenArtifact}
                                  >
                                    <ExternalLink className="mr-1 h-3.5 w-3.5" />
                                    {openArtifactLabel}
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        ) : webPreviewState === "ready" ? (
                          <ScaledWebPreviewFrame
                            src={selectedPreviewUrl}
                            title={`${getFilename(previewPath)} preview`}
                            sandbox={
                              deploymentPreviewUrl
                                ? undefined
                                : "allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
                            }
                          />
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted/20 px-6 text-center">
                            {webPreviewState === "checking" ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                <div className="text-sm text-muted-foreground">
                                  {i18n.t("previewPanel.checkingPreviewEnvironment")}
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="max-w-md text-sm text-muted-foreground">
                                  {webPreviewMessage || i18n.t("previewPanel.htmlUnavailable")}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void reloadWebPreview()}
                                    disabled={webPreviewReloading}
                                  >
                                    {webPreviewReloading ? (
                                      <>
                                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                        {i18n.t("previewPanel.reloadingPreview")}
                                      </>
                                    ) : (
                                      i18n.t("previewPanel.reloadPreview")
                                    )}
                                  </Button>
                                  {showSourceControls ? (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setActiveTab("code")}
                                    >
                                      {i18n.t("previewPanel.viewSource")}
                                    </Button>
                                  ) : null}
                                  {canOpenArtifact ? (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={handleOpenArtifact}
                                    >
                                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                                      {openArtifactLabel}
                                    </Button>
                                  ) : null}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-muted/20 px-6 text-center text-sm text-muted-foreground">
                        {i18n.t("previewPanel.artifactPreview.noHtmlArtifact")}
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
                          {i18n.t("previewPanel.artifactPreview.loadingFileContent")}
                        </div>
                      ) : codeError ? (
                        <div className="flex h-full min-h-[220px] items-center justify-center px-6 text-center text-sm text-rose-300">
                          {codeError}
                        </div>
                      ) : (
                        <pre className="min-h-[220px] whitespace-pre-wrap break-all font-mono text-xs leading-6">
                          {codeFile?.content ||
                            i18n.t("previewPanel.artifactPreview.noContent")}
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
