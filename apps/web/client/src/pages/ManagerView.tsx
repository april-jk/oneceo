/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * Manager View Page - Project-centric Manager and Employee Management
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import WorkspaceLayout from "@/components/WorkspaceLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen,
  Users,
  User,
  ChevronDown,
  ChevronRight,
  Plus,
  MoreVertical,
  BarChart,
  Eye,
  Pin,
  Layers3,
  FileText,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { SELF_ORGANIZED_PROJECTS } from "@/lib/self-organized-projects";
import { useSharedManualProjects } from "@/lib/shared-manual-projects";
import {
  listTaskCreationProjectSessions,
  summarizeProjectInstruction,
  type TaskCreationSessionSummary,
} from "@/lib/task-creation-client";
import { isDevRuntime } from "@/lib/runtime-env";
import { GuidedTour, type GuidedTourStep } from "@/components/GuidedTour";

type ProjectSessionItem = {
  sessionId: string;
  title: string;
  status: string;
  updatedAt?: string;
};

const PROJECTS_OVERVIEW_TOUR_KEY = "oneceo:tour.projects.overview.completed";
const PROJECTS_OVERVIEW_STEPS: GuidedTourStep[] = [
  {
    id: "create-project",
    selector: '[data-tour="projects-create-button"]',
    title: "新建项目",
    body: "项目用于把多个会话和任务收拢到同一个目标下。需要长期指令、默认连接器或复盘交付时，再新建项目。",
    placement: "left",
  },
  {
    id: "manual-projects",
    selector: '[data-tour="projects-manual-section"]',
    title: "普通项目",
    body: "普通项目由你创建，后续任务可以归属进来。项目指令会作为长期约束影响相关会话。",
    placement: "bottom",
  },
  {
    id: "self-organized-projects",
    selector: '[data-tour="projects-self-organized-toggle"]',
    title: "自组织项目",
    body: "这里展示系统示例或已形成组织结构的项目，适合查看经理和员工分工。",
    placement: "top",
  },
  {
    id: "project-card",
    selector: '[data-tour="projects-self-organized-card"]',
    title: "项目卡片",
    body: "进度、经理数、员工数帮助你快速判断执行状态。点击查看详情进入项目层级。",
    placement: "top",
  },
  {
    id: "manager-row",
    selector: '[data-tour="projects-manager-row"]',
    title: "经理与员工",
    body: "经理负责一个方向的任务拆分和协调；展开后能看到员工技能、状态和当前任务。",
    placement: "top",
  },
];

