# 2026-03-27 自动工作汇报
# 2026-03-27 自动工作汇报

## 新增处理结果：managed 附件输入链路与消息保留修复

- 完成 managed 模式附件统一输入链路，并修复 `run_ack` 复用用户 `messageKey` 的协议冲突。
- 继续排查后确认前端还存在 `bindSessionId` 误触发重置和 `loadHistory` 覆盖本地 pending 消息的问题；现已补上 session sync guard、本地 pending 消息保留与 history 合并逻辑，并新增前端单测。
- 已进入会话后的附件按钮在澄清态也可继续使用，多轮对话和回答问题时均可继续添加附件。
- 又调整了附件草稿清理时机，发送后输入区会立即清空附件，失败时再恢复。
- 该问题不是单点故障，而是“事件 key 冲突”和“history/session 清屏”两层根因叠加；只修其中一层时，界面仍会表现为消息消失、只剩 processing 占位。
- 下一步如果需要继续收口，就做一轮浏览器实机复测，重点确认首条消息、第二条消息、附件消息和刷新前后一致性。

## 新增处理结果：Altus managed 轮次耗尽导致已生成文件仍失败

- 继续排查用户反馈的 `managed_run_tool_round_limit_exceeded` 后，确认本次失败并不是 `PPT` 没生成，而是 run 在调用 `complete_task` 之前打满了默认工具轮次预算。
- 数据库事件回放显示，这次 run 已经成功读取 skill 附件、安装 `python-pptx`、写入脚本、生成 `职业规划.pptx`，并完成文件存在性校验，但总共消耗了 `12` 次工具调用，正好命中当前默认上限。
- 已新增问题与修复文档 `docs/agent研发文档/20260327_AltusManaged轮次耗尽导致已生成交付物仍失败_问题与修复方案.md`，把问题、影响、修复原则和验证要求落文档。
- 已将 `apps/api/src/services/altus-run-coordinator.ts` 的默认轮次预算从 `12` 调整为 `16`，给办公型任务的“生成 -> 校验 -> complete_task”留出合理收尾空间。
- 已同步强化 `apps/api/src/services/altus-managed-prompt-service.ts`，明确要求下载型交付物在文件已生成并完成一次验证后立刻 `complete_task`，禁止继续做可选检查或替代实现消耗轮次。
- 已完成真实 PPT 回归验证：`session=dca169c2-e4b6-4655-ab0f-f466cd2b6487`、`run=ebb167fb-7a0d-4697-959f-15e3b695e874` 最终进入 `completed`，成功产出并下载 `career-plan-roundfix.pptx`。
- 日志窗口内该成功 run 共触发 `16` 次模型调用，直接说明旧默认值 `12` 对办公型任务确实偏低；这次修复并非“侥幸跑通”，而是预算设置已匹配真实链路。
- 回归结束后已按仓库要求手动关闭测试 sandbox `ia1x8j56b2bjxyamxq80f`，并删除测试 session，确认 session 详情返回 `404`，避免额外计费。
- 新的复发 run `aeb9fd96-d4d3-4c80-a735-c615a100e7f1` 证明默认 `16` 轮仍不够：该 run 在反复修 `python-pptx` 的错误导入时耗尽预算，说明办公型任务的实际最坏路径比第一轮估计更长。
- 本轮已继续将 `apps/api/src/services/altus-run-coordinator.ts` 的默认预算提高到 `24`，并在 `apps/api/src/services/altus-managed-prompt-service.ts` 增加 office 文件生成的最小化约束，减少无效试错和过度设计。
- 第二轮修复后的同场景探针中，简短提示 `帮我生成一份ppt，主题是职业规划` 已不再直接复现 `managed_run_tool_round_limit_exceeded`；新的探针 run `9f69447f-ed93-4c6d-a8be-0187be9e323d` 在 40 秒窗口内进入 `waiting_user`，说明轮次耗尽问题已被压下，但仍存在“过度澄清”的残余体验问题。
- 该探针使用的测试 sandbox `ij5p1bd9iqd67k0c0vzhb` 已手动关闭，测试 session 也已删除。

## 今天做了什么

- 复测了任务创建链路中“给智能体发消息”的主流程，确认前端/WS 建连本身可用，消息能进入规划阶段。
- 通过 `ws-task-creation-smoke` 与 `sessions/:id/messages/recent` 复盘运行轨迹，定位失败点发生在开发阶段刚启动执行环境时。
- 继续沿着 `sandbox-agent-provision-service -> sandbox-environment-service -> e2b-connector` 向下排查，确认阻塞点是 `open_environment` 调用里的 E2B 创建请求。
- 对同一套 `e2b-connector` 做了最小化探针：代理开启时 `createSandbox` 连续 `fetch failed`；关闭代理后可成功创建并立即销毁 sandbox。

