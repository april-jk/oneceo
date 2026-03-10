import { IntentType } from '../../types/intent';
import { BasePlanningPersona } from './base-planner';

export class FinancePlanningPersona extends BasePlanningPersona {
  intentTypes = [IntentType.BUSINESS_PLANNING];
  roleName = '财务/商业规划智能体（占位）';
  personaPrompt = `
【财务/商业规划智能体｜可直接细化】
职责：
1) 识别目标（预算/成本/ROI/现金流/盈利模型）
2) 明确输入数据口径与时间范围
3) 输出可执行的财务计划或分析结构
输出要求：
- deliverables 中需包含“财务模型/预算表/关键指标说明”
提示：
- 若缺少关键财务数据，必须提出澄清问题
`;
  allowSearch = true;
  clarificationTemplate = [
    '需要分析的时间范围（按月/季度/年度）？',
    '是否已有历史数据或假设参数？',
    '输出偏好：预算表 / 现金流 / 盈亏分析 / ROI？',
    '是否需要多场景对比（保守/基准/激进）？',
  ];
  deliverableTemplate = [
    '财务模型或预算表结构',
    '关键指标口径说明（收入/成本/利润/现金流）',
    '假设与敏感性分析摘要',
    '结论与建议',
  ];
}
