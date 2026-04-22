import { describe, expect, it } from "vitest";
import { buildChatItems, type ChatItem } from "@/pages/Home";
import type { AgentMessage } from "@/hooks/useTaskCreationAgent";

function createManagedToolMessage(input: {
  eventType: "tool_call_started" | "tool_call_completed";
  content: string;
  toolCallId: string;
  toolName?: string;
}): AgentMessage {
  return {
    type: "executor_event",
    content: input.content,
    messageKey: `managed:run-status-dialogue-1:tool:${input.toolCallId}`,
    sessionId: "session-managed-status-dialogue-1",
    metadata: {
      executionMode: "managed",
      executor: "altus",
      eventType: input.eventType,
      runId: "run-status-dialogue-1",
      toolCallId: input.toolCallId,
      toolName: input.toolName || "read_file",
      messageKey: `managed:run-status-dialogue-1:tool:${input.toolCallId}`,
    },
  };
}

function createManagedRunStatusMessage(content: string): AgentMessage {
  return {
    type: "status_update",
    content,
    messageKey: `managed:run-status-dialogue-1:run_status:${content}`,
    sessionId: "session-managed-status-dialogue-1",
    metadata: {
      executionMode: "managed",
      executor: "altus",
      eventType: "run_status",
      runId: "run-status-dialogue-1",
      status: "running",
    },
  };
}

describe("managed run status dialogue", () => {
  it("renders managed run_status between tool cards as Altus dialogue", () => {
    const items = buildChatItems([
      createManagedToolMessage({
        eventType: "tool_call_completed",
        content: "工具 read_file 已完成",
        toolCallId: "tool-1",
      }),
      createManagedRunStatusMessage("正在分析上一步结果并决定下一步操作"),
      createManagedToolMessage({
        eventType: "tool_call_started",
        content: "开始调用 search_code",
        toolCallId: "tool-2",
        toolName: "search_code",
      }),
    ]);

    expect(items).toHaveLength(3);
    expect(items[0]?.kind).toBe("managed_tool");
    expect(items[1]?.kind).toBe("agent_plain");
    expect((items[1] as Extract<ChatItem, { kind: "agent_plain" }>).author).toBe("Altus");
    expect((items[1] as Extract<ChatItem, { kind: "agent_plain" }>).text).toContain("决定下一步操作");
    expect(items[2]?.kind).toBe("managed_tool");
  });
});