## 遇到什么问题

- 当前 `apps/.env` 同时开启了 `E2B_PROXY_ENABLED=true` 和 `ONECEO_PROXY_ENABLED=true`，并把 `HTTP_PROXY/HTTPS_PROXY` 指到 `127.0.0.1:7890`。
- 本机当前没有可用的 `7890` 代理监听，导致 E2B SDK 通过代理发起的外部请求直接失败，进而让任务创建在执行环境调度阶段报错。

## 计划如何解决

- 优先把本地开发环境的 E2B 请求改为直连，或先确保 `127.0.0.1:7890` 代理进程真实可用，再重新验证完整任务创建链路。
- 如需长期保留代理能力，后续应把“本地开发直连”和“需要代理的受限网络环境”拆成明确的环境配置，避免默认配置把 E2B 主流程一并拦死。

## 后续处理结果

- 已将 `apps/.env` 中的 `HTTP_PROXY/HTTPS_PROXY` 从 `127.0.0.1:7890` 改为当前本机实际可用的 `127.0.0.1:7897`，并重启 API。
- 复测后，E2B 最小化创建探针可以在代理开启场景下成功创建并立即销毁 sandbox，说明原始的 `open_environment -> fetch failed` 阻塞已解除。
- 又跑了一次任务创建 smoke 测试，新的会话不再报执行环境创建失败，并且确实创建出了对应 sandbox；为避免额外计费，已手动调用关闭接口将测试 sandbox 关闭。
- 当前仍存在一个更后面的残余现象：该 smoke 会话在 90 秒窗口内停留在 planning 阶段超时，这属于原始代理配置问题之后的下一层问题，需要后续继续排查。

## 新增处理结果：前端 failed to fetch

- 继续排查浏览器里的 `failed to fetch` 后确认，问题不在 API 端口本身，而在前端运行时仍固定请求 `http://oneceo.ai:4000`。
- 当前机器的 `hosts` 中没有 `oneceo.ai -> 127.0.0.1` 映射，系统解析把 `oneceo.ai` 指到了非本机地址，因此浏览器请求没有打到本地 API。
- 原计划是直接补 `hosts` 映射，但当前用户权限无法写入系统 `hosts` 文件，因此改为仓库内本地开发配置切回 `localhost`：
  - `FRONTEND_URL=http://localhost:3000`
  - `VITE_API_BASE_URL=http://localhost:4000`
  - `VITE_ANALYTICS_ENDPOINT=http://localhost:3000`
- 已重启 `apps/web` 和 `apps/api`，并确认 `http://localhost:3000` 返回 200、`http://localhost:4000/health` 返回 ok。

## 新增处理结果：PPT 技能附件上传 400

- 继续复盘 `PPT 办公` skill 导致的 `request failed: 400`，确认前端 skill 模板本身没有语法问题，报错发生在附件上传时的 `ensureTaskSessionRuntime(sessionId)`。
- 后端日志明确报出 `上传附件失败: Error: [PROVISION:sandbox_verify] exit status 15`，说明失败点在 Sandbox 预检，而不是 skill 内容。
- 根因定位为 Sandbox 直连链路错误复用了主平台的 `LLM_PROXY_UPSTREAM_API_TYPE=anthropic`，导致预检误打 `/v1/messages`，与当前 Sandbox/OpenCode 的 OpenAI-compatible 直连口径不一致。
- 已在 `sandbox-agent-provision-service.ts` 中增加 `SANDBOX_OPENAI_*` 独立覆盖，并在 `apps/.env` 中补齐 Sandbox 专用直连配置，使 Sandbox 预检与 OpenCode 使用同一套 OpenAI-compatible 参数。
- 同步新增问题与修复方案文档 `docs/agent研发文档/20260327_PPT技能附件上传400_问题与低风险修复方案.md`，并补充最佳实践文档中的“配置隔离要求”。
- 已完成最小链路复测：`draft session -> attachments(skill-office-ppt.md)` 上传成功，不再返回 `400`；测试产生的 sandbox 已手动关闭，测试会话也已删除。

## 新增处理结果：Skill 附件跨 Sandbox 丢失

