# 2026-04-21 自动工作汇报

- 按最新范围收窄为“只做 Altus 直通链路”的 skills 会话保持修复，不再继续扩散 managed 链路改动。
- 在 `opencode-remote-service` 接入会话级 `sessionSkillState` 解析：用户新一轮输入时优先从 DB/Redis 恢复 resident skills，再结合当前 intent 决定 contextual skills 是否继续挂载。
- 修正直通链路对 `metadata.skills` 的一次性依赖：当前轮没有重复传 skill metadata 时，仍会把会话中已保存的 resident skills 同步回 sandbox，不再因为前端缺参导致 skill 丢失。
- 对 `source=agent` 场景增加保护：内部澄清/续跑不重新洗 resident selections，避免代理中途把已驻留 skills 清空。
- 新增直通链路回归测试 `apps/api/tests/opencode-remote-skill-state.test.ts`，覆盖“上下文变化后 contextual resident skill 退出”和“`metadata.skills` 缺失时仍同步 resident skills”两条主链。
- 已完成定向验证：`pnpm exec tsx --test tests/opencode-remote-stream-delta.test.ts tests/opencode-remote-skill-state.test.ts` 与 `pnpm type-check` 均通过。
- 已尝试执行真实直通 e2e 套件 `pnpm run test:opencode-direct`，但在 `01_session_bootstrap` 场景超时；报告显示 WebSocket 首条欢迎消息后立即返回“当前未登录或会话已过期”，当前阻塞点在测试鉴权上下文，不在本次 skills 续挂逻辑。
- 已补齐 `opencode-sandbox-direct` 测试 harness 的自动登录能力，复用 `apps/web/e2e/playwright-test-account.json` 为 WS / SSE / HTTP 查询统一注入 `app_session_id`，关闭了真实直通 e2e 的鉴权阻塞。
- 已执行 `pnpm db:init` 对齐本地开发库 schema，消除 `task_creation_sessions.metadata_json` 缺失导致的 `PROVISION:opencode_connector_config` 查询失败。
- 已完成本轮详细回归电池：`task-session-skill-state-service`、`task-session-redis-cache-service`、`opencode-remote-*`、`sandbox-skill-sync-service`、`sandbox-archive.service` 共 13 个定向测试全部通过，`pnpm type-check` 通过。
- 已定位并修复 `04_persistence_refresh_consistency`：`/api/task-creation/sessions/:sessionId/messages` 在 native history 存在时只补 metadata、不补缺失 user input，导致刷新后 continuation 类消息丢失；现已改为允许从持久化 timeline 补回缺失的 `user_input / user_response / opencode_user_input`。
- 已新增路由回归测试 `apps/api/tests/task-creation-deep-routes.test.ts`，固定覆盖“native history 缺一轮 user input，但 file-memory 仍有持久化消息”的场景。
- 真实直通 e2e 最新复跑结果：`pnpm run test:opencode-direct` 已 `5/5` 全通过，`04_persistence_refresh_consistency` 已翻绿。
- 本轮 direct e2e 产生的 orchestrator sandbox `isuws2py6fevk9u3pkhpc` 已主动关闭，避免继续计费。
- 已重新对照 `task-session-skill-state-service` 的 skills 记忆设计，收缩 Altus 三级记忆文档中的 session 级方案：保留“DB 真相源 + Redis 可选缓存 + sandbox 文件副本 + 受控 flush”这一复杂度，不再为 Altus 额外引入 `baseVersion / compare-and-set` 一类更重的回写协议，避免首版出现不可控状态机和隐藏竞态。
- 已按最新要求调整 Altus 三级记忆文档：用户级 / 项目级记忆改为“DB 真相源 + Redis 读加速”，同时明确 Redis 只做缓存、写入必须先写 DB 再刷新或失效 Redis，避免把用户级 / 项目级做成第二真相源。
- 已进一步收紧 Altus session 级记忆文档：明确 run 启动阶段只装载一次 session memory，运行中以内存快照和 sandbox 文件为主，避免多轮执行期间反复读写数据库；DB 回写流程直接对齐 skills memory 的固定模式：读 sandbox 文件、normalize、写 DB、刷新 Redis。
- 已开始按采用文档进入 Altus 三级记忆代码实现：用户级记忆扩展到用户设置个性化表单，项目级记忆扩展到项目创建/编辑表单与 `app_user_projects.metadata_json.altusProjectMemory`，session 级记忆新增 `task-session-altus-memory-service` 并接入 DB + Redis + sandbox 文件副本。
- 已将 Altus 运行链路接上三级记忆：managed run 启动时组装“用户级 + 项目级 + session 级” prompt context，coordinator 在 sandbox 物化 session 记忆文件，并在 `completed / failed / waiting_user / archive / restore` 等受控时机回写 DB 与 Redis。
- 已同步补齐边界约束：`POST /sessions` 支持创建时带 `projectId`，项目删除在仍有关联 session 时返回 409，项目改名后同步 session `projectName` 缓存，已进入有效运行阶段的 session 禁止再变更项目归属。
- 已补充针对性回归测试：`altus-managed-run-entry.service.test.ts` 覆盖 run 输入带入 memory context，`altus-run-coordinator.test.ts` 覆盖 memory prompt 注入与 session 记忆 flush，`sandbox-archive.service.test.ts` 覆盖 archive/restore 时 Altus 记忆回写。
## 17:41 Altus三级记忆 Playwright 全链路测试准备

