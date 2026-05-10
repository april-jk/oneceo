/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * Project Detail Page - Task-Employee View
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Plus, ChevronDown, ChevronRight, User, Users, Briefcase, CheckCircle, XCircle, Clock, FileText, ArrowLeft, FolderOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'wouter';
import WorkspaceLayout from '@/components/WorkspaceLayout';
import { useTranslation } from 'react-i18next';
import { EmployeeDeliverableViewer } from '@/components/DeliverableViewer';
import TaskDocumentsDialog from '@/components/TaskDocumentsDialog';
import { GuidedTour, type GuidedTourStep } from '@/components/GuidedTour';

interface EmployeeAssignment {
  employeeId: string;
  employeeName: string;
  role: string;
  status: 'pending' | 'in-progress' | 'completed';
  deliverable?: {
    id: string;
    title: string;
    content: string;
    submittedAt: string;
    attachments: Array<{ name: string; size: string; url: string }>;
    evaluation?: 'perfect' | 'acceptable' | 'rejected';
    feedback?: string;
  };
}

interface Task {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  deadline: string;
  status: 'pending' | 'in-progress' | 'completed';
  assignedEmployees: EmployeeAssignment[];
  expanded: boolean;
}

interface Manager {
  id: string;
  name: string;
  type: 'development' | 'operations' | 'maintenance' | 'research' | 'design' | 'qa';
  description: string;
  tasks: Task[];
  expanded: boolean;
}

interface ProjectDetailProps {
  projectId?: string;
  onBack?: () => void;
}

const PROJECT_DETAIL_TOUR_KEY = 'oneceo:tour.project_detail.completed';
const PROJECT_DETAIL_STEPS: GuidedTourStep[] = [
  {
    id: 'create-manager',
    selector: '[data-tour="project-detail-create-manager"]',
    title: '创建经理',
    body: '需要新增职责线时再创建经理。经理负责一个方向的任务拆分、协调和验收。',
    placement: 'left',
  },
  {
    id: 'manager-card',
    selector: '[data-tour="project-detail-manager-card"]',
    title: '经理卡片',
    body: '每个经理代表一条职责线，例如开发、运营、设计或 QA。展开后可以查看它负责的任务。',
    placement: 'bottom',
  },
  {
    id: 'task-card',
    selector: '[data-tour="project-detail-task-card"]',
    title: '任务卡片',
    body: '任务展示优先级、状态、截止日期和参与员工。点击任务可以展开协作员工与交付状态。',
    placement: 'top',
  },
  {
    id: 'task-documents',
    selector: '[data-tour="project-detail-task-documents"]',
    title: '交付文档',
    body: '这里是验收证据，不只是聊天记录。进入后可以查看该任务下的全部交付文档。',
    placement: 'left',
  },
];

