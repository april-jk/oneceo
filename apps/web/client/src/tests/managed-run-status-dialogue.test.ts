import { describe, expect, it } from "vitest";
import {
  buildChatItems,
  buildManagedReplayData,
  collapseRepeatedChatAuthors,
  getActiveManagedStatusText,
  getManagedToolPurposeSummary,
  groupManagedActivityItems,
  resolveManagedToolReplayView,
  type ChatItem,
} from "@/pages/Home";
import type { AgentMessage } from "@/hooks/useTaskCreationAgent";

function createManagedToolMessage(input: {
  eventType: "tool_call_started" | "tool_call_completed" | "tool_call_failed";
  content: string;
  toolCallId: string;
  toolName?: string;
  metadata?: Record<string, unknown>;
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
      ...(input.metadata || {}),
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

function createManagedTodoWriteMessage(
  toolCallId: string,
  todos: Array<{ content: string; status: string; activeForm?: string }>,
): AgentMessage {
  return createManagedToolMessage({
    eventType: "tool_call_completed",
    content: "任务清单已更新",
    toolCallId,
    toolName: "todowrite",
    metadata: {
      arguments: {
        todos,
      },
      outputPreview: {
        todos,
      },
    },
  });
}

describe("managed run status dialogue", () => {
  it("routes managed tool clicks to the matching replay drawer view", () => {
    expect(resolveManagedToolReplayView("write_file")).toBe("actions");
    expect(resolveManagedToolReplayView("debug_open_page")).toBe("debug");
    expect(resolveManagedToolReplayView("browser_interact")).toBe("debug");
    expect(resolveManagedToolReplayView("deploy_application")).toBe(
      "deployment",
    );
    expect(resolveManagedToolReplayView("redeploy_application")).toBe(
      "deployment",
    );
    expect(
      resolveManagedToolReplayView("get_application_deployment_status"),
    ).toBe("deployment");
  });

  it("attaches browser screenshots to the matching replay action", () => {
    const replayByRun = buildManagedReplayData([
      createManagedToolMessage({
        eventType: "tool_call_completed",
        content: "视觉检测步骤已完成",
        toolCallId: "browser-tool-1",
        toolName: "browser_interact",
        metadata: {
          browserScreenshot: {
            type: "browser_screenshot",
            kind: "browser_action_screenshot",
            status: "captured",
            storageKey: "sessions/session-1/browser-actions/step.png",
            mimeType: "image/png",
            width: 1280,
            height: 720,
            capturedAt: "2026-05-22T06:00:00.000Z",
            visualCheck: {
              status: "failed",
              reasonCode: "visible_text_too_short",
              message: "页面可见文本和元素过少，疑似白屏或空页面。",
              diagnostics: {
                visibleTextLength: 0,
              },
            },
            source: {
              sandboxId: "sandbox-1",
              cdpPort: 9222,
              url: "http://127.0.0.1:3000/",
              title: "Demo",
              action: "keyboard_press",
              description: "按下 ArrowUp 键",
            },
          },
        },
      }),
    ]);

    const action = replayByRun.get("run-status-dialogue-1")?.actions[0];
    expect(action?.browserScreenshot?.status).toBe("captured");
    expect(action?.browserScreenshot?.visualCheck?.status).toBe("failed");
    expect(action?.browserScreenshot?.visualCheck?.reasonCode).toBe(
      "visible_text_too_short",
    );
    expect(action?.browserScreenshot?.source?.url).toBe("http://127.0.0.1:3000/");
    expect(action?.browserScreenshot?.source?.description).toBe("按下 ArrowUp 键");
  });

  it("keeps managed run_status between two tool cards", () => {
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
    expect(items[1]?.kind).toBe("managed_status");
    expect(items[2]?.kind).toBe("managed_tool");
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
    expect(
      (items[0] as Extract<ChatItem, { kind: "managed_status" }>)
        .displayInTimeline,
    ).toBe(false);
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

  it("keeps intermediate run_status in the managed activity group and leaves only the trailing status atomic", () => {
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

    expect(managedStatusItems).toHaveLength(3);
    expect(managedStatusItems.slice(0, 2).map((item) => item.displayInTimeline)).toEqual([
      true,
      true,
    ]);
    expect(managedStatusItems[2]?.text).toBe(
      "界面样式已经整理好了，我继续补上操作逻辑",
    );
    expect(managedStatusItems[2]?.displayInTimeline).toBe(false);
    expect(items.filter((item) => item.kind === "managed_tool")).toHaveLength(2);

    const visibleItems = groupManagedActivityItems(
      items.filter(
        (item) =>
          item.kind !== "managed_status" || item.displayInTimeline !== false,
      ),
    );
    expect(visibleItems).toHaveLength(1);
    expect(visibleItems[0]?.kind).toBe("managed_activity_group");
    expect(
      (visibleItems[0] as Extract<ChatItem, { kind: "managed_activity_group" }>)
        .items,
    ).toHaveLength(4);
  });

  it("marks recovered managed activity group as completed when a later tool succeeds", () => {
    const visibleItems = groupManagedActivityItems(
      buildChatItems([
        createManagedToolMessage({
          eventType: "tool_call_failed",
          content: "本地常驻服务启动命令被拦截",
          toolCallId: "tool-failed",
          toolName: "shell_execute",
          metadata: {
            arguments: {
              command: "pnpm dev --host 0.0.0.0",
            },
          },
        }),
        createManagedRunStatusMessage("刚才那一步执行没成功，我换个方式继续"),
        createManagedToolMessage({
          eventType: "tool_call_completed",
          content: "任务已完成",
          toolCallId: "tool-complete",
          toolName: "complete_task",
          metadata: {
            arguments: {
              summary: "watson，我已经为你创建了一个完整的2048小游戏！",
            },
          },
        }),
      ]).filter(
        (item) =>
          item.kind !== "managed_status" || item.displayInTimeline !== false,
      ),
    );

    expect(visibleItems[0]?.kind).toBe("managed_activity_group");
    const group = visibleItems[0] as Extract<
      ChatItem,
      { kind: "managed_activity_group" }
    >;
    expect(group.title).toBe("刚才那一步执行没成功，我换个方式继续");
    expect(group.items[group.items.length - 1]).toMatchObject({
      kind: "managed_tool",
      status: "completed",
      toolName: "complete_task",
    });
  });

  it("uses purpose summaries instead of raw tool output in managed activity group rows", () => {
    const visibleItems = groupManagedActivityItems(
      buildChatItems([
        createManagedToolMessage({
          eventType: "tool_call_completed",
          content: "写入 HTML",
          toolCallId: "tool-write",
          toolName: "write_file",
          metadata: {
            arguments: {
              path: "game-2048/index.html",
              content: '<!DOCTYPE html><html lang="zh-CN"><head></head></html>',
            },
            outputPreview: {
              path: "game-2048/index.html",
              content: '<!DOCTYPE html><html lang="zh-CN"><head></head></html>',
            },
          },
        }),
        createManagedToolMessage({
          eventType: "tool_call_completed",
          content: "检查目录",
          toolCallId: "tool-ls",
          toolName: "shell_execute",
          metadata: {
            arguments: {
              command: "ls -la game-2048",
            },
            outputPreview: {
              stdout: "total 20 drwxr-xr-x 2 user user 4096 Apr 24",
            },
          },
        }),
      ]),
    );

    const group = visibleItems[0] as Extract<
      ChatItem,
      { kind: "managed_activity_group" }
    >;
    const toolRows = group.items.filter(
      (item): item is Extract<ChatItem, { kind: "managed_tool" }> =>
        item.kind === "managed_tool",
    );
    const writePurpose = getManagedToolPurposeSummary(
      toolRows[0]?.toolName || "",
      toolRows[0]?.metadata,
    );
    const shellPurpose = getManagedToolPurposeSummary(
      toolRows[1]?.toolName || "",
      toolRows[1]?.metadata,
    );

    expect(writePurpose).toBe("更新index.html");
    expect(writePurpose).not.toContain("<!DOCTYPE");
    expect(shellPurpose).toBe("检查项目文件和运行日志");
    expect(shellPurpose).not.toContain("total 20");
  });

  it("hides internal support artifacts from managed activity rows", () => {
    const visibleItems = groupManagedActivityItems(
      buildChatItems([
        createManagedToolMessage({
          eventType: "tool_call_completed",
          content: "写入内部 manifest",
          toolCallId: "tool-support",
          toolName: "write_file",
          metadata: {
            arguments: {
              path: "outputs/document_manifest.json",
              content: '{"fileName":"final.docx"}',
            },
            outputPreview: {
              path: "outputs/document_manifest.json",
              content: '{"fileName":"final.docx"}',
            },
          },
        }),
      ]),
    );

    const managedTools = visibleItems.flatMap((item) =>
      item.kind === "managed_activity_group"
        ? item.items.filter(
            (child): child is Extract<ChatItem, { kind: "managed_tool" }> =>
              child.kind === "managed_tool",
          )
        : [],
    );

    expect(managedTools).toHaveLength(0);
  });

  it("shows concrete browser interaction actions in managed activity rows", () => {
    expect(
      getManagedToolPurposeSummary("debug_open_page", {
        arguments: {
          url: "http://127.0.0.1:3000/",
        },
      }),
    ).toBe("视觉检测：打开 http://127.0.0.1:3000/");

    expect(
      getManagedToolPurposeSummary("browser_interact", {
        arguments: {
          action: "text_click",
          text: "新游戏",
          description: "点击“新游戏”按钮",
        },
      }),
    ).toBe("点击“新游戏”按钮");

    expect(
      getManagedToolPurposeSummary("browser_interact", {
        arguments: {
          action: "keyboard_press",
          key: "ArrowUp",
        },
      }),
    ).toBe("按下 ArrowUp 键");

    expect(
      getManagedToolPurposeSummary("browser_interact", {
        arguments: {
          action: "mouse_wheel",
          direction: "down",
          pixels: 800,
        },
      }),
    ).toBe("向下滚动 800 像素");
  });

  it("splits managed activity groups by active todowrite stages", () => {
    const visibleItems = groupManagedActivityItems(
      buildChatItems([
        createManagedTodoWriteMessage("todo-stage-1", [
          {
            content: "搭建页面结构",
            status: "in_progress",
            activeForm: "正在搭建页面结构",
          },
          {
            content: "验证最终效果",
            status: "pending",
            activeForm: "正在验证最终效果",
          },
        ]),
        createManagedRunStatusMessage("运行环境已经准备好了，我开始生成项目内容"),
        createManagedToolMessage({
          eventType: "tool_call_completed",
          content: "工具 write_file 已完成",
          toolCallId: "tool-write-stage-1",
          toolName: "write_file",
          metadata: {
            arguments: {
              path: "game-2048/index.html",
              content: "<!DOCTYPE html>",
            },
          },
        }),
        createManagedTodoWriteMessage("todo-stage-2", [
          {
            content: "搭建页面结构",
            status: "completed",
            activeForm: "正在搭建页面结构",
          },
          {
            content: "验证最终效果",
            status: "in_progress",
            activeForm: "正在验证最终效果",
          },
        ]),
        createManagedToolMessage({
          eventType: "tool_call_completed",
          content: "工具 shell_execute 已完成",
          toolCallId: "tool-check-stage-2",
          toolName: "shell_execute",
          metadata: {
            arguments: {
              command: "pnpm test",
            },
          },
        }),
        createManagedTodoWriteMessage("todo-all-done", [
          {
            content: "搭建页面结构",
            status: "completed",
            activeForm: "正在搭建页面结构",
          },
          {
            content: "验证最终效果",
            status: "completed",
            activeForm: "正在验证最终效果",
          },
        ]),
        createManagedToolMessage({
          eventType: "tool_call_completed",
          content: "任务已完成",
          toolCallId: "tool-complete",
          toolName: "complete_task",
          metadata: {
            arguments: {
              summary: "2048 小游戏已完成",
            },
          },
        }),
      ]).filter(
        (item) =>
          item.kind !== "managed_status" || item.displayInTimeline !== false,
      ),
    );

    expect(visibleItems).toHaveLength(2);
    expect(visibleItems.every((item) => item.kind === "managed_activity_group")).toBe(
      true,
    );

    const firstGroup = visibleItems[0] as Extract<
      ChatItem,
      { kind: "managed_activity_group" }
    >;
    const secondGroup = visibleItems[1] as Extract<
      ChatItem,
      { kind: "managed_activity_group" }
    >;

    expect(firstGroup.title).toBe("正在搭建页面结构");
    expect(secondGroup.title).toBe("正在验证最终效果");
    expect(firstGroup.defaultExpanded).toBe(false);
    expect(secondGroup.defaultExpanded).toBe(false);
    expect(
      secondGroup.items.filter(
        (item) => item.kind === "managed_tool" && item.toolName === "todowrite",
      ),
    ).toHaveLength(2);
    expect(secondGroup.items[secondGroup.items.length - 1]).toMatchObject({
      kind: "managed_tool",
      toolName: "complete_task",
      status: "completed",
    });
  });

  it("only expands the latest running todo activity group by default", () => {
    const visibleItems = groupManagedActivityItems(
      buildChatItems([
        createManagedTodoWriteMessage("todo-stage-1-running", [
          {
            content: "搭建页面结构",
            status: "in_progress",
            activeForm: "正在搭建页面结构",
          },
          {
            content: "验证最终效果",
            status: "pending",
            activeForm: "正在验证最终效果",
          },
        ]),
        createManagedToolMessage({
          eventType: "tool_call_completed",
          content: "工具 write_file 已完成",
          toolCallId: "tool-write-stage-1-running",
          toolName: "write_file",
          metadata: {
            arguments: {
              path: "game-2048/index.html",
              content: "<!DOCTYPE html>",
            },
          },
        }),
        createManagedTodoWriteMessage("todo-stage-2-running", [
          {
            content: "搭建页面结构",
            status: "completed",
            activeForm: "正在搭建页面结构",
          },
          {
            content: "验证最终效果",
            status: "in_progress",
            activeForm: "正在验证最终效果",
          },
        ]),
        createManagedToolMessage({
          eventType: "tool_call_completed",
          content: "工具 shell_execute 已完成",
          toolCallId: "tool-check-stage-2-running",
          toolName: "shell_execute",
          metadata: {
            arguments: {
              command: "pnpm test",
            },
          },
        }),
      ]).filter(
        (item) =>
          item.kind !== "managed_status" || item.displayInTimeline !== false,
      ),
    );

    const groups = visibleItems.filter(
      (item): item is Extract<ChatItem, { kind: "managed_activity_group" }> =>
        item.kind === "managed_activity_group",
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]?.title).toBe("正在搭建页面结构");
    expect(groups[1]?.title).toBe("正在验证最终效果");
    expect(groups[0]?.defaultExpanded).toBe(false);
    expect(groups[1]?.defaultExpanded).toBe(true);
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
