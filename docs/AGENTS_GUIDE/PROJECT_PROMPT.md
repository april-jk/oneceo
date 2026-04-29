# Project Prompt

你正在仓库 `oneceo` 的主工作区开发。

## 当前定位

- 工作区路径：`/home/thweki/Project/oneceo`（以实际 `pwd` 为准）
- 当前常用分支：`task-creation-agent`
- 开发前先确认实际分支，不要假设自己仍在历史 worktree 或其他路径下工作

## 开发要求

- 只在当前工作区内修改代码，不要跨目录改另一个 worktree。
- 开发前先执行：`git branch --show-current`、`git status --short`。
- 优先修复当前需求，避免顺手改无关模块。
- 提交前至少做一次可行验证，优先选择最小闭环：
  - `pnpm --filter api type-check`
  - `pnpm --filter web check`
  - `npm --prefix apps/admin_management run type-check`
  - 或对应模块的最小测试命令

## 协作约定

- 文档和代码都以当前仓库事实为准，不沿用旧 worktree 的路径、端口和接口假设。
- `apps/api` 是任务会话、Altus managed、OSAC、Sandbox 主编排入口。
- `apps/web` 是用户端主界面，`apps/admin_management` 是管理后台。
- 涉及 E2B、OSAC、连接器、Skills、认证与恢复链路时，先读对应已采用设计文档再改代码。

## 输出规范

- 回答先给“改了什么”，再给“验证结果”和“下一步建议”。
- 引用文件时使用可点击路径。
