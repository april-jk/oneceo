import i18n from "@/i18n";

export type TaskSessionDeploymentPromptAction =
  | "deploy"
  | "redeploy"
  | "rollback"
  | "status";

export function buildTaskSessionDeploymentPrompt(
  action: TaskSessionDeploymentPromptAction,
): string {
  switch (action) {
    case "deploy":
      return i18n.t("deploymentPrompts.deploy");
    case "redeploy":
      return i18n.t("deploymentPrompts.redeploy");
    case "rollback":
      return i18n.t("deploymentPrompts.rollback");
    case "status":
      return i18n.t("deploymentPrompts.status");
    default:
      return i18n.t("deploymentPrompts.status");
  }
}
