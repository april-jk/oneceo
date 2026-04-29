# 2026-04-28 自动工作汇报

## Altus 调试触发进入测试流程

- 问题：`debug_open_page` 当前主要保证页面可达和 CDP tab 就绪，提示词要求后续 Playwright 验证，但没有把“测试文档、testing 阶段、功能测试、失败修复、修复后复测”固定为调试触发后的完整流程。
- 处理方向：将“启动网站调试功能”识别为 debug chain，要求 Altus 在首次 `debug_open_page` 前写 `docs/test-plan.md`，随后用 Playwright 连接同一个 n.eko Chromium 做核心功能测试；失败时记录问题、修复并复测。
- 验证计划：补充 prompt 与意图识别单测，确认调试触发会进入 todo/testing 工作流，并检查提示词包含测试文档与 repair/retest 约束。

## Altus 调试动作可读性修复

- 问题：调试时间线出现大量“这一步已经完成”“换个方式继续”等泛化文案，用户无法判断实际做了什么浏览器动作。
- 处理方向：新增 `browser_interact` 调试动作工具，连接同一个 n.eko Chromium CDP，并收敛为 Playwright 已支持的受控动作投影：locator/text/coordinate click、fill、keyboard type/press、mouse wheel、waitFor、waitForLoadState、waitForTimeout；前端按工具参数展示“点击某按钮 / 按下某按键”等具体动作。
- 验证计划：补充工具定义、运行时、提示词和前端渲染单测，确认调试工具链路不再只依赖泛化状态文案。

## Altus 部署失败状态误判修复

- 问题：部署状态查询拿到 Railway 面板后直接返回 `success`，导致 `FAILED / 404 Application not found / 公网访问验证失败` 被上下文包装为“已获取当前部署状态”，后续 `complete_task` 仍可能宣称部署完成。
- 处理方向：部署工具新增 `deployment_failed` 修复分类，终态失败、部署动作抛出的公网不可达失败、状态查询里的公网不可达失败都返回 `retryable_repair_required`；运行协调器拒绝 failed 类 deploymentStatus 作为完成证据；同步更新部署提示词、平台 skill 种子与设计文档。
- 验证计划：补充部署工具与运行协调器单测；当前已通过 `tsc --noEmit` 和 `git diff --check`，`tsx --test` 在本地沙箱因 IPC pipe 权限被拦截，提升权限重跑被自动审批拒绝。

## 部署 Skill 预挂载语义优化

- 问题：部署工具调用阶段已有 `deployment-orchestrator` 自动补挂载，但模型首轮决策前的意图预挂载只识别抽象 `deployment` trigger；如果治理配置只有 `deploy / redeploy / rollback / status`，首轮上下文可能拿不到部署 skill。
- 处理方向：内置部署 skill seed 同时保留抽象 trigger 与动作 trigger；预挂载逻辑识别动作型部署 trigger，并对 `deployment-orchestrator` 要求当前轮必须是明确部署执行请求，避免普通网页生成也挂载部署 skill。
- 验证计划：补充 `task-session-skill-state-service` 单测，覆盖部署请求预挂载、普通网页生成不挂载。

## OneCEO 通用内部部署模板与 Umami 继承

- 问题：部署稳定性不能只靠 agent 临场修复，也不能在宏观部署模块里只为 HTML 做特定优化；不同运行时需要统一的内部模板契约，并默认继承 Umami 监控。
- 处理方向：新增通用内部部署模板设计文档，补齐 PHP 站点的部署源码归一化、`oneceo.manifest.json`、`railway.json`，并将 PHP HTML 入口纳入 Umami 安全注入；纯 PHP 接口文件不强行追加脚本。
- 验证计划：补充模板归一化与 bootstrap 单测，继续跑 TypeScript 编译和 diff 检查；真实部署按成本控制，不作为本次普通回归默认项。

## 自由开发与部署适配分层约束方案

- 问题：如果开发之初强制套模板，会限制 Altus 的开发自由；如果部署前才临场注入，又会让稳定性过度依赖 LLM 判断。
- 处理方向：新增分层约束文档，明确“开发自由、项目画像持续收集、部署前模板适配、平台合规检查硬验证”的模型，并拆解 project profile、工具 schema、状态 reducer、Umami 安全注入和成本分级回归。
- 验证计划：本次为设计文档更新，先做文档索引和 diff 检查；后续代码阶段按 profile -> schema -> reducer -> 模板扩展顺序落地。

## 部署适配五阶段完成度与补齐方案

- 问题：需要明确 5 个阶段当前哪些已完成、哪些只是局部实现，避免误以为方案已经全量落地。
- 处理方向：补充 22 号文档的当前完成度表，标记阶段一/五未完成，阶段二/三/四部分完成，并为每个未完成阶段补齐数据结构、schema、reducer、runtime 模板和成本分级回归的落地方案。
- 验证计划：文档补齐后执行 diff 检查；后续代码实现按阶段拆分，不一次性混改。

## 部署适配五阶段代码落地

- 问题：22 号文档不能只停留在方案层，需要把五个阶段形成可运行代码和验收入口。
- 处理方向：新增 project profile 扫描服务、deployment flow reducer、context-debug projectProfile 输出、部署工具内部 schema/profile/reducer 绑定、Java Maven/Gradle 内部 manifest/railway config 基线，以及部署链路成本分级回归 SOP。
- 验证计划：补充 profile、reducer、template 单测，并运行相关部署工具测试、类型检查和 diff 检查。
