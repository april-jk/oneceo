import { describe, expect, it } from "vitest";
import { getSessionStatusVisual } from "@/components/Sidebar";

describe("sidebar session status visual", () => {
  it("marks waiting_user with warning text and waiting flag", () => {
    const visual = getSessionStatusVisual("waiting_user");
    expect(visual.label).toBe("待补充");
    expect(visual.waitingUser).toBe(true);
    expect(visual.labelClassName).toContain("function-warning");
  });

  it("restores in_progress visual to normal tone", () => {
    const visual = getSessionStatusVisual("in_progress");
    expect(visual.label).toBe("进行中");
    expect(visual.waitingUser).toBe(false);
    expect(visual.labelClassName).toBe("text-muted-foreground");
  });
});
