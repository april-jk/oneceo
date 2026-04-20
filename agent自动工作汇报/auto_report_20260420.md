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

## Railway 部署资源清理修复

- 排查 Railway 新工作区切换后“平台侧没有任何创建记录”的问题，定位到 `platform-deployment-account-service` 仍在复用旧的 per-user project 绑定。
- 核对数据库、运行事件和 Railway GraphQL 后确认：当前会话失败前没有进入新工作区创建阶段，而是被旧 project 绑定拦住。
- 已修改用户级 Railway project 复用逻辑，并补充针对 workspace 切换/legacy 迁移的单元测试，下一步继续跑测试验证。
- 补齐“部署失败后再次 redeploy 先回收旧 Railway service”的资源修复链路，避免失败 service 残留计费。
- 在 `task-session-deployment-runtime-service` 增加失败态判定，仅在失败后的 redeploy 命中 service 回收；同时补充平台资源层与 runtime 判定测试。
- 继续把失败 redeploy 链路打到真实 Railway：定位到 `serviceDelete` 后 `project.services` 仍可能残留同名 ghost service，导致 repair 误复用旧 serviceId，新 service 永远绑不到 environment。
- 已修正 Railway service 重建策略：只复用真实挂载到目标 environment 的 service；若同名旧 service 只是 ghost 记录，则创建带唯一后缀的新 service，并在发布前等待 `environment.serviceInstances` 完成绑定。
- 真实 smoke 已通过：旧 service `2ef814a8-29c1-4723-8e70-494100e3365f` 被替换为新 service `ca4904a0-a204-4600-9b41-51c303f0033f`，公开地址返回 200 且命中 marker，随后新 service 已删除、environment 已清空，避免继续计费。
- 按“每个用户一个 project、只保留最新一套部署资源”重新梳理清理逻辑：成功部署后自动清除同一 Railway project 下被新版本替代的旧 environment / app service / db service，并同步删除旧 connector account 绑定。
- 针对失败清理补齐 stop-loss：如果本次 deploy 或失败后的 repair-redeploy 新建了 environment/service 但最终仍失败，立即回收这批失败资源；普通 redeploy/rollback 若只是操作现存线上 service 失败，则不误删仍可用的线上资源。
- 已补充 `platform-deployment-account-service` 相关单元测试，验证“失败资源清理”和“同 project 历史资源剪枝”两条主链均能执行。
