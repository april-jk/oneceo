/**
 * Task Documents Dialog Component
 * Displays all deliverable documents for a specific task
 */

import { useTranslation } from "react-i18next";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { FileText, Download, User, Calendar, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

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
}

interface TaskDocumentsDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function TaskDocumentsDialog({ task, open, onOpenChange }: TaskDocumentsDialogProps) {
  const { t } = useTranslation();
  if (!task) return null;

  const getEvaluationBadge = (evaluation: 'perfect' | 'acceptable' | 'rejected') => {
    const config = {
      perfect: { label: t('taskDocumentsDialog.evaluation.perfect'), icon: CheckCircle, className: 'bg-green-500/10 text-green-500 border-green-500/20' },
      acceptable: { label: t('taskDocumentsDialog.evaluation.acceptable'), icon: AlertCircle, className: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' },
      rejected: { label: t('taskDocumentsDialog.evaluation.rejected'), icon: XCircle, className: 'bg-red-500/10 text-red-500 border-red-500/20' },
    };
    const { label, icon: Icon, className } = config[evaluation];
    return (
      <Badge variant="outline" className={className}>
        <Icon className="w-3 h-3 mr-1" />
        {label}
      </Badge>
    );
  };

  // 获取所有有交付文档的员工
  const employeesWithDeliverables = task.assignedEmployees.filter(emp => emp.deliverable);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="text-xl">{t('taskDocumentsDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('taskDocumentsDialog.description', {
              title: task.title,
              count: employeesWithDeliverables.length,
            })}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[60vh] pr-4">
          {employeesWithDeliverables.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">{t('taskDocumentsDialog.empty')}</p>
            </div>
          ) : (
            <div className="space-y-6">
              {employeesWithDeliverables.map((assignment) => (
                <div key={assignment.employeeId} className="bg-muted/30 rounded-lg p-4 space-y-4">
                  {/* 员工信息 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                        <User className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{assignment.employeeName}</span>
                          <Badge variant="outline" className="text-xs">{assignment.role}</Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                          <Calendar className="w-3 h-3" />
                          <span>
                            {t('taskDocumentsDialog.submittedAt', {
                              value: assignment.deliverable?.submittedAt || t('taskDocumentsDialog.unknownTime'),
                            })}
                          </span>
                        </div>
                      </div>
                    </div>
                    {assignment.deliverable?.evaluation && getEvaluationBadge(assignment.deliverable.evaluation)}
                  </div>

                  <Separator />

                  {/* 文档标题 */}
                  <div>
                    <h4 className="font-medium mb-2">{assignment.deliverable?.title}</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {assignment.deliverable?.content}
                    </p>
                  </div>

                  {/* 附件列表 */}
                  {assignment.deliverable?.attachments && assignment.deliverable.attachments.length > 0 && (
                    <div>
                      <h5 className="text-sm font-medium mb-2">
                        {t('taskDocumentsDialog.attachments', {
                          count: assignment.deliverable.attachments.length,
                        })}
                      </h5>
                      <div className="space-y-2">
                        {assignment.deliverable.attachments.map((attachment, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between p-2 bg-background rounded border border-border"
                          >
                            <div className="flex items-center gap-2">
                              <FileText className="w-4 h-4 text-muted-foreground" />
                              <div>
                                <p className="text-sm font-medium">{attachment.name}</p>
                                <p className="text-xs text-muted-foreground">{attachment.size}</p>
                              </div>
                            </div>
                            <Button size="sm" variant="ghost" className="gap-2">
                              <Download className="w-4 h-4" />
                              {t('taskDocumentsDialog.download')}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 评价反馈 */}
                  {assignment.deliverable?.feedback && (
                    <div className="bg-background rounded p-3 border border-border">
                      <h5 className="text-sm font-medium mb-1">{t('taskDocumentsDialog.feedback')}</h5>
                      <p className="text-sm text-muted-foreground">{assignment.deliverable.feedback}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
