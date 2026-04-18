/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * Manager View Page - Project-centric Manager and Employee Management
 */

import { useState } from "react";
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
} from "lucide-react";

// 数据类型定义
interface Employee {
  id: string;
  managerId: string;
  name: string;
  skills: string[];
  status: "idle" | "busy" | "offline";
  currentTask?: string;
}

interface Manager {
  id: string;
  projectId: string;
  type: string;
  name: string;
  description?: string;
  employees: Employee[];
}

interface Project {
  id: string;
  name: string;
  description: string;
  progress: number;
  status: "active" | "completed" | "paused";
  managers: Manager[];
}

// 模拟数据
const mockProjects: Project[] = [
  {
    id: "1",
    name: "E-commerce Platform",
    description: "构建完整的电商平台，包含前端、后端和数据库",
    progress: 65,
    status: "active",
    managers: [
      {
        id: "m1",
        projectId: "1",
        type: "开发经理",
        name: "Development Manager",
        description: "负责所有开发工作的协调和管理",
        employees: [
          {
            id: "e1",
            managerId: "m1",
            name: "Frontend Developer Agent",
            skills: ["React", "TypeScript", "Tailwind CSS"],
            status: "busy",
            currentTask: "实现购物车功能",
          },
          {
            id: "e2",
            managerId: "m1",
            name: "Backend Developer Agent",
            skills: ["Node.js", "Express", "PostgreSQL"],
            status: "busy",
            currentTask: "开发支付 API",
          },
          {
            id: "e3",
            managerId: "m1",
            name: "Database Agent",
            skills: ["PostgreSQL", "Redis", "MongoDB"],
            status: "idle",
          },
        ],
      },
      {
        id: "m2",
        projectId: "1",
        type: "设计经理",
        name: "Design Manager",
        description: "负责用户体验和界面设计",
        employees: [
          {
            id: "e4",
            managerId: "m2",
            name: "UI Designer Agent",
            skills: ["Figma", "Sketch", "Adobe XD"],
            status: "busy",
            currentTask: "设计产品详情页",
          },
          {
            id: "e5",
            managerId: "m2",
            name: "UX Researcher Agent",
            skills: ["User Testing", "Analytics", "Wireframing"],
            status: "idle",
          },
        ],
      },
      {
        id: "m3",
        projectId: "1",
        type: "QA 经理",
        name: "QA Manager",
        description: "负责质量保证和测试",
        employees: [
          {
            id: "e6",
            managerId: "m3",
            name: "Test Engineer Agent",
            skills: ["Jest", "Cypress", "Testing Library"],
            status: "busy",
            currentTask: "编写单元测试",
          },
          {
            id: "e7",
            managerId: "m3",
            name: "Automation Agent",
            skills: ["Selenium", "Puppeteer", "Playwright"],
            status: "idle",
          },
          {
            id: "e8",
            managerId: "m3",
            name: "Performance Tester Agent",
            skills: ["JMeter", "Lighthouse", "WebPageTest"],
            status: "offline",
          },
        ],
      },
    ],
  },
  {
    id: "2",
    name: "Mobile App Development",
    description: "开发跨平台移动应用",
    progress: 40,
    status: "active",
    managers: [
      {
        id: "m4",
        projectId: "2",
        type: "开发经理",
        name: "Mobile Development Manager",
        description: "负责移动端开发",
        employees: [
          {
            id: "e9",
            managerId: "m4",
            name: "iOS Developer Agent",
            skills: ["Swift", "SwiftUI", "UIKit"],
            status: "busy",
            currentTask: "实现登录功能",
          },
          {
            id: "e10",
            managerId: "m4",
            name: "Android Developer Agent",
            skills: ["Kotlin", "Jetpack Compose", "Android SDK"],
            status: "busy",
            currentTask: "实现推送通知",
          },
          {
            id: "e11",
            managerId: "m4",
            name: "API Developer Agent",
            skills: ["REST", "GraphQL", "WebSocket"],
            status: "idle",
          },
        ],
      },
      {
        id: "m5",
        projectId: "2",
        type: "设计经理",
        name: "Mobile Design Manager",
        description: "负责移动端设计",
        employees: [
          {
            id: "e12",
            managerId: "m5",
            name: "Mobile Designer Agent",
            skills: ["Figma", "Principle", "Protopie"],
            status: "busy",
            currentTask: "设计用户引导流程",
          },
          {
            id: "e13",
            managerId: "m5",
            name: "Icon Designer Agent",
            skills: ["Illustrator", "Sketch", "Icon Design"],
            status: "idle",
          },
        ],
      },
    ],
  },
  {
    id: "3",
    name: "Marketing Campaign",
    description: "市场营销活动策划和执行",
    progress: 90,
    status: "active",
    managers: [
      {
        id: "m6",
        projectId: "3",
        type: "市场调研经理",
        name: "Market Research Manager",
        description: "负责市场调研和分析",
        employees: [
          {
            id: "e14",
            managerId: "m6",
            name: "Market Analyst Agent",
            skills: ["Data Analysis", "Trends", "Forecasting"],
            status: "busy",
            currentTask: "分析竞争对手",
          },
          {
            id: "e15",
            managerId: "m6",
            name: "Competitor Research Agent",
            skills: ["SWOT", "Benchmarking", "Industry Analysis"],
            status: "idle",
          },
        ],
      },
      {
        id: "m7",
        projectId: "3",
        type: "运营经理",
        name: "Operations Manager",
        description: "负责内容创作和社交媒体运营",
        employees: [
          {
            id: "e16",
            managerId: "m7",
            name: "Content Creator Agent",
            skills: ["Copywriting", "SEO", "Content Strategy"],
            status: "busy",
            currentTask: "撰写博客文章",
          },
          {
            id: "e17",
            managerId: "m7",
            name: "Social Media Agent",
            skills: ["Twitter", "LinkedIn", "Instagram"],
            status: "busy",
            currentTask: "发布社交媒体内容",
          },
        ],
      },
    ],
  },
];

