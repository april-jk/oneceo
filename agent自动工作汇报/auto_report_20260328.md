# 2026-03-28 工作汇报

## 做了什么

- 继续完成 Tavily + PPT 联网配图链路的实际落地，而不是停留在设计文档
- 收紧 `altus-managed-prompt-service.ts`，限制视觉型 PPT 的检索、配图、脚本修复和收尾路径
- 将 `altus-run-coordinator.ts` 的默认工具轮次预算提升到 `32`，并在 `apps/.env` 中显式配置 `ALTUS_MANAGED_MAX_TOOL_ROUNDS=32`
- 更新 `PPT 办公` skill 模板，加入联网短链路、稳定导入与“生成后立即交付”约束
- 拉起本地 API / Web，并执行真实 smoke：`PPT skill -> web_search/web_extract -> 配图生成 -> deliverable 下载`

## 遇到什么

- 之前 Tavily 接入后虽然主流程基本可用，但视觉型 PPT 的真实链路更长，Altus managed 仍可能把轮次消耗在收尾阶段或脚本重复试错上
- `api` 全量 `tsc` 仍有一批仓库既有报错，无法作为这次改动的回归通过标准

## 结果

- 真实 smoke 已进入 `completed`
- `usedTools` 明确包含 `web_search` 和 `web_extract`
- 最终生成并下载 `career-plan-visual.pptx`
- 验证到 `6` 页、`4` 页含图片，且 deliverable 下载接口正常
- 本次测试创建的 sandbox 已关闭，会话已删除

## 计划如何解决

- 后续继续观察不同主题下 PPT 视觉质量的一致性
- 若用户继续反馈某类主题仍易退化，再沿 prompt 和 skill 模板做有针对性的收紧，而不是回退为无图纯文本方案

## 新增处理结果：Word / Excel 也接上联网检索

- 继续把 Tavily 联网能力从 `PPT 办公` 扩展到 `Word 文档` 和 `Excel 表格`
- 在 `altus-managed-prompt-service.ts` 中补充 `docx/xlsx` 的联网检索与来源保留规则，并明确 `complete_task.attachments` 必须是 JSON 数组而不是字符串
- 在 `skill-attachment-templates.ts` 中更新 `Word 文档` 和 `Excel 表格` 模板，要求素材不足时优先联网补材，并在生成文件后立即完成交付
- 新增通用 smoke 脚本 `apps/api/scripts/_tmp/_tmp_altus_managed_office_smoke.ts`
- `Word` 真链路回归已通过：最终生成并下载 `ai-pm-career-plan.docx`，run 用到了 `web_search / web_extract`
- `Excel` 真链路回归已通过：最终生成并下载 `ai-pm-learning-plan.xlsx`，run 用到了 `web_search / web_extract`
- 本轮回归中创建的 sandbox 均已关闭、测试 session 均已删除，未留下额外计费资源

## ��������������޸� Word ��ҵ�ƻ��鴥���� llm-proxy INTERNAL_ERROR
- �����û��ֳ�ʧ�� run��ȷ�ϲ��� `Word �ĵ�` skill ģ�廵�������ǳ��ĵ������ڶ��� `write_file` ���������Ŵ���һ�� `/api/llm-proxy/v1/chat/completions` �ȱ�Ĭ�� raw body limit ����
- �� `apps/api/src/index.ts` Ϊ `/api/llm-proxy` �� `express.raw()` ������ʽ `limit`�������� `LLM_PROXY_BODY_LIMIT_MB`
- Ĭ��ֵ������ `64mb`��ͬʱ������ǯ�Ƶ� `128mb`���������������޷Ŵ�
- �����������޸�˵���ĵ� `docs/agent�з��ĵ�/20260328_Word��ҵ�ƻ���_INTERNAL_ERROR_�������޸�����.md`
- ��һ������ API ���ó���������̽�븴�⣬ȷ�ϲ���ֱ�ӷ���ͨ�� `500 INTERNAL_ERROR`
- API �Ѱ�������������`http://127.0.0.1:4000/health` ����
- Լ `130178 bytes` �� llm-proxy ̽�����ѷ��� `200` ��ʽ��Ӧ�����ٸ���ͨ�� `500 INTERNAL_ERROR`
- Word ����·�ع���ͨ����`runId=763b2cd6-a82e-4929-87b4-0c5170db38f6`���������ɲ����� `smart-building-business-plan.docx`����С `43554 bytes`
- ���λع������ sandbox `iwcechj9lb3cupbet4a1p` �ѹرգ��Ự `b08e8430-19c4-4918-9763-ea62bef66084` ��ɾ��

