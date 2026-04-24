import { describe, expect, it } from "vitest";
import {
  groupSearchResultsByProject,
  normalizeSearchPageQuery,
  shouldTriggerSearchPage,
} from "@/pages/Search";

describe("search page helpers", () => {
  it("normalizes search query before fetching", () => {
    expect(normalizeSearchPageQuery("   foo   bar   ")).toBe("foo bar");
    expect(normalizeSearchPageQuery("x".repeat(120))).toHaveLength(100);
  });

  it("requires at least two characters to trigger search", () => {
    expect(shouldTriggerSearchPage("a")).toBe(false);
    expect(shouldTriggerSearchPage(" a ")).toBe(false);
    expect(shouldTriggerSearchPage("ab")).toBe(true);
    expect(shouldTriggerSearchPage(" 关键词 ")).toBe(true);
  });

  it("groups results by project and keeps ungrouped items separate", () => {
    const groups = groupSearchResultsByProject([
      {
        sessionId: "session-1",
        title: "Alpha",
        projectName: "Project A",
        updatedAt: "2026-04-24T01:00:00.000Z",
      },
      {
        sessionId: "session-2",
        title: "Beta",
        projectName: null,
        updatedAt: "2026-04-24T02:00:00.000Z",
      },
      {
        sessionId: "session-3",
        title: "Gamma",
        projectName: "Project A",
        updatedAt: "2026-04-24T03:00:00.000Z",
      },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].key).toBe("Project A");
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].key).toBe("__ungrouped__");
    expect(groups[1].items).toHaveLength(1);
  });
});