- 新增 Altus 三级记忆 Playwright 测试方案文档，覆盖用户级、项目级、session 级主链路。
- 准备单次登录复用 cookie 的 Playwright 回归，用项目内箭头入口直接起会话。
- 计划同时核验 UI、接口返回、内部 memory context 和 session memory 快照，避免只看表面交互。

## 18:20 Altus三级记忆 Playwright 全链路修复与复测

- 通过 Playwright 真实跑通后，定位到两个实际问题：
  1. managed 模式从项目箭头进入新会话时，draft session 未继承 `projectId`
  2. session memory 在有 sandbox 但缺少 memory 文件时不会 fallback 回写，导致 `version=0`
- 已分别修复：
  - `useTaskCreationAgent` 在 managed draft session 创建后补做项目归属绑定
  - `task-session-altus-memory-service` 在文件缺失时改为从 timeline 派生 session memory 并落库
- 新增和更新了对应 Playwright 回归与服务层单测，最终复测通过。

## 20:10 Altus managed 纯记忆问答误失败修复

- 定位到 managed 协调器把“我是谁 / 你是谁 / 记得我吗”这类纯记忆问答也强行套进 `complete_task` 合约，模型直接回答纯文本后会被标记为 `managed_model_plain_text_without_tool_call`。
- 已在 `altus-run-coordinator` 增加窄范围放行：只对纯身份/记忆问答接受纯文本直答，普通工程任务仍继续要求工具链和 `complete_task`。
- 同步更新 managed prompt，消除“系统允许纯记忆直答”与“prompt 强制所有回复都必须 complete_task”之间的冲突。
- 已补充 coordinator / prompt 回归测试，准备执行定向验证。

## 20:42 侧边栏项目展平与点击不重排修复

- 已将普通项目在侧边栏中直接作为一级条目显示，不再额外包一层普通项目文件夹；自组织项目分组保持不变。
- 已修正 session 列表“点击即重排”的两个根因：去掉当前选中 session 自动置顶，同时停止在重命名、移动项目等元数据 patch 时默认把 `updatedAt` 刷成当前时间。
- 已收紧 `task-creation-session-updated` 的监听逻辑：只有标题、状态、收藏、项目归属或显式 `updatedAt` 变化才触发本地 patch 与刷新，单纯选中态不再触发列表重载。
- 已补充针对性的前端单测，验证 sidebar patch 会保留原 `updatedAt`，并完成 `pnpm --filter web check` 与定向 `vitest` 校验。
- 已新增 Playwright 浏览器回归 `sidebar-order-stability.playwright.spec.ts`，使用单次登录复用态验证“点击项目不重排、点击会话不重排”，并在 `http://127.0.0.1:3001` 当前实例上实跑通过。

## 20:54 侧边栏会话可见性与排版优化