## 新增处理结果：修复“选择 skill 后，managed run 已创建出现过慢”
- 复盘并确认根因不在 managed run 创建本身，而在内置 skill 被当作 markdown 附件先上传，上传接口又会先冷启动 runtime/sandbox
- 结合既有实测数据收敛链路：新建 session 约 `0.36s`，首次上传 77 bytes skill markdown 约 `34.2s`，单独 `runtime/start` 约 `31.1s`，而 run 到 `run_ack` 仅 `0.3s ~ 0.7s`
- 在 `apps/web/client/src/lib/task-attachments.ts` 中新增 skill 文件打标、附件分流和 inline prompt 拼接能力
- 在 `apps/web/client/src/components/AttachmentPickerButton.tsx` 中把内置 skill 文件标记为 `inline_skill`
- 在 `apps/web/client/src/pages/Home.tsx` 和 `apps/web/client/src/components/TaskCreationChat.tsx` 中改为：只有真正文件附件才上传；skill-only 场景直接把 skill brief 内联进消息，不再触发 `/attachments`
- 新增问题与修复说明文档 `docs/agent研发文档/20260328_技能附件阻塞ManagedRun创建_问题与修复方案.md`
- 同步更新 `docs/agent研发文档/技能附件_PPT办公技能模板设计.md`，补充 skill 传递方式从“上传到 sandbox”切换为“内联到消息”的设计说明
- `pnpm --filter web check` 已通过
- 最小化结构验证已通过：skill-only 时 `uploadableCount = 0`，skill + 普通文件时只有普通文件进入上传队列

## 新增处理结果：修复“发送后用户消息偶发不可见”
- 复盘前端消息链路，确认 `sendChatInput(...)` 会先乐观插入本地 `user_input`，但 `sessionId` 变化后会立刻触发 `loadHistory(...)`
- 确认真正的问题有两层：一是 `loadHistory(...)` 里的 `setMessages(cached.messages)` / `setMessages(normalized)` 会把尚未落库的本地 user message 冲掉；二是 `mergeRealtimeMessage(...)` 原先会把连续两次相同文本的用户消息误判为重复
- 在 `apps/web/client/src/hooks/useTaskCreationAgent.ts` 中新增 `resolveExplicitAgentMessageKey(...)`、`isPendingLocalUserMessageForSession(...)`、`mergePendingLocalUserMessages(...)` 和 `messagesRef`
- 将 pending local user message 保护接入 `applyHistoryState(...)` 与 `loadHistory(...)`，确保历史回放不会覆盖当前 session 下尚未持久化的用户消息
- 同时收紧 `user_input / user_response` 的去重条件：只有在新旧消息都没有显式 `messageKey` 且文本完全相同的情况下，才视为重复
- 新增问题与修复说明文档 `docs/agent研发文档/20260328_发送后用户消息偶发不可见_问题与修复方案.md`

## 新增处理结果：补充“内容感知型 Office 生成”设计文档
- 复盘用户对 `PPT / Word` 结果同质化的反馈，确认问题不只是 skill 文案不够长，而是当前链路缺少“先理解内容类型，再决定结构与风格”的显式决策阶段
- 对照现有实现收敛三层根因：skill 层仍偏通用 brief、prompt 层为稳定性交付做了明显收紧、执行层只有通用工具没有内容决策契约
- 新增设计文档 `docs/agent研发文档/20260328_内容感知型Office生成设计.md`
- 文档明确当前阶段的最短实现路径：不改主工具链、不加新 UI、不换生成引擎，只在 `skill + prompt` 两层补齐“内容原型 -> 结构策略 -> 风格策略 -> 最终生成”的契约
- 同步在 `docs/agent研发文档/20260328_Office技能联网联动扩展_设计与实现.md` 中补充后续演进说明，避免把“联网联动”误认为“已经解决内容同质化”

