# Codex CLI 专属说明

> 本文档仅适用于通过 **OpenAI Codex CLI** 进入本项目的场景。其他 AI 工具（Kimi / OpenCode / ClaudeCode 等）无需阅读。

## 工作区路径差异

Codex CLI 可能使用 worktree 机制，历史工作区路径示例：
- `/Users/watson/codingProj/oneceo`

**注意**：Codex 运行时不要在不同 worktree 之间跨目录修改代码。始终以当前激活的 worktree 为准。

## Codex 配置

Sandbox 内 Codex 运行时配置涉及：
- `~/.codex/config.toml`
- `~/.codex/auth.json`

相关设计文档：
- `docs/agent研发文档/Codex_e2b-template_sandbox配置文件直编与LLM设置设计.md`

## 其他 Codex CLI 专属行为

- Codex CLI 的 `.codex` 目录和配置管理
- Codex 执行模式切换（App Server / WS 模式）
