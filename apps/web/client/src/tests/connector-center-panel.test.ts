import { describe, expect, it } from "vitest";

import {
  normalizeEditableProfileId,
  shouldUseConnectorLevelOauth,
} from "@/components/ConnectorCenterPanel";

describe("connector center panel profile id normalization", () => {
  it("treats __new__ as create mode instead of a persisted profile id", () => {
    expect(normalizeEditableProfileId("__new__")).toBeNull();
  });

  it("keeps persisted profile ids unchanged", () => {
    expect(normalizeEditableProfileId("profile-123")).toBe("profile-123");
  });

  it("uses connector-level OAuth for Notion", () => {
    expect(shouldUseConnectorLevelOauth("notion")).toBe(true);
    expect(shouldUseConnectorLevelOauth("github")).toBe(false);
  });
});
