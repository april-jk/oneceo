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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useTranslation } from 'react-i18next';
import React from 'react';
import { listTaskCreationSessions } from '@/lib/task-creation-client';

interface SidebarProps {
  className?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  selectedProjectId?: string | null;
  onProjectSelect?: (projectId: string | null) => void;
}

export default function Sidebar({ className = "", collapsed = false, onToggleCollapse, selectedProjectId, onProjectSelect }: SidebarProps) {
  const SESSION_PREVIEW_COUNT = 3;
  const [location] = useLocation();
  const { t } = useTranslation();
  const [expandedProjects, setExpandedProjects] = React.useState<string[]>([]);
  const [expandedManagers, setExpandedManagers] = React.useState<string[]>([]);
  const [tasksDialogOpen, setTasksDialogOpen] = React.useState(false);
  const [sessionTasks, setSessionTasks] = React.useState<Array<{
    sessionId: string;
    title: string;
    status: string;
  }>>([]);

  React.useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const list = await listTaskCreationSessions(20);
        if (disposed) return;
        const mapped = list.map((session: any) => ({
          sessionId: session.id,
          title: session.title || `任务会话 ${String(session.id).slice(-6)}`,
          status: session.status || "in_progress",
        }));
        setSessionTasks(mapped);
      } catch {
        // ignore
      }
    };
    void load();
    const timer = window.setInterval(load, 6000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const toggleProject = (projectId: string) => {
    setExpandedProjects(prev => 
      prev.includes(projectId) 
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId]
    );
  };

  const toggleManager = (managerId: string) => {
    setExpandedManagers(prev => 
      prev.includes(managerId) 
        ? prev.filter(id => id !== managerId)
        : [...prev, managerId]
    );
  };

  const navItems = [
    { icon: PlusCircle, label: t('sidebar.newTask'), href: "/new-task" },
    { icon: Search, label: t('sidebar.search'), href: "/search" },
    { icon: Library, label: t('sidebar.library'), href: "/library" },
    { icon: FolderOpen, label: t('sidebar.projects'), href: "/projects" },
    { icon: Network, label: t('sidebar.ceoView'), href: "/ceo-view" },
  ];

  const projectsData = [
    {
      id: "1",
      name: "oneceo.ai",
      managers: [
        {
          id: "m1",
          name: "开发经理",
          type: "development",
          tasks: [
            { id: "t1", name: "API 设计与实现", status: "in_progress" },
            { id: "t2", name: "数据库优化", status: "completed" },
          ]
        },
        {
          id: "m2",
          name: "运营经理",
          type: "operations",
          tasks: [
            { id: "t3", name: "用户增长策略", status: "in_progress" },
          ]
        }
      ]
    },
    {
      id: "2",
      name: "artgen ai",
      managers: [
        {
          id: "m3",
          name: "设计经理",
          type: "design",
          tasks: [
            { id: "t4", name: "UI/UX 设计", status: "in_progress" },
          ]
        }
      ]
    },
    {
      id: "3",
      name: "voiceClone",
      managers: []
    },
    {
      id: "4",
      name: "AI员工",
      managers: []
    },
    {
      id: "5",
      name: "opencode相关",
      managers: []
    },
  ];
  const sessionPreviewList = sessionTasks.slice(0, SESSION_PREVIEW_COUNT);
  const hiddenSessionCount = Math.max(sessionTasks.length - SESSION_PREVIEW_COUNT, 0);
  const hasSessionOverflow = hiddenSessionCount > 0;
  const formatSessionStatus = (status: string) => {
    if (status === "completed") return "完成";
    if (status === "waiting_user") return "待补充";
    return "进行中";
  };

  return (
    <aside
      className={`fixed left-0 top-0 h-screen ${collapsed ? 'w-16' : 'w-60'} bg-sidebar border-r border-sidebar-border flex flex-col shadow-sm transition-all duration-300 ${className}`}
    >
      {/* Logo */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-sidebar-border">
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer">
            <img 
              src="/logo.png"
              alt="oneceo"
              className="w-8 h-8 rounded-xl"
            />
            {!collapsed && (
              <span className="font-semibold text-sidebar-foreground text-base">
                oneceo
              </span>
            )}
          </div>
        </Link>
        {onToggleCollapse && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
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
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1">
          {navItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            const isNewTask = index === 0; // First item is New Task
            
            return (
              <Link key={item.href} href={item.href}>
                <Button
                  variant={isNewTask ? "default" : "ghost"}
                  className={`w-full justify-start gap-3 h-9 px-3 rounded-xl transition-all duration-150 ${
                    isNewTask
                      ? "bg-foreground hover:bg-foreground/90 text-background"
                      : isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
                </Button>
              </Link>
            );
          })}
        </div>

        {!collapsed && <Separator className="my-3 bg-sidebar-border" />}

        {/* Projects Section */}
        {!collapsed && <div className="px-3 pb-3">
          <div className="flex items-center justify-between mb-2 px-3">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t('sidebar.projects').toUpperCase()}
            </span>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <PlusCircle className="w-4 h-4" />
            </Button>
          </div>
          <div className="space-y-1">
            {projectsData.map((project) => {
              const isExpanded = expandedProjects.includes(project.id);
              return (
                <div key={project.id} className="space-y-0.5">
                  {/* Project */}
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
                      className="flex-1 justify-start gap-2 h-7 px-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
                      onClick={() => onProjectSelect?.(project.id)}
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span className="text-sm truncate">{project.name}</span>
                    </Button>
                  </div>

                  {/* Managers */}
                  {isExpanded && project.managers.length > 0 && (
                    <div className="ml-7 space-y-0.5">
                      {project.managers.map((manager) => {
                        const isManagerExpanded = expandedManagers.includes(manager.id);
                        return (
                          <div key={manager.id} className="space-y-0.5">
                            {/* Manager */}
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
                                className="flex-1 justify-start gap-2 h-6 px-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
                              >
                                <User className="w-3 h-3" />
                                <span className="text-xs truncate">{manager.name}</span>
                              </Button>
                            </div>

                            {/* Tasks */}
                            {isManagerExpanded && manager.tasks.length > 0 && (
                              <div className="ml-6 space-y-0.5">
                                {manager.tasks.map((task: any) => (
                                  <Link key={task.id} href={`/task/${project.id}/${manager.id}/${task.id}`}>
                                    <Button
                                      variant="ghost"
                                      className="w-full justify-start gap-2 h-6 px-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
                                    >
                                      <CheckCircle2 className={`w-3 h-3 ${task.status === 'completed' ? 'text-green-500' : 'text-muted-foreground'}`} />
                                      <span className="text-xs truncate">{task.name}</span>
                                    </Button>
                                  </Link>
                                ))}
                              </div>
                            )}
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
              className="w-full justify-start gap-2 h-8 px-3 mt-1 text-muted-foreground hover:text-sidebar-foreground"
              onClick={() => setTasksDialogOpen(true)}
            >
              <span className="text-sm">
                {t('sidebar.viewMore')} ({hiddenSessionCount})
              </span>
            </Button>
          )}

          {sessionTasks.length > 0 && (
            <div className="mt-2 space-y-1">
              {sessionPreviewList.map((session) => (
                <Link key={session.sessionId} href={`/new-task?sessionId=${session.sessionId}`}>
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-2 h-7 px-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span className="text-xs truncate flex-1 text-left">{session.title}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatSessionStatus(session.status)}
                    </span>
                  </Button>
                </Link>
              ))}
            </div>
          )}
        </div>}

        {!collapsed && <Separator className="my-3 bg-sidebar-border" />}

        {/* All Tasks */}
        {!collapsed && <div className="px-3 pb-3">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 h-9 px-3 rounded-xl text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
            onClick={() => setTasksDialogOpen(true)}
          >
            <FileText className="w-4 h-4" />
            <span className="text-sm font-medium">{t('sidebar.allTasks')}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {sessionTasks.length}
            </span>
          </Button>
        </div>}
      </ScrollArea>

      {/* Bottom Section */}
      <div className="border-t border-sidebar-border p-3">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 h-9 px-3 rounded-xl text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
        >
          <Settings className="w-4 h-4" />
          {!collapsed && <span className="text-sm font-medium">{t('sidebar.settings')}</span>}
        </Button>
      </div>

      <Dialog open={tasksDialogOpen} onOpenChange={setTasksDialogOpen}>
        <DialogContent className="max-w-2xl p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle>{t('sidebar.allTasks')}</DialogTitle>
            <DialogDescription>
              {`共 ${sessionTasks.length} 个任务会话`}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[65vh] px-4 py-4">
            {sessionTasks.length === 0 ? (
              <div className="text-sm text-muted-foreground px-2 py-6 text-center">
                暂无任务会话
              </div>
            ) : (
              <div className="space-y-2">
                {sessionTasks.map((session) => (
                  <Link key={session.sessionId} href={`/new-task?sessionId=${session.sessionId}`}>
                    <Button
                      variant="ghost"
                      className="w-full justify-between h-10 px-3 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
                      onClick={() => setTasksDialogOpen(false)}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 shrink-0" />
                        <span className="text-sm truncate">{session.title}</span>
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatSessionStatus(session.status)}
                      </span>
                    </Button>
                  </Link>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
