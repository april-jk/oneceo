# AGENTS Git 协作开发指南

本文用于指导协作成员在 `oneceo/` 仓库内进行稳定、可追溯的 Git 协作开发。

## 基本约定

- 每次功能阶段完成或关键测试通过后必须提交代码。
- 不要在未确认归属的目录中跨系统修改（遵循 `oneceo/AGENTS.md` 目录边界）。
- 大范围改动请分阶段提交，避免一次性混入多个主题。

## 常用分支策略

- 默认使用当前团队约定分支（如 `task-creation-agent`）。
- 功能开发建议新建主题分支：`feature/<topic>`。
- 修复问题建议使用：`fix/<issue>`。

## 提交规范（建议）

- `feat:` 新功能
- `fix:` 修复问题
- `chore:` 非功能性调整
- `docs:` 文档更新

示例：
- `fix: sse persist and debug preview`
- `docs: update AGENTS guide`

## 审查与合并

- 合并前优先自测（本地 + 基本流程）。
- 如涉及 sandbox / opencode / sse 等链路，请附上验证步骤或日志位置。

## 与 AGENTS.md 的关系

- 详细项目结构、服务启动方式、E2B 规则等请参见 `AGENTS.md`。
- 新成员进场必读：`AGENTS.md` + `docs/AGENTS_GUIDE/*`。
