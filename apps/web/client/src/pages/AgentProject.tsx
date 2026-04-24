import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Send, User, Bot, Briefcase, CheckCircle, XCircle, AlertCircle, Building2, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import WorkspaceLayout from '@/components/WorkspaceLayout';

/**
 * 设计理念：瑞士国际主义与数字极简主义融合
 * CEO-总经理战略对话界面 - 上下贯穿式布局
 * - 顶部：公司概况和项目卡片
 * - 中间：全屏对话区域
 * - 底部：固定输入框
 */

interface Message {
  id: string;
  role: 'ceo' | 'general_manager';
  content: string;
  timestamp: Date;
  suggestions?: ProjectSuggestion[];
}

interface ProjectSuggestion {
  id: string;
  type: 'create' | 'delete' | 'modify';
  projectName: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
}

interface CompanyProject {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'completed';
  managersCount: number;
  employeesCount: number;
  progress: number;
}

const INITIAL_GENERAL_MANAGER_MESSAGE =
  'CEO，您好。我是您的总经理，负责统筹调度公司的所有事务。请告诉我您的战略方向，我将为您制定详细的执行计划。';
const GENERAL_MANAGER_ANALYSIS_REPLY =
  '我已经分析了您的战略意图。基于当前公司状况，我建议以下行动：';
const CREATE_PROJECT_REASON =
  '根据您提到的客户服务优化方向，建议创建新项目以提升客户体验';
const MODIFY_PROJECT_REASON =
  '当前营销项目进度缓慢，建议调整策略并增加资源投入';

function buildApprovalConfirmedMessage(projectName: string): string {
  return `已收到批准。我将立即执行 "${projectName}" 的相关操作，并为您持续跟踪进展。`;
}

