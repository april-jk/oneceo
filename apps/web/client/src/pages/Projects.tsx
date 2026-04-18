import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Plus, FolderOpen, Trash2, MoreVertical } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLocation } from 'wouter';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  status: 'active' | 'completed' | 'archived';
  progress: number;
}

export default function Projects() {
  const [location, navigate] = useLocation();
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([
    {
      id: '1',
      name: 'oneceo.ai',
      description: '一个 AI 驱动的项目管理平台',
      createdAt: new Date('2025-12-15'),
      status: 'active',
      progress: 65,
    },
    {
      id: '2',
      name: 'artgen ai',
      description: '艺术生成 AI 工具',
      createdAt: new Date('2025-11-20'),
      status: 'active',
      progress: 40,
    },
    {
      id: '3',
      name: 'voiceClone',
      description: '语音克隆技术实现',
      createdAt: new Date('2025-10-10'),
      status: 'completed',
      progress: 100,
    },
  ]);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', description: '' });

  const handleCreateProject = () => {
    if (newProject.name.trim()) {
      const project: Project = {
        id: Date.now().toString(),
        name: newProject.name,
        description: newProject.description,
        createdAt: new Date(),
        status: 'active',
        progress: 0,
      };
      setProjects([...projects, project]);
      setNewProject({ name: '', description: '' });
      setIsDialogOpen(false);
    }
  };

  const handleDeleteProject = (id: string) => {
    setProjects(projects.filter(p => p.id !== id));
  };

  const handleOpenProject = (id: string) => {
    navigate(`/project/${id}`);
  };

  const goToProject = (id: string) => {
    navigate(`/project/${id}`);
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="h-14 flex items-center justify-between px-6 border-b border-border bg-background">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t('projects.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('projectsPage.subtitle')}</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 rounded-xl bg-foreground hover:bg-foreground/90 text-background">
              <Plus className="w-4 h-4" />
              {t('projectsPage.newProject')}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px] rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-foreground">{t('projectsPage.createTitle')}</DialogTitle>
              <DialogDescription>
                {t('projectsPage.createDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="project-name" className="text-foreground">
                  {t('projectsPage.projectName')}
                </Label>
                <Input
                  id="project-name"
                  placeholder={t('projectsPage.projectNamePlaceholder')}
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  className="rounded-xl border-border"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-desc" className="text-foreground">
                  {t('projectsPage.projectDescription')}
                </Label>
                <Textarea
                  id="project-desc"
                  placeholder={t('projectsPage.projectDescriptionPlaceholder')}
                  value={newProject.description}
                  onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                  className="rounded-xl border-border min-h-24"
                />
              </div>
              <Button
                onClick={handleCreateProject}
                className="w-full rounded-xl bg-foreground hover:bg-foreground/90 text-background"
              >
                {t('projectsPage.createProject')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Projects Grid */}
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project, index) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1, duration: 0.3 }}
            >
              <Card
                className="group cursor-pointer border-border hover:shadow-md transition-all duration-200 rounded-2xl overflow-hidden"
                onClick={() => goToProject(project.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 bg-muted rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-accent transition-colors">
                        <FolderOpen className="w-5 h-5 text-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <CardTitle className="text-base font-semibold text-foreground truncate">
                          {project.name}
                        </CardTitle>
                        <CardDescription className="text-xs text-muted-foreground mt-1">
                          {t('projectsPage.createdAt', { date: project.createdAt.toLocaleDateString() })}
                        </CardDescription>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg">
                          <MoreVertical className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="rounded-xl">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteProject(project.id);
                          }}
                          className="text-destructive rounded-lg"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          {t('common.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-card-foreground line-clamp-2">
                    {project.description}
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{t('projectsPage.progress')}</span>
                      <span className="font-semibold text-foreground">{project.progress}%</span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-foreground rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${project.progress}%` }}
                        transition={{ duration: 0.5, delay: 0.2 }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <span
                      className={`text-xs font-medium px-2 py-1 rounded-lg ${
                        project.status === 'active'
                          ? 'border border-[var(--brand-border)] bg-[var(--brand-soft)] text-[var(--brand-soft-foreground)]'
                          : project.status === 'completed'
                          ? 'bg-green-50 text-green-700'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {project.status === 'active'
                        ? t('agentProject.statusActive')
                        : project.status === 'completed'
                          ? t('agentProject.statusCompleted')
                          : t('projectsPage.archived')}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
