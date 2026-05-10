本轮围绕“强模板策略需要变成确定性交付主链”做了三类收口：

1. 部署工具现在把 `web_app/static_site` 的官方固定模板壳要求提升为主链硬门槛，不再放行自由结构网站进入稳定部署车道。
2. 本地部署预检改成优先复用平台 Playwright 契约：`bash -lc` 替代 `sh -lc`，补上 `NODE_PATH` 与 `PLAYWRIGHT_BROWSERS_PATH`，减少假失败。
3. 新增 `platform_capability` 分流：当 sandbox 缺少 Playwright 模块或浏览器二进制时，错误不再下沉给 Altus 继续误修 `package.json`、依赖或固定模板契约文件。

同步更新了部署基线/Manus 固定模板设计文档，明确“固定模板是硬边界，不是建议”，以及“平台能力异常与工作区代码异常必须分流”。

本轮不跑 E2E，交由用户亲自验收；我会用聚焦单测和 type-check 先把收口逻辑锁住。

补充修复了一条聊天部署确认链路问题：

1. 现象是用户先说“帮我部署当前项目”，随后回答“确认继续”，Altus 仍把当前轮识别成非部署意图，错误回复“当前会话部署权限尚未开放”。
2. 根因是平台意图分类默认禁止“模糊当前轮继承历史部署动作”，但风险确认回答也被一并拦掉了。
3. 本轮在 `altus-managed-setup-service` 补了一个窄规则：只有在存在待回答的部署风险确认问题时，像“确认”“确认继续”“继续”这类回答才会恢复上一条显式部署意图，并继续自动挂载 deployment skill。

又补了一轮固定模板本体收口：

1. 官方固定壳不再同时使用 `jsxInject` 和默认显式 `import React`，统一改为 React 自动 JSX runtime。
2. 部署源码归一化只在文件真实使用 `React.*` 命名空间时才补 `import * as React from 'react';`，普通 JSX 文件不再被盲注入 React 导入。
3. 固定壳 Vite 配置新增 `@shared -> root/shared` alias，前端若引用共享常量统一走 `@shared/...`，减少 `../shared/...` 这类相对路径误写。

继续修了一条生产部署确认循环追问问题：

1. 线上真实链路里，部署风险确认回答会先经过 clarification transition agent。
2. 之前那条“确认继续恢复部署意图”的修复放在 agent 后面，结果真实运行时可能先被 agent 重新解释成新的 `risk_confirmation`，同一句确认问题被重复抛出。
3. 本轮把“pending question 已是生产/预览部署风险确认，且当前回复是确认语句”这条判断前置到 transition agent 之前，并补了两条回归测试：
   - `pendingClarificationType` 缺失时仍可恢复部署意图
   - 即使 transition agent 在线，也不得再次接管这类确认回复

补充了 sandbox 模板层稳定性改造：

1. 基于现有 `opencode-playwright-mcp` 新建 `opencode-playwright-mcp-deploy-stable` 模板，作为部署稳定主模板。
2. 模板在构建阶段固定 Node `20.19.5` 与 `pnpm@9.12.3`，避免部署预检阶段出现 Vite/Node 兼容漂移与安装器漂移。
3. 模板继续预装 Playwright/Chromium 并保留 OSAC + n.eko patch 链路，不改变现有 debug/automation 契约。
4. `apps/api/src/config/e2b-config.ts` 默认模板名切到 `opencode-browseruse-playwright-mcp-v2-20260510`，后续新建 sandbox 默认走稳定模板。

继续补了两处部署稳定性收口：

1. `altus-managed-deployment-tool-service` 对 `public_settling + latestStatus=SUCCESS + 可用公网 URL` 改为直接按成功返回，不再继续标记为 `deployment_pending`，减少“已成功但反复重试”的链路抖动。
2. `e2b-connector.createSandbox` 增加模板不可用识别：若创建失败命中模板不存在语义，统一抛出 `e2b_template_unavailable:<template>`，便于平台快速定位“代码已切模板名但 E2B 制品未发布”的问题。