export default function AgentProject() {
  const { t, i18n } = useTranslation();
  const [inputMessage, setInputMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'general_manager',
      content: INITIAL_GENERAL_MANAGER_MESSAGE,
      timestamp: new Date(),
    },
  ]);

  const [projects, setProjects] = useState<CompanyProject[]>([
    { id: '1', name: 'E-commerce Platform', status: 'active', managersCount: 3, employeesCount: 8, progress: 65 },
    { id: '2', name: 'Mobile App Development', status: 'active', managersCount: 2, employeesCount: 5, progress: 40 },
    { id: '3', name: 'Marketing Campaign', status: 'paused', managersCount: 1, employeesCount: 3, progress: 25 },
  ]);

  const [selectedSuggestion, setSelectedSuggestion] = useState<ProjectSuggestion | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  const handleSendMessage = () => {
    if (!inputMessage.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      role: 'ceo',
      content: inputMessage,
      timestamp: new Date(),
    };

    setMessages([...messages, newMessage]);
    setInputMessage('');

    // 模拟总经理分析并提供建议
    setTimeout(() => {
      const gmReply: Message = {
        id: (Date.now() + 1).toString(),
        role: 'general_manager',
        content: GENERAL_MANAGER_ANALYSIS_REPLY,
        timestamp: new Date(),
        suggestions: [
          {
            id: 's1',
            type: 'create',
            projectName: 'AI Customer Service System',
            reason: CREATE_PROJECT_REASON,
            status: 'pending',
          },
          {
            id: 's2',
            type: 'modify',
            projectName: 'Marketing Campaign',
            reason: MODIFY_PROJECT_REASON,
            status: 'pending',
          },
        ],
      };
      setMessages((prev) => [...prev, gmReply]);
    }, 1000);
  };

  const handleApprove = (suggestion: ProjectSuggestion) => {
    setSelectedSuggestion(suggestion);
    setConfirmDialogOpen(true);
  };

  const confirmApproval = () => {
    if (!selectedSuggestion) return;

    // 更新建议状态
    setMessages((prev) =>
      prev.map((msg) => ({
        ...msg,
        suggestions: msg.suggestions?.map((s) =>
          s.id === selectedSuggestion.id ? { ...s, status: 'approved' as const } : s
        ),
      }))
    );

    // 如果是创建项目，添加到项目列表
    if (selectedSuggestion.type === 'create') {
      const newProject: CompanyProject = {
        id: Date.now().toString(),
        name: selectedSuggestion.projectName,
        status: 'active',
        managersCount: 0,
        employeesCount: 0,
        progress: 0,
      };
      setProjects([...projects, newProject]);
    }

    // 总经理确认消息
    const confirmMsg: Message = {
      id: Date.now().toString(),
      role: 'general_manager',
      content: buildApprovalConfirmedMessage(selectedSuggestion.projectName),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, confirmMsg]);

    setConfirmDialogOpen(false);
    setSelectedSuggestion(null);
  };

  const handleReject = (suggestion: ProjectSuggestion) => {
    setMessages((prev) =>
      prev.map((msg) => ({
        ...msg,
        suggestions: msg.suggestions?.map((s) =>
          s.id === suggestion.id ? { ...s, status: 'rejected' as const } : s
        ),
      }))
    );
  };

  const activeProjects = projects.filter((p) => p.status === 'active').length;
  const totalManagers = projects.reduce((sum, p) => sum + p.managersCount, 0);
  const avgProgress = projects.length > 0 
    ? Math.round(projects.reduce((sum, p) => sum + p.progress, 0) / projects.length) 
    : 0;

  const getStatusBadge = (status: CompanyProject['status']) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">{t('agentProject.statusActive')}</Badge>;
      case 'paused':
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100">{t('agentProject.statusPaused')}</Badge>;
      case 'completed':
        return <Badge className="border border-[var(--brand-border)] bg-[var(--brand-soft)] text-[var(--brand-soft-foreground)]">{t('agentProject.statusCompleted')}</Badge>;
    }
  };

  return (
    <WorkspaceLayout>
      <div className="flex flex-col h-full">
        {/* 顶部卡片区域 */}
        <div className="flex-shrink-0 p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 公司概况卡片 */}
            <Card className="rounded-xl">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-foreground/60" />
                  <CardTitle className="text-lg">{t('agentProject.companyOverview')}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-sm text-muted-foreground mb-1">{t('agentProject.activeProjectsMetric')}</div>
                    <div className="text-3xl font-semibold text-foreground">{activeProjects}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm text-muted-foreground mb-1">{t('agentProject.totalManagersMetric')}</div>
                    <div className="text-3xl font-semibold text-foreground">{totalManagers}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm text-muted-foreground mb-1">{t('agentProject.averageProgressMetric')}</div>
                    <div className="text-3xl font-semibold text-foreground">{avgProgress}%</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 所有项目卡片 */}
            <Card className="rounded-xl">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-foreground/60" />
                  <CardTitle className="text-lg">{t('agentProject.allProjectsCard')}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[120px]">
                  <div className="space-y-3">
                    {projects.map((project) => (
                      <div key={project.id} className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-foreground truncate">{project.name}</span>
                            {getStatusBadge(project.status)}
                          </div>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span>{t('agentProject.managersCount', { count: project.managersCount })}</span>
                            <span>{t('agentProject.employeesCount', { count: project.employeesCount })}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-foreground transition-all duration-300"
                              style={{ width: `${project.progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-10 text-right">{project.progress}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* 对话区域 - 占据剩余空间 */}
        <div className="flex-1 flex flex-col min-h-0 px-6">
          <ScrollArea className="flex-1">
            <div className="max-w-4xl mx-auto py-4 space-y-4">
              <AnimatePresence>
                {messages.map((message) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className={`flex gap-3 ${message.role === 'ceo' ? 'justify-end' : 'justify-start'}`}
                  >
                    {message.role === 'general_manager' && (
                      <div className="w-8 h-8 rounded-full bg-foreground flex items-center justify-center flex-shrink-0">
                        <Bot className="w-4 h-4 text-background" />
                      </div>
                    )}
                    <div className={`max-w-2xl ${message.role === 'ceo' ? 'order-first' : ''}`}>
                      <div
                        className={`rounded-2xl px-4 py-3 ${
                          message.role === 'ceo'
                            ? 'bg-foreground text-background'
                            : 'bg-muted text-foreground'
                        }`}
                      >
                        <p className="text-sm leading-relaxed">{message.content}</p>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 px-2">
                        {message.timestamp.toLocaleTimeString(i18n.language === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </div>

                      {/* 建议卡片 */}
                      {message.suggestions && message.suggestions.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {message.suggestions.map((suggestion) => (
                            <motion.div
                              key={suggestion.id}
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="bg-card border border-border rounded-xl p-4"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2">
                                    {suggestion.type === 'create' && (
                                      <CheckCircle className="w-4 h-4 text-green-600" />
                                    )}
                                    {suggestion.type === 'delete' && (
                                      <XCircle className="w-4 h-4 text-red-600" />
                                    )}
                                    {suggestion.type === 'modify' && (
                                      <AlertCircle className="w-4 h-4 text-yellow-600" />
                                    )}
                                    <span className="text-sm font-medium text-foreground">
                                      {suggestion.type === 'create' && t('agentProject.suggestCreate')}
                                      {suggestion.type === 'delete' && t('agentProject.suggestDelete')}
                                      {suggestion.type === 'modify' && t('agentProject.suggestModify')}
                                    </span>
                                    {suggestion.status === 'approved' && (
                                      <Badge className="bg-green-100 text-green-800">{t('agentProject.approved')}</Badge>
                                    )}
                                    {suggestion.status === 'rejected' && (
                                      <Badge className="bg-red-100 text-red-800">{t('agentProject.rejected')}</Badge>
                                    )}
                                  </div>
                                  <p className="text-sm font-medium text-foreground mb-1">
                                    {suggestion.projectName}
                                  </p>
                                  <p className="text-xs text-muted-foreground">{suggestion.reason}</p>
                                </div>
                                {suggestion.status === 'pending' && (
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleApprove(suggestion)}
                                      className="rounded-lg"
                                    >
                                      {t('agentProject.approve')}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleReject(suggestion)}
                                      className="rounded-lg text-red-600 hover:text-red-700"
                                    >
                                      {t('agentProject.reject')}
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </div>
                    {message.role === 'ceo' && (
                      <div className="w-8 h-8 rounded-full bg-foreground flex items-center justify-center flex-shrink-0">
                        <User className="w-4 h-4 text-background" />
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </ScrollArea>

          {/* 输入框 - 固定在底部 */}
          <div className="flex-shrink-0 py-4 border-t border-border">
            <div className="max-w-4xl mx-auto flex gap-2">
              <Input
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={t('agentProject.messagePlaceholder')}
                className="flex-1 rounded-xl"
              />
              <Button
                onClick={handleSendMessage}
                disabled={!inputMessage.trim()}
                className="rounded-xl bg-foreground text-background hover:bg-foreground/90"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 确认对话框 */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent className="rounded-xl">
          <DialogHeader>
            <DialogTitle>{t('agentProject.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('agentProject.confirmDescription')}
            </DialogDescription>
          </DialogHeader>
          {selectedSuggestion && (
            <div className="py-4">
              <div className="flex items-center gap-2 mb-2">
                {selectedSuggestion.type === 'create' && <CheckCircle className="w-5 h-5 text-green-600" />}
                {selectedSuggestion.type === 'delete' && <XCircle className="w-5 h-5 text-red-600" />}
                {selectedSuggestion.type === 'modify' && <AlertCircle className="w-5 h-5 text-yellow-600" />}
                <span className="font-medium">
                  {selectedSuggestion.type === 'create' && t('agentProject.suggestCreate')}
                  {selectedSuggestion.type === 'delete' && t('agentProject.suggestDelete')}
                  {selectedSuggestion.type === 'modify' && t('agentProject.suggestModify')}
                </span>
              </div>
              <p className="text-sm font-medium mb-2">{selectedSuggestion.projectName}</p>
              <p className="text-sm text-muted-foreground">{selectedSuggestion.reason}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)} className="rounded-lg">
              {t('common.cancel')}
            </Button>
            <Button onClick={confirmApproval} className="rounded-lg bg-foreground text-background hover:bg-foreground/90">
              {t('agentProject.confirmApprove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkspaceLayout>
  );
}
