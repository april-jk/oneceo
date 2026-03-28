# 技能附件 PPT 办公技能模板设计

## 1. 设计目标

`PPT 办公` 不是底层 PPT 引擎，而是任务创建阶段的执行型 skill brief。它的职责是把用户一句自然语言需求，收敛成可交付的商务演示文稿工作流。

目标包括：

- 识别新建、修改、重组现有材料三种任务类型
- 明确受众、场景、主题、页数和结论导向
- 强制使用逐页结构和页面原型
- 把最终产物指向可下载的 `.pptx`

## 2. 参考来源

本模板主要参考了 MiniMax 的 Office 相关 skills，但不是原样拷贝，而是按当前项目的 skill 附件机制重新组织：

- `pptx-generator`
- `minimax-docx`
- `minimax-xlsx`

参考点主要包括：

- 先做任务分流，而不是直接开始生成文件
- 明确 create / edit / read existing materials 的不同执行路径
- 强调最终交付物而不只是提纲

## 3. 模板核心约束

### 3.1 输入梳理

- 识别主题、受众、演讲场景、目标结论、页数或时长、语气与品牌限制
- 若用户未指定页数，默认输出 8-12 页正式商务演示文稿
- 若已有材料，优先提炼事实、数据和已有结构

### 3.2 联网补材

- 若用户未提供足够素材，且系统具备联网能力，优先补外部事实、案例、候选图片和图表依据
- 联网时优先走一次“搜索 -> 抽取 -> 选图”的短链路，不允许无限补充素材

### 3.3 页面原型

优先使用以下 `slide_type`：

- `cover_hero`
- `agenda`
- `section_divider`
- `two_column_text_image`
- `three_card_comparison`
- `chart_focus`
- `summary_next_step`

并要求：

- 至少 1 页封面视觉页
- 至少 2 页带图片、图表或卡片结构的内容页
- 不允许整份 PPT 全是纯文本页

### 3.4 交付约束

- 输出逐页大纲与 speaker notes
- 使用外部资料或图片时保留来源 URL
- 最终产物优先生成 `.pptx`
- `.pptx` 生成并完成一次验证后应立刻作为最终交付物完成

## 4. 技术执行提示

如果使用 `python-pptx`，模板明确提示优先采用稳定导入：

- `from pptx import Presentation`
- `from pptx.util import Inches, Pt`
- `from pptx.dml.color import RGBColor`

这样做是为了减少模型猜测错误模块路径导致的无效轮次消耗。

## 5. 当前落地状态（2026-03-28）

该模板已经与 Tavily 联网检索链路联动，并在本项目中实际落地：

- 模板要求优先走“联网搜索 -> 抽取 -> 选图”的短链路
- 模板要求至少产出封面视觉页和两页以上带视觉元素的内容页
- 模板要求 `.pptx` 生成并完成一次验证后立刻作为最终交付物完成

对应实现与验证文档：

- `docs/agent研发文档/20260328_Tavily_PPT联网配图实现与验证.md`

## 6. Skill 传递方式更新（2026-03-28）

为了解决“选择 skill 后发送消息，要等待很久才看到 managed run 已创建”的问题，skill brief 的传递方式已经从“先上传到 sandbox 的附件”调整为“直接内联到当前消息”。

当前规则如下：

- 内置 skill 仍然在前端以 `skill-*.md` 的形式出现在附件区，便于用户确认已选择的 skill
- 但发送时，内置 skill 不再走 `attachments` 上传接口
- skill 内容会直接拼接进 prompt，并显式提示模型不要再尝试从工作区或 `.attachments` 中读取这些 skill 文件
- 只有真正的文件附件才继续走上传和 sandbox 写入链路

这样做的直接收益是：

- 不再因为 skill 附件上传而提前冷启动 runtime
- `managed run 已创建` 不会再被前置的 sandbox provision 阻塞
- skill 继续服务外部 managed agent，而不是被错误地绑定到 sandbox 文件系统
