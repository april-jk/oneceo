import { IntentType } from '../../types/intent';
import type { PlanningRouteConfig } from './base-planner';
import { SoftwarePlanningPersona } from './software-planner';
import { FinancePlanningPersona } from './finance-planner';
import { OpsPlanningPersona } from './ops-planner';
import { ContentPlanningPersona } from './content-planner';
import { DesignPlanningPersona } from './design-planner';
import { ResearchPlanningPersona } from './research-planner';
import { GenericPlanningPersona } from './generic-planner';

const PERSONAS = [
  new SoftwarePlanningPersona(),
  new FinancePlanningPersona(),
  new OpsPlanningPersona(),
  new ContentPlanningPersona(),
  new DesignPlanningPersona(),
  new ResearchPlanningPersona(),
  new GenericPlanningPersona(),
];

export function getPlanningPersona(intentType: string): PlanningRouteConfig {
  const hit =
    PERSONAS.find((persona) => persona.intentTypes.includes(intentType as IntentType)) ||
    PERSONAS.find((persona) => persona.intentTypes.includes(IntentType.OTHER)) ||
    PERSONAS[PERSONAS.length - 1];
  return hit.getRouteConfig();
}
