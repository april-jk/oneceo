## 2026-04-19 交付预览卡片空白修复

- 做了什么：
  - 排查真实会话 `218508e0-2d3f-4ea9-b8da-227a2521bea8` 的部署状态、sandbox metadata 与前端预览链路，确认 Railway 已成功发布且 `latestStaticUrl` 已落入 `deploymentPanel`。
  - 修复 `apps/web/client/src/components/AltusArtifactPreviewCard.tsx`，让网页类交付物在已有部署公网地址时优先使用 Railway 地址做 `Preview / Open`。
  - 修复 `apps/web/client/src/components/OpencodePreviewPanel.tsx`，让右侧文件预览在选中 HTML 文件时，同样优先走部署公网地址，而不是只依赖 sandbox 原始文件预览。
  - 补充文档 `docs/agent研发文档/Altus接管模式参照Suna重构设计/12_Suna预览卡片与Altus产物预览对齐设计.md`，记录“部署成功后预览优先切线上地址”的约束。
  - 补充前端单测 `apps/web/client/src/tests/altus-artifact-preview-card.test.ts`。
- 遇到什么：
  - 真实 session 页面初始展示的是 `Show preview -> Load files` 状态，问题不是 Railway 站点不可访问，而是 HTML 预览原本只看 `workspace/raw/*`，导致部署成功后仍可能拿到不稳定的本地预览链路。
- 计划如何解决：
  - 后续若继续收口体验，可再把“已部署会话在未加载文件树前也能直接显示线上站点”做成显式入口，但这不影响当前预览空白问题的修复闭环。