export default function ProjectDetail({ projectId: propProjectId, onBack }: ProjectDetailProps = {}) {
  const [location] = useLocation();
  const { t } = useTranslation();
  const projectId = propProjectId || location.split('/').pop();

  const [managers, setManagers] = useState<Manager[]>([
    {
      id: 'm1',
      name: '开发经理',
      type: 'development',
      description: '负责项目的技术开发和架构设计',
      expanded: true,
      tasks: [
        {
          id: 't1',
          title: 'API 设计与实现',
          description: '设计并实现用户管理相关的 REST API 端点',
          priority: 'high',
          deadline: '2026/2/15',
          status: 'completed',
          expanded: false,
          assignedEmployees: [
            {
              employeeId: 'e1',
              employeeName: 'Backend Developer Agent',
              role: 'API 开发',
              status: 'completed',
              deliverable: {
                id: 'd1',
                title: 'API Design',
                content: 'Completed API design with OpenAPI specification. Includes 15 endpoints for user management.\n\nKey Features:\n- RESTful design principles\n- Authentication and authorization\n- Rate limiting\n- Comprehensive error handling\n- API versioning support',
                submittedAt: '2026/2/10 00:00:00',
                attachments: [
                  { name: 'api-spec.yaml', size: '45 KB', url: '#' },
                  { name: 'api-documentation.pdf', size: '2.3 MB', url: '#' },
                ],
                evaluation: 'perfect',
                feedback: 'Excellent work! The API design is comprehensive and follows best practices.',
              },
            },
            {
              employeeId: 'e2',
              employeeName: 'Database Agent',
              role: '数据库设计',
              status: 'completed',
              deliverable: {
                id: 'd2',
                title: 'Database Schema',
                content: 'Designed optimized database schema with proper indexing and relationships.\n\nKey Features:\n- Normalized schema design\n- Efficient indexing strategy\n- Foreign key constraints\n- Migration scripts included',
                submittedAt: '2026/2/09 00:00:00',
                attachments: [
                  { name: 'schema.sql', size: '28 KB', url: '#' },
                  { name: 'er-diagram.png', size: '1.2 MB', url: '#' },
                ],
                evaluation: 'acceptable',
                feedback: 'Good work, but some indexes could be optimized further.',
              },
            },
          ],
        },
        {
          id: 't2',
          title: '前端界面开发',
          description: '实现用户仪表板和管理界面',
          priority: 'high',
          deadline: '2026/2/20',
          status: 'in-progress',
          expanded: false,
          assignedEmployees: [
            {
              employeeId: 'e3',
              employeeName: 'Frontend Developer Agent',
              role: 'UI 实现',
              status: 'in-progress',
            },
            {
              employeeId: 'e4',
              employeeName: 'UX Designer Agent',
              role: '交互设计',
              status: 'completed',
              deliverable: {
                id: 'd3',
                title: 'UI Design Mockups',
                content: 'Created comprehensive UI mockups for all dashboard screens.\n\nDeliverables:\n- High-fidelity mockups\n- Interactive prototypes\n- Design system documentation\n- Responsive layouts',
                submittedAt: '2026/2/08 00:00:00',
                attachments: [
                  { name: 'mockups.fig', size: '15 MB', url: '#' },
                  { name: 'design-system.pdf', size: '3.5 MB', url: '#' },
                ],
                evaluation: 'perfect',
                feedback: 'Outstanding design work! Very user-friendly and modern.',
              },
            },
          ],
        },
        {
          id: 't3',
          title: '性能优化',
          description: '优化数据库查询和 API 响应时间',
          priority: 'medium',
          deadline: '2026/2/25',
          status: 'pending',
          expanded: false,
          assignedEmployees: [
            {
              employeeId: 'e1',
              employeeName: 'Backend Developer Agent',
              role: 'API 优化',
              status: 'pending',
            },
          ],
        },
      ],
    },
    {
      id: 'm2',
      name: '运营经理',
      type: 'operations',
      description: '负责项目运营策略和用户增长',
      expanded: false,
      tasks: [
        {
          id: 't4',
          title: '内容营销策略',
          description: '制定 3 个月的内容营销计划',
          priority: 'medium',
          deadline: '2026/3/1',
          status: 'in-progress',
          expanded: false,
          assignedEmployees: [
            {
              employeeId: 'e5',
              employeeName: 'Marketing Agent',
              role: '市场推广',
              status: 'in-progress',
            },
            {
              employeeId: 'e6',
              employeeName: 'Content Writer Agent',
              role: '内容创作',
              status: 'in-progress',
            },
          ],
        },
      ],
    },
  ]);

  const [createManagerOpen, setCreateManagerOpen] = useState(false);
  const [selectedDeliverable, setSelectedDeliverable] = useState<EmployeeAssignment['deliverable'] | null>(null);
  const [deliverableViewerOpen, setDeliverableViewerOpen] = useState(false);
  const [selectedTaskForDocs, setSelectedTaskForDocs] = useState<Task | null>(null);

  const toggleManager = (managerId: string) => {
    setManagers(managers.map(m => 
      m.id === managerId ? { ...m, expanded: !m.expanded } : m
    ));
  };

  const toggleTask = (managerId: string, taskId: string) => {
    setManagers(managers.map(m => 
      m.id === managerId 
        ? {
            ...m,
            tasks: m.tasks.map(t => 
              t.id === taskId ? { ...t, expanded: !t.expanded } : t
            ),
          }
        : m
    ));
  };

  const viewDeliverable = (deliverable: EmployeeAssignment['deliverable']) => {
    setSelectedDeliverable(deliverable);
    setDeliverableViewerOpen(true);
  };

  const getManagerTypeLabel = (type: Manager['type']) => {
    const labels = {
      development: t('projectDetail.managerTypes.development'),
      operations: t('projectDetail.managerTypes.operations'),
      maintenance: t('projectDetail.managerTypes.maintenance'),
      research: t('projectDetail.managerTypes.research'),
      design: t('projectDetail.managerTypes.design'),
      qa: 'QA',
    };
    return labels[type];
  };

  const getManagerTypeColor = (type: Manager['type']) => {
    const colors = {
      development: 'border border-[var(--brand-border)] bg-[var(--brand-soft)] text-[var(--brand-soft-foreground)]',
      operations: 'bg-green-100 text-green-700',
      maintenance: 'bg-yellow-100 text-yellow-700',
      research: 'bg-purple-100 text-purple-700',
      design: 'bg-pink-100 text-pink-700',
      qa: 'bg-orange-100 text-orange-700',
    };
    return colors[type];
  };

  const getPriorityColor = (priority: Task['priority']) => {
    const colors = {
      low: 'bg-gray-100 text-gray-700',
      medium: 'bg-yellow-100 text-yellow-700',
      high: 'bg-red-100 text-red-700',
    };
    return colors[priority];
  };

  const getPriorityLabel = (priority: Task['priority']) => {
    const labels = {
      low: t('projectDetail.priority.low'),
      medium: t('projectDetail.priority.medium'),
      high: t('projectDetail.priority.high'),
    };
    return labels[priority];
  };

  const getStatusIcon = (status: Task['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'in-progress':
        return <Clock className="h-4 w-4 text-[var(--brand-link)]" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusLabel = (status: Task['status']) => {
    const labels = {
      pending: t('projectDetail.status.pending'),
      'in-progress': t('projectDetail.status.inProgress'),
      completed: t('projectDetail.status.completed'),
    };
    return labels[status];
  };

  const getEvaluationBadge = (evaluation?: 'perfect' | 'acceptable' | 'rejected') => {
    if (!evaluation) return null;
    
    const styles = {
      perfect: 'bg-green-100 text-green-700',
      acceptable: 'border border-[var(--brand-border)] bg-[var(--brand-soft)] text-[var(--brand-soft-foreground)]',
      rejected: 'bg-red-100 text-red-700',
    };
    
    const labels = {
      perfect: t('projectDetail.evaluation.perfect'),
      acceptable: t('projectDetail.evaluation.acceptable'),
      rejected: t('projectDetail.evaluation.rejected'),
    };
    
    return (
      <Badge className={`${styles[evaluation]} text-xs`}>
        {labels[evaluation]}
      </Badge>
    );
  };

  return (
      <div className="flex-1 flex flex-col">
        <GuidedTour
          storageKey={PROJECT_DETAIL_TOUR_KEY}
          steps={PROJECT_DETAIL_STEPS}
          autoStart
        />
        {/* Header */}
        <div className="border-b border-border bg-background px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              {onBack && (
                <Button variant="ghost" size="sm" onClick={onBack} className="gap-2 mb-3">
                  <ArrowLeft className="w-4 h-4" />
                  {t('projectDetail.backToProjects')}
                </Button>
              )}
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <span>{t('projectDetail.breadcrumbProjects')}</span>
                <ChevronRight className="w-3 h-3" />
                <span className="text-foreground font-medium">{t('projectDetail.projectNumber', { projectId })}</span>
              </div>
              <h1 className="text-2xl font-semibold text-foreground">
                {t('projectDetail.title')}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {t('projectDetail.subtitle')}
              </p>
            </div>
            <Dialog open={createManagerOpen} onOpenChange={setCreateManagerOpen}>
              <DialogTrigger asChild>
                <Button data-tour="project-detail-create-manager" className="gap-2">
                  <Plus className="w-4 h-4" />
                  {t('projectDetail.createManager')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('projectDetail.createManagerTitle')}</DialogTitle>
                  <DialogDescription>
                    {t('projectDetail.createManagerDescription')}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="manager-name">{t('projectDetail.managerNameLabel')}</Label>
                    <Input id="manager-name" placeholder={t('projectDetail.managerNamePlaceholder')} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="manager-type">{t('projectDetail.managerTypeLabel')}</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder={t('projectDetail.managerTypePlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="development">{t('projectDetail.managerTypes.development')}</SelectItem>
                        <SelectItem value="operations">{t('projectDetail.managerTypes.operations')}</SelectItem>
                        <SelectItem value="maintenance">{t('projectDetail.managerTypes.maintenance')}</SelectItem>
                        <SelectItem value="research">{t('projectDetail.managerTypes.research')}</SelectItem>
                        <SelectItem value="design">{t('projectDetail.managerTypes.design')}</SelectItem>
                        <SelectItem value="qa">QA</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="manager-description">{t('projectDetail.managerDescriptionLabel')}</Label>
                    <Textarea
                      id="manager-description"
                      placeholder={t('projectDetail.managerDescriptionPlaceholder')}
                      rows={3}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setCreateManagerOpen(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button onClick={() => setCreateManagerOpen(false)}>
                    {t('projectDetail.createManager')}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Main Content */}
        <ScrollArea className="flex-1">
          <div className="p-6 space-y-4">
            {managers.map((manager, managerIndex) => (
              <motion.div
                key={manager.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Card
                  data-tour={managerIndex === 0 ? 'project-detail-manager-card' : undefined}
                  className="overflow-hidden"
                >
                  <CardHeader 
                    className="cursor-pointer hover:bg-muted/50 transition-colors" 
                    onClick={() => toggleManager(manager.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {manager.expanded ? (
                          <ChevronDown className="w-5 h-5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-5 h-5 text-muted-foreground" />
                        )}
                        <Briefcase className="w-5 h-5 text-foreground" />
                        <div>
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-lg">{manager.name}</CardTitle>
                            <Badge className={getManagerTypeColor(manager.type)}>
                              {getManagerTypeLabel(manager.type)}
                            </Badge>
                          </div>
                          <CardDescription className="mt-1">
                            {manager.description}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Briefcase className="w-4 h-4" />
                          <span>{t('projectDetail.taskCount', { count: manager.tasks.length })}</span>
                        </div>
                      </div>
                    </div>
                  </CardHeader>

                  <AnimatePresence>
                    {manager.expanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                      >
                        <CardContent className="pt-0 space-y-3">
                          {manager.tasks.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground">
                              {t('projectDetail.noTasks')}
                            </div>
                          ) : (
                            manager.tasks.map((task, taskIndex) => (
                              <Card
                                key={task.id}
                                data-tour={managerIndex === 0 && taskIndex === 0 ? 'project-detail-task-card' : undefined}
                                className="border-l-4 border-l-foreground/20"
                              >
                                <CardHeader 
                                  className="cursor-pointer hover:bg-muted/30 transition-colors py-4"
                                  onClick={() => toggleTask(manager.id, task.id)}
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3 flex-1">
                                      {task.expanded ? (
                                        <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                      ) : (
                                        <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <CardTitle className="text-base">{task.title}</CardTitle>
                                          <Badge className={getPriorityColor(task.priority)}>
                                            {getPriorityLabel(task.priority)}
                                          </Badge>
                                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                            {getStatusIcon(task.status)}
                                            <span>{getStatusLabel(task.status)}</span>
                                          </div>
                                        </div>
                                        <CardDescription className="mt-1">
                                          {task.description}
                                        </CardDescription>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-4 text-sm text-muted-foreground flex-shrink-0 ml-4">
                                      <div className="flex items-center gap-1">
                                        <Users className="w-4 h-4" />
                                        <span>{t('projectDetail.employeeCount', { count: task.assignedEmployees.length })}</span>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <Clock className="w-4 h-4" />
                                        <span>{task.deadline}</span>
                                      </div>
                                      <Button
                                        data-tour={managerIndex === 0 && taskIndex === 0 ? 'project-detail-task-documents' : undefined}
                                        size="sm"
                                        variant="outline"
                                        className="gap-2"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedTaskForDocs(task);
                                        }}
                                      >
                                        <FolderOpen className="w-4 h-4" />
                                        {t('projectDetail.viewAllDocuments')}
                                      </Button>
                                    </div>
                                  </div>
                                </CardHeader>

                                <AnimatePresence>
                                  {task.expanded && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.2 }}
                                    >
                                      <CardContent className="pt-0 space-y-3">
                                        <Separator />
                                        <div className="space-y-2">
                                          <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                                            <Users className="w-4 h-4" />
                                            {t('projectDetail.collaborators')}
                                          </h4>
                                          {task.assignedEmployees.map((assignment) => (
                                            <div
                                              key={assignment.employeeId}
                                              className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
                                            >
                                              <div className="flex items-center gap-3 flex-1">
                                                <User className="w-4 h-4 text-muted-foreground" />
                                                <div className="flex-1">
                                                  <div className="flex items-center gap-2">
                                                    <span className="font-medium text-sm">
                                                      {assignment.employeeName}
                                                    </span>
                                                    <Badge variant="outline" className="text-xs">
                                                      {assignment.role}
                                                    </Badge>
                                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                      {getStatusIcon(assignment.status)}
                                                      <span>{getStatusLabel(assignment.status)}</span>
                                                    </div>
                                                    {assignment.deliverable?.evaluation && 
                                                      getEvaluationBadge(assignment.deliverable.evaluation)
                                                    }
                                                  </div>
                                                </div>
                                              </div>
                                              {assignment.deliverable && (
                                                <Button
                                                  size="sm"
                                                  variant="outline"
                                                  className="gap-2 flex-shrink-0"
                                                  onClick={() => viewDeliverable(assignment.deliverable)}
                                                >
                                                  <FileText className="w-4 h-4" />
                                                  {t('projectDetail.viewDeliverable')}
                                                </Button>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      </CardContent>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </Card>
                            ))
                          )}
                        </CardContent>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              </motion.div>
            ))}
          </div>
        </ScrollArea>

        {/* Deliverable Viewer Dialog */}
        {selectedDeliverable && (
          <EmployeeDeliverableViewer
            deliverable={{
              id: selectedDeliverable.id,
              taskId: '',
              taskTitle: selectedDeliverable.title,
              employeeName: '员工',
              submittedAt: new Date(selectedDeliverable.submittedAt),
              content: selectedDeliverable.content,
              attachments: selectedDeliverable.attachments,
              evaluation: selectedDeliverable.evaluation ? {
                rating: selectedDeliverable.evaluation === 'perfect' ? 'perfect' : selectedDeliverable.evaluation === 'acceptable' ? 'acceptable' : 'unacceptable',
                feedback: selectedDeliverable.feedback || '',
                evaluatedAt: new Date(),
              } : undefined,
            }}
            open={deliverableViewerOpen}
            onOpenChange={setDeliverableViewerOpen}
          />
        )}

        {/* Task Documents Dialog */}
        <TaskDocumentsDialog
          task={selectedTaskForDocs}
          open={!!selectedTaskForDocs}
          onOpenChange={(open) => !open && setSelectedTaskForDocs(null)}
        />
      </div>
  );
}
