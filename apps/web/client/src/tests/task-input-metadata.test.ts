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
      modelTier: "pro",
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
      modelTier: "pro",
      originalInput: "use github",
    });
  });

  it("returns metadata with default model tier when nothing else should be attached", () => {
    expect(
      buildManagedTaskInputMetadata({
        originalInput: "plain text only",
        skills: [],
        mcpReferences: [],
        fileCount: 0,
      }),
    ).toEqual({
      modelTier: "pro",
      originalInput: "plain text only",
    });
  });

  it("keeps an explicit max model tier", () => {
    expect(
      buildManagedTaskInputMetadata({
        originalInput: "run with max tier",
        skills: [],
        mcpReferences: [],
        fileCount: 0,
        modelTier: "max",
      }),
    ).toEqual({
      modelTier: "max",
      originalInput: "run with max tier",
    });
  });
});
