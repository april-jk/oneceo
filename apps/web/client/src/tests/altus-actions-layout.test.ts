import { describe, expect, it } from "vitest";
import { shouldAutoCollapseSidebarForAltusActions } from "@/lib/altus-actions-layout";

describe("altus actions sidebar auto collapse", () => {
  it("collapses the sidebar when the preview hits max width and drag keeps moving left", () => {
    expect(
      shouldAutoCollapseSidebarForAltusActions({
        managedAltusMode: true,
        sidebarCollapsed: false,
        previewOpen: true,
        previewMaximized: false,
        previewPanelSize: 48,
        previewPanelMaxSize: 48,
        dragDeltaX: -12,
      }),
    ).toBe(true);
  });

  it("does not collapse before the preview reaches the max width threshold", () => {
    expect(
      shouldAutoCollapseSidebarForAltusActions({
        managedAltusMode: true,
        sidebarCollapsed: false,
        previewOpen: true,
        previewMaximized: false,
        previewPanelSize: 44,
        previewPanelMaxSize: 48,
        dragDeltaX: -12,
      }),
    ).toBe(false);
  });

  it("does not collapse for non-managed layouts or rightward drags", () => {
    expect(
      shouldAutoCollapseSidebarForAltusActions({
        managedAltusMode: false,
        sidebarCollapsed: false,
        previewOpen: true,
        previewMaximized: false,
        previewPanelSize: 48,
        previewPanelMaxSize: 48,
        dragDeltaX: -12,
      }),
    ).toBe(false);

    expect(
      shouldAutoCollapseSidebarForAltusActions({
        managedAltusMode: true,
        sidebarCollapsed: false,
        previewOpen: true,
        previewMaximized: false,
        previewPanelSize: 48,
        previewPanelMaxSize: 48,
        dragDeltaX: 8,
      }),
    ).toBe(false);
  });
});
