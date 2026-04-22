type AltusSidebarAutoCollapseInput = {
  managedAltusMode: boolean;
  sidebarCollapsed: boolean;
  previewOpen: boolean;
  previewMaximized: boolean;
  previewPanelSize: number;
  previewPanelMaxSize: number;
  dragDeltaX: number;
};

const PREVIEW_PANEL_SIZE_TOLERANCE = 0.5;
const AUTO_COLLAPSE_DRAG_DELTA = -4;

export function shouldAutoCollapseSidebarForAltusActions(
  input: AltusSidebarAutoCollapseInput,
) {
  const {
    managedAltusMode,
    sidebarCollapsed,
    previewOpen,
    previewMaximized,
    previewPanelSize,
    previewPanelMaxSize,
    dragDeltaX,
  } = input;

  if (!managedAltusMode || sidebarCollapsed || !previewOpen || previewMaximized) {
    return false;
  }

  if (dragDeltaX >= AUTO_COLLAPSE_DRAG_DELTA) {
    return false;
  }

  return (
    previewPanelSize >= previewPanelMaxSize - PREVIEW_PANEL_SIZE_TOLERANCE
  );
}