export default function ManagerView() {
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  const [projects] = useState<Project[]>(mockProjects);
  const [expandedProjects, setExpandedProjects] = useState<{
    [key: string]: boolean;
  }>({ "1": true });
  const [expandedManagers, setExpandedManagers] = useState<{
    [key: string]: boolean;
  }>({ m1: true, m2: true });

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => ({
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

  const getStatusColor = (status: string) => {
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

  const getStatusText = (status: string) => {
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
        return "bg-blue-500";
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

  return (
    <WorkspaceLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t("managerView.title")}</h1>
            <p className="text-muted-foreground mt-1">
              {t("managerView.subtitle")}
            </p>
          </div>
          <Button className="gap-2">
            <Plus className="w-4 h-4" />
            {t("managerView.createProject")}
          </Button>
        </div>

        {/* 项目列表 */}
        <div className="space-y-4">
          {projects.map((project) => (
            <Card key={project.id} className="p-6">
              {/* 项目头部 */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => toggleProject(project.id)}
                    >
                      {expandedProjects[project.id] ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </Button>
                    <FolderOpen className="w-5 h-5 text-muted-foreground" />
                    <h2 
                      className="text-xl font-semibold cursor-pointer hover:text-primary transition-colors"
                      onClick={() => setLocation(`/project/${project.id}`)}
                    >
                      {project.name}
                    </h2>
                    <Badge
                      className={`${getProjectStatusColor(project.status)} text-white`}
                    >
                      {getProjectStatusText(project.status)}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground ml-12">
                    {project.description}
                  </p>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="gap-2"
                  onClick={() => setLocation(`/project/${project.id}`)}
                >
                  <Eye className="w-4 h-4" />
                  {t("managerView.viewDetails")}
                </Button>
              </div>

              {/* 项目统计 */}
              <div className="flex items-center gap-6 ml-12 mb-4">
                <div className="flex items-center gap-2 text-sm">
                  <BarChart className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t("managerView.progressLabel")}</span>
                  <span className="font-medium">{project.progress}%</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t("managerView.managersLabel")}</span>
                  <span className="font-medium">{project.managers.length}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <User className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t("managerView.employeesLabel")}</span>
                  <span className="font-medium">
                    {project.managers.reduce(
                      (sum, m) => sum + m.employees.length,
                      0
                    )}
                  </span>
                </div>
              </div>

              {/* 经理列表 */}
              <AnimatePresence>
                {expandedProjects[project.id] && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-3 ml-12"
                  >
                    {project.managers.map((manager) => (
                      <div
                        key={manager.id}
                        className="bg-muted/30 rounded-lg p-4 border-l-4 border-primary"
                      >
                        {/* 经理头部 */}
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => toggleManager(manager.id)}
                              >
                                {expandedManagers[manager.id] ? (
                                  <ChevronDown className="w-3 h-3" />
                                ) : (
                                  <ChevronRight className="w-3 h-3" />
                                )}
                              </Button>
                              <Users className="w-4 h-4 text-muted-foreground" />
                              <span className="font-medium">
                                {manager.type}
                              </span>
                              <span className="text-sm text-muted-foreground">
                                ({manager.name})
                              </span>
                              <Badge variant="outline">
                                {t("managerView.employeesCount", { count: manager.employees.length })}
                              </Badge>
                            </div>
                            {manager.description && (
                              <p className="text-xs text-muted-foreground ml-8">
                                {manager.description}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" className="h-7">
                              <Plus className="w-3 h-3 mr-1" />
                              {t("managerView.addEmployee")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                            >
                              <MoreVertical className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>

                        {/* 员工列表 */}
                        <AnimatePresence>
                          {expandedManagers[manager.id] && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="space-y-2 ml-8"
                            >
                              {manager.employees.map((employee) => (
                                <div
                                  key={employee.id}
                                  className="bg-background rounded-md p-3 flex items-center justify-between"
                                >
                                  <div className="flex items-center gap-3 flex-1">
                                    <User className="w-4 h-4 text-muted-foreground" />
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="text-sm font-medium">
                                          {employee.name}
                                        </span>
                                        <div className="flex items-center gap-1">
                                          <div
                                            className={`w-2 h-2 rounded-full ${getStatusColor(employee.status)}`}
                                          />
                                          <span className="text-xs text-muted-foreground">
                                            {getStatusText(employee.status)}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {employee.skills.map((skill) => (
                                          <Badge
                                            key={skill}
                                            variant="secondary"
                                            className="text-xs"
                                          >
                                            {skill}
                                          </Badge>
                                        ))}
                                      </div>
                                      {employee.currentTask && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                          {t("managerView.currentTask", { value: employee.currentTask })}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0"
                                  >
                                    <MoreVertical className="w-3 h-3" />
                                  </Button>
                                </div>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}

                    {/* 添加经理按钮 */}
                    <Button variant="outline" className="w-full" size="sm">
                      <Plus className="w-4 h-4 mr-2" />
                      {t("managerView.addManager")}
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          ))}
        </div>
      </div>
    </WorkspaceLayout>
  );
}
