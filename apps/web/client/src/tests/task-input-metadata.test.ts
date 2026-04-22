import { describe, expect, it } from "vitest";

import {
  buildManagedTaskInputMetadata,
  type TaskCreationMcpReference,
} from "@/lib/task-input-metadata";
import type { TaskCreationPlatformSkill } from "@/lib/task-creation-client";

const skill: TaskCreationPlatformSkill = {
  sourceType: "platform",
  skillId: "minimax-pdf",
  revisionId: "rev1",
  slug: "minimax-pdf",
  name: "minimax-pdf",
  description: "PDF skill",
  category: "tool",
  revisionNumber: 1,
  resourceSummary: null,
};

const mcpReference: TaskCreationMcpReference = {
  key: "github",
  name: "GitHub MCP",
  category: "custom_mcp",
};

describe("buildManagedTaskInputMetadata", () => {
  it("keeps slash-selected skills even when no file attachments exist", () => {
    expect(
      buildManagedTaskInputMetadata({
        originalInput: "run with selected skill",
        skills: [skill],
        mcpReferences: [],
        fileCount: 0,
      }),
    ).toEqual({
      skills: [skill],
      originalInput: "run with selected skill",
    });
  });

  it("keeps mcp references without file attachments", () => {
    expect(
      buildManagedTaskInputMetadata({
        originalInput: "use github",
        skills: [],
        mcpReferences: [mcpReference],
        fileCount: 0,
      }),
    ).toEqual({
      mcpReferences: [mcpReference],
      originalInput: "use github",
    });
  });

  it("returns undefined when nothing should be attached", () => {
    expect(
      buildManagedTaskInputMetadata({
        originalInput: "plain text only",
        skills: [],
        mcpReferences: [],
        fileCount: 0,
      }),
    ).toBeUndefined();
  });
});
