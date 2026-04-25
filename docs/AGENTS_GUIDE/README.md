# AGENTS_GUIDE 目录说明

> 本目录下的所有规范文档适用于 **所有 AI 协作工具**（Kimi / Codex / OpenCode / ClaudeCode 等），是 `oneceo` 项目的通用协作规范入口。

## 目录结构

| 文件 | 适用范围 | 说明 |
|---|---|---|
| `PROJECT_PROMPT.md` | 所有 AI 工具 | 项目级通用 Prompt：工作区定位、开发要求、协作约定、输出规范。 |
| `01_overview.md` | 所有 AI 工具 | 项目架构概览与当前主线能力。 |
| `02_services.md` | 所有 AI 工具 | 服务模块说明。 |
| `03_sandbox_e2b.md` | 所有 AI 工具 | E2B Sandbox 方案与规则。 |
| `04_agent_flow.md` | 所有 AI 工具 | Agent 流程与编排说明。 |
| `05_系统调试与测试指南.md` | 所有 AI 工具 | 调试与测试规范。 |
| `06_分支与部署环境简要规范.md` | 所有 AI 工具 | 分支职责、服务架构、部署拓扑与环境变量规则。 |
| `AGENTS_git操作与提交指南.md` | 所有 AI 工具 | Git 操作与提交规范。 |
| `AGENTS_git协作开发指南.md` | 所有 AI 工具 | Git 协作开发流程。 |
| `AGENT_CODE_MODIFICATION_GUIDE.md` | 所有 AI 工具 | 代码修改规范。 |
| `AGENT_USAGE_EXAMPLES.md` | 所有 AI 工具 | 使用示例。 |
| `agent-code-locations.md` | 所有 AI 工具 | 关键代码位置索引。 |
| `codex-specific.md` | Codex CLI 专属 | Codex CLI 工具专属内容：worktree 路径、`.codex` 配置等。 |

## 使用方式

1. 首次进入本项目时，先阅读根目录 `AGENTS.md`。
2. 再阅读 `PROJECT_PROMPT.md` 建立工作区认知。
3. 按需查阅 `01_overview.md` 及后续分段文档。
4. 如果你是通过 **Codex CLI** 进入本项目，额外阅读 `codex-specific.md`。
