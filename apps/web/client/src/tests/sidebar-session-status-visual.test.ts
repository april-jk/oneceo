import { describe, expect, it } from "vitest";
import {
  getSessionStatusVisual,
  hasMeaningfulSidebarSessionUpdate,
  mergeSidebarSessionPatch,
} from "@/components/Sidebar";

describe("sidebar session status visual", () => {
  const t = (key: string) => {
    if (key === "sidebar.statusWaitingUser") return "待补充";
    if (key === "sidebar.statusInProgress") return "进行中";
    if (key === "sidebar.statusCompleted") return "已完成";
    return key;
  };

  it("marks waiting_user with warning text and waiting flag", () => {
    const visual = getSessionStatusVisual("waiting_user", t);
    expect(visual.label).toBe("待补充");
    expect(visual.waitingUser).toBe(true);
    expect(visual.labelClassName).toContain("function-warning");
  });

  it("restores in_progress visual to normal tone", () => {
    const visual = getSessionStatusVisual("in_progress", t);
    expect(visual.label).toBe("进行中");
    expect(visual.waitingUser).toBe(false);
    expect(visual.labelClassName).toBe("text-muted-foreground");
  });

  it("preserves updatedAt when patch only changes metadata", () => {
    const merged = mergeSidebarSessionPatch(
      {
        title: "旧标题",
        updatedAt: "2026-04-21T10:00:00.000Z",
        projectId: "project-a",
      },
      {
        title: "新标题",
        projectId: "project-b",
      },
    );
    expect(merged.title).toBe("新标题");
    expect(merged.projectId).toBe("project-b");
    expect(merged.updatedAt).toBe("2026-04-21T10:00:00.000Z");
  });

  it("treats selection-only session events as non-meaningful", () => {
    expect(hasMeaningfulSidebarSessionUpdate(null)).toBe(false);
    expect(hasMeaningfulSidebarSessionUpdate({})).toBe(false);
    expect(
      hasMeaningfulSidebarSessionUpdate({
        projectId: null,
      }),
    ).toBe(true);
    expect(
      hasMeaningfulSidebarSessionUpdate({
        status: "in_progress",
      }),
    ).toBe(true);
  });
});
