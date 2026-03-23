## 2026-03-23

- 做了什么：
  统一修改 sandbox 默认 LLM 配置，覆盖 Codex runtime 默认值、Codex App Server 兜底配置、OpenCode 直通与 Altus sandbox provision 默认环境，以及前端设置页默认展示值；同步更新相关 Codex 设计文档。
- 遇到什么：
  仓库内同一组默认值分散在 API、前端、`.env` 与设计文档多处，且 Codex 与 OpenCode 对 base URL 的格式要求不同，不能简单做全文替换。
- 计划如何解决：
  继续用类型校验验证 API 与前端改动；若后续联调发现 OpenCode 上游必须使用不同路径，再只在 OpenCode 环节收敛到兼容的 OpenAI-compatible endpoint，不改 Codex 的 provider 根地址约定。
