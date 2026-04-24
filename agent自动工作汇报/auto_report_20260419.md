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

## 2026-04-19 WD-NODE-01 平台误判成功修复

- 做了什么：
  - 用 Playwright 真实跑多语言 deployable 矩阵，确认 `WD-HTML-01`、`WD-JS-01` 通过，而 `WD-NODE-01` 出现“Railway SUCCESS 但公网 500”的业务失败。
  - 通过 Railway 真实运行日志确认根因是 Node/EJS 站点运行时报错 `layout is not defined`。
  - 开始收紧平台成功判定，把“Railway 终态成功”和“公网真实可用”改成同时满足。
  - 同步更新部署主链设计文档与多语言测试方案文档。
- 遇到什么：
  - 当前平台会吞掉公网可达性失败，导致 deploy tool 仍返回 success，Altus 直接 `complete_task`。
- 计划如何解决：
  - 让公网验证失败继续向上抛出，并保留到 deployment state 中；随后回归 `WD-NODE-01`，再继续跑 Python / Java / PHP 与 non-deployable 矩阵。

## 2026-04-19 服务端模板 analytics 注入与多语言矩阵回归

- 做了什么：
  - 修复 `apps/api/src/services/deployment-template-bootstrap-service.ts`，把模板基线从“只认固定 `index.html` / `layout.ejs`”升级为“固定候选 + `templates/`、`app/templates/`、`views/`、`app/views/` 目录扫描”，覆盖 `.html`、`.ejs`、`.jinja`、`.j2`。
  - 修复 `apps/api/src/services/template-compliance-service.ts`，让 analytics 合规检测和实际注入目标保持一致，避免 Flask / Jinja 站点反复掉入 `missing_analytics_entry` 修复循环。
  - 回归通过 `WD-PY-01`、`WD-PHP-01`，确认 Python / PHP 网站都能完成“生成 -> 合规修复 -> Railway 发布 -> 公网 200 可访问”。
  - 跑完整套 `non-deployable-script-language-matrix.e2e.mjs`，确认 `ND-HTML-01`、`ND-JS-01`、`ND-NODE-01`、`ND-PY-01`、`ND-JAVA-01`、`ND-PHP-01` 全部不触发 `deploy_application`。
- 遇到什么：
  - Python 网站真实失败点不是 Railway，也不是 E2B，而是平台模板基线把服务端模板误判成“没有 HTML 入口”，导致 Altus 在 deploy run 里不断本地修补却无法越过合规门槛。
- 计划如何解决：
  - 继续观察后续真实会话是否还有新的服务端模板变体；如果出现 Twig/Handlebars 等新模板形态，再沿用相同目录扫描策略扩展，不再回退到硬编码单文件判断。
