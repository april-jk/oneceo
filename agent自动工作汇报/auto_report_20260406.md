# auto_report_20260406

- 做了什么：
  - 将 `new-task` 无 session 场景下的连接器选择改为“草稿化持久化”：前端写本地草稿并调用后端草稿 API。
  - 新增后端草稿服务与路由，支持草稿保存/应用/清理。
  - 发送消息创建 session 后，异步触发草稿 apply，不阻断 `创建 sandbox -> 启动 Altus 对话` 主链路。
  - attach 路由改为不强制先起 runtime，允许离线持久化为 `pending_recover`。
  - 文档方案状态已从 `[尚未采用]` 更新为 `[20260406-1831已采用]` 并同步索引。
  - 对回归问题做热修：将 session MCP 恢复从“主链路同步执行”改为“入队后后台异步执行”，并把 Altus run 启动阶段的恢复调用改成非阻塞，避免 `正在准备 sandbox` 长时间卡住。
  - 继续修复 session 页连接器体验：
    - `ConnectorDialog` 增加未展开静默预加载，输入框旁连接器图标可及时显示已选连接器。
    - 后端新增会话连接器投影 Redis 缓存（connector projection），并在 attach/detach/恢复/草稿 apply 后失效缓存。
    - 关闭默认 runtime 直连探测，避免连接器列表请求被 OSAC 超时拖慢。

- 遇到什么：
  - API 工程存在大量既有 TypeScript 报错，导致无法用全量 type-check 证明“零报错”。

- 计划如何解决：
  - 本次仅验证 web 侧 `tsc` 通过，API 侧确认新增改动未引入新增类型错误后交付联调。
  - 下一步通过真实流程回归：`new-task 配置连接器 -> 发送消息 -> /session 页面检查连接器状态与 pending_recover/reconcile 过程`。
  - 重点回归延迟与吞消息：验证首条消息在 run ack 后快速进入后续事件流，不再因连接器恢复阻塞；同时核对消息流与历史落盘一致性。
