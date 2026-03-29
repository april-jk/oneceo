import type { OneceoApiConnector } from '../connectors/oneceo-api-connector';

export class SkillManagementService {
  constructor(private readonly oneceoApi: OneceoApiConnector) {}

  listSkills(filters?: { query?: string; status?: string; category?: string }) {
    return this.oneceoApi.listSkills(filters);
  }

  getSkill(skillId: string) {
    return this.oneceoApi.getSkill(skillId);
  }

  createSkill(input: {
    slug: string;
    name: string;
    description?: string;
    category?: string;
    bodyMarkdown: string;
    createdBy?: string;
  }) {
    return this.oneceoApi.createSkill(input);
  }

  updateSkill(
    skillId: string,
    input: {
      name?: string;
      description?: string;
      category?: string;
      bodyMarkdown?: string;
      createdBy?: string;
    }
  ) {
    return this.oneceoApi.updateSkill(skillId, input);
  }

  archiveSkill(skillId: string) {
    return this.oneceoApi.archiveSkill(skillId);
  }

  activateSkill(skillId: string) {
    return this.oneceoApi.activateSkill(skillId);
  }

  listRevisions(skillId: string) {
    return this.oneceoApi.listSkillRevisions(skillId);
  }

  getRenderedRevision(skillId: string, revisionId: string) {
    return this.oneceoApi.getRenderedSkillRevision(skillId, revisionId);
  }

  validateRevision(skillId: string, revisionId: string, sessionId: string) {
    return this.oneceoApi.validateSkillRevision(skillId, revisionId, sessionId);
  }
}
