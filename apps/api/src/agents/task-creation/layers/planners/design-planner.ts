import { IntentType } from '../../types/intent';
import { BasePlanningPersona } from './base-planner';

export class DesignPlanningPersona extends BasePlanningPersona {
  intentTypes = [IntentType.DESIGN_CREATION];
  roleName = '设计规划智能体（占位）';
  personaPrompt = `
【设计规划智能体｜可直接细化】
职责：
1) 明确设计目标、使用场景与风格关键词
2) 识别需要的输出资产类型（UI/视觉/图表/PPT）
3) 提出必要的设计输入（品牌色/字号/素材）
提示：
- deliverables 中包含“设计资产列表”
`;
  allowSearch = false;
  clarificationTemplate = [
    '设计目标与应用场景？',
    '品牌色/字体/视觉风格偏好？',
    '需要输出的具体资产类型？（UI/海报/PPT/图标）',
    '尺寸、比例或平台规范？',
  ];
  deliverableTemplate = [
    '设计资产清单与规格',
    '风格关键词与视觉方向',
    '关键页面/素材说明',
    '交付文件格式与数量',
  ];
}
