import type { ConnectorKey } from "@/lib/connectors-client";

export type SettingsTab =
  | "personalization"
  | "account"
  | "model"
  | "settings"
  | "skills"
  | "connectors"
  | "billing";

export type OpenSettingsDialogDetail = {
  tab?: SettingsTab;
  targetSessionId?: string | null;
  connectorKey?: ConnectorKey | null;
};

export const OPEN_SETTINGS_DIALOG_EVENT = "oneceo:open-settings-dialog";
export const TASK_CREATION_SKILLS_UPDATED_EVENT = "oneceo:task-creation-skills-updated";

export function openSettingsDialog(detail: OpenSettingsDialogDetail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenSettingsDialogDetail>(OPEN_SETTINGS_DIALOG_EVENT, {
      detail,
    })
  );
}

export function notifyTaskCreationSkillsUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TASK_CREATION_SKILLS_UPDATED_EVENT));
}