## �������������ʵ�����ݸ�֪�� Office �����װ�
- ������ĵ� `docs/agent�з��ĵ�/20260328_���ݸ�֪��Office�������.md` ��ʼ����룬�������·����ֻ�޸� `skill + prompt` ���㣬������ UI��connector ���µ���������
- ��д `apps/web/client/src/lib/skill-attachment-templates.ts`���������� 6 ������ skills�����ص����� `office-ppt` �� `office-docx`
- �� `PPT �칫` skill ������ `content_archetype` �������޶�Ϊ `pitch_deck / consulting_report / roadmap_plan / training_material / proposal_solution / research_summary / product_story`
- �� `PPT �칫` skill ������ `generation_brief` ������ `style_pack` ���ƣ�Ҫ���Ⱦ��� `contentArchetype / tone / structureStrategy / visualStrategy / evidenceMode`��������ҳ��
- �� `Word �ĵ�` skill ������ `content_archetype` �������޶�Ϊ `business_plan / formal_report / proposal / policy_process / meeting_memo / research_brief / external_statement`
- �� `Word �ĵ�` skill ������ `generation_brief` ������ `style_pack` ���ƣ�Ҫ��ͬ�ĵ�ԭ��ʹ�ò�ͬ�½�˳��������֤����֯��ʽ
- �� `apps/api/src/services/altus-managed-prompt-service.ts` ������ Office ���ݸ�֪������ȷ `PPT / DOCX` ����ֱ�������ļ����ɣ�������ѡ��Ψһ `contentArchetype` �� bounded style pack�����γ��ڲ� brief
- ����ʵ������֤�ĵ� `docs/agent�з��ĵ�/20260328_���ݸ�֪��Office����_ʵ������֤.md`
- `pnpm --filter web check` ��ͨ������ͨ���ؼ��ּ���ȷ�� `content_archetype / generation_brief / style_pack / contentArchetype` ���䵽������

## 新增处理结果：补充 Office 正式任务模式设计
- 用户希望把 `PPT / Word / Excel` 从当前 office skills 升级成真正的正式办公模式，因此按仓库规则先进入设计阶段，不直接改业务代码
- 新增设计文档 `docs/agent研发文档/20260328_Office正式任务模式设计.md`
- 设计文档明确：Office 不再继续和 generic skills 混层，下一阶段会把 `PPT / Word / Excel` 从 skill 入口升级为 first-class office mode
- 设计文档同时定义了最短路径：新增共享 `office mode` 定义层、前端改为结构化 mode 选择、后端改为 mode-specific execution contract、completion 按 mode gate 校验
- 同步回写 `docs/agent研发文档/20260328_内容感知型Office生成设计.md`，标注后续演进方向已切换为“Office 正式任务模式”

## 新增处理结果：补充 PPT 多阶段协同技能设计
- 用户明确提出“先把 PPT 相关的 skills 弄好，让它们协同工作”，并要求继续参照 MiniMax `pptx-generator` 项目，而不是只在现有 `PPT 办公` skill 上继续堆长文案
- 重新对照 MiniMax 参考资料：`README`、`skills/pptx-generator/SKILL.md`、`references/slide-types.md`、`references/design-system.md`、`references/pitfalls.md`
- 结论收敛：MiniMax 之所以不千篇一律，不是因为 prompt 更长，而是因为它把 PPT 生成拆成“需求研究 -> 视觉系统选择 -> 页面原型选择 -> 逐页生成 -> QA gate”的多阶段工作流
- 新增设计文档 `docs/agent研发文档/20260328_PPT多阶段协同技能设计.md`
- 新文档明确本项目的最短实现路径是“一个 PPT 主技能 + 六个内部阶段子技能协同”：`ppt_task_router / ppt_research_curator / ppt_storyboard_designer / ppt_visual_system_designer / ppt_builder / ppt_qa_reviewer`
- 新文档同时定义了第一版要落地的 `pageType / contentSubtype / paletteKey / styleRecipe / fontPairing / QA gate`，并明确继续沿用当前 `python-pptx` 技术路线，不照搬 MiniMax 的 `PptxGenJS` 生成栈
- 下一步等待用户确认这份新设计文档；确认后再开始改 `skill-attachment-templates.ts`、`altus-managed-prompt-service.ts` 与共享 PPT 契约定义

