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
      return "帮我部署当前项目";
    case "redeploy":
      return "帮我重新部署当前项目";
    case "rollback":
      return "请回滚到上一个可用部署版本";
    case "status":
      return "帮我查看当前部署状态";
    default:
      return "帮我查看当前部署状态";
  }
}
