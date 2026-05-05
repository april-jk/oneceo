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
  loading: true,
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

export function readSidebarExpandedState(
  raw: string | null,
  key: "expandedProjectGroups" | "expandedProjects" | "expandedManagers",
  defaultValue: string[],
) {
  if (!raw) return defaultValue;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const stored = parsed?.[key];
    return Array.isArray(stored) ? stored.filter((item) => typeof item === "string") : [];
  } catch {
    return defaultValue;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readSidebarExpandedState(
  raw: string | null,
  key: string,
  fallback: string[],
) {
  if (!raw) return fallback;

  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const candidate = parsed[key];
  if (!Array.isArray(candidate)) return fallback;

  const next = candidate.filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return next.length > 0 ? next : fallback;
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
    snapshot.projects.length === 0;

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
      .catch((error) => {
        setSnapshot({
          ...snapshot,
          loading: false,
        });
        throw error;
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
