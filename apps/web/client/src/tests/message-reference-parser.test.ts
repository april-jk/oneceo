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

  it("fixes mojibake attachment names from history marker text", () => {
    const resolved = resolveUserMessageReferences({
      content:
        "分析一下我提供的文档\n\n[Attached: éå½è¿ç¨è®°å½_20260328.md -> uploads/1775390487727-743df299-20260328.md]",
      metadata: {},
    });

    expect(resolved.attachments).toHaveLength(1);
    expect(resolved.attachments[0]?.name).toBe("递归过程记录_20260328.md");
    expect(Number.isNaN(resolved.attachments[0]?.size)).toBe(true);
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

  it("keeps skill visible even when revisionId is missing in legacy metadata", () => {
    const resolved = resolveUserMessageReferences({
      content: "执行技能",
      metadata: {
        skills: [
          {
            skillId: "skill-legacy",
            name: "Legacy Skill",
            slug: "legacy-skill",
          },
        ],
      },
    });

    expect(resolved.skills).toHaveLength(1);
    expect(resolved.skills[0]?.skillId).toBe("skill-legacy");
    expect(resolved.skills[0]?.revisionId).toBe("skill-legacy");
    expect(resolved.skills[0]?.name).toBe("Legacy Skill");
  });

  it("parses skills from stringified metadata", () => {
    const resolved = resolveUserMessageReferences({
      content: "执行技能",
      metadata: JSON.stringify({
        originalInput: "执行技能",
        skills: [
          {
            skillId: "skill-json",
            revisionId: "rev-json",
            slug: "json-skill",
            name: "JSON Skill",
          },
        ],
      }),
    });

    expect(resolved.text).toBe("执行技能");
    expect(resolved.skills).toHaveLength(1);
    expect(resolved.skills[0]?.skillId).toBe("skill-json");
  });

  it("parses references from nested references object", () => {
    const resolved = resolveUserMessageReferences({
      content: "引用测试",
      metadata: {
        references: {
          managedSkillContext: [
            {
              skillId: "skill-nested",
              revisionId: "rev-nested",
              slug: "nested-skill",
              name: "Nested Skill",
            },
          ],
        },
      },
    });

    expect(resolved.skills).toHaveLength(1);
    expect(resolved.skills[0]?.skillId).toBe("skill-nested");
  });
});
