import { useEffect, useSyncExternalStore } from "react";
import {
  listTaskCreationProjects,
  type TaskCreationProjectSummary,
} from "@/lib/task-creation-client";

type ManualProjectsSnapshot = {
  projects: TaskCreationProjectSummary[];
  loading: boolean;
  loadedUserId: string | null;
};

let snapshot: ManualProjectsSnapshot = {
  projects: [],
  loading: false,
  loadedUserId: null,
};

let inFlightLoad: Promise<void> | null = null;

const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function setSnapshot(next: ManualProjectsSnapshot) {
  snapshot = next;
  emitChange();
}

function getSnapshot() {
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function sortSharedManualProjects(
  projects: TaskCreationProjectSummary[],
) {
  return [...projects].sort((left, right) => {
    const pinnedDelta = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
    if (pinnedDelta !== 0) return pinnedDelta;

    const leftTime = Date.parse(left.updatedAt || left.createdAt || "");
    const rightTime = Date.parse(right.updatedAt || right.createdAt || "");
    const safeLeftTime = Number.isFinite(leftTime) ? leftTime : 0;
    const safeRightTime = Number.isFinite(rightTime) ? rightTime : 0;
    if (safeRightTime !== safeLeftTime) return safeRightTime - safeLeftTime;

    return (left.name || "").localeCompare(right.name || "", "zh-CN");
  });
}

export function upsertSharedManualProjectList(
  projects: TaskCreationProjectSummary[],
  nextProject: TaskCreationProjectSummary,
) {
  const nextProjects = projects.some((project) => project.id === nextProject.id)
    ? projects.map((project) => (project.id === nextProject.id ? nextProject : project))
    : [nextProject, ...projects];
  return sortSharedManualProjects(nextProjects);
}

export function removeSharedManualProjectFromList(
  projects: TaskCreationProjectSummary[],
  projectId: string,
) {
  return projects.filter((project) => project.id !== projectId);
}

export async function loadSharedManualProjects(options?: {
  force?: boolean;
  userId?: string | null;
}) {
  const nextUserId = options?.userId ?? null;
  const needsReload =
    options?.force ||
    snapshot.loadedUserId !== nextUserId ||
    (!snapshot.loading && snapshot.projects.length === 0);

  if (!needsReload) {
    return snapshot.projects;
  }

  if (!inFlightLoad) {
    setSnapshot({
      ...snapshot,
      loading: true,
    });
    inFlightLoad = listTaskCreationProjects()
      .then((projects) => {
        setSnapshot({
          projects: sortSharedManualProjects(projects),
          loading: false,
          loadedUserId: nextUserId,
        });
      })
      .finally(() => {
        inFlightLoad = null;
      });
  }

  await inFlightLoad;
  return snapshot.projects;
}

export function replaceSharedManualProjects(
  projects: TaskCreationProjectSummary[],
  userId?: string | null,
) {
  setSnapshot({
    projects: sortSharedManualProjects(projects),
    loading: false,
    loadedUserId: userId ?? snapshot.loadedUserId,
  });
}

export function upsertSharedManualProject(
  project: TaskCreationProjectSummary,
  userId?: string | null,
) {
  setSnapshot({
    projects: upsertSharedManualProjectList(snapshot.projects, project),
    loading: false,
    loadedUserId: userId ?? snapshot.loadedUserId,
  });
}

export function removeSharedManualProject(projectId: string) {
  setSnapshot({
    ...snapshot,
    projects: removeSharedManualProjectFromList(snapshot.projects, projectId),
  });
}

export function useSharedManualProjects(userId?: string | null) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void loadSharedManualProjects({ userId });
  }, [userId]);

  return state;
}
