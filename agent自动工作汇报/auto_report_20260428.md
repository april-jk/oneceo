# 2026-04-28 自动工作汇报

## Altus 调试触发进入测试流程

- 问题：`debug_open_page` 当前主要保证页面可达和 CDP tab 就绪，提示词要求后续 Playwright 验证，但没有把“测试文档、testing 阶段、功能测试、失败修复、修复后复测”固定为调试触发后的完整流程。
- 处理方向：将“启动网站调试功能”识别为 debug chain，要求 Altus 在首次 `debug_open_page` 前写 `docs/test-plan.md`，随后用 Playwright 连接同一个 n.eko Chromium 做核心功能测试；失败时记录问题、修复并复测。
- 验证计划：补充 prompt 与意图识别单测，确认调试触发会进入 todo/testing 工作流，并检查提示词包含测试文档与 repair/retest 约束。

## Altus 调试动作可读性修复

- 问题：调试时间线出现大量“这一步已经完成”“换个方式继续”等泛化文案，用户无法判断实际做了什么浏览器动作。
- 处理方向：新增 `browser_interact` 调试动作工具，连接同一个 n.eko Chromium CDP，并收敛为 Playwright 已支持的受控动作投影：locator/text/coordinate click、fill、keyboard type/press、mouse wheel、waitFor、waitForLoadState、waitForTimeout；前端按工具参数展示“点击某按钮 / 按下某按键”等具体动作。
- 验证计划：补充工具定义、运行时、提示词和前端渲染单测，确认调试工具链路不再只依赖泛化状态文案。
