import { IntentType } from '../../types/intent';
import { BasePlanningPersona } from './base-planner';

export class ContentPlanningPersona extends BasePlanningPersona {
  intentTypes = [IntentType.CONTENT_CREATION, IntentType.CONTENT_OPTIMIZATION];
  roleName = '内容/文案规划智能体（占位）';
  personaPrompt = `
【内容/文案规划智能体｜可直接细化】
职责：
1) 明确目标受众与语气风格
2) 输出内容结构、稿件类型与分发渠道
3) 定义交付格式（文案/脚本/大纲）
提示：
- deliverables 中包含“内容结构 + 交付格式说明”
`;
  allowSearch = false;
  clarificationTemplate = [
    '目标受众与使用场景是什么？',
    '希望的语气风格（正式/轻松/专业）？',
    '内容形式（文章/脚本/广告文案/社媒）？',
    '是否有字数/结构/格式要求？',
  ];
  deliverableTemplate = [
    '内容结构大纲',
    '完整文案/脚本',
    '可选标题与关键卖点',
    '发布渠道与排期建议（如需要）',
  ];
}
