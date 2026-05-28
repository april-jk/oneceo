import { describe, expect, it } from "vitest";

import {
  extractFilesFromTransfer,
  hasFileTransfer,
} from "@/lib/task-attachment-transfer";

function createFile(name: string, type = "text/plain") {
  return new File(["content"], name, {
    type,
    lastModified: 1,
  });
}

describe("task attachment transfer", () => {
  it("extracts files from clipboard or drag items", () => {
    const image = createFile("screen.png", "image/png");
    const doc = createFile("brief.md");
    const files = extractFilesFromTransfer({
      items: [
        { kind: "string" },
        { kind: "file", getAsFile: () => image },
        { kind: "file", getAsFile: () => doc },
      ],
    });

    expect(files.map((file) => file.name)).toEqual(["screen.png", "brief.md"]);
  });

  it("falls back to file list and avoids duplicates", () => {
    const file = createFile("report.pdf", "application/pdf");
    const files = extractFilesFromTransfer({
      files: [file],
      items: [{ kind: "file", getAsFile: () => file }],
    });

    expect(files).toEqual([file]);
  });

  it("detects file transfers without extracting text clipboard content", () => {
    expect(hasFileTransfer({ types: ["text/plain"] })).toBe(false);
    expect(hasFileTransfer({ types: ["Files"] })).toBe(true);
    expect(hasFileTransfer({ items: [{ kind: "file" }] })).toBe(true);
  });
});
