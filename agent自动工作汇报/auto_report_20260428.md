# 2026-04-28 自动工作汇报

## Altus 调试触发进入测试流程

- 问题：`debug_open_page` 当前主要保证页面可达和 CDP tab 就绪，提示词要求后续 Playwright 验证，但没有把“测试文档、testing 阶段、功能测试、失败修复、修复后复测”固定为调试触发后的完整流程。
- 处理方向：将“启动网站调试功能”识别为 debug chain，要求 Altus 在首次 `debug_open_page` 前写 `docs/test-plan.md`，随后用 Playwright 连接同一个 n.eko Chromium 做核心功能测试；失败时记录问题、修复并复测。
- 验证计划：补充 prompt 与意图识别单测，确认调试触发会进入 todo/testing 工作流，并检查提示词包含测试文档与 repair/retest 约束。
