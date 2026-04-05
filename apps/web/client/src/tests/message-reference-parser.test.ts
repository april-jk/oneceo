import { describe, expect, it } from "vitest";
import {
  parseAttachmentReferencesFromText,
  resolveUserMessageReferences,
  stripAttachmentReferencesFromText,
} from "@/lib/message-reference-parser";

describe("message-reference-parser", () => {
  it("parses and strips attached marker lines from user content", () => {
    const text = [
      "分析一下我提供的文档",
      "",
      "[Attached: README.md -> uploads/1775379849350-856248cc-README.md]",
      "[Attached: data.csv -> uploads/abc-data.csv]",
    ].join("\n");

    const attachments = parseAttachmentReferencesFromText(text);
    const cleaned = stripAttachmentReferencesFromText(text);

    expect(attachments).toHaveLength(2);
    expect(attachments[0]?.name).toBe("README.md");
    expect(attachments[0]?.path).toBe("uploads/1775379849350-856248cc-README.md");
    expect(cleaned).toBe("分析一下我提供的文档");
  });

  it("recovers attachments from marker text when metadata lacks attachments", () => {
    const resolved = resolveUserMessageReferences({
      content:
        "帮我总结一个word\n\n[Attached: README.md -> uploads/1775379849350-856248cc-README.md]",
      metadata: {},
    });

    expect(resolved.text).toBe("帮我总结一个word");
    expect(resolved.attachments).toHaveLength(1);
    expect(resolved.attachments[0]?.name).toBe("README.md");
  });

  it("recovers skills from managedSkillContext when skills is empty", () => {
    const resolved = resolveUserMessageReferences({
      content: "请基于我的技能执行",
      metadata: {
        managedSkillContext: [
          {
            sourceType: "platform",
            skillId: "skill-1",
            revisionId: "rev-1",
            slug: "ppt-office",
            name: "PPT 办公",
            description: "desc",
            category: "office",
            revisionNumber: 1,
          },
        ],
      },
    });

    expect(resolved.skills).toHaveLength(1);
    expect(resolved.skills[0]?.skillId).toBe("skill-1");
    expect(resolved.skills[0]?.name).toBe("PPT 办公");
  });
});

