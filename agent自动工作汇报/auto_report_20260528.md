# 2026-05-28 自动工作汇报

## PPT HTML Deck 导出一致性修复

- 排查会话 `5b71e725-b7c7-426a-83cd-9275914a34a5`：最终附件来自旧 `render_pptx_from_instructions`，而 `ppt-html-deck/export/export-report.json` 停在 `visual_qa failed`；同时 slide 文件是 fragment，CSS 只在 `ppt-html-deck/index.html`。
- 修复 HTML Deck renderer：导出前把每页 fragment 包装成带共享 CSS 的完整 HTML，写入 `ppt-html-deck/.oneceo-rendered-slides/` 后再截图，避免 PPTX 与 HTML 样式不一致。
- 收紧 PPT 工作流：一旦生成或尝试 HTML Deck，禁止回退旧 instruction renderer 交付最终 PPTX，防止 HTML 源与 PPT 成品分叉。
- 更新相关研发文档，并新增 CSS 注入、4:3 几何、HTML Deck fallback 护栏的回归测试。

## PPT 交付物展示与配色可读性优化

- 修复前端完成卡片路由：`ppt-html-deck/` 下除 `export/*.pptx` 外都按 PPT 中间产物隐藏；同一 run 有 PPTX 正式附件时优先展示下载卡片，不再把 slide HTML 列成“任务完成 N 个文件”。
- 收紧 `complete_task`：PPT 工作流中附带 HTML Deck 源文件、截图或 report 会被拒绝，防止中间文件进入最终交付。
- 调整配色策略：不再在 HTML Deck 导出后做文本对比度阻断，而是在补全信息后先生成 `colorApplicationPlan`，导出成功后直接交付；如用户反馈可读性问题，再按反馈重导。
- 为旧 instruction renderer 增加主题色可读性选择，避免模型给出低对比配色时直接生成看不清文字的 PPT。
- 已通过 API PPT/runtime 局部回归 82 项，Web 完成卡片相关回归 27 项。
