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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  Bell,
  Coins,
  Crown,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useTranslation } from 'react-i18next';
import React from 'react';
import { listTaskCreationSessions } from '@/lib/task-creation-client';
import { openSettingsDialog } from "@/lib/settings-dialog-events";

interface SidebarProps {
  className?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  selectedProjectId?: string | null;
  onProjectSelect?: (projectId: string | null) => void;
}

export default function Sidebar({ className = "", collapsed = false, onToggleCollapse, selectedProjectId, onProjectSelect }: SidebarProps) {
  const SESSION_PREVIEW_COUNT = 3;
  const [location, setLocation] = useLocation();
  const { t } = useTranslation();
  const [expandedProjects, setExpandedProjects] = React.useState<string[]>([]);
  const [expandedManagers, setExpandedManagers] = React.useState<string[]>([]);
  const [tasksDialogOpen, setTasksDialogOpen] = React.useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = React.useState(false);
  const [sessionTasks, setSessionTasks] = React.useState<Array<{
    sessionId: string;
    title: string;
    status: string;
    updatedAt?: string;
  }>>([]);
  const listLoadingRef = React.useRef(false);
  const lastListFetchRef = React.useRef(0);
  const LIST_POLL_MS = 30000;

  React.useEffect(() => {
    let disposed = false;
    const load = async (force = false) => {
      if (disposed) return;
      if (listLoadingRef.current) return;
      if (!force && document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (!force && now - lastListFetchRef.current < 3000) return;
      listLoadingRef.current = true;
      try {
        const list = await listTaskCreationSessions('all');
        if (disposed) return;
        const mapped = list
          .map((session: any, index: number) => ({
            sessionId: session.id,
            title: session.title || `任务会话 ${String(session.id).slice(-6)}`,
            status: session.status || "in_progress",
            updatedAt:
              typeof session.updatedAt === "string" && session.updatedAt.trim()
                ? session.updatedAt
                : undefined,
            originalIndex: index,
          }))
          .sort((left, right) => {
            const leftTime = Date.parse(left.updatedAt || "");
            const rightTime = Date.parse(right.updatedAt || "");
            const safeLeftTime = Number.isFinite(leftTime) ? leftTime : 0;
            const safeRightTime = Number.isFinite(rightTime) ? rightTime : 0;
            if (safeRightTime !== safeLeftTime) {
              return safeRightTime - safeLeftTime;
            }
            return left.originalIndex - right.originalIndex;
          })
          .map(({ originalIndex, ...session }) => session);
        setSessionTasks(mapped);
        lastListFetchRef.current = Date.now();
      } catch {
        // ignore
      } finally {
        listLoadingRef.current = false;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load(true);
      }
    };
    const onSessionUpdated = () => {
      void load(true);
    };
    void load(true);
    const timer = window.setInterval(() => {
      void load(false);
    }, LIST_POLL_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('task-creation-session-updated', onSessionUpdated);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('task-creation-session-updated', onSessionUpdated);
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
  const activeSessionId = React.useMemo(() => {
    const matched = location.match(/^\/session\/([^/?]+)/);
    return matched?.[1] || null;
  }, [location]);
  const orderedSessionTasks = React.useMemo(() => {
    if (!activeSessionId) {
      return sessionTasks;
    }
    const activeIndex = sessionTasks.findIndex((session) => session.sessionId === activeSessionId);
    if (activeIndex <= 0) {
      return sessionTasks;
    }
    const next = [...sessionTasks];
    const [activeSession] = next.splice(activeIndex, 1);
    next.unshift(activeSession);
    return next;
  }, [activeSessionId, sessionTasks]);
  const sessionPreviewList = orderedSessionTasks.slice(0, SESSION_PREVIEW_COUNT);
  const hiddenSessionCount = Math.max(orderedSessionTasks.length - SESSION_PREVIEW_COUNT, 0);
  const hasSessionOverflow = hiddenSessionCount > 0;
  const formatSessionStatus = (status: string) => {
    if (status === "completed") return "完成";
    if (status === "waiting_user") return "待补充";
    return "进行中";
  };

  return (
    <aside
      className={`fixed left-4 top-4 bottom-4 ${collapsed ? 'w-16' : 'w-60'} bg-sidebar border border-sidebar-border flex flex-col shadow-lg rounded-3xl backdrop-blur-sm transition-all duration-300 ${className}`}
    >
      {/* Logo */}
      <div className={`h-14 flex items-center ${collapsed ? "px-3 justify-center" : "px-4 justify-between"} border-b border-sidebar-border relative`}>
        <Link href="/">
          <div className={`flex items-center ${collapsed ? "justify-center" : "gap-2"} cursor-pointer shrink-0`}>
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
      <ScrollArea className="flex-1">
        <div className={`p-3 space-y-1 ${collapsed ? "items-center" : ""}`}>
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
                  }`}
                  onClick={() => {
                    setLocation(`/new-task?new=${Date.now()}`);
                    onProjectSelect?.(null);
                  }}
                >
                  <Icon className="w-4 h-4" />
                  {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
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
                      className="flex-1 min-w-0 justify-start gap-2 h-7 px-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
                      onClick={() => onProjectSelect?.(project.id)}
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span className="text-sm truncate min-w-0">{project.name}</span>
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
                                className="flex-1 min-w-0 justify-start gap-2 h-6 px-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
                              >
                                <User className="w-3 h-3" />
                                <span className="text-xs truncate min-w-0">{manager.name}</span>
                              </Button>
                            </div>

                            {/* Tasks */}
                            {isManagerExpanded && manager.tasks.length > 0 && (
                              <div className="ml-6 space-y-0.5">
                                {manager.tasks.map((task: any) => (
                                  <Link key={task.id} href={`/task/${project.id}/${manager.id}/${task.id}`}>
                                    <Button
                                      variant="ghost"
                                      className="w-full min-w-0 justify-start gap-2 h-6 px-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
                                    >
                                      <CheckCircle2 className={`w-3 h-3 ${task.status === 'completed' ? 'text-green-500' : 'text-muted-foreground'}`} />
                                      <span className="text-xs truncate min-w-0">{task.name}</span>
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
                <Link key={session.sessionId} href={`/session/${session.sessionId}?view=history`}>
                  <Button
                    variant="ghost"
                    className="w-full min-w-0 justify-start gap-2 h-7 px-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span className="text-xs truncate flex-1 min-w-0 text-left">{session.title}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
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
              {orderedSessionTasks.length}
            </span>
          </Button>
        </div>}
      </ScrollArea>

      {/* Bottom Section */}
      <div
        className="border-t border-sidebar-border p-3"
        onMouseEnter={() => setSettingsMenuOpen(true)}
        onMouseLeave={() => setSettingsMenuOpen(false)}
      >
        <DropdownMenu open={settingsMenuOpen} onOpenChange={setSettingsMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className={`w-full ${collapsed ? "justify-center px-0" : "justify-start gap-3 px-3"} h-9 rounded-xl text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150`}
              onClick={() => openSettingsDialog({ tab: "settings" })}
            >
              <Settings className="w-4 h-4" />
              {!collapsed && <span className="text-sm font-medium">{t('sidebar.settings')}</span>}
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
                  <AvatarImage src="https://avatar.vercel.sh/user" alt="User" />
                  <AvatarFallback>U</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-foreground truncate">
                    John Doe
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    john.doe@example.com
                  </div>
                </div>
              </div>
              <div className="bg-accent/50 rounded-xl p-3 border border-border">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Coins className="w-4 h-4 text-amber-500" />
                    <span className="text-sm font-medium text-foreground">Credits</span>
                  </div>
                  <span className="text-sm font-bold text-foreground">13,639</span>
                </div>
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-purple-500" />
                  <span className="text-xs text-muted-foreground">Pro Member</span>
                </div>
              </div>
            </div>
            <div className="p-2">
              <DropdownMenuItem className="rounded-lg py-2.5 px-3">
                <Bell className="w-4 h-4 mr-2 text-muted-foreground" />
                <span className="text-sm">通知</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="rounded-lg py-2.5 px-3"
                onSelect={() => openSettingsDialog({ tab: "settings" })}
              >
                <Settings className="w-4 h-4 mr-2 text-muted-foreground" />
                <span className="text-sm">设置</span>
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={tasksDialogOpen} onOpenChange={setTasksDialogOpen}>
        <DialogContent className="max-w-2xl p-0 gap-0 flex flex-col h-[80vh] max-h-[80vh] min-h-[420px] overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle>{t('sidebar.allTasks')}</DialogTitle>
            <DialogDescription>
              {`共 ${orderedSessionTasks.length} 个任务会话`}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 min-h-0 px-4 py-4 pr-6">
            {orderedSessionTasks.length === 0 ? (
              <div className="text-sm text-muted-foreground px-2 py-6 text-center">
                暂无任务会话
              </div>
            ) : (
              <div className="space-y-2">
                {orderedSessionTasks.map((session) => (
                <Link key={session.sessionId} href={`/session/${session.sessionId}?view=history`}>
                    <Button
                      variant="ghost"
                      className="w-full min-w-0 justify-between h-10 px-3 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors duration-150"
                      onClick={() => setTasksDialogOpen(false)}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 shrink-0" />
                        <span className="text-sm truncate min-w-0">{session.title}</span>
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
