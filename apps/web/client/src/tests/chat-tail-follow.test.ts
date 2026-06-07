import { describe, expect, it } from "vitest";

import { followChatTail } from "../pages/Home";

describe("followChatTail", () => {
  it("moves only the chat container directly to its current tail", () => {
    const container = {
      scrollTop: 120,
      scrollHeight: 960,
    };

    expect(followChatTail(container, true)).toBe(true);
    expect(container.scrollTop).toBe(960);
  });

  it("preserves the user's position after they scroll away from the tail", () => {
    const container = {
      scrollTop: 120,
      scrollHeight: 960,
    };

    expect(followChatTail(container, false)).toBe(false);
    expect(container.scrollTop).toBe(120);
  });
});
