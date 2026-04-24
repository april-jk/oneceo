import { describe, expect, it } from "vitest";
import {
  buildChatItems,
  collapseRepeatedChatAuthors,
  getActiveManagedStatusText,
  type ChatItem,
} from "@/pages/Home";
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

function createManagedStartingStatusMessage(content: string): AgentMessage {
  return {
    type: "status_update",
    content,
    messageKey: `managed:run-status-dialogue-1:run_status:starting`,
    sessionId: "session-managed-status-dialogue-1",
    metadata: {
      executionMode: "managed",
      executor: "altus",
      eventType: "run_status",
      runId: "run-status-dialogue-1",
      status: "starting",
    },
  };
}

describe("managed run status dialogue", () => {
  it("drops stale managed run_status once a following tool card arrives", () => {
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

    expect(items).toHaveLength(2);
    expect(items[0]?.kind).toBe("managed_tool");
    expect(items[1]?.kind).toBe("managed_tool");
    expect(
      items.some(
        (item) =>
          item.kind === "agent_plain" &&
          item.text.includes("决定下一步操作"),
      ),
    ).toBe(false);
  });

  it("renders only the latest trailing managed run_status as an atomic status", () => {
    const items = buildChatItems([
      createManagedRunStatusMessage("已创建新的 sandbox，开始执行"),
      createManagedRunStatusMessage("正在分析并执行任务"),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("managed_status");
    expect(
      (items[0] as Extract<ChatItem, { kind: "managed_status" }>).text,
    ).toBe("正在分析并执行任务");
    expect(getActiveManagedStatusText(items)).toBe("正在分析并执行任务");
  });

  it("drops stale managed starting run_status once a following tool card arrives", () => {
    const items = buildChatItems([
      createManagedStartingStatusMessage("正在准备 sandbox 与运行环境"),
      createManagedToolMessage({
        eventType: "tool_call_started",
        content: "开始调用 search_code",
        toolCallId: "tool-2",
        toolName: "search_code",
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("managed_tool");
  });

  it("keeps only the latest managed run_status around managed tools", () => {
    const items = collapseRepeatedChatAuthors(
      buildChatItems([
        createManagedRunStatusMessage("运行环境已经准备好了，我开始生成项目内容"),
        createManagedToolMessage({
          eventType: "tool_call_completed",
          content: "工具 write_file 已完成",
          toolCallId: "tool-1",
          toolName: "write_file",
        }),
        createManagedRunStatusMessage("页面框架已经搭好，我继续把样式和交互补完整"),
        createManagedToolMessage({
          eventType: "tool_call_completed",
          content: "工具 write_file 已完成",
          toolCallId: "tool-2",
          toolName: "write_file",
        }),
        createManagedRunStatusMessage("界面样式已经整理好了，我继续补上操作逻辑"),
      ]),
    );

    const managedStatusItems = items.filter(
      (item): item is Extract<ChatItem, { kind: "managed_status" }> =>
        item.kind === "managed_status",
    );

    expect(managedStatusItems).toHaveLength(1);
    expect(managedStatusItems[0]?.text).toBe(
      "界面样式已经整理好了，我继续补上操作逻辑",
    );
    expect(items.filter((item) => item.kind === "managed_tool")).toHaveLength(2);
  });

  it("starts a fresh managed run_status after a new user round", () => {
    const items = collapseRepeatedChatAuthors(
      buildChatItems([
        createManagedRunStatusMessage("运行环境已经准备好了，我开始生成项目内容"),
        {
          type: "user_input",
          content: "继续帮我完善动效",
          messageKey: "user-next-round",
          sessionId: "session-managed-status-dialogue-1",
          metadata: {
            messageKey: "user-next-round",
          },
        } as AgentMessage,
        createManagedRunStatusMessage("我继续补齐动效和收尾细节"),
      ]),
    );

    expect(items.some((item) => item.kind === "managed_status")).toBe(true);
    expect(items[0]?.kind).toBe("user");
    expect(items[1]?.kind).toBe("managed_status");
    expect(getActiveManagedStatusText(items)).toBe("我继续补齐动效和收尾细节");
  });
});
