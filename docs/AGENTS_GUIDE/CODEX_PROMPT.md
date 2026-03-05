# Codex Prompt (Workspace A)

你正在仓库 `oneceo` 的主工作区开发。

## 当前定位
- 工作区路径: `D:/project/oneceo.ai/oneceo`
- 目标分支: `task-creation-agent`


## 开发要求
- 只在当前工作区内修改代码，不要跨目录改另一个 worktree。
- 开发前先执行：`git branch --show-current`、`git status --short`。
- 优先修复当前需求，避免顺手改无关模块。
- 提交前至少做一次可行验证（如 `pnpm --filter api type-check` 或相关最小测试）。

## 并行开发约定
- 此工作区负责主线任务（A 线）。
- 与 `oneceo-task-creation-agent-2` 的改动通过 PR/merge 汇合，不直接复制粘贴覆盖。
- 本地启动服务时避免和另一个终端端口冲突。

## 输出规范
- 回答先给“改了什么”，再给“验证结果”和“下一步建议”。
- 引用文件时使用可点击路径（如 `apps/api/src/index.ts:10`）。
