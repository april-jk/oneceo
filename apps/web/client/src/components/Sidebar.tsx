/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * - Fixed 240px width sidebar with clear visual hierarchy
 * - Single blue accent color (#3B82F6) for interactive elements
 * - 1px dividers for clean separation
 * - Inter font with precise spacing
 */

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileText,
  FolderOpen,
  Home,
  Library,
  PlusCircle,
  Search,
  Settings,
  Users,
  Network,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  User,
  CheckCircle2,
  Bell,
  Check,
  Coins,
  Crown,
  Pin,
  Pencil,
  Share2,
  Star,
  FolderSync,
  Trash2,
  ArrowRight,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import React from "react";
import { toast } from "sonner";
import { isDevRuntime } from "@/lib/runtime-env";
import {
  createTaskCreationProject,
  deleteTaskCreationProject,
  deleteTaskCreationSession,
  listTaskCreationProjectSessions,
  listTaskCreationSessions,
  renameTaskCreationSessionTitle,
  summarizeProjectInstruction,
  type TaskCreationProjectSummary,
  toggleTaskCreationSessionFavorite,
  updateTaskCreationProject,
  updateTaskCreationSessionProject,
  type TaskCreationSessionSummary,
} from "@/lib/task-creation-client";
import {
  removeSharedManualProject,
  upsertSharedManualProject,
  readSidebarExpandedState,
  useSharedManualProjects,
} from "@/lib/shared-manual-projects";
import { SELF_ORGANIZED_PROJECTS } from "@/lib/self-organized-projects";
import type { TaskProjectSelection } from "@/lib/task-project-selection";
import { openSettingsDialog } from "@/lib/settings-dialog-events";
import { openNotificationCenter } from "@/lib/notification-center-events";
import { useAuth } from "@/contexts/AuthContext";
import { ProjectEditorDialog } from "@/components/ProjectEditorDialog";

interface SidebarProps {
  className?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  selectedProject?: TaskProjectSelection | null;
}

const WAITING_USER_TEXT_CLASS = "text-[var(--function-warning,rgb(217_119_6))]";
function WaitingUserIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      height="16"
      width="16"
      fill="none"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={className}
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="2.44 1.62"
      />
    </svg>
  );
}

export function getSessionStatusVisual(
  status: string,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const normalized = (status || "").trim().toLowerCase();
  if (normalized === "completed") {
    return {
      label: t("sidebar.statusCompleted"),
      labelClassName: "text-muted-foreground",
      waitingUser: false,
    } as const;
  }
  if (normalized === "waiting_user") {
    return {
      label: t("sidebar.statusWaitingUser"),
      labelClassName: WAITING_USER_TEXT_CLASS,
      waitingUser: true,
    } as const;
  }
  return {
    label: t("sidebar.statusInProgress"),
    labelClassName: "text-muted-foreground",
    waitingUser: false,
  } as const;
}

export function mergeSidebarSessionPatch<T extends { updatedAt?: string }>(
  session: T,
  patch: Partial<T>,
): T {
  if (!Object.prototype.hasOwnProperty.call(patch, "updatedAt")) {
    return {
      ...session,
      ...patch,
      updatedAt: session.updatedAt,
    };
  }
  return {
    ...session,
    ...patch,
  };
}

export function hasMeaningfulSidebarSessionUpdate(detail: {
  title?: string;
  status?: string;
  isFavorite?: boolean;
  projectId?: string | null;
  projectName?: string | null;
  updatedAt?: string;
} | null): boolean {
  if (!detail) return false;
  return (
    (typeof detail.title === "string" && detail.title.trim().length > 0) ||
    (typeof detail.status === "string" && detail.status.trim().length > 0) ||
    typeof detail.isFavorite === "boolean" ||
    Object.prototype.hasOwnProperty.call(detail, "projectId") ||
    Object.prototype.hasOwnProperty.call(detail, "projectName") ||
    Object.prototype.hasOwnProperty.call(detail, "updatedAt")
  );
}

export function resolveSidebarSessionTitle(
  session: Pick<TaskCreationSessionSummary, "title" | "status">,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const title = typeof session.title === "string" ? session.title.trim() : "";
  if (title) return title;
  return session.status === "waiting_user"
    ? t("sidebar.sessionWaitingFallbackTitle")
    : t("sidebar.sessionFallbackTitle");
}

