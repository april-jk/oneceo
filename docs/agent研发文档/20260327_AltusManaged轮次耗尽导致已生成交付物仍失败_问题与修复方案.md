# 20260327 Altus Managed 轮次耗尽导致已生成交付物仍失败问题与修复方案

## 1. 问题概述

在 `Altus managed run` 中，用户让智能体生成办公型交付物时，系统可能出现：

- sandbox 内最终文件已经生成
- 文件存在性校验也已经成功
- 但 run 最终仍显示 `failed`
- stop reason 为 `managed_run_tool_round_limit_exceeded`

这会让用户看到“明明 PPT 已经做出来了，但系统却说失败”，同时也会阻断正式交付物持久化与下载入口。

## 2. 本次故障现象

以本次失败 run 为例：

- run id：`7ad35117-1be2-4bac-a138-b17ef7abbb40`
- session id：`8abef6b3-207c-49bb-9f2b-491dde310753`
- 最终 stop reason：`managed_run_tool_round_limit_exceeded`

实际事件回放显示：

1. Altus 成功读取了 `PPT` skill 附件。
2. Altus 检查 `python-pptx` 是否存在。
3. Altus 安装了 `python-pptx`。
4. Altus 写入 `create_ppt.py`。
5. Altus 成功执行脚本，生成 `职业规划.pptx`。
6. Altus 又执行了一次文件存在性校验。
7. 但在调用 `complete_task` 之前，工具轮次预算已经耗尽。

也就是说，本次故障的本质不是“PPT 没生成成功”，而是“生成成功后没来得及正常收尾”。

## 3. 根因分析

根因集中在两个点：

### 3.1 默认工具轮次预算偏低

当前 `AltusRunCoordinator` 的默认工具轮次上限为 `12`。

对于代码改动类任务，这个值通常够用；但对办公型任务，常见链路往往包含：

1. 读取 skill brief
2. 查看工作区
3. 检查依赖库
4. 安装依赖库
5. 写脚本
6. 执行脚本
7. 再次修正脚本
8. 再次执行
9. 校验最终文件
10. 调用 `complete_task`

本次 run 实际已经消耗了 `12` 次工具调用，正好打满上限，因此没有给最终 `complete_task` 留出空间。

### 3.2 completion 提示词不够强

虽然系统已经要求“最终通过 `complete_task` 结束”，但现有 prompt 对办公型交付物的约束还不够明确：

- 没有强调“文件一旦验证存在，就应立即结束”
- 没有明确禁止“已经生成后还继续做可选检查或额外尝试”

这导致模型在交付物已经可用时，仍然可能继续消耗工具轮次，而不是立刻收尾。

## 4. 影响

如果不修，这个问题会造成：

- 用户侧看到 run `failed`，误以为交付物没有生成
- `complete_task.attachments` 无法被调用，交付物不会进入正式持久化流程
- 文件虽然留在 sandbox 中，但前端不会稳定展示下载入口
- 用户会重复重试，额外增加 sandbox 时间和成本

## 5. 修复原则

本次修复遵循最短正确路径，不做兼容补丁，不引入旁路逻辑：

1. 直接提高 Altus managed 的默认工具轮次预算
2. 明确强化办公型交付物的 completion 规则
3. 保持“只有 `complete_task` 才算正常完成”的主流程不变

## 6. 修复方案

### 6.1 提高默认轮次预算

将 `AltusRunCoordinator.getMaxToolRounds()` 的默认值从 `12` 调整为 `16`。

这样做的目的不是放宽无限执行，而是给“读取附件 -> 安装依赖 -> 生成文件 -> 校验文件 -> complete_task”这类完整办公链路留出合理收尾空间。

### 6.2 强化 completion prompt

在 `AltusManagedPromptService` 中新增以下约束：

- 对下载型交付物，优先走最短验证路径
- 最终文件一旦生成并完成一次验证，就应立即 `complete_task`
- 不允许在文件已满足要求后，继续做额外的环境探测、重复存在性检查或替代实现尝试

这样可以把模型行为收敛到：

`生成 -> 验证一次 -> complete_task`

而不是：

`生成 -> 反复检查 -> 再尝试别的动作 -> 轮次耗尽`

## 7. 修改文件

- `apps/api/src/services/altus-run-coordinator.ts`
- `apps/api/src/services/altus-managed-prompt-service.ts`

## 8. 第一轮验证结果

本次修复完成后，我跑了一条真实的 PPT 链路回归：

- session id：`dca169c2-e4b6-4655-ab0f-f466cd2b6487`
- run id：`ebb167fb-7a0d-4697-959f-15e3b695e874`
- sandbox id：`ia1x8j56b2bjxyamxq80f`

测试步骤：

1. 创建 draft session
2. 上传真实 `skill-office-ppt.md` 附件
3. 发起 Altus managed run，要求生成 `career-plan-roundfix.pptx`
4. 轮询 run 直到终态
5. 调用 deliverables 列表与下载接口校验交付物
6. 验证完成后手动关闭 sandbox，并删除测试 session

验证结果：

