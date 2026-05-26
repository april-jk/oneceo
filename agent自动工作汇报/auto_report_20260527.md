# 2026-05-27 自动工作汇报

## 管理端复查 PPT 资料覆盖不足

- 从管理后台打开会话 `6a65b010-9dbf-4d56-ab32-389b268c424c`，确认最新 run 完成 PPT 渲染，但 API traces 中仅有 `web_search`，没有 `web_extract`。
- 结论：PPT archetype 路由已生效，但资料覆盖门槛不足，导致高冲击数据可能来自搜索摘要或模型补全。
- 处理：在 PPT scoped contract 中补充非阻断式 `Source coverage guidance`，要求关键来源优先先搜索再解析，高冲击数字不得只依赖搜索摘要；资料不足时继续交付，并写入 openQuestions / 来源说明后降级表达。
