/**
 * Design Philosophy: Swiss International Style + Digital Minimalism
 * Deliverable Document Viewer Component
 */

import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { FileText, Download, User, Calendar, CheckCircle, XCircle, Star } from 'lucide-react';
import { motion } from 'framer-motion';

export interface EmployeeDeliverable {
  id: string;
  taskId: string;
  taskTitle: string;
  employeeName: string;
  submittedAt: Date;
  content: string;
  attachments?: {
    name: string;
    url: string;
    size: string;
  }[];
  evaluation?: {
    rating: 'acceptable' | 'unacceptable' | 'perfect';
    feedback: string;
    evaluatedAt: Date;
  };
}

export interface ManagerDeliverable {
  id: string;
  moduleTitle: string;
  managerName: string;
  managerType: string;
  submittedAt: Date;
  summary: string;
  employeeContributions: {
    employeeName: string;
    taskTitle: string;
    deliverableId: string;
  }[];
  attachments?: {
    name: string;
    url: string;
    size: string;
  }[];
  status: 'pending' | 'approved' | 'rejected';
  feedback?: string;
}

interface EmployeeDeliverableViewerProps {
  deliverable: EmployeeDeliverable;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EmployeeDeliverableViewer({
  deliverable,
  open,
  onOpenChange,
}: EmployeeDeliverableViewerProps) {
  const { t, i18n } = useTranslation();
  const getEvaluationIcon = (rating: 'acceptable' | 'unacceptable' | 'perfect') => {
    switch (rating) {
      case 'perfect':
        return <Star className="w-5 h-5 text-green-600" />;
      case 'acceptable':
        return <CheckCircle className="h-5 w-5 text-[var(--brand-link)]" />;
      case 'unacceptable':
        return <XCircle className="w-5 h-5 text-red-600" />;
    }
  };

  const getEvaluationLabel = (rating: 'acceptable' | 'unacceptable' | 'perfect') => {
    const labels = {
      perfect: t('deliverableViewer.evaluation.perfect'),
      acceptable: t('deliverableViewer.evaluation.acceptable'),
      unacceptable: t('deliverableViewer.evaluation.unacceptable'),
    };
    return labels[rating];
  };

  const getEvaluationColor = (rating: 'acceptable' | 'unacceptable' | 'perfect') => {
    const colors = {
      perfect: 'bg-green-100 text-green-700',
      acceptable: 'border border-[var(--brand-border)] bg-[var(--brand-soft)] text-[var(--brand-soft-foreground)]',
      unacceptable: 'bg-red-100 text-red-700',
    };
    return colors[rating];
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            {t('deliverableViewer.employeeTitle')}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(80vh-120px)]">
          <div className="space-y-6 pr-4">
            {/* Document Header */}
            <div className="space-y-3">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  {deliverable.taskTitle}
                </h3>
              </div>

              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <User className="w-4 h-4" />
                  {deliverable.employeeName}
                </div>
                <div className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {t('deliverableViewer.submittedAt', {
                    value: deliverable.submittedAt
                      ? new Date(deliverable.submittedAt).toLocaleString(i18n.language)
                      : t('deliverableViewer.unknownTime'),
                  })}
                </div>
              </div>

              {deliverable.evaluation && (
                <Badge className={getEvaluationColor(deliverable.evaluation.rating)}>
                  <span className="flex items-center gap-1">
                    {getEvaluationIcon(deliverable.evaluation.rating)}
                    {getEvaluationLabel(deliverable.evaluation.rating)}
                  </span>
                </Badge>
              )}
            </div>

            <Separator />

            {/* Document Content */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-foreground">{t('deliverableViewer.content')}</h4>
              <div className="bg-muted/30 p-4 rounded-lg">
                <pre className="whitespace-pre-wrap text-sm text-foreground font-sans">
                  {deliverable.content}
                </pre>
              </div>
            </div>

            {/* Attachments */}
            {deliverable.attachments && deliverable.attachments.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-foreground">{t('deliverableViewer.attachments')}</h4>
                <div className="space-y-2">
                  {deliverable.attachments.map((attachment, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            {attachment.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {attachment.size}
                          </div>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="gap-2">
                        <Download className="w-4 h-4" />
                        {t('deliverableViewer.download')}
                      </Button>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Evaluation */}
            {deliverable.evaluation && (
              <div className="space-y-3">
                <Separator />
                <h4 className="text-sm font-medium text-foreground">{t('deliverableViewer.managerEvaluation')}</h4>
                <div className="bg-muted/30 p-4 rounded-lg space-y-3">
                  <div className="flex items-center gap-2">
                    {getEvaluationIcon(deliverable.evaluation.rating)}
                    <span className="font-medium text-sm">
                      {getEvaluationLabel(deliverable.evaluation.rating)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {deliverable.evaluation.feedback}
                  </p>
                  <div className="text-xs text-muted-foreground">
                    {t('deliverableViewer.evaluatedAt', {
                      value: deliverable.evaluation.evaluatedAt
                        ? new Date(deliverable.evaluation.evaluatedAt).toLocaleString(i18n.language)
                        : t('deliverableViewer.unknownTime'),
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

interface ManagerDeliverableViewerProps {
  deliverable: ManagerDeliverable;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ManagerDeliverableViewer({
  deliverable,
  open,
  onOpenChange,
}: ManagerDeliverableViewerProps) {
  const { t, i18n } = useTranslation();
  const getStatusColor = (status: ManagerDeliverable['status']) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-700',
      approved: 'bg-green-100 text-green-700',
      rejected: 'bg-red-100 text-red-700',
    };
    return colors[status];
  };

  const getStatusLabel = (status: ManagerDeliverable['status']) => {
    const labels = {
      pending: t('deliverableViewer.status.pending'),
      approved: t('deliverableViewer.status.approved'),
      rejected: t('deliverableViewer.status.rejected'),
    };
    return labels[status];
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            {t('deliverableViewer.managerTitle')}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(80vh-120px)]">
          <div className="space-y-6 pr-4">
            {/* Document Header */}
            <div className="space-y-3">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  {deliverable.moduleTitle}
                </h3>
              </div>

              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <User className="w-4 h-4" />
                  {deliverable.managerName} - {deliverable.managerType}
                </div>
                <div className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {t('deliverableViewer.submittedAt', {
                    value: deliverable.submittedAt
                      ? new Date(deliverable.submittedAt).toLocaleString(i18n.language)
                      : t('deliverableViewer.unknownTime'),
                  })}
                </div>
              </div>

              <Badge className={getStatusColor(deliverable.status)}>
                {getStatusLabel(deliverable.status)}
              </Badge>
            </div>

            <Separator />

            {/* Summary */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-foreground">{t('deliverableViewer.moduleSummary')}</h4>
              <div className="bg-muted/30 p-4 rounded-lg">
                <pre className="whitespace-pre-wrap text-sm text-foreground font-sans">
                  {deliverable.summary}
                </pre>
              </div>
            </div>

            {/* Employee Contributions */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-foreground">
                {t('deliverableViewer.employeeContributions', {
                  count: deliverable.employeeContributions.length,
                })}
              </h4>
              <div className="space-y-2">
                {deliverable.employeeContributions.map((contribution, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {contribution.employeeName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {contribution.taskTitle}
                        </div>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="gap-2">
                      <FileText className="w-4 h-4" />
                      {t('deliverableViewer.viewDeliverable')}
                    </Button>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Attachments */}
            {deliverable.attachments && deliverable.attachments.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-foreground">{t('deliverableViewer.attachments')}</h4>
                <div className="space-y-2">
                  {deliverable.attachments.map((attachment, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            {attachment.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {attachment.size}
                          </div>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="gap-2">
                        <Download className="w-4 h-4" />
                        {t('deliverableViewer.download')}
                      </Button>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Feedback */}
            {deliverable.feedback && (
              <div className="space-y-3">
                <Separator />
                <h4 className="text-sm font-medium text-foreground">{t('deliverableViewer.ceoFeedback')}</h4>
                <div className="bg-muted/30 p-4 rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    {deliverable.feedback}
                  </p>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
