# 20260328 Tavily + PPT 联网配图实现与验证

## 1. 背景

针对用户反馈的两个核心问题，本次继续完成了 PPT 办公 skill 的联网检索与配图增强落地：

- 生成的 PPT 没有图片、没有明显版式层次
- Altus managed 在接入联网检索后，仍可能因为工具轮次耗尽而失败

本次目标不是新增一套独立的 Office 平台，而是在现有 Altus managed 链路上补齐最短可用闭环：

- 能联网检索资料与候选图片
- 能把联网结果真正用于 PPT 生成
- 能在生成完成后稳定收尾并产出可下载的 `.pptx`

## 2. 问题原因

### 2.1 之前为什么 PPT 没图

此前系统虽然已经有 `PPT 办公` skill brief，但 Altus managed 缺少真正的联网检索工具，因此模型即使知道“应该配图”，也没有办法稳定获得外部事实、图片 URL 和来源信息。

### 2.2 之前为什么仍会 `managed_run_tool_round_limit_exceeded`

联网检索 + 抽取 + 下载图片 + 生成 PPT 本身比纯文本 PPT 路径更长；在这条更真实的执行链路里，默认轮次预算偏低，且提示词对“收尾即完成”的约束仍然不够强，模型容易把轮次浪费在可选检查和重复试错上。

## 3. 本次实现

### 3.1 新增 Tavily 连接层

新增服务端 Tavily connector，封装 Search / Extract 能力，并统一读取以下环境变量：

- `TAVILY_API_KEY`
- `TAVILY_BASE_URL`
- `TAVILY_TIMEOUT_MS`

修改位置：

- `apps/api/src/connectors/tavily-connector.ts`
- `apps/.env`

### 3.2 给 Altus managed 增加联网工具

在 managed tool 定义中新增：

- `web_search`
- `web_extract`

并在 tool runtime 中接入 Tavily connector，让 Altus managed 可以直接在 run 内调用联网检索与内容抽取。

修改位置：

- `apps/api/src/services/altus-managed-shared.ts`
- `apps/api/src/services/altus-managed-tool-runtime.ts`

### 3.3 收紧 PPT 执行提示词

继续强化 Altus managed prompt，重点约束：

- PPT 任务需要当前事实、案例或视觉素材时，优先使用 `web_search / web_extract`
- 检索路径保持短链路，不做无限来回搜索
- 视觉型 PPT 只选少量必要图片
- 脚本失败后必须根据真实错误做定向修复，不能重复原命令空转
- 文件一旦生成并完成一次验证，就立刻 `complete_task`
- 对“职业规划、市场分析、方案汇报、周报”等广义办公主题，默认用合理专业默认值，不再泛化追问

同时补充了 `python-pptx` 的稳定导入约束，减少错误猜测模块路径带来的无效轮次消耗。

修改位置：

- `apps/api/src/services/altus-managed-prompt-service.ts`

### 3.4 提升 managed run 轮次预算

将 Altus managed 默认轮次预算从 `24` 提升到 `32`，并在本地环境中显式配置：

- `ALTUS_MANAGED_MAX_TOOL_ROUNDS=32`

修改位置：

- `apps/api/src/services/altus-run-coordinator.ts`
- `apps/.env`

### 3.5 更新 PPT 办公 skill 模板

把 `PPT 办公` skill brief 进一步收紧为执行型规范，新增以下要求：

- 优先走一次“联网搜索 -> 抽取 -> 选图”的短链路
- 页面必须有明确 `slide_type`
- 至少保证封面视觉页和两页以上带图/图表/卡片结构的内容页
- 若使用 `python-pptx`，优先使用稳定导入
- 文件生成并验证后应立刻作为最终交付物完成，不再在收尾阶段继续试错

修改位置：

- `apps/web/client/src/lib/skill-attachment-templates.ts`

## 4. 修改位置总览

- `apps/.env`
- `apps/api/src/connectors/tavily-connector.ts`
- `apps/api/src/services/altus-managed-shared.ts`
- `apps/api/src/services/altus-managed-tool-runtime.ts`
- `apps/api/src/services/altus-managed-prompt-service.ts`
- `apps/api/src/services/altus-run-coordinator.ts`
- `apps/web/client/src/lib/skill-attachment-templates.ts`

## 5. 验证结果

### 5.1 服务状态

- `http://127.0.0.1:4000/health` 返回 `ok`
- `http://127.0.0.1:3000` 返回 `200`

### 5.2 真实链路 smoke

执行脚本：

- `pnpm --filter api exec tsx scripts/_tmp/_tmp_altus_managed_ppt_visual_smoke.ts`

结果：

- `latestRunStatus = completed`
- `usedTools = ["complete_task","shell_execute","web_extract","web_search","write_file"]`
- 最终交付物：`career-plan-visual.pptx`
- 大小：`833288 bytes`
- 幻灯片数量：`6`
- 含图片页面：`4`
- 交付物下载接口返回正常 `Content-Type`

关键说明：

- 这次验证已证明 PPT 生成链路确实用上了 Tavily 联网工具，而不是只生成了一个无图纯文本 deck
- run 最终进入 `completed`，没有再次触发 `managed_run_tool_round_limit_exceeded`

### 5.3 清理结果

本次 smoke 产生的资源已经清理：

- sandbox：`inmuud1a9cc81r2oqgwth` 已关闭
- session：`6a9de98b-8195-40ef-83da-77ebf1e18358` 已删除

### 5.4 静态校验

- `pnpm --filter web check` 通过
- `pnpm --filter api exec tsc --noEmit --pretty false` 仍存在仓库内既有错误，未由本次改动引入；本次改动以真实链路 smoke 作为回归依据

## 6. 结论

本次已经完成 Tavily + PPT 联网配图链路的实际落地，不再只是设计文档阶段。

当前用户侧可预期效果为：

- 选择 `PPT 办公` skill 后，Altus managed 可以联网补资料和候选图片
- 生成的 PPT 不再默认退化为纯文本页
- 生成完成后会走正式 deliverable 闭环，可直接下载 `.pptx`

当前残余关注点不是“功能是否可用”，而是后续继续观察不同主题下的视觉质量一致性。
