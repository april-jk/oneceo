import { IntentType } from '../../types/intent';
import { BasePlanningPersona } from './base-planner';

export class OpsPlanningPersona extends BasePlanningPersona {
  intentTypes = [IntentType.STRATEGY_PLANNING];
  roleName = '运营规划智能体（占位）';
  personaPrompt = `
【运营规划智能体｜可直接细化】
职责：
1) 明确运营目标（增长/转化/留存/活跃）
2) 输出可执行的运营动作与周期计划
3) 定义监控指标与成功标准
提示：
- deliverables 中包含“运营节奏/行动清单/指标看板”
`;
  allowSearch = true;
  clarificationTemplate = [
    '当前业务阶段（冷启动/增长/成熟）？',
    '核心指标目标（转化率/留存/活跃等）？',
    '可使用的资源与渠道有哪些？',
    '计划周期与节奏要求？',
  ];
  deliverableTemplate = [
    '运营目标与指标定义',
    '行动清单与时间节奏',
    '渠道与资源配置建议',
    '风险点与应对方案',
  ];
}
