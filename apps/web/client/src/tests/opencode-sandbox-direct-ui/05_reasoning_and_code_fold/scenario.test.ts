import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@/hooks/useTaskCreationAgent";
import {
  buildChatItems,
  buildDirectMarkdownSegments,
} from "@/pages/Home";

function reasoningPartEvent(content: string, partId: string): AgentMessage {
  return {
    type: "opencode_event",
    content,
    metadata: {
      eventType: "message.part.updated",
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: partId,
            type: "reasoning",
            text: content,
            time: {
              start: Date.now(),
            },
          },
        },
      },
      rawPayload: {
        event: {
          type: "message.part.updated",
          properties: {
            part: {
              id: partId,
              type: "reasoning",
              text: content,
              time: {
                start: Date.now(),
              },
            },
          },
        },
      },
    },
  };
}

function textPartEvent(content: string, partId: string): AgentMessage {
  return {
    type: "opencode_event",
    content,
    metadata: {
      eventType: "message.part.updated",
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: partId,
            type: "text",
            text: content,
          },
        },
      },
      rawPayload: {
        event: {
          type: "message.part.updated",
          properties: {
            part: {
              id: partId,
              type: "text",
              text: content,
            },
          },
        },
      },
    },
  };
}

describe("05_reasoning_and_code_fold", () => {
  it("hides reasoning body while keeping thinking heading and atomic text", () => {
    const messages: AgentMessage[] = [
      {
        type: "user_input",
        content: "继续优化这个页面",
      },
      reasoningPartEvent(
        [
          "## Structuring the project",
          "",
          "I'm thinking about providing a structure for the project and splitting files.",
        ].join("\n"),
        "reasoning-1",
      ),
      textPartEvent("已读取 `package.json`，接下来检查入口文件。", "text-1"),
    ];

    const items = buildChatItems(messages);
    const turnItems = items.filter((item) => item.kind === "opencode_turn");

    expect(turnItems).toHaveLength(1);
    expect(turnItems[0]?.thinkingLabel).toBe("Structuring the project");
    expect(
      turnItems[0]?.assistantParts.map((part) => part.kind),
    ).toEqual(["text"]);
    expect(
      turnItems[0]?.assistantParts[0] &&
        "markdown" in turnItems[0].assistantParts[0]
        ? turnItems[0].assistantParts[0].markdown
        : "",
    ).toContain("已读取");
  });

  it("folds long fenced code blocks while keeping surrounding text visible", () => {
    const longCode = Array.from({ length: 18 }, (_, index) =>
      `console.log("line-${index + 1}")`,
    ).join("\n");
    const markdown = [
      "已生成入口文件：",
      "",
      "```ts",
      longCode,
      "```",
      "",
      "后续我会继续整理样式文件。",
    ].join("\n");

    const segments = buildDirectMarkdownSegments(markdown);

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({
      kind: "markdown",
    });
    expect(segments[1]).toMatchObject({
      kind: "foldable",
      summary: "ts 代码 · 18 行",
    });
    expect(segments[2]).toMatchObject({
      kind: "markdown",
    });
  });
});