## 新增处理结果：实现 PPT 多阶段协同技能首版
- 用户确认开始实现 `PPT 办公` 的多阶段协同方案后，按设计文档 `docs/agent研发文档/20260328_PPT多阶段协同技能设计.md` 进入正式编码
- 在 `packages/shared/src/ppt-generation.ts` 中新增共享 PPT 契约，定义 `PPT_TASK_PHASES / PPT_CONTENT_ARCHETYPES / PPT_PAGE_TYPES / PPT_CONTENT_SUBTYPES / PPT_STYLE_PACKS / PPT_PALETTE_KEYS / PPT_STYLE_RECIPES / PPT_FONT_PAIRINGS / PPT_QA_GATE_RULES` 以及 `PptGenerationBrief / PptEvidenceBundle / PptStoryboard / PptVisualSystem`
- 在 `packages/shared/src/index.ts` 中补充导出，为后续 Office 正式模式继续落地预留统一契约入口
- 重写 `apps/web/client/src/lib/skill-attachment-templates.ts`，把 `PPT 办公` 改成显式六阶段协同协议：`ppt_task_router / ppt_research_curator / ppt_storyboard_designer / ppt_visual_system_designer / ppt_builder / ppt_qa_reviewer`
- 同时在 `PPT 办公` skill 中补齐 `pageType / contentSubtype / paletteKey / styleRecipe / fontPairing / presentation_manifest.json / QA gate` 约束，直接把“反同质化”写入技能协议而不是停留在建议层
- 在 `apps/api/src/services/altus-managed-prompt-service.ts` 中新增对应的 PPT 多阶段执行规则，要求 Altus 先形成 `PptGenerationBrief`、再做受控检索、再做 storyboard 和 visual system，最后由 `ppt_qa_reviewer` 按 QA gate 收口
- 在 `apps/api/tests/altus-managed-prompt-service.test.ts` 中新增 prompt 单测，校验多阶段协同、`presentation_manifest.json`、`paletteKey` 和 QA gate 文案都已进入系统提示
- 实现过程中发现当前 `@oneceo/shared` 的运行时导入策略还不适合直接给 API prompt 服务读取新常量，因此本轮保留了共享契约文件，同时让 API prompt 服务先使用一份本地镜像常量，保证最短路径落地和运行稳定
- 新增实现与验证文档 `docs/agent研发文档/20260328_PPT多阶段协同技能实现与验证.md`
- 同步回写设计文档 `docs/agent研发文档/20260328_PPT多阶段协同技能设计.md` 的当前状态
- 验证已通过：`pnpm --filter @oneceo/shared build`、`pnpm --filter web check`、`pnpm --filter api exec node --import tsx --test tests/altus-managed-prompt-service.test.ts`

## 新增处理结果：跑通两条真实 PPT smoke
- 为验证 `PPT 办公` 多阶段协同协议的真实效果，继续使用现有 `apps/api/scripts/_tmp/_tmp_altus_managed_office_smoke.ts` 跑了两条真实 PPT 链路，而不是只停留在 prompt 单测
- 第一条 smoke：职业规划 PPT，session `833773dc-84f2-4438-8daa-03282fce1b83`，run `71b65460-f77e-4263-9a61-0b57ecef2f59`，最终 `completed`
- 结果生成并下载 `career-plan-multiphase-smoke.pptx`，大小 `312868 bytes`，用到了 `web_search / web_extract / shell_execute / write_file / complete_task`
- 结果特征：6 页结构、带封面图、至少 2 页视觉内容页、保留来源 URL
- 第二条 smoke：AI 学习助手路演 PPT，session `489ca27e-edc6-4895-b823-3ad571e8cbef`，run `503d4cf3-ebb4-41c4-82ad-5bfae923d730`，最终 `completed`
- 结果生成并下载 `ai-learning-assistant-pitch-smoke.pptx`，大小 `45572 bytes`，同样用到了 `web_search / web_extract / shell_execute / write_file / complete_task`
- 结果特征：10 页结构，明显转成路演型目录（problem / solution / market / business model / team / ask），与职业规划 PPT 的结构已经拉开
- 两次 smoke 产生的 sandbox `ir7e83mvvh7cgztz2n0f3`、`ibh466p9wxxipittwe5vh` 均已关闭，会话均已删除，没有留下额外计费资源
- 已把 run 结果回写到 `docs/agent研发文档/20260328_PPT多阶段协同技能实现与验证.md`

## 新增处理结果：补充 Word / Excel 多阶段协同技能设计
- 用户希望把 Word / Excel 也升级成和 PPT 一样的“主技能 + 多阶段子技能协同”方案，因此当前任务从 PPT 单点实现扩展到 Office 其余两条主链路
- 重新对照 MiniMax minimax-docx 与 minimax-xlsx 参考资料，重点吸收其“先路由再生成、先设计再交付、最后过 validation gate”的实现思想，而不是只模仿 skill 文案
- 新增设计文档 docs/agent研发文档/20260328_WordExcel多阶段协同技能设计.md
- 设计文档中把 Word 文档 定义为 6 个阶段：docx_task_router / docx_research_curator / docx_outline_architect / docx_style_system_designer / docx_builder / docx_qa_reviewer
- 设计文档中把 Excel 表格 定义为 6 个阶段：xlsx_task_router / xlsx_source_curator / xlsx_workbook_designer / xlsx_formula_planner / xlsx_builder / xlsx_qa_reviewer
- 设计文档同时明确第一版的 contentArchetype、style/structure 契约、manifest 输出和 QA gate，确保后续实现仍然走最短路径，而不是扩到 UI、数据库或新 connector
- 同步回写 docs/agent研发文档/20260328_Office正式任务模式设计.md，标记当前下一优先切片已切到 Word / Excel 多阶段协同
- 下一步等待用户审核这份新设计文档；确认后再开始改 skill-attachment-templates.ts、ltus-managed-prompt-service.ts 和必要的 shared 契约文件
