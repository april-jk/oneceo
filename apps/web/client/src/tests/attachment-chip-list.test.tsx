import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AttachmentChipList from "@/components/AttachmentChipList";

describe("AttachmentChipList", () => {
  it("renders pending files as compact previews before the composer text area", () => {
    const file = new File(["hello"], "brief.txt", { type: "text/plain" });
    const html = renderToStaticMarkup(
      <AttachmentChipList
        attachments={[
          {
            kind: "file",
            id: "file:brief.txt:5:1",
            name: "brief.txt",
            size: 5,
            type: "text/plain",
            file,
          },
        ]}
        uploadingIds={["file:brief.txt:5:1"]}
      />,
    );

    expect(html).toContain("brief.txt");
    expect(html).toContain("animate-spin");
    expect(html).not.toContain("rounded-full");
  });
});
