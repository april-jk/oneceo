import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import MessageAttachmentReference from "@/components/MessageAttachmentReference";

describe("MessageAttachmentReference", () => {
  it("renders skills and attachments in grouped reference sections", () => {
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

    expect(html).toContain("已附加");
    expect(html).toContain("Skills 与附件");
    expect(html).toContain("PPT 办公");
    expect(html).toContain("rev.3");
    expect(html).toContain("brief.pdf");
    expect(html).toContain("2.0 KB");
  });

  it("renders nothing when no references exist", () => {
    const html = renderToStaticMarkup(<MessageAttachmentReference />);
    expect(html).toBe("");
  });
});
