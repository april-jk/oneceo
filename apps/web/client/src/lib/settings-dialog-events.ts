import type { ConnectorKey } from "@/lib/connectors-client";

export type SettingsTab = "account" | "model" | "settings" | "connectors";

export type OpenSettingsDialogDetail = {
  tab?: SettingsTab;
  targetSessionId?: string | null;
  connectorKey?: ConnectorKey | null;
};

export const OPEN_SETTINGS_DIALOG_EVENT = "oneceo:open-settings-dialog";

export function openSettingsDialog(detail: OpenSettingsDialogDetail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenSettingsDialogDetail>(OPEN_SETTINGS_DIALOG_EVENT, {
      detail,
    })
  );
}
