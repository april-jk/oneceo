import { useLocation } from 'wouter';
import WorkspaceLayout from '@/components/WorkspaceLayout';
import ProjectDetail from './ProjectDetail';

export default function ProjectDetailWrapper() {
  const [location] = useLocation();
  const projectId = location.split('/').pop();

  return (
    <WorkspaceLayout>
      <ProjectDetail projectId={projectId} />
    </WorkspaceLayout>
  );
}
