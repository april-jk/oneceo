import { describe, expect, it } from "vitest";
import { buildChatItems, type ChatItem } from "@/pages/Home";
import type { AgentMessage } from "@/hooks/useTaskCreationAgent";

function createWriteFileProgressMessage(input: {
  runId?: string;
  sessionId?: string;
  path?: string;
  generatedChars?: number;
  preview?: string;
}): AgentMessage {
  return {
    type: "executor_event",
    content: "正在生成文件",
    sessionId: input.sessionId || "session-write-progress-1",
    metadata: {
      executionMode: "managed",
      executor: "altus",
      eventType: "tool_call_progress",
      runId: input.runId || "run-write-progress-1",
      toolCallId: "tool-write-progress-1",
      toolName: "write_file",
      arguments: {
        path: input.path || "src/pages/Home.tsx",
      },
      writeFileProgress: {
        path: input.path || "src/pages/Home.tsx",
        generatedChars: input.generatedChars ?? 268,
        preview: input.preview || "export default function Home() {\\n  return <main>Hello</main>;\\n}",
      },
    },
  };
}

describe("managed write_file progress visibility", () => {
  it("renders write_file generation progress in managed tool chip summary", () => {
    const items = buildChatItems([createWriteFileProgressMessage({})]);
    const toolItem = items.find((item): item is Extract<ChatItem, { kind: "managed_tool" }> => item.kind === "managed_tool");
    expect(toolItem).toBeTruthy();
    expect(toolItem?.summary).toContain("生成中 268 字符");
    expect(toolItem?.summary).toContain("src/pages/Home.tsx");
  });

  it("renders write_file code preview in managed tool detail", () => {
    const items = buildChatItems([
      createWriteFileProgressMessage({
        preview: "const app = createApp();\\napp.mount('#root');",
      }),
    ]);
    const toolItem = items.find((item): item is Extract<ChatItem, { kind: "managed_tool" }> => item.kind === "managed_tool");
    expect(toolItem).toBeTruthy();
    expect(toolItem?.detail).toContain("代码预览");
    expect(toolItem?.detail).toContain("const app = createApp()");
  });

  it("keeps full write_file preview content without truncated marker", () => {
    const longPreview = `${"x".repeat(1400)}\n// tail-visible`;
    const items = buildChatItems([
      createWriteFileProgressMessage({
        generatedChars: 1400 + "// tail-visible".length,
        preview: longPreview,
      }),
    ]);
    const toolItem = items.find((item): item is Extract<ChatItem, { kind: "managed_tool" }> => item.kind === "managed_tool");
    expect(toolItem).toBeTruthy();
    expect(toolItem?.detail).toContain("// tail-visible");
    expect(toolItem?.detail).not.toContain("[truncated]");
  });
});
