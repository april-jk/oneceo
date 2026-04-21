export type TaskProjectKind = "manual" | "self-organized";

export type TaskProjectSelection = {
  id: string;
  kind: TaskProjectKind;
};

export const SELF_ORGANIZED_PREVIEW_PROJECT_IDS = [
  "1",
  "2",
  "3",
  "4",
  "5",
] as const;

export function isSelfOrganizedPreviewProjectId(projectId: string) {
  return SELF_ORGANIZED_PREVIEW_PROJECT_IDS.includes(
    projectId as (typeof SELF_ORGANIZED_PREVIEW_PROJECT_IDS)[number],
  );
}