export default function ManagerView() {
  const showSelfOrganizedProjects = isDevRuntime();
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { projects: manualProjects } = useSharedManualProjects(user?.id);
  const [manualProjectSessions, setManualProjectSessions] = useState<
    Record<string, ProjectSessionItem[]>
  >({});
  const [manualProjectSessionLoading, setManualProjectSessionLoading] = useState<
    Record<string, boolean>
  >({});
  const [expandedManualProjects, setExpandedManualProjects] = useState<Record<string, boolean>>({});
  const [expandedSelfOrganizedProjects, setExpandedSelfOrganizedProjects] = useState<
    Record<string, boolean>
  >({
    "1": true,
  });
  const [expandedManagers, setExpandedManagers] = useState<Record<string, boolean>>({
    m1: true,
    m2: true,
  });
  const [selfOrganizedExpanded, setSelfOrganizedExpanded] = useState(true);

  const toggleManualProject = (projectId: string) => {
    setExpandedManualProjects((prev) => ({
      ...prev,
      [projectId]: !prev[projectId],
    }));
  };

  const toggleSelfOrganizedProject = (projectId: string) => {
    setExpandedSelfOrganizedProjects((prev) => ({
      ...prev,
      [projectId]: !prev[projectId],
    }));
  };

  const toggleManager = (managerId: string) => {
    setExpandedManagers((prev) => ({
      ...prev,
      [managerId]: !prev[managerId],
    }));
  };

  const getEmployeeStatusColor = (status: string) => {
    switch (status) {
      case "idle":
        return "bg-gray-500";
      case "busy":
        return "bg-yellow-500";
      case "offline":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  const getEmployeeStatusText = (status: string) => {
    switch (status) {
      case "idle":
        return t("managerView.employeeIdle");
      case "busy":
        return t("managerView.employeeBusy");
      case "offline":
        return t("managerView.employeeOffline");
      default:
        return status;
    }
  };

  const getProjectStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-[var(--brand-solid)]";
      case "completed":
        return "bg-green-500";
      case "paused":
        return "bg-orange-500";
      default:
        return "bg-gray-500";
    }
  };

  const getProjectStatusText = (status: string) => {
    switch (status) {
      case "active":
        return t("managerView.projectActive");
      case "completed":
        return t("managerView.projectCompleted");
      case "paused":
        return t("managerView.projectPaused");
      default:
        return status;
    }
  };

  const requestCreateProject = () => {
    window.dispatchEvent(new CustomEvent("task-creation-project-create-requested"));
  };

  const resolveSessionTitle = (session: Pick<TaskCreationSessionSummary, "title" | "status">) => {
    const title = typeof session.title === "string" ? session.title.trim() : "";
    if (title) return title;
    return session.status === "waiting_user"
      ? t("sidebar.sessionWaitingFallbackTitle")
      : t("sidebar.sessionFallbackTitle");
  };

  const mapProjectSession = (session: TaskCreationSessionSummary): ProjectSessionItem => ({
    sessionId: session.id,
    title: resolveSessionTitle(session),
    status: session.status || "in_progress",
    updatedAt:
      typeof session.updatedAt === "string" && session.updatedAt.trim()
        ? session.updatedAt
        : undefined,
  });

  const getSessionStatusLabel = (status: string) => {
    const normalized = status.trim().toLowerCase();
    if (normalized === "completed") return t("sidebar.statusCompleted");
    if (normalized === "waiting_user") return t("sidebar.statusWaitingUser");
    return t("sidebar.statusInProgress");
  };

  const getSessionStatusClassName = (status: string) => {
    const normalized = status.trim().toLowerCase();
    if (normalized === "completed") return "bg-emerald-50 text-emerald-700";
    if (normalized === "waiting_user") return "bg-amber-50 text-amber-700";
    return "bg-slate-100 text-slate-700";
  };

  const manualProjectIdsKey = useMemo(
    () => manualProjects.map((project) => project.id).join("|"),
    [manualProjects],
  );

  useEffect(() => {
    const validProjectIds = new Set(manualProjects.map((project) => project.id));
    setManualProjectSessions((prev) => {
      const nextEntries = Object.entries(prev).filter(([projectId]) => validProjectIds.has(projectId));
      if (nextEntries.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(nextEntries);
    });
    setManualProjectSessionLoading((prev) => {
      const nextEntries = Object.entries(prev).filter(([projectId]) => validProjectIds.has(projectId));
      if (nextEntries.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(nextEntries);
    });
  }, [manualProjects]);

  useEffect(() => {
    setExpandedManualProjects((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const project of manualProjects) {
        if (typeof next[project.id] !== "boolean") {
          next[project.id] = true;
          changed = true;
        }
      }
      for (const projectId of Object.keys(next)) {
        if (!manualProjects.some((project) => project.id === projectId)) {
          delete next[projectId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [manualProjects]);

  useEffect(() => {
    if (manualProjects.length === 0) return;

    let cancelled = false;
    setManualProjectSessionLoading((prev) => {
      const next = { ...prev };
      for (const project of manualProjects) {
        next[project.id] = true;
      }
      return next;
    });

    void Promise.all(
      manualProjects.map(async (project) => {
        try {
          const sessions = await listTaskCreationProjectSessions(project.id);
          if (cancelled) return;
          setManualProjectSessions((prev) => ({
            ...prev,
            [project.id]: sessions.map(mapProjectSession),
          }));
        } catch {
          if (cancelled) return;
          setManualProjectSessions((prev) => ({
            ...prev,
            [project.id]: [],
          }));
        } finally {
          if (cancelled) return;
          setManualProjectSessionLoading((prev) => ({
            ...prev,
            [project.id]: false,
          }));
        }
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [manualProjectIdsKey, manualProjects, t]);

  return (
    <WorkspaceLayout>
      <div className="space-y-6">
        <GuidedTour
          storageKey={PROJECTS_OVERVIEW_TOUR_KEY}
          steps={PROJECTS_OVERVIEW_STEPS}
          autoStart
        />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t("managerView.title")}</h1>
            <p className="mt-1 text-muted-foreground">{t("managerView.subtitle")}</p>
          </div>
          <Button data-tour="projects-create-button" className="gap-2" onClick={requestCreateProject}>
            <Plus className="h-4 w-4" />
            {t("managerView.createProject")}
          </Button>
        </div>

        <section data-tour="projects-manual-section" className="space-y-4">
          <div className="flex items-center gap-2">
            <Layers3 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("sidebar.projects")}
            </h2>
          </div>

          {manualProjects.length === 0 ? (
            <Card className="border-dashed p-6">
              <div className="flex items-center gap-3">
                <FolderOpen className="h-5 w-5 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">{t("sidebar.noManualProjects")}</p>
                  <p className="text-sm text-muted-foreground">{t("projectsPage.subtitle")}</p>
                </div>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {manualProjects.map((project) => (
                <Card key={project.id} className="overflow-hidden p-0">
                  <div className="flex gap-3 px-5 py-4">
                    <div className="flex w-6 justify-center pt-1">
                      <button
                        type="button"
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        onClick={() => toggleManualProject(project.id)}
                        aria-label={expandedManualProjects[project.id] ? "Collapse project" : "Expand project"}
                      >
                        {expandedManualProjects[project.id] ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    <div className="min-w-0 flex-1 space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex items-center gap-2">
                            <FolderOpen className="h-4 w-4 text-muted-foreground" />
                            <button
                              type="button"
                              className="truncate text-left text-base font-semibold text-foreground transition-colors hover:text-primary"
                              onClick={() => setLocation(`/project/${encodeURIComponent(project.id)}`)}
                            >
                              {project.name}
                            </button>
                            {project.pinned ? (
                              <Pin className="h-3.5 w-3.5 fill-current text-amber-500" />
                            ) : null}
                            <Badge variant="outline" className="shrink-0">
                              {project.status?.trim() || "active"}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {summarizeProjectInstruction(project.projectInstruction) ||
                              t("projectsPage.projectDescriptionPlaceholder")}
                          </p>
                          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              <FileText className="h-3.5 w-3.5" />
                              {project.updatedAt || project.createdAt
                                ? new Date(project.updatedAt || project.createdAt || "").toLocaleDateString()
                                : "--"}
                            </span>
                            <span>
                              {t("sidebar.allTasksCount", {
                                count: manualProjectSessions[project.id]?.length || 0,
                              })}
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => setLocation(`/project/${encodeURIComponent(project.id)}`)}
                        >
                          <Eye className="h-4 w-4" />
                          {t("managerView.viewDetails")}
                        </Button>
                      </div>

                      <AnimatePresence initial={false}>
                        {expandedManualProjects[project.id] ? (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.18 }}
                            className="overflow-hidden"
                          >
                            <div className="relative pl-6">
                              <div className="absolute bottom-3 left-[0.6875rem] top-0 w-px bg-border" />
                              {manualProjectSessionLoading[project.id] ? (
                                <div className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                                  {t("common.loading")}
                                </div>
                              ) : (manualProjectSessions[project.id] || []).length === 0 ? (
                                <div className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                                  {t("sidebar.noTasks")}
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  {(manualProjectSessions[project.id] || []).map((session) => (
                                    <div key={session.sessionId} className="relative pl-5">
                                      <div className="absolute left-0 top-1/2 h-px w-3 bg-border" />
                                      <button
                                        type="button"
                                        className="flex w-full items-center justify-between gap-3 rounded-xl bg-muted/20 px-3 py-3 text-left transition-colors hover:bg-accent/40"
                                        onClick={() =>
                                          setLocation(
                                            `/session/${encodeURIComponent(session.sessionId)}?view=history`,
                                          )
                                        }
                                      >
                                        <div className="min-w-0 space-y-1">
                                          <div className="truncate text-sm font-medium text-foreground">
                                            {session.title}
                                          </div>
                                          <div className="text-xs text-muted-foreground">
                                            {session.updatedAt
                                              ? new Date(session.updatedAt).toLocaleString()
                                              : "--"}
                                          </div>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2">
                                          <span
                                            className={`rounded-full px-2 py-1 text-[11px] font-medium ${getSessionStatusClassName(session.status)}`}
                                          >
                                            {getSessionStatusLabel(session.status)}
                                          </span>
                                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                                        </div>
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {showSelfOrganizedProjects ? (
          <section data-tour="projects-self-organized-section" className="space-y-4">
            <button
              type="button"
              data-tour="projects-self-organized-toggle"
              className="flex w-full items-center justify-between rounded-2xl border border-border/70 bg-card px-4 py-3 text-left transition-colors hover:bg-accent/30"
              onClick={() => setSelfOrganizedExpanded((prev) => !prev)}
            >
              <div className="flex items-center gap-3">
                <FolderOpen className="h-5 w-5 text-muted-foreground" />
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    {t("sidebar.selfOrganizedProjects")}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {SELF_ORGANIZED_PROJECTS.length}
                  </p>
                </div>
              </div>
              {selfOrganizedExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </button>

            <AnimatePresence initial={false}>
              {selfOrganizedExpanded ? (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4 overflow-hidden"
                >
                  {SELF_ORGANIZED_PROJECTS.map((project, projectIndex) => (
                    <Card key={project.id} className="p-6">
                    <div
                      data-tour={projectIndex === 0 ? "projects-self-organized-card" : undefined}
                      className="mb-4 flex items-start justify-between"
                    >
                      <div className="flex-1">
                        <div className="mb-2 flex items-center gap-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => toggleSelfOrganizedProject(project.id)}
                          >
                            {expandedSelfOrganizedProjects[project.id] ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                          <FolderOpen className="h-5 w-5 text-muted-foreground" />
                          <h3
                            className="cursor-pointer text-xl font-semibold transition-colors hover:text-primary"
                            onClick={() => setLocation(`/project/${project.id}`)}
                          >
                            {project.name}
                          </h3>
                          <Badge className={`${getProjectStatusColor(project.status)} text-white`}>
                            {getProjectStatusText(project.status)}
                          </Badge>
                        </div>
                        <p className="ml-12 text-sm text-muted-foreground">{project.description}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => setLocation(`/project/${project.id}`)}
                      >
                        <Eye className="h-4 w-4" />
                        {t("managerView.viewDetails")}
                      </Button>
                    </div>

                    <div className="mb-4 ml-12 flex items-center gap-6">
                      <div className="flex items-center gap-2 text-sm">
                        <BarChart className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">{t("managerView.progressLabel")}</span>
                        <span className="font-medium">{project.progress}%</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">{t("managerView.managersLabel")}</span>
                        <span className="font-medium">{project.managers.length}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">{t("managerView.employeesLabel")}</span>
                        <span className="font-medium">
                          {project.managers.reduce((sum, manager) => sum + manager.employees.length, 0)}
                        </span>
                      </div>
                    </div>

                    <AnimatePresence>
                      {expandedSelfOrganizedProjects[project.id] ? (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="ml-12 space-y-3"
                        >
                          {project.managers.map((manager, managerIndex) => (
                            <div
                              key={manager.id}
                              data-tour={
                                projectIndex === 0 && managerIndex === 0
                                  ? "projects-manager-row"
                                  : undefined
                              }
                              className="rounded-lg border-l-4 border-primary bg-muted/30 p-4"
                            >
                              <div className="mb-3 flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="mb-1 flex items-center gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0"
                                      onClick={() => toggleManager(manager.id)}
                                    >
                                      {expandedManagers[manager.id] ? (
                                        <ChevronDown className="h-3 w-3" />
                                      ) : (
                                        <ChevronRight className="h-3 w-3" />
                                      )}
                                    </Button>
                                    <Users className="h-4 w-4 text-muted-foreground" />
                                    <span className="font-medium">{manager.type}</span>
                                    <span className="text-sm text-muted-foreground">({manager.name})</span>
                                    <Badge variant="outline">
                                      {t("managerView.employeesCount", {
                                        count: manager.employees.length,
                                      })}
                                    </Badge>
                                  </div>
                                  {manager.description ? (
                                    <p className="ml-8 text-xs text-muted-foreground">{manager.description}</p>
                                  ) : null}
                                </div>
                                <div className="flex gap-2">
                                  <Button variant="outline" size="sm" className="h-7">
                                    <Plus className="mr-1 h-3 w-3" />
                                    {t("managerView.addEmployee")}
                                  </Button>
                                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                    <MoreVertical className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>

                              <AnimatePresence>
                                {expandedManagers[manager.id] ? (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: "auto", opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="ml-8 space-y-2"
                                  >
                                    {manager.employees.map((employee) => (
                                      <div
                                        key={employee.id}
                                        className="flex items-center justify-between rounded-md bg-background p-3"
                                      >
                                        <div className="flex flex-1 items-center gap-3">
                                          <User className="h-4 w-4 text-muted-foreground" />
                                          <div className="flex-1">
                                            <div className="mb-1 flex items-center gap-2">
                                              <span className="text-sm font-medium">{employee.name}</span>
                                              <div className="flex items-center gap-1">
                                                <div
                                                  className={`h-2 w-2 rounded-full ${getEmployeeStatusColor(employee.status)}`}
                                                />
                                                <span className="text-xs text-muted-foreground">
                                                  {getEmployeeStatusText(employee.status)}
                                                </span>
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              {employee.skills.map((skill) => (
                                                <Badge key={skill} variant="secondary" className="text-xs">
                                                  {skill}
                                                </Badge>
                                              ))}
                                            </div>
                                            {employee.currentTask ? (
                                              <p className="mt-1 text-xs text-muted-foreground">
                                                {t("managerView.currentTask", {
                                                  value: employee.currentTask,
                                                })}
                                              </p>
                                            ) : null}
                                          </div>
                                        </div>
                                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                          <MoreVertical className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    ))}
                                  </motion.div>
                                ) : null}
                              </AnimatePresence>
                            </div>
                          ))}
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                    </Card>
                  ))}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </section>
        ) : null}
      </div>
    </WorkspaceLayout>
  );
}
