# 2026-05-27 自动工作汇报

## 管理端复查 PPT 资料覆盖不足

- 从管理后台打开会话 `6a65b010-9dbf-4d56-ab32-389b268c424c`，确认最新 run 完成 PPT 渲染，但 API traces 中仅有 `web_search`，没有 `web_extract`。
- 结论：PPT archetype 路由已生效，但资料覆盖门槛不足，导致高冲击数据可能来自搜索摘要或模型补全。
- 处理：在 PPT scoped contract 中补充非阻断式 `Source coverage guidance`，要求关键来源优先先搜索再解析，高冲击数字不得只依赖搜索摘要；资料不足时继续交付，并写入 openQuestions / 来源说明后降级表达。

## PPT HTML 中间形态方案设计

- 读取用户提供的 DeepWiki / Presenton 参考链路，确认其核心是先生成 HTML/Tailwind/React，再由 export service 转为 PPTX/PDF。
- 已新增设计文档 `docs/agent研发文档/20260527_PPT_HTML中间形态导出PPT方案_[尚未采用].md`。
- 方案原则：HTML deck 只作为 PPT 专用分支，不进入通用 Agent prompt，不触发网站部署/调试链路；第一阶段采用 HTML 截图型 PPTX，保留旧 renderer 作为回退。

## PPT 生成链路审计修复

- 审计结论：PPT workflow 存在完成态缺少 `.pptx` 仍可结束、page type 合同不一致、质量门只 warning、HTML Deck 4:3 比例错误、截图型 PPTX 可编辑性边界不清、图片下载缺少安全边界等问题。
- 处理动作：收紧 `complete_task` PPT 附件校验，统一 PPT page type 合同，给 HTML Deck 增加 4:3 几何、openQuestions 阻断和截图型导出声明。
- 处理动作：旧 renderer 增加阻断式质量门，并限制图片下载 host、content-type、大小和超时。
- 计划如何解决：跑 `ppt-render`、validator、managed runtime 相关单测，确认审计项都有回归保护。
