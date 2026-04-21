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
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
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
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import React from "react";
import { toast } from "sonner";
import {
  createTaskCreationProject,
  deleteTaskCreationProject,
  deleteTaskCreationSession,
  listTaskCreationProjects,
  listTaskCreationSessions,
  renameTaskCreationSessionTitle,
  type TaskCreationProjectSummary,
  toggleTaskCreationSessionFavorite,
  updateTaskCreationProject,
  updateTaskCreationSessionProject,
  type TaskCreationSessionSummary,
} from "@/lib/task-creation-client";
import type { TaskProjectSelection } from "@/lib/task-project-selection";
import { openSettingsDialog } from "@/lib/settings-dialog-events";
import { useAuth } from "@/contexts/AuthContext";

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

export default function Sidebar({
  className = "",
  collapsed = false,
  onToggleCollapse,
  selectedProject,
}: SidebarProps) {
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
  const SESSION_PREVIEW_COUNT = 3;
  const [location, setLocation] = useLocation();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [manualProjects, setManualProjects] = React.useState<TaskCreationProjectSummary[]>([]);
  const [expandedProjectGroups, setExpandedProjectGroups] = React.useState<string[]>(["self-organized"]);
  const [expandedProjects, setExpandedProjects] = React.useState<string[]>([]);
  const [expandedManagers, setExpandedManagers] = React.useState<string[]>([]);
  const [tasksDialogOpen, setTasksDialogOpen] = React.useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = React.useState(false);
  const [sessionTasks, setSessionTasks] = React.useState<SessionTask[]>([]);
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = React.useState(false);
  const [createProjectName, setCreateProjectName] = React.useState("");
  const [createProjectDescription, setCreateProjectDescription] = React.useState("");
  const [createProjectSubmitting, setCreateProjectSubmitting] = React.useState(false);
  const [editProjectDialogOpen, setEditProjectDialogOpen] = React.useState(false);
  const [editProjectTarget, setEditProjectTarget] = React.useState<TaskCreationProjectSummary | null>(null);
  const [editProjectName, setEditProjectName] = React.useState("");
  const [editProjectDescription, setEditProjectDescription] = React.useState("");
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
  const listLoadingRef = React.useRef(false);
  const lastListFetchRef = React.useRef(0);
  const lastListErrorToastAtRef = React.useRef(0);
  const projectListLoadingRef = React.useRef(false);
  const LIST_POLL_MS = 30000;

  const sortManualProjects = React.useCallback((projects: TaskCreationProjectSummary[]) => {
    return [...projects].sort((left, right) => {
      const pinnedDelta = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
      if (pinnedDelta !== 0) return pinnedDelta;
      const leftTime = Date.parse(left.updatedAt || left.createdAt || "");
      const rightTime = Date.parse(right.updatedAt || right.createdAt || "");
      const safeLeft = Number.isFinite(leftTime) ? leftTime : 0;
      const safeRight = Number.isFinite(rightTime) ? rightTime : 0;
      if (safeRight !== safeLeft) return safeRight - safeLeft;
      return (left.name || "").localeCompare(right.name || "", "zh-CN");
    });
  }, []);

  const mapSessionTask = React.useCallback(
    (session: TaskCreationSessionSummary | any, index: number): SessionTask & { originalIndex: number } => ({
      sessionId: session.id,
      title: session.title || t("sidebar.sessionFallbackTitle", { suffix: String(session.id).slice(-6) }),
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

  React.useEffect(() => {
    let disposed = false;
    const load = async (force = false) => {
      if (disposed) return;
      if (listLoadingRef.current) return;
      if (!force && document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!force && now - lastListFetchRef.current < 3000) return;
      listLoadingRef.current = true;
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
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load(true);
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
      if (patchedSessionId) {
        setSessionTasks((prev) => {
          const nowIso = new Date().toISOString();
          const index = prev.findIndex(
            (session) => session.sessionId === patchedSessionId,
          );
          if (index >= 0) {
            const next = [...prev];
            const current = next[index];
            next[index] = {
              ...current,
              title: patchedTitle || current.title,
              status: patchedStatus || current.status,
              isFavorite: hasFavoritePatch ? Boolean(detail?.isFavorite) : current.isFavorite,
              projectId: hasProjectIdPatch ? detail?.projectId || null : current.projectId,
              projectName: hasProjectNamePatch ? detail?.projectName || null : current.projectName,
              updatedAt: nowIso,
            };
            return sortSessionTasks(next);
          }
          if (patchedTitle) {
            return sortSessionTasks([
              {
                sessionId: patchedSessionId,
                title: patchedTitle,
                status: patchedStatus || "in_progress",
                updatedAt: nowIso,
                isFavorite: hasFavoritePatch ? Boolean(detail?.isFavorite) : false,
                projectId: hasProjectIdPatch ? detail?.projectId || null : null,
                projectName: hasProjectNamePatch ? detail?.projectName || null : null,
              },
              ...prev,
            ]);
          }
          return prev;
        });
      }
      void load(true);
      window.setTimeout(() => {
        void load(true);
      }, 4000);
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

  React.useEffect(() => {
    let disposed = false;
    const loadProjects = async () => {
      if (disposed || projectListLoadingRef.current) return;
      projectListLoadingRef.current = true;
      try {
        const projects = await listTaskCreationProjects();
        if (disposed) return;
        setManualProjects(sortManualProjects(projects));
        setExpandedProjectGroups((prev) => {
          if (projects.length === 0 || prev.includes("manual-projects")) return prev;
          return ["manual-projects", ...prev];
        });
      } catch (error) {
        console.error("[Sidebar] failed to load projects:", error);
        toast.error(
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : t("sidebar.loadProjectsFailed"),
        );
      } finally {
        projectListLoadingRef.current = false;
      }
    };
    void loadProjects();
    return () => {
      disposed = true;
    };
  }, [sortManualProjects, t, user?.id]);

  const toggleProjectGroup = (groupId: string) => {
    setExpandedProjectGroups((prev) =>
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId],
    );
  };

  const toggleProject = (projectId: string) => {
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
    { icon: Network, label: t("sidebar.ceoView"), href: "/ceo-view" },
  ];

  // Preview-only scaffold for the upcoming self-organized projects feature.
  // AI maintainers: do not reshape or replace this block unless the request
  // explicitly targets that future feature.
  // This block must stay excluded from session-parent project choices.
  const selfOrganizedProjectsData: SidebarProjectNode[] = [
    {
      id: "1",
      name: "oneceo.ai",
      description: "",
      managers: [
        {
          id: "m1",
          name: "开发经理",
          type: "development",
          tasks: [
            { id: "t1", name: "API 设计与实现", status: "in_progress" },
            { id: "t2", name: "数据库优化", status: "completed" },
          ],
        },
        {
          id: "m2",
          name: "运营经理",
          type: "operations",
          tasks: [{ id: "t3", name: "用户增长策略", status: "in_progress" }],
        },
      ],
    },
    {
      id: "2",
      name: "artgen ai",
      description: "",
      managers: [
        {
          id: "m3",
          name: "设计经理",
          type: "design",
          tasks: [{ id: "t4", name: "UI/UX 设计", status: "in_progress" }],
        },
      ],
    },
    {
      id: "3",
      name: "voiceClone",
      description: "",
      managers: [],
    },
    {
      id: "4",
      name: "AI员工",
      description: "",
      managers: [],
    },
    {
      id: "5",
      name: "opencode相关",
      description: "",
      managers: [],
    },
  ].map((project) => ({
    ...project,
    kind: "self-organized" as const,
  }));
  const manualProjectNodes = React.useMemo<SidebarProjectNode[]>(
    () =>
      manualProjects.map((project) => ({
        id: project.id,
        name: project.name,
        description: project.description,
        pinned: Boolean(project.pinned),
        managers: [],
        kind: "manual" as const,
      })),
    [manualProjects],
  );
  const projectGroups = React.useMemo(
    () => [
      {
        id: "manual-projects",
        name: t("sidebar.standardProjects"),
        projects: manualProjectNodes,
      },
      {
        id: "self-organized",
        name: t("sidebar.selfOrganizedProjects"),
        projects: selfOrganizedProjectsData,
      },
    ],
    [manualProjectNodes, selfOrganizedProjectsData, t],
  );
  const assignableProjects = React.useMemo(
    () =>
      manualProjects.map((project) => ({
        id: project.id,
        name: project.name,
      })),
    [manualProjects],
  );
  // End of preview-only self-organized projects scaffold.
  const activeSessionId = React.useMemo(() => {
    const matched = location.match(/^\/session\/([^/?]+)/);
    return matched?.[1] || null;
  }, [location]);
  const orderedSessionTasks = React.useMemo(() => {
    if (!activeSessionId) {
      return sortSessionTasks(sessionTasks);
    }
    const activeIndex = sessionTasks.findIndex(
      (session) => session.sessionId === activeSessionId,
    );
    if (activeIndex <= 0) {
      return sortSessionTasks(sessionTasks);
    }
    const next = sortSessionTasks(sessionTasks);
    const sortedActiveIndex = next.findIndex(
      (session) => session.sessionId === activeSessionId,
    );
    if (sortedActiveIndex <= 0) {
      return next;
    }
    const [activeSession] = next.splice(sortedActiveIndex, 1);
    next.unshift(activeSession);
    return next;
  }, [activeSessionId, sessionTasks, sortSessionTasks]);
  const sessionPreviewList = orderedSessionTasks.slice(
    0,
    SESSION_PREVIEW_COUNT,
  );
  const hiddenSessionCount = Math.max(
    orderedSessionTasks.length - SESSION_PREVIEW_COUNT,
    0,
  );
  const hasSessionOverflow = hiddenSessionCount > 0;
  const projectSessionMap = React.useMemo(() => {
    const mapping = new Map<string, SessionTask[]>();
    for (const session of orderedSessionTasks) {
      const projectId =
        typeof session.projectId === "string" && session.projectId.trim()
          ? session.projectId.trim()
          : "";
      if (!projectId) continue;
      const current = mapping.get(projectId) || [];
      current.push(session);
      mapping.set(projectId, current);
    }
    return mapping;
  }, [orderedSessionTasks]);
  const patchSessionTask = React.useCallback((sessionId: string, patch: Partial<SessionTask>) => {
    setSessionTasks((prev) =>
      sortSessionTasks(
        prev.map((session, index) =>
          session.sessionId === sessionId
            ? {
                ...session,
                ...patch,
                updatedAt:
                  patch.updatedAt || new Date().toISOString(),
                originalIndex: index,
              }
            : { ...session, originalIndex: index },
        ),
      ),
    );
  }, [sortSessionTasks]);

  const dispatchSessionUpdate = React.useCallback((session: Partial<SessionTask> & { sessionId: string }) => {
    window.dispatchEvent(
      new CustomEvent("task-creation-session-updated", {
        detail: {
          sessionId: session.sessionId,
          title: session.title,
          status: session.status,
          isFavorite: session.isFavorite,
          projectId: session.projectId,
          projectName: session.projectName,
        },
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
    setCreateProjectName("");
    setCreateProjectDescription("");
    setCreateProjectDialogOpen(true);
  }, []);

  const openEditProjectDialog = React.useCallback((project: TaskCreationProjectSummary) => {
    setEditProjectTarget(project);
    setEditProjectName(project.name || "");
    setEditProjectDescription(project.description || "");
    setEditProjectDialogOpen(true);
  }, []);

  const openDeleteProjectDialog = React.useCallback((project: TaskCreationProjectSummary) => {
    setDeleteProjectTarget(project);
    setDeleteProjectDialogOpen(true);
  }, []);

  const handleCreateProjectSubmit = React.useCallback(async () => {
    const nextName = createProjectName.trim();
    if (!nextName) return;
    setCreateProjectSubmitting(true);
    try {
      const created = await createTaskCreationProject({
        name: nextName,
        description: createProjectDescription,
      });
      if (!created?.id) {
        throw new Error(t("sidebar.projectCreateFailed"));
      }
      setManualProjects((prev) => sortManualProjects([created, ...prev]));
      setExpandedProjectGroups((prev) =>
        prev.includes("manual-projects") ? prev : ["manual-projects", ...prev],
      );
      setExpandedProjects((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]));
      setCreateProjectDialogOpen(false);
      toast.success(t("sidebar.projectCreated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sidebar.projectCreateFailed"));
    } finally {
      setCreateProjectSubmitting(false);
    }
  }, [createProjectDescription, createProjectName, sortManualProjects, t]);

  const handleEditProjectSubmit = React.useCallback(async () => {
    const target = editProjectTarget;
    const nextName = editProjectName.trim();
    if (!target || !nextName) return;
    setEditProjectSubmitting(true);
    try {
      const updated = await updateTaskCreationProject(target.id, {
        name: nextName,
        description: editProjectDescription,
      });
      if (!updated?.id) {
        throw new Error(t("sidebar.projectUpdateFailed"));
      }
      setManualProjects((prev) =>
        sortManualProjects(prev.map((project) => (project.id === updated.id ? updated : project))),
      );
      setEditProjectDialogOpen(false);
      setEditProjectTarget(null);
      toast.success(t("sidebar.projectUpdated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sidebar.projectUpdateFailed"));
    } finally {
      setEditProjectSubmitting(false);
    }
  }, [editProjectDescription, editProjectName, editProjectTarget, sortManualProjects, t]);

  const handleToggleProjectPinned = React.useCallback(async (project: TaskCreationProjectSummary) => {
    try {
      const updated = await updateTaskCreationProject(project.id, {
        pinned: !Boolean(project.pinned),
      });
      if (!updated?.id) {
        throw new Error(t("sidebar.projectUpdateFailed"));
      }
      setManualProjects((prev) =>
        sortManualProjects(prev.map((item) => (item.id === updated.id ? updated : item))),
      );
      toast.success(updated.pinned ? t("sidebar.projectPinned") : t("sidebar.projectUnpinned"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sidebar.projectUpdateFailed"));
    }
  }, [sortManualProjects, t]);

  const handleDeleteProjectConfirm = React.useCallback(async () => {
    const target = deleteProjectTarget;
    if (!target) return;
    setDeleteProjectSubmitting(true);
    try {
      await deleteTaskCreationProject(target.id);
      setManualProjects((prev) => prev.filter((project) => project.id !== target.id));
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

  const handleProjectAssign = React.useCallback(async (
    session: SessionTask,
    projectId: string | null,
    projectName: string | null,
  ) => {
    if (moveProjectSubmitting) return;
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

  const handleDeleteConfirm = React.useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteSubmitting(true);
    try {
      await deleteTaskCreationSession(target.sessionId);
      setSessionTasks((prev) => prev.filter((session) => session.sessionId !== target.sessionId));
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
  }, [activeSessionId, deleteTarget, setLocation, t]);

  const renderSessionTaskItem = React.useCallback(
    (session: SessionTask, options?: { compact?: boolean; onNavigate?: () => void }) => {
      const compact = Boolean(options?.compact);
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
          onClick={options?.onNavigate}
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
          <ContextMenuTrigger>
            <Link
              href={`/session/${session.sessionId}?view=history`}
              className="block min-w-0 max-w-full"
            >
              {button}
            </Link>
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
    [assignableProjects, handleFavoriteToggle, handleProjectAssign, moveProjectSubmitting, openCreateProjectDialog, openDeleteDialog, openRenameDialog, t],
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
            const isActive = location === item.href;
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
                <div className="space-y-1">
                  {projectGroups.map((group) => {
                    const isGroupExpanded = expandedProjectGroups.includes(group.id);
                    return (
                      <div key={group.id} className="space-y-1">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={() => toggleProjectGroup(group.id)}
                          >
                            {isGroupExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            className="flex-1 min-w-0 justify-start gap-2 h-7 overflow-hidden px-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
                            onClick={() => toggleProjectGroup(group.id)}
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                            <span className="text-sm truncate min-w-0">
                              {group.name}
                            </span>
                          </Button>
                        </div>

                        {isGroupExpanded && (
                          <div className="ml-4 min-w-0 space-y-0.5 overflow-x-hidden">
                            {group.projects.length === 0 && group.id === "manual-projects" ? (
                              <div className="px-2 py-2 text-xs leading-5 text-muted-foreground">
                                {t("sidebar.noManualProjects")}
                              </div>
                            ) : null}
                            {group.projects.map((project) => {
                              const sourceProject =
                                project.kind === "manual"
                                  ? manualProjects.find((item) => item.id === project.id) || null
                                  : null;
                              const isExpanded = expandedProjects.includes(project.id);
                              const isProjectActive =
                                selectedProject?.id === project.id &&
                                selectedProject?.kind === project.kind;
                              const projectSessions = projectSessionMap.get(project.id) || [];
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
                                    {project.kind === "manual" ? (
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
                                            <span>{t("sidebar.projectPinAction")}</span>
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
                                    ) : (
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
                                    )}
                                  </div>

                                  {isExpanded && project.kind === "manual" && projectSessions.length > 0 ? (
                                    <div className="ml-7 min-w-0 space-y-0.5 overflow-x-hidden">
                                      {projectSessions.map((session) =>
                                        renderSessionTaskItem(session, { compact: true }),
                                      )}
                                    </div>
                                  ) : null}

                                  {isExpanded && project.kind === "self-organized" && project.managers.length > 0 ? (
                                    <div className="ml-7 min-w-0 space-y-0.5 overflow-x-hidden">
                                      {project.managers.map((manager) => {
                                        const isManagerExpanded = expandedManagers.includes(
                                          manager.id,
                                        );
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

                                            {isManagerExpanded &&
                                              manager.tasks.length > 0 && (
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
                                              )}
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
                    );
                  })}
                </div>

                {hasSessionOverflow && (
                  <Button
                    variant="ghost"
                    className="mt-1 h-8 w-full min-w-0 justify-start gap-2 overflow-hidden px-3 text-muted-foreground hover:text-sidebar-foreground"
                    onClick={() => setTasksDialogOpen(true)}
                  >
                    <span className="truncate text-sm">
                      {t("sidebar.viewMore")} ({hiddenSessionCount})
                    </span>
                  </Button>
                )}

                {sessionTasks.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {sessionPreviewList.map((session) =>
                      renderSessionTaskItem(session, { compact: true }),
                    )}
                  </div>
                )}

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
              </div>
            </ScrollArea>
          </div>
        )}
      </div>

      {/* Bottom Section */}
      <div
        className="border-t border-sidebar-border p-2.5"
        onMouseEnter={() => setSettingsMenuOpen(true)}
        onMouseLeave={() => setSettingsMenuOpen(false)}
      >
        <DropdownMenu
          open={settingsMenuOpen}
          onOpenChange={setSettingsMenuOpen}
        >
          <DropdownMenuTrigger asChild>
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
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            className="w-72 p-0 rounded-2xl border border-border shadow-lg"
          >
            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-3 mb-3">
                <Avatar className="h-12 w-12">
                  <AvatarImage
                    src={user?.email ? `https://avatar.vercel.sh/${encodeURIComponent(user.email)}` : undefined}
                    alt={user?.displayName || user?.email || t("account.title")}
                  />
                  <AvatarFallback>{(user?.displayName || user?.email || "U").slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-foreground truncate">
                    {user?.displayName || user?.email || t("userMenu.guestName")}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {user?.email || t("userMenu.guestSubtitle")}
                  </div>
                </div>
              </div>
              <div className="bg-accent/50 rounded-xl p-3 border border-border">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Coins className="w-4 h-4 text-amber-500" />
                    <span className="text-sm font-medium text-foreground">
                      {t("sidebar.credits")}
                    </span>
                  </div>
                  <span className="text-sm font-bold text-foreground">
                    13,639
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-purple-500" />
                  <span className="text-xs text-muted-foreground">
                    {t("sidebar.proMember")}
                  </span>
                </div>
              </div>
            </div>
            <div className="p-2">
              <DropdownMenuItem className="rounded-lg py-2.5 px-3">
                <Bell className="w-4 h-4 mr-2 text-muted-foreground" />
                <span className="text-sm">{t("sidebar.notifications")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="rounded-lg py-2.5 px-3"
                onSelect={() => openSettingsDialog({ tab: "settings" })}
              >
                <Settings className="w-4 h-4 mr-2 text-muted-foreground" />
                <span className="text-sm">{t("sidebar.settings")}</span>
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
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
                    onNavigate: () => setTasksDialogOpen(false),
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

      <Dialog open={createProjectDialogOpen} onOpenChange={setCreateProjectDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("sidebar.createProjectTitle")}</DialogTitle>
            <DialogDescription>{t("sidebar.createProjectDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sidebar-create-project-name">{t("sidebar.projectNameLabel")}</Label>
              <Input
                id="sidebar-create-project-name"
                value={createProjectName}
                onChange={(event) => setCreateProjectName(event.target.value)}
                placeholder={t("sidebar.projectNamePlaceholder")}
                maxLength={80}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleCreateProjectSubmit();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sidebar-create-project-description">
                {t("sidebar.projectDescriptionLabel")}
              </Label>
              <Textarea
                id="sidebar-create-project-description"
                value={createProjectDescription}
                onChange={(event) => setCreateProjectDescription(event.target.value)}
                placeholder={t("sidebar.projectDescriptionPlaceholder")}
                maxLength={300}
                className="min-h-[112px] resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateProjectDialogOpen(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => void handleCreateProjectSubmit()}
              disabled={createProjectSubmitting || !createProjectName.trim()}
            >
              {createProjectSubmitting ? t("sidebar.creatingProject") : t("sidebar.createProjectAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editProjectDialogOpen} onOpenChange={setEditProjectDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("sidebar.projectEditTitle")}</DialogTitle>
            <DialogDescription>{t("sidebar.projectEditDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sidebar-edit-project-name">{t("sidebar.projectNameLabel")}</Label>
              <Input
                id="sidebar-edit-project-name"
                value={editProjectName}
                onChange={(event) => setEditProjectName(event.target.value)}
                placeholder={t("sidebar.projectNamePlaceholder")}
                maxLength={80}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleEditProjectSubmit();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sidebar-edit-project-description">
                {t("sidebar.projectDescriptionLabel")}
              </Label>
              <Textarea
                id="sidebar-edit-project-description"
                value={editProjectDescription}
                onChange={(event) => setEditProjectDescription(event.target.value)}
                placeholder={t("sidebar.projectDescriptionPlaceholder")}
                maxLength={300}
                className="min-h-[112px] resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditProjectDialogOpen(false);
                setEditProjectTarget(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => void handleEditProjectSubmit()}
              disabled={editProjectSubmitting || !editProjectName.trim()}
            >
              {editProjectSubmitting ? t("sidebar.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
