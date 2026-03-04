import { BaseAgent, type AgentConfig } from '../../base-agent';

export type PlaywrightTestDetectionResult = {
  tested: boolean;
  confidence: number;
  reason: string;
};

export class PlaywrightTestDetectionAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      name: 'PlaywrightTestDetectionAgent',
      description: '判断是否真实完成 Playwright 自动化测试',
      systemPrompt: `你是执行日志判定器。你的任务是判断日志内容是否代表“Playwright 自动化测试已经实际执行完成”。

判断标准：
- 如果只是计划/准备/说明要运行测试（例如“将开始测试”“需要安装 Playwright”“准备运行”），则 tested=false。
- 如果明确出现执行步骤、测试动作、测试结果（通过/失败/截图/断言）等，且是“已经执行”的语义，则 tested=true。
- 仅提及 Playwright 或自动化测试但无执行证据，应判定为 tested=false。

输出格式（必须是有效 JSON）：
{
  "tested": true,
  "confidence": 0.0,
  "reason": "简要理由"
}

注意：confidence 取 0~1。`,
      tools: [],
      modelName: process.env.AGENT_OPENAI_MODEL || 'claude-haiku-4-5-20251001',
      temperature: 0.2,
      maxIterations: 4,
    };
    super(config);
  }

  async detect(input: string): Promise<PlaywrightTestDetectionResult> {
    const prompt = `日志片段：\n${input}\n\n请输出判断结果 JSON。`;
    const result = await this.execute(prompt);
    if (!result.success) {
      throw new Error(result.error || 'Playwright 测试判定失败');
    }
    const parsed = await this.parseJsonResponse<PlaywrightTestDetectionResult>(
      result.output || '',
      'Playwright 测试判定'
    );
    return {
      tested: Boolean(parsed.tested),
      confidence: Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(1, Number(parsed.confidence))) : 0,
      reason: parsed.reason || '',
    };
  }
}

export const playwrightTestDetectionAgent = new PlaywrightTestDetectionAgent();