export default function Sidebar({
  className = "",
  collapsed = false,
  onToggleCollapse,
  selectedProject,
}: SidebarProps) {
  const SIDEBAR_EXPAND_STATE_STORAGE_PREFIX = "oneceo_sidebar_expand_state_v1";
  type ProjectManager = {
    id: string;
    name: string;
    type: string;
    tasks: Array<{ id: string; name: string; status: string }>;
  };
  type SidebarProjectNode = {
    id: string;
    name: string;
    description?: string;
    pinned?: boolean;
    managers: ProjectManager[];
    kind: "manual" | "self-organized";
  };
  type SessionTask = {
    sessionId: string;
    title: string;
    status: string;
    updatedAt?: string;
    isFavorite?: boolean;
    projectId?: string | null;
    projectName?: string | null;
    shareEnabled?: boolean;
    shareToken?: string | null;
  };
  type SidebarPromoItem = {
    id: string;
    bannerId?: string;
    title: string;
    imageUrl?: string | null;
    linkType?: "internal" | "external" | "none";
    linkTarget?: string | null;
  };
  type SidebarPromoBanner = {
    id: string;
    displayType: "single" | "carousel";
    allowDismiss: boolean;
    version: number;
    items: SidebarPromoItem[];
  };
  const SESSION_PREVIEW_COUNT = 6;
  const [location, setLocation] = useLocation();
  const currentPath = React.useMemo(() => location.split("?")[0] || location, [location]);
  const { t } = useTranslation();
  const { user, credits } = useAuth();
  const expandStateStorageKey = React.useMemo(
    () => `${SIDEBAR_EXPAND_STATE_STORAGE_PREFIX}:${user?.id || "anonymous"}`,
    [user?.id],
  );
  const creditBalanceLabel = credits ? credits.balance.toLocaleString() : "--";
  const { projects: manualProjects, loading: manualProjectsLoading } = useSharedManualProjects(user?.id);
  const [expandedProjectGroups, setExpandedProjectGroups] = React.useState<string[]>(() => {
    if (typeof window === "undefined") return ["manual-projects"];
    try {
      const raw = window.localStorage.getItem(expandStateStorageKey);
      return readSidebarExpandedState(raw, "expandedProjectGroups", ["manual-projects"]);
    } catch {
      return ["manual-projects"];
    }
  });
  const [expandedProjects, setExpandedProjects] = React.useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(expandStateStorageKey);
      return readSidebarExpandedState(raw, "expandedProjects", []);
    } catch {
      return [];
    }
  });
  const [expandedManagers, setExpandedManagers] = React.useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(expandStateStorageKey);
      return readSidebarExpandedState(raw, "expandedManagers", []);
    } catch {
      return [];
    }
  });
  const [tasksDialogOpen, setTasksDialogOpen] = React.useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = React.useState(false);
  const [sessionTasks, setSessionTasks] = React.useState<SessionTask[]>([]);
  const [sessionListLoading, setSessionListLoading] = React.useState(true);
  const [projectSessionsByProjectId, setProjectSessionsByProjectId] = React.useState<
    Record<string, SessionTask[]>
  >({});
  const [projectSessionLoadingByProjectId, setProjectSessionLoadingByProjectId] =
    React.useState<Record<string, boolean>>({});
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = React.useState(false);
  const [createProjectSubmitting, setCreateProjectSubmitting] = React.useState(false);
  const [editProjectDialogOpen, setEditProjectDialogOpen] = React.useState(false);
  const [editProjectTarget, setEditProjectTarget] = React.useState<TaskCreationProjectSummary | null>(null);
  const [editProjectSubmitting, setEditProjectSubmitting] = React.useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = React.useState(false);
  const [renameTarget, setRenameTarget] = React.useState<SessionTask | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [renameSubmitting, setRenameSubmitting] = React.useState(false);
  const [moveProjectSubmitting, setMoveProjectSubmitting] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<SessionTask | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = React.useState(false);
  const [deleteProjectDialogOpen, setDeleteProjectDialogOpen] = React.useState(false);
  const [deleteProjectTarget, setDeleteProjectTarget] = React.useState<TaskCreationProjectSummary | null>(null);
  const [deleteProjectSubmitting, setDeleteProjectSubmitting] = React.useState(false);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [promoBanner, setPromoBanner] = React.useState<SidebarPromoBanner | null>(null);
  const [promoLoading, setPromoLoading] = React.useState(false);
  const [promoCurrentIndex, setPromoCurrentIndex] = React.useState(0);
  const listLoadingRef = React.useRef(false);
  const lastListFetchRef = React.useRef(0);
  const lastListErrorToastAtRef = React.useRef(0);
  const projectSessionLoadingRef = React.useRef<Record<string, boolean>>({});
  const projectSessionsByProjectIdRef = React.useRef<Record<string, SessionTask[]>>({});
  const LIST_POLL_MS = 30000;

  const mapSessionTask = React.useCallback(
    (session: TaskCreationSessionSummary | any, index: number): SessionTask & { originalIndex: number } => ({
      sessionId: session.id,
      title: resolveSidebarSessionTitle(session, t),
      status: session.status || "in_progress",
      updatedAt:
        typeof session.updatedAt === "string" && session.updatedAt.trim()
          ? session.updatedAt
          : undefined,
      isFavorite: Boolean(session.isFavorite),
      projectId:
        typeof session.projectId === "string" && session.projectId.trim()
          ? session.projectId.trim()
          : null,
      projectName:
        typeof session.projectName === "string" && session.projectName.trim()
          ? session.projectName.trim()
          : null,
      shareEnabled: Boolean(session.shareEnabled),
      shareToken:
        typeof session.shareToken === "string" && session.shareToken.trim()
          ? session.shareToken.trim()
          : null,
      originalIndex: index,
    }),
    [],
  );

  const sortSessionTasks = React.useCallback((list: Array<SessionTask & { originalIndex?: number }>) => {
    return [...list]
      .sort((left, right) => {
        const favoriteDelta = Number(Boolean(right.isFavorite)) - Number(Boolean(left.isFavorite));
        if (favoriteDelta !== 0) {
          return favoriteDelta;
        }
        const leftTime = Date.parse(left.updatedAt || "");
        const rightTime = Date.parse(right.updatedAt || "");
        const safeLeftTime = Number.isFinite(leftTime) ? leftTime : 0;
        const safeRightTime = Number.isFinite(rightTime) ? rightTime : 0;
        if (safeRightTime !== safeLeftTime) {
          return safeRightTime - safeLeftTime;
        }
        return (left.originalIndex || 0) - (right.originalIndex || 0);
      })
      .map(({ originalIndex, ...session }) => session);
  }, []);
  const mapSessionTaskList = React.useCallback(
    (list: TaskCreationSessionSummary[]) => sortSessionTasks(list.map(mapSessionTask)),
    [mapSessionTask, sortSessionTasks],
  );
  const manualProjectIdSet = React.useMemo(
    () => new Set(manualProjects.map((project) => project.id)),
    [manualProjects],
  );

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        expandStateStorageKey,
        JSON.stringify({
          expandedProjectGroups,
          expandedProjects,
          expandedManagers,
        }),
      );
    } catch {
      // ignore localStorage write failures
    }
  }, [expandStateStorageKey, expandedProjectGroups, expandedProjects, expandedManagers]);

  React.useEffect(() => {
    projectSessionsByProjectIdRef.current = projectSessionsByProjectId;
  }, [projectSessionsByProjectId]);

  const patchCachedSessionAcrossProjects = React.useCallback(
    (sessionId: string, patch: Partial<SessionTask>) => {
      setProjectSessionsByProjectId((prev) => {
        let changed = false;
        const next: Record<string, SessionTask[]> = {};
        for (const [projectId, sessions] of Object.entries(prev)) {
          const hasTarget = sessions.some((session) => session.sessionId === sessionId);
          if (!hasTarget) {
            next[projectId] = sessions;
            continue;
          }
          changed = true;
          next[projectId] = sortSessionTasks(
            sessions.map((session, index) =>
              session.sessionId === sessionId
                ? mergeSidebarSessionPatch(session, patch)
                : {
                    ...session,
                  },
            ),
          );
        }
        return changed ? next : prev;
      });
    },
    [sortSessionTasks],
  );

  const removeCachedSessionAcrossProjects = React.useCallback((sessionId: string) => {
    setProjectSessionsByProjectId((prev) => {
      let changed = false;
      const next: Record<string, SessionTask[]> = {};
      for (const [projectId, sessions] of Object.entries(prev)) {
        const filtered = sessions.filter((session) => session.sessionId !== sessionId);
        if (filtered.length !== sessions.length) {
          changed = true;
        }
        next[projectId] = filtered;
      }
      return changed ? next : prev;
    });
  }, []);

  React.useEffect(() => {
    if (collapsed) return;
    let disposed = false;
    const loadPromo = async () => {
      setPromoLoading(true);
      try {
        const response = await fetch("/api/ui/promo-banners/active?placement=sidebar_bubble", {
          credentials: "include",
        });
        if (!response.ok) {
          throw new Error("加载侧边栏气泡失败");
        }
        const data = await response.json();
        if (disposed) return;
        const banner = data?.banner || null;
        if (
          banner &&
          typeof banner.id === "string" &&
          Array.isArray(banner.items) &&
          banner.items.length > 0
        ) {
          const dismissedKey = `oneceo-sidebar-promo-dismissed:${user?.id || "anonymous"}:${banner.id}:v${String(banner.version || 1)}`;
          if (typeof window !== "undefined" && window.localStorage.getItem(dismissedKey) === "1") {
            setPromoBanner(null);
            return;
          }
          setPromoBanner(banner);
          setPromoCurrentIndex(0);
        } else {
          setPromoBanner(null);
        }
      } catch (error) {
        console.error("[Sidebar] failed to load promo banner:", error);
        setPromoBanner(null);
      } finally {
        if (!disposed) setPromoLoading(false);
      }
    };
    void loadPromo();
    return () => {
      disposed = true;
    };
  }, [collapsed, user?.id]);

  React.useEffect(() => {
    if (!promoBanner || promoBanner.items.length < 2 || promoBanner.displayType !== "carousel") return;
    const timer = window.setInterval(() => {
      setPromoCurrentIndex((prev) => (prev + 1) % promoBanner.items.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [promoBanner]);

  const currentPromoItem = React.useMemo(() => {
    if (!promoBanner || promoBanner.items.length === 0) return null;
    if (promoBanner.displayType !== "carousel") return promoBanner.items[0] || null;
    const safeIndex = Math.max(0, Math.min(promoCurrentIndex, promoBanner.items.length - 1));
    return promoBanner.items[safeIndex] || null;
  }, [promoBanner, promoCurrentIndex]);

  const reportPromoEvent = React.useCallback(
    async (eventType: "impression" | "click" | "dismiss", item?: SidebarPromoItem | null) => {
      if (!promoBanner) return;
      try {
        await fetch(`/api/ui/promo-banners/${promoBanner.id}/events`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            eventType,
            itemId: item?.id || null,
            metadata: {
              placement: "sidebar_bubble",
              displayType: promoBanner.displayType,
              index: promoCurrentIndex,
            },
          }),
        });
      } catch (error) {
        console.error("[Sidebar] failed to report promo event:", error);
      }
    },
    [promoBanner, promoCurrentIndex],
  );

  React.useEffect(() => {
    if (!promoBanner || !currentPromoItem) return;
    void reportPromoEvent("impression", currentPromoItem);
  }, [currentPromoItem, promoBanner, reportPromoEvent]);

  const handlePromoDismiss = React.useCallback(() => {
    if (!promoBanner) return;
    if (typeof window !== "undefined") {
      const key = `oneceo-sidebar-promo-dismissed:${user?.id || "anonymous"}:${promoBanner.id}:v${String(promoBanner.version || 1)}`;
      window.localStorage.setItem(key, "1");
    }
    void reportPromoEvent("dismiss", currentPromoItem);
    setPromoBanner(null);
  }, [currentPromoItem, promoBanner, reportPromoEvent, user?.id]);

  const handlePromoClick = React.useCallback(() => {
    if (!currentPromoItem) return;
    void reportPromoEvent("click", currentPromoItem);
    if (currentPromoItem.linkType === "internal" && currentPromoItem.linkTarget) {
      setLocation(currentPromoItem.linkTarget);
      return;
    }
    if (currentPromoItem.linkType === "external" && currentPromoItem.linkTarget) {
      window.open(currentPromoItem.linkTarget, "_blank", "noopener,noreferrer");
    }
  }, [currentPromoItem, reportPromoEvent, setLocation]);

  const loadProjectSessions = React.useCallback(
    async (projectId: string, options?: { force?: boolean }) => {
      const safeProjectId = projectId.trim();
      if (!safeProjectId || !manualProjectIdSet.has(safeProjectId)) return;
      if (projectSessionLoadingRef.current[safeProjectId]) return;
      if (
        !options?.force &&
        Object.prototype.hasOwnProperty.call(projectSessionsByProjectIdRef.current, safeProjectId)
      ) {
        return;
      }

      projectSessionLoadingRef.current[safeProjectId] = true;
      setProjectSessionLoadingByProjectId((prev) => ({ ...prev, [safeProjectId]: true }));
      try {
        const sessions = await listTaskCreationProjectSessions(safeProjectId);
        setProjectSessionsByProjectId((prev) => ({
          ...prev,
          [safeProjectId]: mapSessionTaskList(sessions),
        }));
      } catch (error) {
        console.error("[Sidebar] failed to load project sessions:", error);
        toast.error(
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : t("sidebar.loadSessionsFailed"),
        );
      } finally {
        delete projectSessionLoadingRef.current[safeProjectId];
        setProjectSessionLoadingByProjectId((prev) => {
          if (!prev[safeProjectId]) return prev;
          const next = { ...prev };
          delete next[safeProjectId];
          return next;
        });
      }
    },
    [manualProjectIdSet, mapSessionTaskList, t],
  );

  React.useEffect(() => {
    const validProjectIds = new Set(manualProjects.map((project) => project.id));
    setProjectSessionsByProjectId((prev) => {
      let changed = false;
      const next: Record<string, SessionTask[]> = {};
      for (const [projectId, sessions] of Object.entries(prev)) {
        if (!validProjectIds.has(projectId)) {
          changed = true;
          continue;
        }
        next[projectId] = sessions;
      }
      return changed ? next : prev;
    });
    setProjectSessionLoadingByProjectId((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [projectId, loading] of Object.entries(prev)) {
        if (!validProjectIds.has(projectId)) {
          changed = true;
          delete projectSessionLoadingRef.current[projectId];
          continue;
        }
        next[projectId] = loading;
      }
      return changed ? next : prev;
    });
    setExpandedProjects((prev) => {
      const next = prev.filter((projectId) => validProjectIds.has(projectId));
      return next.length === prev.length ? prev : next;
    });
  }, [manualProjects]);

  React.useEffect(() => {
    for (const projectId of expandedProjects) {
      if (
        manualProjectIdSet.has(projectId) &&
        !projectSessionLoadingByProjectId[projectId] &&
        !Object.prototype.hasOwnProperty.call(projectSessionsByProjectId, projectId)
      ) {
        void loadProjectSessions(projectId);
      }
    }
  }, [
    expandedProjects,
    loadProjectSessions,
    manualProjectIdSet,
    projectSessionLoadingByProjectId,
    projectSessionsByProjectId,
  ]);

  React.useEffect(() => {
    let disposed = false;
    const load = async (force = false) => {
      if (disposed) return;
      if (listLoadingRef.current) return;
      if (!force && document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!force && now - lastListFetchRef.current < 3000) return;
      listLoadingRef.current = true;
      if (force || sessionTasks.length === 0) {
        setSessionListLoading(true);
      }
      try {
        const list = await listTaskCreationSessions("all");
        if (disposed) return;
        const mapped = sortSessionTasks(list.map(mapSessionTask));
        setSessionTasks(mapped);
        lastListFetchRef.current = Date.now();
      } catch (error) {
        console.error("[Sidebar] failed to load sessions:", error);
        const now = Date.now();
        if (now - lastListErrorToastAtRef.current > 8000) {
          lastListErrorToastAtRef.current = now;
          const message =
            error instanceof Error && error.message.trim()
              ? error.message.trim()
              : t("sidebar.loadSessionsFailed");
          toast.error(message);
        }
      } finally {
        listLoadingRef.current = false;
        if (!disposed) {
          setSessionListLoading(false);
        }
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load(false);
      }
    };
    const onSessionUpdated = (event: Event) => {
      const detail =
        event instanceof CustomEvent &&
        event.detail &&
        typeof event.detail === "object"
          ? (event.detail as {
              sessionId?: string;
              title?: string;
              status?: string;
              isFavorite?: boolean;
              projectId?: string | null;
              projectName?: string | null;
            })
          : null;
      const patchedSessionId =
        typeof detail?.sessionId === "string" && detail.sessionId.trim()
          ? detail.sessionId.trim()
          : "";
      const patchedTitle =
        typeof detail?.title === "string" && detail.title.trim()
          ? detail.title.trim()
          : "";
      const patchedStatus =
        typeof detail?.status === "string" && detail.status.trim()
          ? detail.status.trim()
          : "";
      const hasFavoritePatch = typeof detail?.isFavorite === "boolean";
      const hasProjectIdPatch = Object.prototype.hasOwnProperty.call(detail || {}, "projectId");
      const hasProjectNamePatch = Object.prototype.hasOwnProperty.call(detail || {}, "projectName");
      const hasUpdatedAtPatch = Object.prototype.hasOwnProperty.call(detail || {}, "updatedAt");
      const patchIsMeaningful = hasMeaningfulSidebarSessionUpdate(
        patchedSessionId
          ? {
              title: patchedTitle || undefined,
              status: patchedStatus || undefined,
              isFavorite: hasFavoritePatch ? Boolean(detail?.isFavorite) : undefined,
              ...(hasProjectIdPatch ? { projectId: detail?.projectId || null } : {}),
              ...(hasProjectNamePatch ? { projectName: detail?.projectName || null } : {}),
              ...(hasUpdatedAtPatch
                ? {
                    updatedAt:
                      typeof (detail as { updatedAt?: unknown }).updatedAt === "string" &&
                      (detail as { updatedAt?: string }).updatedAt?.trim()
                        ? (detail as { updatedAt?: string }).updatedAt?.trim()
                        : undefined,
                  }
                : {}),
            }
          : null,
      );
      if (patchedSessionId && patchIsMeaningful) {
        setSessionTasks((prev) => {
          const nextUpdatedAt =
            hasUpdatedAtPatch &&
            typeof (detail as { updatedAt?: unknown }).updatedAt === "string" &&
            (detail as { updatedAt?: string }).updatedAt?.trim()
              ? (detail as { updatedAt?: string }).updatedAt?.trim()
              : undefined;
          const index = prev.findIndex(
            (session) => session.sessionId === patchedSessionId,
          );
          if (index >= 0) {
            const next = [...prev];
            const current = next[index];
            next[index] = mergeSidebarSessionPatch(current, {
              title: patchedTitle || current.title,
              status: patchedStatus || current.status,
              isFavorite: hasFavoritePatch ? Boolean(detail?.isFavorite) : current.isFavorite,
              projectId: hasProjectIdPatch ? detail?.projectId || null : current.projectId,
              projectName: hasProjectNamePatch ? detail?.projectName || null : current.projectName,
              ...(typeof nextUpdatedAt === "string" ? { updatedAt: nextUpdatedAt } : {}),
            });
            return sortSessionTasks(next);
          }
          if (patchedTitle) {
            return sortSessionTasks([
              {
                sessionId: patchedSessionId,
                title: patchedTitle,
                status: patchedStatus || "in_progress",
                ...(typeof nextUpdatedAt === "string" ? { updatedAt: nextUpdatedAt } : {}),
                isFavorite: hasFavoritePatch ? Boolean(detail?.isFavorite) : false,
                projectId: hasProjectIdPatch ? detail?.projectId || null : null,
                projectName: hasProjectNamePatch ? detail?.projectName || null : null,
              },
              ...prev,
            ]);
          }
          return prev;
        });

        if (hasProjectIdPatch) {
          const appliedProjectId =
            typeof detail?.projectId === "string" && detail.projectId.trim()
              ? detail.projectId.trim()
              : null;
          const appliedProjectName =
            typeof detail?.projectName === "string" && detail.projectName.trim()
              ? detail.projectName.trim()
              : null;
          const nextUpdatedAt =
            hasUpdatedAtPatch &&
            typeof (detail as { updatedAt?: unknown }).updatedAt === "string" &&
            (detail as { updatedAt?: string }).updatedAt?.trim()
              ? (detail as { updatedAt?: string }).updatedAt?.trim()
              : undefined;

          setProjectSessionsByProjectId((prev) => {
            const next = { ...prev };
            const patchBase: SessionTask = {
              sessionId: patchedSessionId,
              title: patchedTitle || t("sidebar.sessionFallbackTitle"),
              status: patchedStatus || "in_progress",
              isFavorite: hasFavoritePatch ? Boolean(detail?.isFavorite) : false,
              projectId: appliedProjectId,
              projectName: appliedProjectName,
              ...(typeof nextUpdatedAt === "string" ? { updatedAt: nextUpdatedAt } : {}),
            };

            for (const [projectId, sessions] of Object.entries(next)) {
              const filtered = sessions.filter((session) => session.sessionId !== patchedSessionId);
              next[projectId] = filtered;
            }

            if (appliedProjectId) {
              const existing = next[appliedProjectId] || [];
              next[appliedProjectId] = sortSessionTasks([
                patchBase,
                ...existing,
              ]);
            }

            return next;
          });
        }
      }
      if (patchedSessionId && patchIsMeaningful) {
        // Use local patch as the primary update path to avoid visible sidebar flashing.
        // Fallback polling will reconcile any missed server-side fields.
        lastListFetchRef.current = Date.now();
      }
    };
    void load(true);
    const timer = window.setInterval(() => {
      void load(false);
    }, LIST_POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("task-creation-session-updated", onSessionUpdated);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(
        "task-creation-session-updated",
        onSessionUpdated,
      );
    };
  }, [mapSessionTask, sortSessionTasks, t]);

  // 获取未读通知数量
  React.useEffect(() => {
    const fetchUnreadCount = async () => {
      try {
        const response = await fetch("/api/notifications/unread-count", {
          credentials: "include",
        });
        if (response.ok) {
          const data = await response.json();
          setUnreadCount(data.count || 0);
        }
      } catch (error) {
        console.error("[Sidebar] failed to load unread count:", error);
      }
    };
    void fetchUnreadCount();
    const timer = window.setInterval(fetchUnreadCount, 60000);

    // 监听通知已读事件，刷新未读数量
    const handleNotificationRead = () => void fetchUnreadCount();
    window.addEventListener("oneceo:notification-read", handleNotificationRead);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("oneceo:notification-read", handleNotificationRead);
    };
  }, []);

  const toggleProjectGroup = (groupId: string) => {
    setExpandedProjectGroups((prev) =>
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId],
    );
  };

  const toggleProject = (projectId: string) => {
    const isExpanded = expandedProjects.includes(projectId);
    if (!isExpanded && manualProjectIdSet.has(projectId)) {
      void loadProjectSessions(projectId);
    }
    setExpandedProjects((prev) =>
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId],
    );
  };

  const toggleManager = (managerId: string) => {
    setExpandedManagers((prev) =>
      prev.includes(managerId)
        ? prev.filter((id) => id !== managerId)
        : [...prev, managerId],
    );
  };

  const navItems = [
    { icon: PlusCircle, label: t("sidebar.newTask"), href: "/new-task" },
    { icon: Search, label: t("sidebar.search"), href: "/search" },
    { icon: Library, label: t("sidebar.library"), href: "/library" },
    { icon: FolderOpen, label: t("sidebar.projects"), href: "/projects" },
    ...(isDevRuntime()
      ? [{ icon: Network, label: t("sidebar.ceoView"), href: "/ceo-view" }]
      : []),
  ];

  const selfOrganizedProjectsData = React.useMemo<SidebarProjectNode[]>(
    () =>
      isDevRuntime()
        ? SELF_ORGANIZED_PROJECTS.map((project) => ({
            id: project.id,
            name: project.name,
            description: project.description,
            managers: project.managers.map((manager) => ({
              id: manager.id,
              name: manager.name,
              type: manager.type,
              tasks: manager.tasks,
            })),
            kind: "self-organized" as const,
          }))
        : [],
    [],
  );
  const manualProjectNodes = React.useMemo<SidebarProjectNode[]>(
    () =>
      manualProjects.map((project) => ({
        id: project.id,
        name: project.name,
        description: summarizeProjectInstruction(project.projectInstruction),
        pinned: Boolean(project.pinned),
        managers: [],
        kind: "manual" as const,
      })),
    [manualProjects],
  );
  const assignableProjects = React.useMemo(
    () =>
      manualProjects.map((project) => ({
        id: project.id,
        name: project.name,
      })),
    [manualProjects],
  );
  const activeSessionId = React.useMemo(() => {
    const matched = location.match(/^\/session\/([^/?]+)/);
    return matched?.[1] || null;
  }, [location]);
  const orderedSessionTasks = React.useMemo(
    () => sortSessionTasks(sessionTasks),
    [sessionTasks, sortSessionTasks],
  );
  const ungroupedRecentSessionTasks = React.useMemo(
    () =>
      orderedSessionTasks.filter(
        (session) =>
          !(typeof session.projectId === "string" && session.projectId.trim()),
      ),
    [orderedSessionTasks],
  );
  const sessionPreviewList = ungroupedRecentSessionTasks.slice(
    0,
    SESSION_PREVIEW_COUNT,
  );
  const hiddenSessionCount = Math.max(
    ungroupedRecentSessionTasks.length - SESSION_PREVIEW_COUNT,
    0,
  );
  const hasSessionOverflow = hiddenSessionCount > 0;
  const patchSessionTask = React.useCallback((sessionId: string, patch: Partial<SessionTask>) => {
    setSessionTasks((prev) =>
      sortSessionTasks(
        prev.map((session) =>
          session.sessionId === sessionId
            ? mergeSidebarSessionPatch(session, patch)
            : { ...session },
        ),
      ),
    );
  }, [sortSessionTasks]);

  const dispatchSessionUpdate = React.useCallback((session: Partial<SessionTask> & { sessionId: string }) => {
    const detail: Record<string, unknown> = {
      sessionId: session.sessionId,
    };
    if (typeof session.title === "string" && session.title.trim()) {
      detail.title = session.title;
    }
    if (typeof session.status === "string" && session.status.trim()) {
      detail.status = session.status;
    }
    if (typeof session.isFavorite === "boolean") {
      detail.isFavorite = session.isFavorite;
    }
    if (Object.prototype.hasOwnProperty.call(session, "projectId")) {
      detail.projectId = session.projectId ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(session, "projectName")) {
      detail.projectName = session.projectName ?? null;
    }
    if (typeof session.updatedAt === "string" && session.updatedAt.trim()) {
      detail.updatedAt = session.updatedAt;
    }
    window.dispatchEvent(
      new CustomEvent("task-creation-session-updated", {
        detail,
      }),
    );
  }, []);

  const openRenameDialog = React.useCallback((session: SessionTask) => {
    setRenameTarget(session);
    setRenameValue(session.title);
    setRenameDialogOpen(true);
  }, []);

  const handleRenameSubmit = React.useCallback(async () => {
    const target = renameTarget;
    const nextTitle = renameValue.trim();
    if (!target || !nextTitle) {
      return;
    }
    setRenameSubmitting(true);
    try {
      const updated = await renameTaskCreationSessionTitle(target.sessionId, nextTitle);
      const appliedTitle = updated?.title?.trim() || nextTitle;
      patchSessionTask(target.sessionId, { title: appliedTitle });
      patchCachedSessionAcrossProjects(target.sessionId, { title: appliedTitle });
      dispatchSessionUpdate({
        sessionId: target.sessionId,
        title: appliedTitle,
      });
      setRenameDialogOpen(false);
      setRenameTarget(null);
      toast.success(t("sidebar.renameSuccess"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sidebar.renameFailed"));
    } finally {
      setRenameSubmitting(false);
    }
  }, [dispatchSessionUpdate, patchSessionTask, renameTarget, renameValue, t]);

  const handleFavoriteToggle = React.useCallback(async (session: SessionTask) => {
    const nextFavorite = !Boolean(session.isFavorite);
    try {
      const updated = await toggleTaskCreationSessionFavorite(session.sessionId, nextFavorite);
      const appliedFavorite = typeof updated?.isFavorite === "boolean" ? Boolean(updated.isFavorite) : nextFavorite;
      patchSessionTask(session.sessionId, { isFavorite: appliedFavorite });
      patchCachedSessionAcrossProjects(session.sessionId, { isFavorite: appliedFavorite });
      dispatchSessionUpdate({
        sessionId: session.sessionId,
        isFavorite: appliedFavorite,
      });
      toast.success(appliedFavorite ? t("sidebar.favoriteAdded") : t("sidebar.favoriteRemoved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sidebar.favoriteUpdateFailed"));
    }
  }, [dispatchSessionUpdate, patchSessionTask, t]);

  const openDeleteDialog = React.useCallback((session: SessionTask) => {
    setDeleteTarget(session);
    setDeleteDialogOpen(true);
  }, []);

  const openCreateProjectDialog = React.useCallback(() => {
    setCreateProjectDialogOpen(true);
  }, []);

  const openEditProjectDialog = React.useCallback((project: TaskCreationProjectSummary) => {
    setEditProjectTarget(project);
    setEditProjectDialogOpen(true);
  }, []);

  const openDeleteProjectDialog = React.useCallback((project: TaskCreationProjectSummary) => {
    setDeleteProjectTarget(project);
    setDeleteProjectDialogOpen(true);
  }, []);

  const handleCreateProjectSubmit = React.useCallback(async (input: {
    name: string;
    projectInstruction: string;
    defaultConnectors: NonNullable<TaskCreationProjectSummary["defaultConnectors"]>;
  }) => {
    setCreateProjectSubmitting(true);
    try {
      const created = await createTaskCreationProject({
        name: input.name,
        projectInstruction: input.projectInstruction,
        defaultConnectors: input.defaultConnectors.map((item) => ({
          connectorKey: item.connectorKey,
          profileId: item.profileId,
        })),
      });
      if (!created?.id) {
        throw new Error(t("sidebar.projectCreateFailed"));
      }
      upsertSharedManualProject(created, user?.id);
      setProjectSessionsByProjectId((prev) => ({ ...prev, [created.id]: [] }));
      setExpandedProjects((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]));
      setCreateProjectDialogOpen(false);
      toast.success(t("sidebar.projectCreated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sidebar.projectCreateFailed"));
    } finally {
      setCreateProjectSubmitting(false);
    }
  }, [t, user?.id]);

  const handleEditProjectSubmit = React.useCallback(async (input: {
    name: string;
    projectInstruction: string;
    defaultConnectors: NonNullable<TaskCreationProjectSummary["defaultConnectors"]>;
  }) => {
    const target = editProjectTarget;
    if (!target) return;
    setEditProjectSubmitting(true);
    try {
      const updated = await updateTaskCreationProject(target.id, {
        name: input.name,
        projectInstruction: input.projectInstruction,
        defaultConnectors: input.defaultConnectors.map((item) => ({
          connectorKey: item.connectorKey,
          profileId: item.profileId,
        })),
      });
      if (!updated?.id) {
        throw new Error(t("sidebar.projectUpdateFailed"));
      }
      upsertSharedManualProject(updated, user?.id);
      setEditProjectDialogOpen(false);
      setEditProjectTarget(null);
      toast.success(t("sidebar.projectUpdated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sidebar.projectUpdateFailed"));
    } finally {
      setEditProjectSubmitting(false);
    }
  }, [editProjectTarget, t, user?.id]);

  const handleToggleProjectPinned = React.useCallback(async (project: TaskCreationProjectSummary) => {
    try {
      const updated = await updateTaskCreationProject(project.id, {
        pinned: !Boolean(project.pinned),
      });
      if (!updated?.id) {
        throw new Error(t("sidebar.projectUpdateFailed"));
      }
      upsertSharedManualProject(updated, user?.id);
      toast.success(updated.pinned ? t("sidebar.projectPinned") : t("sidebar.projectUnpinned"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sidebar.projectUpdateFailed"));
    }
  }, [t, user?.id]);

  const handleDeleteProjectConfirm = React.useCallback(async () => {
    const target = deleteProjectTarget;
    if (!target) return;
    setDeleteProjectSubmitting(true);
    try {
      await deleteTaskCreationProject(target.id);
      removeSharedManualProject(target.id);
      setProjectSessionsByProjectId((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, target.id)) return prev;
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
      setProjectSessionLoadingByProjectId((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, target.id)) return prev;
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
      delete projectSessionLoadingRef.current[target.id];
      setSessionTasks((prev) =>
        sortSessionTasks(
          prev.map((session, index) => ({
            ...session,
            projectId: session.projectId === target.id ? null : session.projectId,
            projectName: session.projectId === target.id ? null : session.projectName,
            originalIndex: index,
          })),
        ),
      );
      setExpandedProjects((prev) => prev.filter((projectId) => projectId !== target.id));
      if (selectedProject?.kind === "manual" && selectedProject.id === target.id) {
        setLocation("/");
      }
      setDeleteProjectDialogOpen(false);
      setDeleteProjectTarget(null);
      toast.success(t("sidebar.projectDeleted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sidebar.projectDeleteFailed"));
    } finally {
      setDeleteProjectSubmitting(false);
    }
  }, [deleteProjectTarget, selectedProject, setLocation, sortSessionTasks, t]);

  React.useEffect(() => {
    const handleCreateProjectRequest = () => {
      openCreateProjectDialog();
    };
    window.addEventListener("task-creation-project-create-requested", handleCreateProjectRequest);
    return () => {
      window.removeEventListener(
        "task-creation-project-create-requested",
        handleCreateProjectRequest,
      );
    };
  }, [openCreateProjectDialog]);

  const handleProjectAssign = React.useCallback(async (
    session: SessionTask,
    projectId: string | null,
    projectName: string | null,
  ) => {
    if (moveProjectSubmitting) return;
    const previousProjectId =
      typeof session.projectId === "string" && session.projectId.trim()
        ? session.projectId.trim()
        : null;
    const assignableProject = projectId
      ? assignableProjects.find((project) => project.id === projectId) || null
      : null;
    if (projectId && !assignableProject) {
      toast.error(t("sidebar.projectParentRestricted"));
      return;
    }
    const nextProjectId = assignableProject ? assignableProject.id : null;
    const nextProjectName = assignableProject ? assignableProject.name : null;
    setMoveProjectSubmitting(true);
    try {
      const updated = await updateTaskCreationSessionProject(session.sessionId, {
        projectId: nextProjectId,
        projectName: nextProjectName,
      });
      const appliedProjectId =
        updated && Object.prototype.hasOwnProperty.call(updated, "projectId")
          ? updated.projectId || null
          : nextProjectId;
      const appliedProjectName =
        updated && Object.prototype.hasOwnProperty.call(updated, "projectName")
          ? updated.projectName || null
          : nextProjectName;
      patchSessionTask(session.sessionId, {
        projectId: appliedProjectId,
        projectName: appliedProjectName,
      });
      const cachedOrExpandedProjectIds = new Set([
        ...Object.keys(projectSessionsByProjectIdRef.current),
        ...expandedProjects,
      ]);
      const projectIdsToReload = [previousProjectId, appliedProjectId].filter(
        (value, index, list): value is string =>
          typeof value === "string" &&
          value.trim().length > 0 &&
          list.indexOf(value) === index &&
          cachedOrExpandedProjectIds.has(value),
      );
      for (const affectedProjectId of projectIdsToReload) {
        void loadProjectSessions(affectedProjectId, { force: true });
      }
      dispatchSessionUpdate({
        sessionId: session.sessionId,
        projectId: appliedProjectId,
        projectName: appliedProjectName,
      });
      toast.success(
        appliedProjectId
          ? t("sidebar.projectMoved", { projectName: appliedProjectName || nextProjectName || "" })
          : t("sidebar.projectRemoved"),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sidebar.projectUpdateFailed"));
    } finally {
      setMoveProjectSubmitting(false);
    }
  }, [assignableProjects, dispatchSessionUpdate, moveProjectSubmitting, patchSessionTask, t]);

  const openProjectScopedNewSession = React.useCallback((projectId: string) => {
    const token = Date.now().toString();
    setLocation(`/new-task?projectId=${encodeURIComponent(projectId)}&new=${encodeURIComponent(token)}`);
  }, [setLocation]);

  const navigateToSessionHistory = React.useCallback((sessionId: string) => {
    setLocation(`/session/${encodeURIComponent(sessionId)}?view=history`);
  }, [setLocation]);

  const handleDeleteConfirm = React.useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteSubmitting(true);
    try {
      await deleteTaskCreationSession(target.sessionId);
      setSessionTasks((prev) => prev.filter((session) => session.sessionId !== target.sessionId));
      removeCachedSessionAcrossProjects(target.sessionId);
      if (activeSessionId === target.sessionId) {
        setLocation("/");
      }
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      toast.success(t("sidebar.sessionDeleted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sidebar.sessionDeleteFailed"));
    } finally {
      setDeleteSubmitting(false);
    }
  }, [activeSessionId, deleteTarget, removeCachedSessionAcrossProjects, setLocation, t]);

  const renderSessionTaskItem = React.useCallback(
    (session: SessionTask, options?: { compact?: boolean; onNavigate?: () => void }) => {
      const compact = Boolean(options?.compact);
      const navigateToSession =
        options?.onNavigate ||
        (() => {
          navigateToSessionHistory(session.sessionId);
        });
      const statusVisual = getSessionStatusVisual(session.status, t);
      const favoriteLabel = session.isFavorite ? t("sidebar.favoriteRemove") : t("sidebar.favoriteAdd");
      const leadingIcon = statusVisual.waitingUser ? (
        <WaitingUserIcon
          className={`${compact ? "h-3.5 w-3.5" : "w-4 h-4 shrink-0"} ${WAITING_USER_TEXT_CLASS}`}
        />
      ) : session.isFavorite ? (
        <Star className="h-3.5 w-3.5 fill-current text-amber-500" />
      ) : (
        <FileText className={compact ? "h-3.5 w-3.5" : "w-4 h-4 shrink-0"} />
      );

      const button = compact ? (
        <Button
          variant="ghost"
          className="grid h-7 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 overflow-hidden rounded-lg px-2 text-sidebar-foreground transition-colors duration-150 hover:bg-sidebar-accent/50"
          onClick={navigateToSession}
        >
          {leadingIcon}
          <span className="text-xs truncate flex-1 min-w-0 text-left">
            {session.title}
          </span>
          <span className={`w-9 truncate text-right text-[10px] ${statusVisual.labelClassName}`}>
            {statusVisual.label}
          </span>
        </Button>
      ) : (
        <Button
          variant="ghost"
          className="w-full min-w-0 justify-between h-10 overflow-hidden px-3 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
          onClick={navigateToSession}
        >
          <span className="flex items-center gap-2 min-w-0">
            {leadingIcon}
            <span className="text-sm truncate min-w-0">
              {session.title}
            </span>
          </span>
          <span className={`text-xs shrink-0 ${statusVisual.labelClassName}`}>
            {statusVisual.label}
          </span>
        </Button>
      );

      return (
        <ContextMenu key={session.sessionId}>
          <ContextMenuTrigger asChild>
            {button}
          </ContextMenuTrigger>
          <ContextMenuContent className="w-52">
            <ContextMenuItem disabled>
              <Share2 className="h-4 w-4" />
              <span>{t("sidebar.sharePending")}</span>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => openRenameDialog(session)}>
              <Pencil className="h-4 w-4" />
              <span>{t("sidebar.renameAction")}</span>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void handleFavoriteToggle(session)}>
              <Star className={`h-4 w-4 ${session.isFavorite ? "fill-current text-amber-500" : ""}`} />
              <span>{favoriteLabel}</span>
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger className="group gap-2 rounded-[8px] p-2 text-sm text-foreground focus:bg-accent/60 data-[state=open]:bg-accent/60">
                <div className="flex size-5 items-center justify-center">
                  <FolderSync className="h-4 w-4" />
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <div className="flex flex-1 items-center justify-between gap-2 min-w-0">
                    <span className="truncate">{t("sidebar.moveToProjectAction")}</span>
                  </div>
                </div>
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-64 rounded-[10px] p-1.5">
                <ContextMenuItem
                  className="gap-2 rounded-[8px] p-2"
                  disabled={moveProjectSubmitting}
                  onSelect={() => void handleProjectAssign(session, null, null)}
                >
                  <div className="flex size-5 items-center justify-center">
                    {session.projectId ? (
                      <div className="h-4 w-4" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </div>
                  <span className="min-w-0 flex-1 truncate">{t("sidebar.noProjectOption")}</span>
                </ContextMenuItem>
                {assignableProjects.length === 0 ? (
                  <>
                    <ContextMenuItem
                      disabled
                      className="min-h-0 cursor-default rounded-[8px] px-2 py-2 text-xs leading-5 text-muted-foreground opacity-100"
                    >
                      {t("sidebar.noManualProjectsForSession")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      className="gap-2 rounded-[8px] p-2"
                      onSelect={() => openCreateProjectDialog()}
                    >
                      <div className="flex size-5 items-center justify-center">
                        <PlusCircle className="h-4 w-4" />
                      </div>
                      <span className="min-w-0 flex-1 truncate">{t("sidebar.createProjectAction")}</span>
                    </ContextMenuItem>
                  </>
                ) : (
                  assignableProjects.map((project) => {
                    const isCurrentProject = session.projectId === project.id;
                    return (
                      <ContextMenuItem
                        key={project.id}
                        className="gap-2 rounded-[8px] p-2"
                        disabled={moveProjectSubmitting}
                        onSelect={() => void handleProjectAssign(session, project.id, project.name)}
                      >
                        <div className="flex size-5 items-center justify-center">
                          {isCurrentProject ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <div className="h-4 w-4" />
                          )}
                        </div>
                        <span className="min-w-0 flex-1 truncate">{project.name}</span>
                      </ContextMenuItem>
                    );
                  })
                )}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => openDeleteDialog(session)}>
              <Trash2 className="h-4 w-4" />
              <span>{t("common.delete")}</span>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      );
    },
    [assignableProjects, handleFavoriteToggle, handleProjectAssign, moveProjectSubmitting, navigateToSessionHistory, openCreateProjectDialog, openDeleteDialog, openRenameDialog, t],
  );
  return (
    <aside
      className={`fixed left-4 top-4 bottom-4 ${collapsed ? "w-16" : "w-60"} overflow-hidden bg-sidebar border border-sidebar-border flex flex-col shadow-lg rounded-3xl backdrop-blur-sm transition-all duration-300 ${className}`}
    >
      {/* Logo */}
      <div
        className={`h-14 flex items-center ${collapsed ? "px-3 justify-center" : "px-4 justify-between"} border-b border-sidebar-border relative`}
      >
        <Link href="/" className="min-w-0 flex-1">
          <div
            className={`flex min-w-0 items-center ${collapsed ? "justify-center" : "gap-2"} cursor-pointer`}
          >
            <img src="/logo.png" alt="oneceo" className="w-8 h-8 rounded-xl" />
            {!collapsed && (
              <span className="truncate font-semibold text-sidebar-foreground text-base">
                oneceo
              </span>
            )}
          </div>
        </Link>
        {onToggleCollapse && (
          <Button
            variant="ghost"
            size="icon"
            className={`h-8 w-8 shrink-0 ${collapsed ? "absolute right-2" : ""}`}
            onClick={onToggleCollapse}
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </Button>
        )}
      </div>

      {/* Navigation */}
      <div className="flex flex-1 min-h-0 flex-col">
        <div
          className={`space-y-1 p-2.5 ${collapsed ? "items-center" : "pr-3"}`}
        >
          {navItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = currentPath === item.href;
            const isNewTask = index === 0; // First item is New Task

            if (isNewTask) {
              return (
                <Button
                  key={item.href}
                  variant={isNewTask ? "default" : "ghost"}
                  className={`w-full ${collapsed ? "justify-center px-0" : "justify-start gap-3 px-3"} h-9 rounded-xl transition-all duration-150 ${
                    isNewTask
                      ? "bg-foreground hover:bg-foreground/90 text-background"
                      : isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                  } ${collapsed ? "" : "min-w-0 overflow-hidden"}`}
                  onClick={() => {
                    setLocation(`/new-task?new=${Date.now()}`);
                  }}
                  data-umami-event="sidebar_new_task_click"
                  data-umami-event-target="/new-task"
                >
                  <Icon className="w-4 h-4" />
                  {!collapsed && (
                    <span className="min-w-0 truncate text-sm font-medium">
                      {item.label}
                    </span>
                  )}
                </Button>
              );
            }

            return (
              <Link key={item.href} href={item.href}>
                <Button
                  variant={isNewTask ? "default" : "ghost"}
                  className={`w-full ${collapsed ? "justify-center px-0" : "justify-start gap-3 px-3"} h-9 rounded-xl transition-all duration-150 ${
                    isNewTask
                      ? "bg-foreground hover:bg-foreground/90 text-background"
                      : isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                  } ${collapsed ? "" : "min-w-0 overflow-hidden"}`}
                  data-umami-event="sidebar_nav_click"
                  data-umami-event-target={item.href}
                >
                  <Icon className="w-4 h-4" />
                  {!collapsed && (
                    <span className="min-w-0 truncate text-sm font-medium">
                      {item.label}
                    </span>
                  )}
                </Button>
              </Link>
            );
          })}
        </div>

        {!collapsed && <Separator className="my-3 bg-sidebar-border" />}

        {/* Projects Section */}
        {!collapsed && (
          <div className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0 px-2.5 pb-2.5 pr-3">
                  <div className="mb-2 flex min-w-0 items-center justify-between gap-2 px-3">
                    <span className="truncate text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {t("sidebar.projects").toUpperCase()}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={openCreateProjectDialog}
                    >
                      <PlusCircle className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

            <ScrollArea
              data-sidebar-project-scroll="true"
              className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block [&>[data-slot=scroll-area-viewport]>div]:!w-full [&>[data-slot=scroll-area-viewport]>div]:max-w-full"
            >
              <div className="overflow-x-hidden px-2.5 pb-2.5 pr-3">
                <div className="space-y-3">
                  {manualProjectNodes.length === 0 ? (
                    <div className="space-y-1 px-0 py-1">
                      {manualProjectsLoading ? (
                        <>
                          <div className="flex items-center gap-1 px-0.5">
                            <Skeleton className="h-7 w-7 shrink-0 rounded-lg" />
                            <Skeleton className="h-7 flex-1 rounded-lg" />
                            <Skeleton className="h-7 w-7 shrink-0 rounded-lg" />
                          </div>
                          <div className="flex items-center gap-1 px-0.5">
                            <Skeleton className="h-7 w-7 shrink-0 rounded-lg" />
                            <Skeleton className="h-7 flex-1 rounded-lg" />
                            <Skeleton className="h-7 w-7 shrink-0 rounded-lg" />
                          </div>
                        </>
                      ) : (
                        <div className="px-2 py-1 text-xs leading-5 text-muted-foreground">
                          {t("sidebar.noManualProjects")}
                        </div>
                      )}
                    </div>
                  ) : null}
                  {manualProjectNodes.map((project) => {
                    const sourceProject =
                      manualProjects.find((item) => item.id === project.id) || null;
                    const isExpanded = expandedProjects.includes(project.id);
                    const isProjectActive =
                      selectedProject?.id === project.id &&
                      selectedProject?.kind === project.kind;
                    const projectSessions = projectSessionsByProjectId[project.id] || [];
                    return (
                      <div key={project.id} className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={() => toggleProject(project.id)}
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                          </Button>
                          <ContextMenu>
                            <ContextMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                className={`flex-1 min-w-0 justify-start gap-2 h-7 overflow-hidden px-2 rounded-lg transition-colors duration-150 ${
                                  isProjectActive
                                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                    : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                                }`}
                                onClick={() => {
                                  setLocation(`/project/${encodeURIComponent(project.id)}`);
                                }}
                              >
                                <FolderOpen className="w-3.5 h-3.5" />
                                <span className="text-sm truncate min-w-0">
                                  {project.name}
                                </span>
                              </Button>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-44">
                              <ContextMenuItem onSelect={() => void handleToggleProjectPinned(project)}>
                                <Pin className={`h-4 w-4 ${project.pinned ? "fill-current" : ""}`} />
                                <span>
                                  {project.pinned
                                    ? t("sidebar.projectUnpinAction")
                                    : t("sidebar.projectPinAction")}
                                </span>
                              </ContextMenuItem>
                              <ContextMenuItem
                                onSelect={() => {
                                  if (sourceProject) openEditProjectDialog(sourceProject);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                                <span>{t("sidebar.projectEditAction")}</span>
                              </ContextMenuItem>
                              <ContextMenuItem
                                variant="destructive"
                                onSelect={() => {
                                  if (sourceProject) openDeleteProjectDialog(sourceProject);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                                <span>{t("sidebar.projectDeleteAction")}</span>
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/50"
                            title={t("sidebar.projectCreateSessionAction")}
                            aria-label={t("sidebar.projectCreateSessionAction")}
                            onClick={(event) => {
                              event.stopPropagation();
                              openProjectScopedNewSession(project.id);
                            }}
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>

                        {isExpanded &&
                        !projectSessionLoadingByProjectId[project.id] &&
                        projectSessions.length > 0 ? (
                          <div className="ml-7 min-w-0 space-y-0.5 overflow-x-hidden">
                            {projectSessions.map((session) =>
                              renderSessionTaskItem(session, { compact: true }),
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  <div className="space-y-1">
                    <div className="flex min-w-0 items-center justify-between gap-2 px-3">
                      <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t("sidebar.recentSessions")}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {ungroupedRecentSessionTasks.length}
                      </span>
                    </div>

                    {sessionListLoading && sessionTasks.length === 0 ? (
                      <div className="space-y-1 px-2 py-1">
                        <div className="grid h-7 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 px-2">
                          <Skeleton className="h-3.5 w-3.5 rounded-sm" />
                          <Skeleton className="h-3.5 w-full rounded-sm" />
                          <Skeleton className="h-3.5 w-9 rounded-sm" />
                        </div>
                        <div className="grid h-7 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 px-2">
                          <Skeleton className="h-3.5 w-3.5 rounded-sm" />
                          <Skeleton className="h-3.5 w-11/12 rounded-sm" />
                          <Skeleton className="h-3.5 w-9 rounded-sm" />
                        </div>
                        <div className="grid h-7 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 px-2">
                          <Skeleton className="h-3.5 w-3.5 rounded-sm" />
                          <Skeleton className="h-3.5 w-10/12 rounded-sm" />
                          <Skeleton className="h-3.5 w-9 rounded-sm" />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {sessionPreviewList.map((session) =>
                          renderSessionTaskItem(session, { compact: true }),
                        )}
                      </div>
                    )}

                    {hasSessionOverflow ? (
                      <Button
                        variant="ghost"
                        className="h-8 w-full min-w-0 justify-start gap-2 overflow-hidden rounded-lg px-3 text-muted-foreground hover:text-sidebar-foreground"
                        onClick={() => setTasksDialogOpen(true)}
                      >
                        <span className="truncate text-sm">
                          {t("sidebar.viewMore")} ({hiddenSessionCount})
                        </span>
                      </Button>
                    ) : null}
                  </div>

                </div>

                <Separator className="my-3 bg-sidebar-border" />

                {/* All Tasks */}
                <div className="pb-2.5">
                  <Button
                    variant="ghost"
                    className="grid h-9 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 overflow-hidden rounded-xl px-3 text-sidebar-foreground transition-colors duration-150 hover:bg-sidebar-accent/50"
                    onClick={() => setTasksDialogOpen(true)}
                  >
                    <FileText className="h-4 w-4" />
                    <span className="truncate text-sm font-medium text-left">
                      {t("sidebar.allTasks")}
                    </span>
                    <span className="truncate text-right text-xs text-muted-foreground">
                      {orderedSessionTasks.length}
                    </span>
                  </Button>
                </div>

                {isDevRuntime() ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => toggleProjectGroup("self-organized")}
                    >
                      {expandedProjectGroups.includes("self-organized") ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      className="flex-1 min-w-0 justify-start gap-2 h-7 overflow-hidden px-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
                      onClick={() => toggleProjectGroup("self-organized")}
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span className="text-sm truncate min-w-0">
                        {t("sidebar.selfOrganizedProjects")}
                      </span>
                    </Button>
                  </div>

                  {expandedProjectGroups.includes("self-organized") && (
                    <div className="ml-4 min-w-0 space-y-0.5 overflow-x-hidden">
                      {selfOrganizedProjectsData.map((project) => {
                        const isExpanded = expandedProjects.includes(project.id);
                        const isProjectActive =
                          selectedProject?.id === project.id &&
                          selectedProject?.kind === project.kind;
                        return (
                          <div key={project.id} className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                onClick={() => toggleProject(project.id)}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                className={`flex-1 min-w-0 justify-start gap-2 h-7 overflow-hidden px-2 rounded-lg transition-colors duration-150 ${
                                  isProjectActive
                                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                    : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                                }`}
                                onClick={() => {
                                  setLocation(`/project/${encodeURIComponent(project.id)}`);
                                }}
                              >
                                <FolderOpen className="w-3.5 h-3.5" />
                                <span className="text-sm truncate min-w-0">
                                  {project.name}
                                </span>
                              </Button>
                            </div>

                            {isExpanded && project.managers.length > 0 ? (
                              <div className="ml-7 min-w-0 space-y-0.5 overflow-x-hidden">
                                {project.managers.map((manager) => {
                                  const isManagerExpanded = expandedManagers.includes(manager.id);
                                  return (
                                    <div key={manager.id} className="space-y-0.5">
                                      <div className="flex items-center gap-1">
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6 shrink-0"
                                          onClick={() => toggleManager(manager.id)}
                                        >
                                          {isManagerExpanded ? (
                                            <ChevronDown className="w-3 h-3" />
                                          ) : (
                                            <ChevronRight className="w-3 h-3" />
                                          )}
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          className="flex-1 min-w-0 justify-start gap-2 h-6 overflow-hidden px-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
                                        >
                                          <User className="w-3 h-3" />
                                          <span className="text-xs truncate min-w-0">
                                            {manager.name}
                                          </span>
                                        </Button>
                                      </div>

                                      {isManagerExpanded && manager.tasks.length > 0 ? (
                                        <div className="ml-6 min-w-0 space-y-0.5 overflow-x-hidden">
                                          {manager.tasks.map((task) => (
                                            <Link
                                              key={task.id}
                                              href={`/task/${project.id}/${manager.id}/${task.id}`}
                                            >
                                              <Button
                                                variant="ghost"
                                                className="w-full min-w-0 justify-start gap-2 h-6 overflow-hidden px-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
                                              >
                                                <CheckCircle2
                                                  className={`w-3 h-3 ${task.status === "completed" ? "text-green-500" : "text-muted-foreground"}`}
                                                />
                                                <span className="text-xs truncate min-w-0">
                                                  {task.name}
                                                </span>
                                              </Button>
                                            </Link>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>

      {/* Bottom Section */}
      <div className="border-t border-sidebar-border p-2.5">
        {!collapsed && !promoLoading && promoBanner && currentPromoItem ? (
          <div className="mb-2 overflow-hidden rounded-xl border border-sidebar-border bg-sidebar-accent/20">
            <button type="button" className="w-full text-left" onClick={handlePromoClick}>
              {currentPromoItem.imageUrl ? (
                <img
                  src={currentPromoItem.imageUrl}
                  alt={currentPromoItem.title}
                  className="h-24 w-full object-cover"
                />
              ) : null}
              <div className="space-y-1 px-3 py-2">
                <p className="text-sm font-semibold text-sidebar-foreground truncate">
                  {currentPromoItem.title}
                </p>
              </div>
            </button>
            <div className="flex items-center justify-between px-3 pb-2">
              <div className="flex items-center gap-1">
                {promoBanner.items.map((_, index) => (
                  <button
                    key={`promo-dot-${index}`}
                    type="button"
                    className={`h-1.5 rounded-full transition-all ${
                      promoCurrentIndex === index ? "w-4 bg-sidebar-foreground/80" : "w-1.5 bg-sidebar-foreground/30"
                    }`}
                    onClick={() => setPromoCurrentIndex(index)}
                    aria-label={`切换到第 ${index + 1} 条`}
                  />
                ))}
              </div>
              {promoBanner.allowDismiss ? (
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-sidebar-foreground"
                  onClick={handlePromoDismiss}
                >
                  关闭
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* 通知按钮 */}
        <Button
          variant="ghost"
          className={`w-full ${collapsed ? "justify-center px-0" : "justify-start gap-3 px-3"} h-9 rounded-xl text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150 mb-1 ${collapsed ? "" : "min-w-0 overflow-hidden"}`}
          onClick={() => openNotificationCenter()}
        >
          <span className="relative">
            <Bell className={`w-4 h-4 ${unreadCount > 0 ? "animate-bounce" : ""}`} />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
            )}
          </span>
          {!collapsed && (
            <span className="min-w-0 truncate text-sm font-medium">
              {t("sidebar.notifications")}
            </span>
          )}
        </Button>

        {/* 设置按钮 */}
        <Button
          variant="ghost"
          className={`w-full ${collapsed ? "justify-center px-0" : "justify-start gap-3 px-3"} h-9 rounded-xl text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150 ${collapsed ? "" : "min-w-0 overflow-hidden"}`}
          onClick={() => openSettingsDialog({ tab: "personalization" })}
        >
          <Settings className="w-4 h-4" />
          {!collapsed && (
            <span className="min-w-0 truncate text-sm font-medium">
              {t("sidebar.settings")}
            </span>
          )}
        </Button>
      </div>

      <Dialog open={tasksDialogOpen} onOpenChange={setTasksDialogOpen}>
        <DialogContent className="max-w-2xl p-0 gap-0 flex flex-col h-[80vh] max-h-[80vh] min-h-[420px] overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle>{t("sidebar.allTasks")}</DialogTitle>
            <DialogDescription>
              {t("sidebar.allTasksCount", { count: orderedSessionTasks.length })}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 min-h-0 px-4 py-4 pr-6">
            {orderedSessionTasks.length === 0 ? (
              <div className="text-sm text-muted-foreground px-2 py-6 text-center">
                {t("sidebar.noTasks")}
              </div>
            ) : (
              <div className="space-y-2">
                {orderedSessionTasks.map((session) =>
                  renderSessionTaskItem(session, {
                    onNavigate: () => {
                      setTasksDialogOpen(false);
                      navigateToSessionHistory(session.sessionId);
                    },
                  }),
                )}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sidebar.renameTitle")}</DialogTitle>
            <DialogDescription>{t("sidebar.renameDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              placeholder={t("sidebar.renamePlaceholder")}
              maxLength={80}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleRenameSubmit();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRenameDialogOpen(false);
                setRenameTarget(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => void handleRenameSubmit()}
              disabled={renameSubmitting || !renameValue.trim()}
            >
              {renameSubmitting ? t("sidebar.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProjectEditorDialog
        open={createProjectDialogOpen}
        mode="create"
        submitting={createProjectSubmitting}
        onOpenChange={setCreateProjectDialogOpen}
        onSubmit={handleCreateProjectSubmit}
      />

      <ProjectEditorDialog
        open={editProjectDialogOpen}
        mode="edit"
        project={editProjectTarget}
        submitting={editProjectSubmitting}
        onOpenChange={(open) => {
          setEditProjectDialogOpen(open);
          if (!open) {
            setEditProjectTarget(null);
          }
        }}
        onSubmit={handleEditProjectSubmit}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sidebar.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.title
                ? t("sidebar.deleteDescriptionWithTitle", { title: deleteTarget.title })
                : t("sidebar.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setDeleteDialogOpen(false);
                setDeleteTarget(null);
              }}
            >
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteConfirm();
              }}
              disabled={deleteSubmitting}
            >
              {deleteSubmitting ? t("sidebar.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteProjectDialogOpen} onOpenChange={setDeleteProjectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sidebar.projectDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteProjectTarget?.name
                ? t("sidebar.projectDeleteDescriptionWithTitle", { title: deleteProjectTarget.name })
                : t("sidebar.projectDeleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setDeleteProjectDialogOpen(false);
                setDeleteProjectTarget(null);
              }}
            >
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteProjectConfirm();
              }}
              disabled={deleteProjectSubmitting}
            >
              {deleteProjectSubmitting ? t("sidebar.deleting") : t("sidebar.projectDeleteAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