- 已将侧边栏信息顺序调整为“普通项目 -> 最近会话 -> 全部任务 -> 自组织项目”，避免自组织项目长期挤占主要视区。
- 最近会话改为显式分组，默认可见数量从 3 提升到 6，并保留“查看更多”入口。
- 自组织项目分组改为默认收起，释放更多垂直空间给当前活跃会话列表。
- 已在当前代码实例上完成 `pnpm --filter web check` 和定向 Playwright 回归，确认这轮排版优化没有破坏“点击不重排”的稳定性。

## 21:15 直通冷启动耗时排查埋点

- 已按最新问题收敛到“发送消息 -> runtime/start -> provision -> OSAC ready -> 首条恢复前阻塞”这条链路，只加耗时埋点，不改现有启动流程。
- 在 `sandbox-agent-provision-service` 新增 provision 总耗时与 step 级耗时日志，覆盖 `open_environment / workspace_restore / commands_ready / workspace_prepare / sandbox_host / opencode_start / osac_bridge / osac_ready / sandbox_verify / playwright_mcp / neko_debug`。
- 在 `task-creation-routes.ensureTaskSessionRuntime` 新增 `runtime/start` 总耗时日志，便于把用户入口耗时与 provision 内部阶段对齐。
- 已同步在采用中的 Sandbox 恢复设计文档追加本轮埋点记录，后续复现将以 `apps/api/data/connector-debug.log` 为主证据源继续定责。

## 22:35 deployment skill 强制挂载问题文档化

- 已结合真实 managed 会话、数据库记录与日志，确认 `deployment-orchestrator` 当前是因 `required=true` 被全局强制挂载，而不是仅在部署意图下自动激活。
- 已新增候选修复文档 `19_部署编排Skill自动强制挂载修复方案_[尚未采用].md`，明确本次只修“自动强制挂载”语义错误，不扩散到 OSAC、restore 或其他启动链路问题。
- 已同步更新部署基线专题 README，补充该候选方案索引，便于后续评审与采用状态切换。

## 23:08 冷启动三项主因开始收敛修复

- 已将 `deployment-orchestrator` 的 seed 治理语义从全局 `required` 改为非 required，仅保留 deployment 系统角色和 autoActivation；同时补上 session skill state 清理逻辑，历史会话中已持久化的 `activationSource=required` 旧绑定会在下一次 `prepareRunState` 时自动剔除。
- 已优化 `restoreWorkspaceIfArchived` 的空检查路径：有环境 metadata 时不再额外调用 `getSandboxInfo`，R2 `metadata/archive` 候选改为并行探测，减少“没有归档也阻塞数秒”的固定成本。
- 已把 OSAC 预置接入 `opencode-playwright-mcp` E2B 模板构建链路，模板构建时直接拉取当前已发布 OSAC 并写入 `/opt/.altus/opencode/osac`，同时把默认模板版本切到 `opencode-playwright-mcp-v6-osac-prebuilt-20260421`。

## 22:39 OSAC 预置模板命中链路修正

- 已确认 API 实际加载的是 `apps/.env`，旧配置仍把 `E2B_TEMPLATE` 指向 `v4` 模板、把 `OPENCODE_TASK_WORKSPACE_ROOT` 指向 `/home/user/opencode/workspaces`，导致真实 managed 冷启动没有命中新模板与新目录布局。
- 已修正 `apps/.env` / `apps/.env.example` 到 `/opt/.altus/opencode/workspaces`，并把默认模板切到 `opencode-playwright-mcp-v7-osac-prebuilt-20260421`。
- 已修正 `sandbox-osac-bridge-service` 的 remote base dir 选择逻辑：`altus/opencode` 不再被 `workspaceRoot` 反推覆盖，统一使用 `OSAC_REMOTE_BASE_DIR`，避免绕开模板预置的 `/opt/.altus/opencode/osac`。
- 进一步定位出 `v6` 模板 ownership 错误：模板内 `/opt/.altus/opencode` 被构建成 `node:node 755`，而运行时用户是 `user(uid=1001)`，导致 `workspace_prepare` 权限失败。
- 已更新模板构建脚本改为 `chown -R user:user`，并重新构建 `v7` 模板。
- 已完成真实 managed 冷启动复测：`workspace_prepare` 恢复成功，`remoteBaseDir=/opt/.altus/opencode`，`remoteBinary=/opt/.altus/opencode/osac`，`reusedExistingBinary=true`，说明 OSAC 已命中模板预置。
