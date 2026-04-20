# 2026-04-20 自动工作汇报

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