- run 最终状态为 `completed`
- stop reason 为空，不再出现 `managed_run_tool_round_limit_exceeded`
- deliverables 接口返回 `1` 个正式交付物
- 下载接口成功返回 `career-plan-roundfix.pptx`
- 下载文件大小为 `42462` bytes，`Content-Type` 正确
- 最终 recent messages 中已出现 `assistant_message` 与 `status_update(eventType=run_completed)`

额外说明：

- 这次成功 run 在日志窗口内共出现了 `16` 次模型调用
- 旧默认值只有 `12`，这说明本次问题并不是偶发，而是办公型任务确实会消耗超过 `12` 轮的模型预算
- 测试结束后，session 已删除，请求 session 详情返回 `404`
- 测试 sandbox 已手动关闭，E2B 返回 `Paused sandbox ia1x8j56b2bjxyamxq80f not found`，说明该 sandbox 已不存在

## 9. 新增复发案例与二次根因收敛

在第一轮修复后，又出现了一次新的 `managed_run_tool_round_limit_exceeded`：

- run id：`aeb9fd96-d4d3-4c80-a735-c615a100e7f1`
- session id：`c4ff3cfc-cfcb-43fa-9d68-002b15ac3ae6`
- 发生时间：`2026-03-27 17:41` 到 `2026-03-27 17:48`（Asia/Shanghai）

这次说明第一轮修复方向是对的，但默认 `16` 轮预算对办公型 PPT 任务依然偏紧。

### 9.1 本次复发的真实过程

事件回放显示，这次 run：

1. 成功读取了 `PPT` skill 附件
2. 安装了 `python-pptx`
3. 写入了第一版 `create_career_ppt.py`
4. 因 `RgbColor` / `RGBColor` 导入路径错误反复失败
5. 在第 16 轮附近才验证出正确导入应来自 `pptx.dml.color`
6. 但还没来得及继续修正并生成文件，就再次触发 `managed_run_tool_round_limit_exceeded`

### 9.2 这次复发暴露出的新问题

这说明单纯把预算从 `12` 提到 `16` 还不够，因为办公型任务仍然存在两个额外风险：

- 生成脚本过度复杂，导致单次失败后的修复轮次变多
- 模型会在文件尚未生成前，把大量预算耗在不必要的样式设计和导入试错上

因此本次二次修复需要同时覆盖两点：

1. 默认预算继续提高到 `24`
2. Prompt 明确要求办公文件生成优先走“最小可用脚本”，不要先搭复杂版式和装饰性 helper

## 10. 第二轮修复方案

### 10.1 默认预算从 16 提高到 24

`AltusRunCoordinator.getMaxToolRounds()` 默认值继续提高到 `24`，这也是当前代码允许的上限。

这样做的原因不是无限放大执行，而是承认办公型任务的真实成本：

- 读取 skill
- 安装依赖
- 写脚本
- 运行脚本
- 修正脚本
- 再次运行
- 校验文件
- `complete_task`

这条链路在弱约束下确实可能超过 `16` 轮。

### 10.2 收紧 office 文件生成策略

在 `AltusManagedPromptService` 中补充三条强约束：

- 对 `pptx/docx/xlsx` 任务，优先生成简单且正确的交付物，而不是先做花哨设计
- 不允许无依据扩写用户范围，例如用户只说“帮我生成一份职业规划 PPT”，就不应先擅自扩成复杂的大型 deck
- 使用 `python-pptx` 等库时，必须先从稳定导入和最小工作脚本开始，不要在基本文件还没跑通前先搭复杂 helper

## 11. 验证要求

修复完成后，需要至少验证以下主链路：

1. 让 Altus 生成一份 `pptx` 文件
2. 确认 run 最终进入 `completed`
3. 确认最终消息中出现正式 deliverable
4. 确认前端可直接下载文件
5. 确认验证后关闭本次测试 sandbox，避免额外计费

## 12. 第二轮修复后的快速探针结果

第二轮修复后，我又对同一句用户输入做了轻量探针：

- 输入：`帮我生成一份ppt，主题是职业规划`
- 附件：真实 `skill-office-ppt.md`
- session id：`d6018461-8b95-452f-84d7-820111c68965`
- run id：`9f69447f-ed93-4c6d-a8be-0187be9e323d`

探针结果：

- 该 run 在 40 秒窗口内没有再复现 `managed_run_tool_round_limit_exceeded`
- 当前状态变为 `waiting_user`
- 说明第二轮修复已经把“直接因为轮次耗尽而失败”的问题压下去了

但也同时暴露出一个新的残余问题：

- 对于这类已经足够开始执行的办公请求，模型仍然可能发起不必要的泛化澄清
- 这属于“过度澄清”问题，而不是本次的轮次耗尽问题

本次探针结束后，测试 sandbox `ij5p1bd9iqd67k0c0vzhb` 已手动关闭，测试 session 也已删除。

## 13. 结论

这次问题不是 PPT skill 本身失效，也不是交付物闭环设计错误，而是 Altus managed 在办公型任务上的“收尾预算”与“收尾指令”不够强，导致 run 在文件已生成后仍被错误判为失败。

修复后，系统应更稳定地完成这类链路：

`读取 skill -> 生成交付物 -> 验证 -> complete_task -> deliverable 持久化 -> 用户下载`
