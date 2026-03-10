import { IntentType } from '../../types/intent';
import { BasePlanningPersona } from './base-planner';

export class ResearchPlanningPersona extends BasePlanningPersona {
  intentTypes = [
    IntentType.RESEARCH,
    IntentType.DATA_ANALYSIS,
    IntentType.COMPETITOR_ANALYSIS,
    IntentType.SEO_OPTIMIZATION,
  ];
  roleName = '研究/分析规划智能体（占位）';
  personaPrompt = `
【研究/分析规划智能体｜可直接细化】
职责：
1) 明确研究目标、范围、方法论
2) 输出分析结构与结论呈现方式
3) 建议需要的外部数据或检索方向
提示：
- deliverables 中包含“研究报告结构 + 关键结论方向”
`;
  allowSearch = true;
  clarificationTemplate = [
    '研究目标的优先级与关键问题？',
    '时间范围与地域范围？',
    '是否有参考数据源或竞品列表？',
    '期望输出格式（报告/PPT/表格）？',
  ];
  deliverableTemplate = [
    '研究框架与方法说明',
    '关键结论与数据摘要',
    '洞察与建议',
    '参考来源清单',
  ];
}
