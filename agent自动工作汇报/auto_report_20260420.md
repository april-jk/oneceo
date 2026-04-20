# 2026-04-20 自动工作汇报

## Altus 意图路由与执行模板分流修复

- 做了什么：
  - 定位到旧 task-creation 链路中的“营销计划制定”硬编码 fallback。
  - 新增共享任务形态分类器，前置判定网站类、脚本类、宽泛业务系统类、非部署约束。
  - 将 `IntentRecognitionAgent` 改为强规则优先，对 `客户管理系统 / 公司官网 / Python 脚本分析 CSV` 等请求直接走正确路由或先澄清。
  - 将 `PlanningAgent` 改为软件任务专用模板，不再把非软件 fallback 写成营销计划。
- 遇到什么：
  - 现有 Altus 路由分成旧三层 task-creation 与 managed run 两条链，smoke 失败主要来自旧三层链路的早期误路由。
- 计划如何解决：
  - 继续补执行层 focused 测试，覆盖 CRM 澄清、Python 脚本不误网页、源码-only 边界保留、HTML 官网直推四类 smoke 场景。

## Altus 执行层真实复测补充

- 做了什么：
  - 按官方 `altus-eval` 流程反复复跑 `ALTUS-TOOL-002`，并同时检查 DB 消息、workspace 文件树、sandbox 进程、真实脚本运行结果。
  - 修复 OpenCode managed completion 的空 assistant / step-only assistant 误判。
  - 收紧交付物判定，避免 `sample_data.csv` 这类输入样例被当成脚本交付物。
  - 对脚本类 prompt 增加“优先标准库、避免新增第三方依赖”的约束，针对 `pandas` 缺失导致的假失败。
  - 增加 stream idle + workspace artifact 兜底转验证逻辑，减少模型不发 final 时的无限等待。
- 遇到什么：
  - `qwen3-max-2026-01-23` 在真实脚本任务里表现不稳定：有时只写样例 CSV 就空转，有时能写出 `analyze_csv.py` 但不继续生成报告。
  - 临时切换 `gpt-5.3-codex` 做 localhost 冷启动复测时，出现 `[PROVISION:sandbox_verify] exit status 15`，说明 sandbox verify 链路和该模型组合仍有兼容问题。
- 计划如何解决：
  - 下一步直接检查 `sandbox-agent-provision-service` 与 `PROVISION:sandbox_verify` 失败源，确认是否是模型配置透传或 sandbox 校验脚本问题。
  - 在执行层继续把“模型没发 final 但已生成交付物”的验证/收口链路做成可稳定通过的闭环。

## Altus 部署误触发修复

- 做了什么：
  - 在 `altus-managed-prompt-service`、`altus-managed-tool-runtime`、`altus-run-coordinator` 三层收紧部署判定，只允许当前轮明确部署请求进入 deployment tools。
  - 真实复测时发现 `altus-managed-input-service` 仍会把 `不要部署 / 不要检查部署状态` 这类文档请求错误自动挂上 `deployment-orchestrator`，于是补齐否定表达识别并复用 `task-intent-shape-service` 做前置过滤。
  - 新增回归测试覆盖“否定部署表达不自动挂载部署技能”。
  - 用真实 Altus managed 请求复测文档场景，确认只触发 `ask_user` 澄清，不再出现部署工具或部署技能误注入。
- 遇到什么：
  - 误触发不仅来自 deployment tools 本身，输入阶段的 deployment skill 自动挂载也会给模型带来部署偏置。
  - E2B sandbox 需要在真实复测后显式清理，否则会留下计费风险。
- 计划如何解决：
  - 后续继续用同样方式复测源码-only、脚本、研究文档类任务，确保不存在其他“提到部署名词即挂部署技能”的漏网路径。
