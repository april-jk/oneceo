import { describe, expect, it } from "vitest";
import type { TaskCreationProjectSummary } from "@/lib/task-creation-client";
import {
  removeSharedManualProjectFromList,
  sortSharedManualProjects,
  upsertSharedManualProjectList,
} from "@/lib/shared-manual-projects";

function createProject(
  overrides: Partial<TaskCreationProjectSummary>,
): TaskCreationProjectSummary {
  return {
    id: overrides.id || "project-id",
    name: overrides.name || "Project",
    pinned: overrides.pinned ?? false,
    createdAt: overrides.createdAt || "2026-04-20T00:00:00.000Z",
    updatedAt: overrides.updatedAt || "2026-04-20T00:00:00.000Z",
    projectInstruction: overrides.projectInstruction,
    status: overrides.status,
    projectType: overrides.projectType,
    defaultConnectors: overrides.defaultConnectors,
  };
}

describe("shared manual projects helpers", () => {
  it("sorts pinned projects before recent projects", () => {
    const projects = sortSharedManualProjects([
      createProject({
        id: "b",
        name: "Beta",
        pinned: false,
        updatedAt: "2026-04-20T00:00:00.000Z",
      }),
      createProject({
        id: "a",
        name: "Alpha",
        pinned: true,
        updatedAt: "2026-04-10T00:00:00.000Z",
      }),
    ]);

    expect(projects.map((project) => project.id)).toEqual(["a", "b"]);
  });

  it("replaces an existing project in place before sorting", () => {
    const projects = upsertSharedManualProjectList(
      [
        createProject({ id: "a", name: "Alpha", pinned: false }),
        createProject({ id: "b", name: "Beta", pinned: false }),
      ],
      createProject({ id: "b", name: "Beta Prime", pinned: true }),
    );

    expect(projects).toHaveLength(2);
    expect(projects[0]).toMatchObject({ id: "b", name: "Beta Prime", pinned: true });
  });

  it("removes a deleted project from the list", () => {
    const projects = removeSharedManualProjectFromList(
      [
        createProject({ id: "a", name: "Alpha" }),
        createProject({ id: "b", name: "Beta" }),
      ],
      "a",
    );

    expect(projects.map((project) => project.id)).toEqual(["b"]);
  });
});
