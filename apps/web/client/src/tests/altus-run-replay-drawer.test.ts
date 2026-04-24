import { describe, expect, it } from "vitest";
import {
  normalizeReplayCompletionMarkdown,
  resolveReplayPreferredFilePath,
  resolveReplaySelectedFilePath,
  shouldRenderReplayActionMarkdown,
  type AltusReplayFile,
} from "@/components/AltusRunReplayDrawer";

const replayFiles: AltusReplayFile[] = [
  {
    path: "src/index.html",
    name: "index.html",
    displayName: "index.html",
    previewType: "web",
  },
  {
    path: "src/style.css",
    name: "style.css",
    displayName: "style.css",
    previewType: "code",
  },
  {
    path: "src/script.js",
    name: "script.js",
    displayName: "script.js",
    previewType: "code",
  },
];

describe("altus run replay drawer file selection", () => {
  it("prefers an artifact path from the selected action when available", () => {
    expect(
      resolveReplayPreferredFilePath(replayFiles, [
        "src/unknown.ts",
        "src/style.css",
      ]),
    ).toBe("src/style.css");
  });

  it("keeps the manually selected file while staying on the same action", () => {
    expect(
      resolveReplaySelectedFilePath({
        currentSelectedPath: "src/script.js",
        files: replayFiles,
        artifactPaths: ["src/index.html"],
        forcePreferred: false,
      }),
    ).toBe("src/script.js");
  });

  it("switches back to the action preferred file when the action changes", () => {
    expect(
      resolveReplaySelectedFilePath({
        currentSelectedPath: "src/script.js",
        files: replayFiles,
        artifactPaths: ["src/index.html"],
        forcePreferred: true,
      }),
    ).toBe("src/index.html");
  });
});

describe("altus run replay drawer action rendering", () => {
  it("renders completion actions as markdown while keeping other tools plain", () => {
    expect(
      shouldRenderReplayActionMarkdown({ toolName: "complete_task" }),
    ).toBe(true);
    expect(shouldRenderReplayActionMarkdown({ toolName: "write_file" })).toBe(
      false,
    );
  });

  it("normalizes legacy bullet glyph summaries into markdown lists", () => {
    expect(
      normalizeReplayCompletionMarkdown(
        "核心功能： • **前端**：完成 • **后端**：完成",
      ),
    ).toBe("核心功能：\n- **前端**：完成\n- **后端**：完成");
  });
});
