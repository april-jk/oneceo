import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/WorkspaceLayout";
import ProjectDetail from "./ProjectDetail";
import StandardProjectDetail from "./StandardProjectDetail";
import { listTaskCreationProjects } from "@/lib/task-creation-client";
import {
  isSelfOrganizedPreviewProjectId,
  type TaskProjectSelection,
} from "@/lib/task-project-selection";

type ResolvedProjectKind = "manual" | "self-organized";

export default function ProjectDetailWrapper() {
  const { t } = useTranslation();
  const [location, setLocation] = useLocation();
  const projectId = useMemo(() => location.split("/").pop() || "", [location]);
  const [projectKind, setProjectKind] = useState<ResolvedProjectKind | null>(null);

  useEffect(() => {
    let disposed = false;

    const resolveProjectKind = async () => {
      if (!projectId) {
        setProjectKind("self-organized");
        return;
      }

      if (isSelfOrganizedPreviewProjectId(projectId)) {
        setProjectKind("self-organized");
        return;
      }

      try {
        const projects = await listTaskCreationProjects();
        if (disposed) return;
        const matched = projects.some((project) => project.id === projectId);
        setProjectKind(matched ? "manual" : "self-organized");
      } catch {
        if (!disposed) {
          setProjectKind("manual");
        }
      }
    };

    void resolveProjectKind();
    return () => {
      disposed = true;
    };
  }, [projectId]);

  const selectedProject: TaskProjectSelection | null =
    projectId && projectKind
      ? {
          id: projectId,
          kind: projectKind,
        }
      : null;

  return (
    <WorkspaceLayout selectedProject={selectedProject}>
      {projectKind === "manual" ? (
        <StandardProjectDetail
          projectId={projectId}
          onBack={() => setLocation("/home")}
        />
      ) : projectKind === "self-organized" ? (
        <ProjectDetail
          projectId={projectId}
          onBack={() => setLocation("/home")}
        />
      ) : (
        <div className="flex min-h-[calc(100vh-2rem)] items-center justify-center">
          <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
        </div>
      )}
    </WorkspaceLayout>
  );
}
