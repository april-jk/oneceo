/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * Manager Node Page - Task Assignment and Employee Management
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
import { Plus, Users, CheckCircle, XCircle, Star, Clock, User, Briefcase, Calendar, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import WorkspaceLayout from '@/components/WorkspaceLayout';
import { useTranslation } from 'react-i18next';
import { EmployeeDeliverableViewer, ManagerDeliverableViewer, type EmployeeDeliverable, type ManagerDeliverable } from '@/components/DeliverableViewer';

interface Employee {
  id: string;
  name: string;
  role: string;
  skills: string[];
  tasksCompleted: number;
  performance: {
    perfect: number;
    acceptable: number;
    rejected: number;
  };
}

interface AssignedTask {
  id: string;
  title: string;
  description: string;
  assignedTo: string;
  dueDate: Date;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in-progress' | 'completed' | 'rejected';
  result?: {
    content: string;
    submittedAt: Date;
    evaluation?: {
      rating: 'acceptable' | 'unacceptable' | 'perfect';
      feedback: string;
    };
  };
}

export default function ManagerNode() {
  const { t } = useTranslation();
  
  const [employees] = useState<Employee[]>([
    {
      id: '1',
      name: 'Backend Developer Agent',
      role: 'API 开发',
      skills: ['Node.js', 'Database', 'API Design'],
      tasksCompleted: 15,
      performance: {
        perfect: 10,
        acceptable: 4,
        rejected: 1,
      },
    },
    {
      id: '2',
      name: 'Frontend Developer Agent',
      role: 'UI 实现',
      skills: ['React', 'TypeScript', 'CSS'],
      tasksCompleted: 12,
      performance: {
        perfect: 8,
        acceptable: 3,
        rejected: 1,
      },
    },
    {
      id: '3',
      name: 'Database Agent',
      role: '数据库设计',
      skills: ['PostgreSQL', 'MongoDB', 'Redis'],
      tasksCompleted: 8,
      performance: {
        perfect: 5,
        acceptable: 2,
        rejected: 1,
      },
    },
  ]);

  const [tasks, setTasks] = useState<AssignedTask[]>([
    {
      id: '1',
      title: 'API Design',
      description: 'Design REST API endpoints for user management',
      assignedTo: '1',
      dueDate: new Date('2026-02-15'),
      priority: 'high',
      status: 'completed',
      result: {
        content: 'Completed API design with OpenAPI specification. Includes 15 endpoints for user management.',
        submittedAt: new Date('2026-02-10'),
        evaluation: {
          rating: 'perfect',
          feedback: 'Excellent work! The API design is comprehensive and follows best practices.',
        },
      },
    },
    {
      id: '2',
      title: 'Database Schema',
      description: 'Design database schema for the project',
      assignedTo: '2',
      dueDate: new Date('2026-02-20'),
      priority: 'high',
      status: 'in-progress',
    },
    {
      id: '3',
      title: 'Authentication Flow',
      description: 'Implement OAuth2 authentication',
      assignedTo: '3',
      dueDate: new Date('2026-02-25'),
      priority: 'medium',
      status: 'pending',
    },
  ]);

  const [assignTaskOpen, setAssignTaskOpen] = useState(false);
  const [evaluateTaskOpen, setEvaluateTaskOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<AssignedTask | null>(null);
  const [employeeDeliverableOpen, setEmployeeDeliverableOpen] = useState(false);
  const [selectedEmployeeDeliverable, setSelectedEmployeeDeliverable] = useState<EmployeeDeliverable | null>(null);
  const [managerDeliverableOpen, setManagerDeliverableOpen] = useState(false);
  const [selectedManagerDeliverable, setSelectedManagerDeliverable] = useState<ManagerDeliverable | null>(null);

  // Mock employee deliverable data
  const mockEmployeeDeliverable: EmployeeDeliverable = {
    id: '1',
    taskId: '1',
    taskTitle: 'API Design',
    employeeName: 'Backend Developer Agent',
    submittedAt: new Date('2026-02-10'),
    content: 'Completed API design with OpenAPI specification. Includes 15 endpoints for user management.\n\nKey Features:\n- RESTful design principles\n- Authentication and authorization\n- Rate limiting\n- Comprehensive error handling\n- API versioning support',
    attachments: [
      { name: 'api-spec.yaml', url: '#', size: '45 KB' },
      { name: 'api-documentation.pdf', url: '#', size: '2.3 MB' },
    ],
    evaluation: {
      rating: 'perfect',
      feedback: 'Excellent work! The API design is comprehensive and follows best practices.',
      evaluatedAt: new Date('2026-02-11'),
    },
  };

  // Mock manager deliverable data
  const mockManagerDeliverable: ManagerDeliverable = {
    id: '1',
    moduleTitle: 'Backend Development Module',
    managerName: 'Development Manager',
    managerType: '开发经理',
    submittedAt: new Date('2026-02-20'),
    summary: 'Successfully completed the backend development module. All API endpoints have been implemented and tested.\n\nAchievements:\n- 15 API endpoints designed and implemented\n- Database schema optimized for performance\n- Authentication system fully functional\n- Comprehensive test coverage (95%)\n\nThe module is ready for integration with the frontend.',
    employeeContributions: [
      { employeeName: 'Backend Developer Agent', taskTitle: 'API Design', deliverableId: '1' },
      { employeeName: 'Database Agent', taskTitle: 'Database Schema', deliverableId: '2' },
      { employeeName: 'Backend Developer Agent', taskTitle: 'Authentication Flow', deliverableId: '3' },
    ],
    attachments: [
      { name: 'backend-module-report.pdf', url: '#', size: '5.2 MB' },
      { name: 'test-coverage-report.html', url: '#', size: '1.8 MB' },
    ],
    status: 'approved',
    feedback: 'Outstanding work! The backend module meets all requirements and exceeds expectations.',
  };

  const getStatusColor = (status: AssignedTask['status']) => {
    const colors = {
      pending: 'bg-muted text-muted-foreground',
      'in-progress': 'border border-[var(--brand-border)] bg-[var(--brand-soft)] text-[var(--brand-soft-foreground)]',
      completed: 'bg-green-100 text-green-700',
      rejected: 'bg-red-100 text-red-700',
    };
    return colors[status];
  };

  const getStatusLabel = (status: AssignedTask['status']) => {
    const labels = {
      pending: t('managerNode.status.pending'),
      'in-progress': t('managerNode.status.inProgress'),
      completed: t('managerNode.status.completed'),
      rejected: t('managerNode.status.rejected'),
    };
    return labels[status];
  };

  const getPriorityColor = (priority: AssignedTask['priority']) => {
    const colors = {
      low: 'bg-gray-100 text-gray-700',
      medium: 'bg-yellow-100 text-yellow-700',
      high: 'bg-red-100 text-red-700',
    };
    return colors[priority];
  };

  const getPriorityLabel = (priority: AssignedTask['priority']) => {
    const labels = {
      low: t('managerNode.priority.low'),
      medium: t('managerNode.priority.medium'),
      high: t('managerNode.priority.high'),
    };
    return labels[priority];
  };

  const getEvaluationIcon = (rating: 'acceptable' | 'unacceptable' | 'perfect') => {
    switch (rating) {
      case 'perfect':
        return <Star className="w-4 h-4 text-green-600" />;
      case 'acceptable':
        return <CheckCircle className="h-4 w-4 text-[var(--brand-link)]" />;
      case 'unacceptable':
        return <XCircle className="w-4 h-4 text-red-600" />;
    }
  };

  const getEvaluationLabel = (rating: 'acceptable' | 'unacceptable' | 'perfect') => {
    const labels = {
      perfect: t('managerNode.perfect'),
      acceptable: t('managerNode.acceptable'),
      unacceptable: t('managerNode.unacceptable'),
    };
    return labels[rating];
  };

  const getEmployeeName = (employeeId: string) => {
    const employee = employees.find(e => e.id === employeeId);
    return employee?.name || t('managerNode.unknownEmployee');
  };

  return (
    <WorkspaceLayout>
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Header */}
        <div className="border-b border-border bg-background px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">
                {t('managerNode.title')}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {t('managerNode.pageDescription')}
              </p>
            </div>
            <Dialog open={assignTaskOpen} onOpenChange={setAssignTaskOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="w-4 h-4" />
                  {t('managerNode.assignTask')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('managerNode.assignTaskTitle')}</DialogTitle>
                  <DialogDescription>
                    {t('managerNode.assignTaskDescription')}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="task-title">{t('managerNode.taskTitleLabel')}</Label>
                    <Input id="task-title" placeholder={t('managerNode.taskTitlePlaceholder')} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="task-description">{t('managerNode.taskDescriptionLabel')}</Label>
                    <Textarea
                      id="task-description"
                      placeholder={t('managerNode.taskDescriptionPlaceholder')}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="task-assignee">{t('managerNode.assigneeLabel')}</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder={t('managerNode.assigneePlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {employees.map((employee) => (
                          <SelectItem key={employee.id} value={employee.id}>
                            {employee.name} - {employee.role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="task-priority">{t('managerNode.priorityLabel')}</Label>
                      <Select>
                        <SelectTrigger>
                          <SelectValue placeholder={t('managerNode.priorityPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">{t('managerNode.priority.low')}</SelectItem>
                          <SelectItem value="medium">{t('managerNode.priority.medium')}</SelectItem>
                          <SelectItem value="high">{t('managerNode.priority.high')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="task-duedate">{t('managerNode.dueDateLabel')}</Label>
                      <Input id="task-duedate" type="date" />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setAssignTaskOpen(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button onClick={() => setAssignTaskOpen(false)}>
                    {t('managerNode.assignTask')}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Main Content */}
        <Tabs defaultValue="tasks" className="flex-1 flex flex-col overflow-hidden">
          <div className="border-b border-border bg-background px-6">
            <TabsList className="bg-transparent">
              <TabsTrigger value="tasks">{t('managerNode.taskList')}</TabsTrigger>
              <TabsTrigger value="employees">{t('managerNode.employeeManagement')}</TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="flex-1">
            <TabsContent value="tasks" className="p-6 space-y-4 m-0">
              {tasks.map((task) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <Card>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <CardTitle className="text-lg">{task.title}</CardTitle>
                            <Badge className={getStatusColor(task.status)}>
                              {getStatusLabel(task.status)}
                            </Badge>
                            <Badge className={getPriorityColor(task.priority)}>
                              {t('managerNode.priorityBadge', { value: getPriorityLabel(task.priority) })}
                            </Badge>
                          </div>
                          <CardDescription>{task.description}</CardDescription>
                          <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <User className="w-4 h-4" />
                              {getEmployeeName(task.assignedTo)}
                            </div>
                            <div className="flex items-center gap-1">
                              <Calendar className="w-4 h-4" />
                              {t('managerNode.dueDateValue', { value: task.dueDate.toLocaleDateString() })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardHeader>

                    {task.result && (
                      <CardContent>
                        <Separator className="mb-4" />
                        <div className="space-y-3">
                          <div>
                            <div className="text-sm font-medium text-foreground mb-2">
                              {t('managerNode.workResult')}
                            </div>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <div className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-lg">
                                  {task.result.content}
                                </div>
                                <div className="text-xs text-muted-foreground mt-2">
                                  {t('managerNode.submittedAt', {
                                    value: task.result.submittedAt ? new Date(task.result.submittedAt).toLocaleString() : t('managerNode.unknownTime'),
                                  })}
                                </div>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-2 shrink-0"
                                onClick={() => {
                                  setSelectedEmployeeDeliverable(mockEmployeeDeliverable);
                                  setEmployeeDeliverableOpen(true);
                                }}
                              >
                                <FileText className="w-4 h-4" />
                                {t('managerNode.viewDeliverable')}
                              </Button>
                            </div>
                          </div>

                          {task.result.evaluation ? (
                            <div className="bg-muted/30 p-4 rounded-lg">
                              <div className="flex items-center gap-2 mb-2">
                                {getEvaluationIcon(task.result.evaluation.rating)}
                                <span className="font-medium text-sm">
                                  {t('managerNode.evaluationLabel', {
                                    value: getEvaluationLabel(task.result.evaluation.rating),
                                  })}
                                </span>
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {task.result.evaluation.feedback}
                              </div>
                            </div>
                          ) : (
                            <Dialog open={evaluateTaskOpen && selectedTask?.id === task.id} onOpenChange={(open) => {
                              setEvaluateTaskOpen(open);
                              if (open) setSelectedTask(task);
                            }}>
                              <DialogTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-2"
                                  onClick={() => setSelectedTask(task)}
                                >
                                  <Star className="w-4 h-4" />
                                  {t('managerNode.evaluateWork')}
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>{t('managerNode.evaluateWorkTitle')}</DialogTitle>
                                  <DialogDescription>
                                    {t('managerNode.evaluateWorkDescription', {
                                      name: getEmployeeName(task.assignedTo),
                                    })}
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                  <div className="space-y-2">
                                    <Label>{t('managerNode.evaluationLevelLabel')}</Label>
                                    <div className="grid grid-cols-3 gap-2">
                                      <Button variant="outline" className="gap-2">
                                        <Star className="w-4 h-4 text-green-600" />
                                        {t('managerNode.perfect')}
                                      </Button>
                                      <Button variant="outline" className="gap-2">
                                        <CheckCircle className="h-4 w-4 text-[var(--brand-link)]" />
                                        {t('managerNode.acceptable')}
                                      </Button>
                                      <Button variant="outline" className="gap-2">
                                        <XCircle className="w-4 h-4 text-red-600" />
                                        {t('managerNode.unacceptable')}
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor="evaluation-feedback">{t('managerNode.evaluationFeedbackLabel')}</Label>
                                    <Textarea
                                      id="evaluation-feedback"
                                      placeholder={t('managerNode.evaluationFeedbackPlaceholder')}
                                      rows={4}
                                    />
                                  </div>
                                </div>
                                <div className="flex justify-end gap-2">
                                  <Button variant="outline" onClick={() => setEvaluateTaskOpen(false)}>
                                    {t('common.cancel')}
                                  </Button>
                                  <Button onClick={() => setEvaluateTaskOpen(false)}>
                                    {t('managerNode.submitEvaluation')}
                                  </Button>
                                </div>
                              </DialogContent>
                            </Dialog>
                          )}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                </motion.div>
              ))}
            </TabsContent>

            <TabsContent value="employees" className="p-6 space-y-4 m-0">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {employees.map((employee) => (
                  <motion.div
                    key={employee.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Card>
                      <CardHeader>
                        <div className="flex items-start gap-3">
                          <div className="w-12 h-12 rounded-full bg-foreground/10 flex items-center justify-center">
                            <User className="w-6 h-6 text-foreground" />
                          </div>
                          <div className="flex-1">
                            <CardTitle className="text-base">{employee.name}</CardTitle>
                            <CardDescription className="mt-1">
                              {employee.role}
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          <div>
                            <div className="text-sm font-medium text-foreground mb-2">
                              {t('managerNode.skillsLabel')}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {employee.skills.map((skill, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs">
                                  {skill}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <Separator />
                          <div>
                            <div className="text-sm font-medium text-foreground mb-2">
                              {t('managerNode.performanceStats')}
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="flex items-center gap-1 text-green-600">
                                <Star className="w-3 h-3" />
                                {t('managerNode.performancePerfect', { count: employee.performance.perfect })}
                              </div>
                              <div className="flex items-center gap-1 text-[var(--brand-link)]">
                                <CheckCircle className="w-3 h-3" />
                                {t('managerNode.performanceAcceptable', { count: employee.performance.acceptable })}
                              </div>
                              <div className="flex items-center gap-1 text-red-600">
                                <XCircle className="w-3 h-3" />
                                {t('managerNode.performanceRejected', { count: employee.performance.rejected })}
                              </div>
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <Briefcase className="w-3 h-3" />
                                {t('managerNode.performanceTotal', { count: employee.tasksCompleted })}
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>

        {/* Manager Deliverable Button */}
        <div className="border-t border-border bg-background px-6 py-4">
          <Button
            className="w-full gap-2"
            onClick={() => {
              setSelectedManagerDeliverable(mockManagerDeliverable);
              setManagerDeliverableOpen(true);
            }}
          >
            <FileText className="w-4 h-4" />
            {t('managerNode.viewManagerDeliverable')}
          </Button>
        </div>
      </div>

      {/* Deliverable Viewers */}
      {selectedEmployeeDeliverable && (
        <EmployeeDeliverableViewer
          deliverable={selectedEmployeeDeliverable}
          open={employeeDeliverableOpen}
          onOpenChange={setEmployeeDeliverableOpen}
        />
      )}
      {selectedManagerDeliverable && (
        <ManagerDeliverableViewer
          deliverable={selectedManagerDeliverable}
          open={managerDeliverableOpen}
          onOpenChange={setManagerDeliverableOpen}
        />
      )}
    </WorkspaceLayout>
  );
}
