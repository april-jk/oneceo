import { IntentType } from '../../types/intent';
import { BasePlanningPersona } from './base-planner';

export class GenericPlanningPersona extends BasePlanningPersona {
  intentTypes = [IntentType.OTHER];
  roleName = '通用规划智能体（占位）';
  personaPrompt = `
【通用规划智能体｜可直接细化】
职责：
1) 将需求转化为清晰任务描述
2) 输出可交付物与约束
3) 缺信息时提出澄清问题
`;
  allowSearch = false;
  clarificationTemplate = [
    '核心目标是什么？',
    '期望的交付物形式？',
    '是否有明确的范围/限制条件？',
  ];
  deliverableTemplate = [
    '任务描述与范围说明',
    '交付物清单',
    '约束与依赖',
  ];
}
