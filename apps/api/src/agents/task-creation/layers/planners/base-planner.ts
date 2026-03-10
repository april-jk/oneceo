import { IntentType } from '../../types/intent';

export type PlanningRouteConfig = {
  roleName: string;
  personaPrompt: string;
  allowSearch: boolean;
  buildSearchQuery?: (keyInfo: Record<string, any>) => string;
  clarificationTemplate?: string[];
  deliverableTemplate?: string[];
};

/**
 * Layer 2 子规划智能体基类（占位）
 *
 * 后续你可以在各子类中直接细化 personaPrompt，
 * 或扩展 buildSearchQuery/allowSearch。
 */
export abstract class BasePlanningPersona {
  abstract intentTypes: IntentType[];
  abstract roleName: string;
  abstract personaPrompt: string;
  allowSearch = false;
  clarificationTemplate: string[] = [];
  deliverableTemplate: string[] = [];

  buildSearchQuery?(keyInfo: Record<string, any>): string;

  getRouteConfig(): PlanningRouteConfig {
    return {
      roleName: this.roleName,
      personaPrompt: this.personaPrompt,
      allowSearch: this.allowSearch,
      buildSearchQuery: this.buildSearchQuery?.bind(this),
      clarificationTemplate: this.clarificationTemplate,
      deliverableTemplate: this.deliverableTemplate,
    };
  }
}
