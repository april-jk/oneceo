import { describe, expect, it } from "vitest";

import { getSkillDisplayName } from "@/lib/skill-display-name";

describe("getSkillDisplayName", () => {
  it("hides opaque uuid names and falls back to a readable slug", () => {
    expect(
      getSkillDisplayName({
        name: "96f7efbd-0a0c-4cb4-9a39-25af001c5a6a",
        slug: "deploy-site",
        skillId: "skill-1",
      }),
    ).toBe("deploy site");
  });

  it("strips uuid suffixes from readable names", () => {
    expect(
      getSkillDisplayName({
        name: "帮我部署-96f7efbd-0a0c-4cb4-9a39-25af001c5a6a",
        slug: "deploy-site",
        skillId: "skill-1",
      }),
    ).toBe("帮我部署");
  });

  it("keeps normal skill names unchanged", () => {
    expect(
      getSkillDisplayName({
        name: "PPT 办公",
        slug: "ppt-office",
        skillId: "skill-1",
      }),
    ).toBe("PPT 办公");
  });
});
