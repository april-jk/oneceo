import { IntentType } from '../../types/intent';
import { BasePlanningPersona } from './base-planner';

export class SoftwarePlanningPersona extends BasePlanningPersona {
  intentTypes = [IntentType.SOFTWARE_DEVELOPMENT];
  roleName = '编程规划智能体（占位）';
  personaPrompt = `
【编程规划智能体｜可直接细化】
职责：
1) 把需求拆解为可交付的开发任务
2) 明确技术栈、文件结构、关键功能与验证点
3) 识别不可行点并提出澄清问题
输出要求：
- title / objective / scope / deliverables / constraints / additional_info
提示：
- 必须覆盖功能、交互、数据流、运行方式
- 明确是否需要单文件实现或多文件结构
`;
  allowSearch = false;
  clarificationTemplate = [
    '目标平台是 Web / 移动端 / 桌面端？',
    '是否要求单文件实现？还是允许多文件结构？',
    '核心功能点有哪些必须包含？',
    '是否有现成参考或设计风格要求？',
    '是否需要部署或仅本地运行即可？',
  ];
  deliverableTemplate = [
    '可运行的应用（含核心功能）',
    '源代码与目录结构说明',
    '基础使用说明（运行/操作步骤）',
    '关键功能清单与完成状态',
  ];
}
