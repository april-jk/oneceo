import { describe, expect, it } from "vitest";

import {
  buildSlashText,
  parseTrailingSlashQuery,
  stripTrailingSlashQuery,
} from "@/lib/slash-references";

describe("slash-references", () => {
  it("parses trailing slash query with kind suffix", () => {
    const skill = parseTrailingSlashQuery("hello /ppt-skills");
    expect(skill?.kind).toBe("skill");
    expect(skill?.keyword).toBe("ppt");

    const mcp = parseTrailingSlashQuery("hello /github-mcp");
    expect(mcp?.kind).toBe("mcp");
    expect(mcp?.keyword).toBe("github");
  });

  it("parses generic slash query", () => {
    const parsed = parseTrailingSlashQuery("hello /fig");
    expect(parsed?.kind).toBe("all");
    expect(parsed?.keyword).toBe("fig");
  });

  it("strips trailing slash query into plain input prefix", () => {
    expect(stripTrailingSlashQuery("hello /fig")).toBe("hello ");
    expect(stripTrailingSlashQuery("/fig-skills")).toBe("");
  });

  it("builds slash text from token kind and value", () => {
    expect(buildSlashText("skill", "PPT 办公")).toBe("/ppt-办公-skills");
    expect(buildSlashText("mcp", "GitHub")).toBe("/github-mcp");
  });
});
