# 2026-04-18 自动工作汇报

- 做了什么：
  - 将部署面板状态改为后台同步模型：`deploymentState` 负责执行态，`deploymentPanel` 负责展示态，请求读取不再直接触发 Railway 实时同步。
  - 在 API 启动时增加部署后台同步任务，支持部署触发后的跟进刷新、异常重试，以及服务重启后的 backlog 恢复。
  - 扩展部署源码基线，补齐 `html/js/nodejs/python` 多形态发布支持，自动生成 `oneceo.manifest.json` 与 `railway.json`。
  - 完成真实会话端到端复跑，验证从 agent 生成代码到 Railway 发布、公网访问、Umami 绑定、sandbox/session 清理的全链路。
- 遇到什么：
  - 部署成功后旧的 `provisioningPhase` 会残留在持久化状态里，导致后台快照和最终 ready 态不完全一致。
  - 现有源码归一化逻辑对无 `package.json` 的脚本型项目覆盖不足，导致 Railway 对 start/build 命令的判定不稳定。
- 计划如何解决：
  - 已补状态清理逻辑，确保 ready 态不再保留旧的 provisioning/error 字段。
  - 下一步继续把这条真实 E2E 纳入持续回归，重点盯住后台同步队列在高并发和重启恢复场景下的收敛表现。

- 做了什么：
  - 将 deployment sync 从进程内 `Map` 升级为 DB 持久化 job，新增 `task_session_deployment_sync_jobs` 表与 DAO。
  - 后台 runner 已切换到数据库 runnable job 拉取、失败退避、follow-up 重新入队，不再依赖内存队列保存任务。
  - 新增 DAO 级测试，验证同一 `sync_key` 只保留一条活跃 job，以及 pending/running/failed 的 runnable 选择逻辑。
  - 再次完成真实部署主链复跑，并确认数据库中的 deployment sync job 最终收敛为 `completed`。
- 遇到什么：
  - 直接把整套 `runMigration()` 拉进 DAO 测试会让测试变慢且不稳定，不适合作为这组测试的建表方式。
  - shell 层 `psql` 与应用层数据库连接的查询表现不一致，容易误判表是否已创建。
- 计划如何解决：
  - DAO 测试已改成最小建表，不再依赖整套迁移。
  - 后续继续优先用应用自己的 DB 连接做状态核验，避免被 shell 环境差异误导。
