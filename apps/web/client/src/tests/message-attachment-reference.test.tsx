import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import MessageAttachmentReference, {
  classifyAttachmentPreview,
  MessageAttachmentFiles,
  MessageInlineReferences,
} from "@/components/MessageAttachmentReference";

describe("MessageAttachmentReference", () => {
  it("renders skills as inline colored references and files as separate file chips", () => {
    const html = renderToStaticMarkup(
      <MessageAttachmentReference
        skills={[
          {
            sourceType: "platform",
            skillId: "skill-1",
            revisionId: "rev-1",
            slug: "ppt",
            name: "PPT 办公",
            description: "desc",
            category: "office",
            revisionNumber: 3,
            resourceSummary: null,
          },
        ]}
        mcpReferences={[
          {
            key: "github",
            name: "GitHub",
            category: "code",
          },
        ]}
        attachments={[
          {
            name: "brief.pdf",
            path: "/tmp/brief.pdf",
            size: 2048,
            mimeType: "application/pdf",
          },
        ]}
      />,
    );

    expect(html).toContain("Skills");
    expect(html).toContain("GitHub");
    expect(html).toContain("PPT 办公");
    expect(html).toContain("brief.pdf");
    expect(html).toContain("2.0 KB");
    expect(html).not.toContain("已附加");
    expect(html).not.toContain("Skills 与附件");
  });

  it("renders nothing when no references exist", () => {
    const html = renderToStaticMarkup(<MessageAttachmentReference />);
    expect(html).toBe("");
  });

  it("does not render 0 B when attachment size is unknown", () => {
    const html = renderToStaticMarkup(
      <MessageAttachmentReference
        attachments={[
          {
            name: "递归过程记录_20260328.md",
            path: "uploads/1775390487727-743df299-20260328.md",
            size: Number.NaN,
          },
        ]}
      />,
    );

    expect(html).toContain("递归过程记录_20260328.md");
    expect(html).not.toContain("0 B");
  });

  it("collapses files after two items into a plus count trigger", () => {
    const html = renderToStaticMarkup(
      <MessageAttachmentFiles
        attachments={[
          { name: "one.md", path: "one.md", size: 10 },
          { name: "two.md", path: "two.md", size: 20 },
          { name: "three.md", path: "three.md", size: 30 },
          { name: "four.md", path: "four.md", size: 40 },
        ]}
      />,
    );

    expect(html).toContain("one.md");
    expect(html).toContain("two.md");
    expect(html).toContain("+2");
  });

  it("classifies uploaded files by preview capability", () => {
    expect(
      classifyAttachmentPreview({
        name: "wireframe.png",
        path: "attachments/wireframe.png",
        size: 100,
        mimeType: "image/png",
      }),
    ).toBe("image");
    expect(
      classifyAttachmentPreview({
        name: "notes.md",
        path: "attachments/notes.md",
        size: 100,
        mimeType: "text/markdown",
      }),
    ).toBe("text");
    expect(
      classifyAttachmentPreview({
        name: "contract.pdf",
        path: "attachments/contract.pdf",
        size: 100,
        mimeType: "application/pdf",
      }),
    ).toBe("pdf");
    expect(
      classifyAttachmentPreview({
        name: "archive.zip",
        path: "attachments/archive.zip",
        size: 100,
        mimeType: "application/zip",
      }),
    ).toBe("unsupported");
  });

  it("renders inline references without a surrounding attachment card", () => {
    const html = renderToStaticMarkup(
      <MessageInlineReferences
        skills={[
          {
            sourceType: "platform",
            skillId: "skill-1",
            revisionId: "rev-1",
            slug: "ppt",
            name: "PPT 办公",
            description: "desc",
            category: "office",
            revisionNumber: 3,
            resourceSummary: null,
          },
        ]}
      />,
    );

    expect(html).toContain("PPT 办公");
    expect(html).not.toContain("已附加");
  });

  it("shows readable skill names instead of opaque hash names", () => {
    const html = renderToStaticMarkup(
      <MessageInlineReferences
        skills={[
          {
            sourceType: "platform",
            skillId: "skill-1",
            revisionId: "rev-1",
            slug: "deploy-site",
            name: "96f7efbd-0a0c-4cb4-9a39-25af001c5a6a",
            description: "desc",
            category: "deployment",
            revisionNumber: 1,
            resourceSummary: null,
          },
        ]}
      />,
    );

    expect(html).toContain("deploy site");
    expect(html).not.toContain(">96f7efbd-0a0c-4cb4-9a39-25af001c5a6a<");
  });
});