- 针对用户反馈的 `read_file .attachments/...-skill-office-ppt.md does not exist` 继续下钻，确认不是 skill 模板没传，而是“附件上传时的 sandbox”和“Altus managed run 真正执行时的 sandbox”被拆成了两个。
- 通过数据库与运行事件复盘确认：附件上传路径只更新了 file-memory 的 `runtime.orchestratorSessionId`，但没有同步 `task_session_sandbox_bindings`；Altus managed run 启动时只认 binding，于是又新建了第二个 sandbox。
- 已在 `task-creation-routes.ts` 的 `ensureTaskSessionRuntime()` 中补上 binding 同步，并在 `altus-managed-setup-service.ts` 中增加优先复用 runtime sandbox 的逻辑，把两条链路收口到同一个 sandbox。
- 已完成针对性复测：`draft session -> 上传 skill-office-ppt.md -> 启动 Altus run` 后，数据库里只出现一个 sandbox，`read_file` 成功读到附件，复测产生的 sandbox 已关闭、会话已删除。
- 已新增专项报告 `docs/agent研发文档/20260327_技能附件跨Sandbox丢失_问题与修复方案.md`，并更新 `技能附件_PPT办公技能模板设计.md` 的运行约束与验证口径。

## 新增处理结果：交付物出 Sandbox 闭环设计

- 继续围绕“PPT 生成了但用户拿不到”做主链路梳理，确认当前断点不在单一组件，而在 `complete_task` 协议、二进制产物识别、交付物持久化与前端最终呈现四个环节同时缺失闭环。
- 已对齐现有 Altus 产物预览设计文档与 R2 持久化文档，形成统一方案：最终文件必须在 run 完成前从 sandbox 读出、上传到 R2、写入正式交付物记录，再向前端暴露下载入口。
- 已新增设计文档 `docs/agent研发文档/20260327_交付物出Sandbox闭环设计.md`，明确“任务完成”的新定义是“文件可下载”，并给出唯一实施路径，不做兼容补丁或降级方案。
- 已同步在 `技能附件_PPT办公技能模板设计.md` 中补充办公 skill 的完成约束：仅在 sandbox 内生成文件但用户无法下载，不视为完成。
## 新增处理结果：交付物出 Sandbox 闭环已实现

- 已按设计文档完成交付物正式闭环实现：`complete_task.attachments -> 服务端持久化 -> deliverables 路由 -> 前端下载卡片`。
- 后端新增 `task_session_deliverable_artifacts` 表、deliverable DAO、R2 持久化服务，并在 `run_completed` 的 timeline metadata 中持久化 `deliverables`，保证刷新后仍可恢复下载卡片。
- 前端新增 `TaskDeliverableCard`，`Home.tsx` 在 managed `run_completed` 事件中优先渲染正式交付物，而不再只依赖 web preview artifact。
- 已完成最小真链路验证：Altus 生成 `deliverable-test.txt` 后，deliverables 接口返回 1 个文件，下载接口返回内容 `deliverable pipeline ok`。
- 已补做 recent messages 验证：`status_update` 的 `metadata.eventType = run_completed` 且带有 `deliverables`，说明历史重载后也能恢复下载卡片。
- 本次测试新建的 sandbox 已全部手动 `kill`，测试 session 也已删除，避免额外计费与脏数据残留。

## 新增处理结果：PPT 联网配图与版式增强设计

- 继续复盘用户“PPT 做出来了但没有图片、没有排版”的反馈后，确认这不是单纯 skill brief 文案不足，而是当前 Altus managed 工具集根本没有联网搜索、资料抽取和图片获取能力。
- 已核对现有 `altus-managed-shared.ts`，确认当前 managed tool 仅包含 `shell_execute/read_file/write_file/list_directory/search_code/ask_user/complete_task`，没有 `web_search`、`web_extract` 或浏览器类工具。
- 已同步核对 `PPT 办公` 模板与最近的 prompt 约束，确认当前系统为了稳定交付，明确偏向“简单且正确的办公文件”，这会进一步放大“纯文本 PPT”倾向。
- 已新增设计文档 `docs/agent研发文档/20260327_PPT联网检索配图与版式增强设计.md`，把问题收口为“联网检索 + 图片落盘 + 固定版式生成”三段闭环，而不是误判成“只要接一个 Tavily 就够了”。
- 设计文档给出的最短路径是：新增 Tavily connector、给 Altus managed 暴露 `web_search/web_extract`、复用 `shell_execute` 下载图片到 sandbox、并对 PPT 任务强制固定 `slide_type` 与视觉页约束。
- 已同步更新 `技能附件_PPT办公技能模板设计.md`，把这轮后续演进方向与新设计文档串起来，避免后面实现时再次出现“skill 有配图建议，但链路本身拿不到图”的认知断层。
- 这轮按仓库要求先停在设计评审，不直接改业务代码；待用户确认文档后，再进入实现阶段。
