import { appUserDAO, appUserProjectDAO, taskCreationSessionDAO, type ProjectInstructionMemory } from '../db/dao';
import { altusMemoryRedisCacheService } from './altus-memory-redis-cache-service';
import { readSessionAltusMemory, taskSessionAltusMemoryService, type AltusSessionMemory } from './task-session-altus-memory-service';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export type AltusUserMemory = {
  preferredName: string;
  occupation: string;
  identity: string;
  location: string;
  background: string;
  preferences: string;
  responsePreferences: string;
};

function emptyUserMemory(): AltusUserMemory {
  return {
    preferredName: '',
    occupation: '',
    identity: '',
    location: '',
    background: '',
    preferences: '',
    responsePreferences: '',
  };
}

function normalizeUserMemory(value: unknown): AltusUserMemory {
  const record = asRecord(value);
  return {
    preferredName: asText(record.preferredName),
    occupation: asText(record.occupation ?? record.role),
    identity: asText(record.identity),
    location: asText(record.location),
    background: asText(record.background ?? record.about),
    preferences: asText(record.preferences),
    responsePreferences: asText(record.responsePreferences),
  };
}

export class AltusMemoryContextService {
  async getUserMemory(userId: string): Promise<AltusUserMemory> {
    const cached = await altusMemoryRedisCacheService.getUserMemory<AltusUserMemory>(userId);
    if (cached) return normalizeUserMemory(cached);

    const user = await appUserDAO.getById(userId);
    const profile = asRecord((user as any)?.profileJson);
    const memory = normalizeUserMemory(profile.personalization);
    await altusMemoryRedisCacheService.setUserMemory(userId, memory);
    return memory;
  }

  async getProjectMemoryForSession(sessionId: string, userId: string): Promise<ProjectInstructionMemory | null> {
    const session = await taskCreationSessionDAO.getSession(sessionId);
    const projectId = asText(session?.projectId);
    if (!projectId) return null;

    const cached = await altusMemoryRedisCacheService.getProjectMemory<ProjectInstructionMemory>(userId, projectId);
    if (cached) {
      const instruction = asText((cached as Record<string, unknown>)?.instruction);
      return instruction ? { instruction } : null;
    }

    const project = await appUserProjectDAO.getOwnedProjectById(projectId, userId);
    if (!project || project.projectType !== 'standard' || project.status !== 'active') {
      return null;
    }
    const instruction = appUserProjectDAO.readProjectInstruction(project.metadataJson);
    if (!instruction) return null;
    const memory = { instruction };
    await altusMemoryRedisCacheService.setProjectMemory(userId, projectId, memory);
    return memory;
  }

  async getSessionMemory(sessionId: string): Promise<AltusSessionMemory> {
    return taskSessionAltusMemoryService.getSessionAltusMemory(sessionId);
  }

  buildPromptSection(input: {
    userMemory: AltusUserMemory;
    projectMemory: ProjectInstructionMemory | null;
    sessionMemory: AltusSessionMemory;
  }) {
    const lines: string[] = ['# Altus memory context'];
    const { userMemory, projectMemory, sessionMemory } = input;

    const userLines = [
      userMemory.preferredName ? `- preferred_name: ${userMemory.preferredName}` : '',
      userMemory.occupation ? `- occupation: ${userMemory.occupation}` : '',
      userMemory.identity ? `- identity: ${userMemory.identity}` : '',
      userMemory.location ? `- location: ${userMemory.location}` : '',
      userMemory.background ? `- background: ${userMemory.background}` : '',
      userMemory.preferences ? `- long_term_preferences: ${userMemory.preferences}` : '',
      userMemory.responsePreferences
        ? `- response_preferences: ${userMemory.responsePreferences}`
        : '',
    ].filter(Boolean);
    if (userLines.length > 0) {
      lines.push('', '## User memory', '- Use this to adjust tone, address, and explanation defaults.', ...userLines);
    }

    if (projectMemory?.instruction) {
      lines.push(
        '',
        '## Project instruction',
        '- Treat this as shared project-level instruction and default operating context.',
        `- instruction: ${projectMemory.instruction}`
      );
    }

    const sessionLines = [
      sessionMemory.summary.goal ? `- current_goal: ${sessionMemory.summary.goal}` : '',
      sessionMemory.summary.latestOutcome
        ? `- latest_outcome: ${sessionMemory.summary.latestOutcome}`
        : '',
      ...(sessionMemory.summary.openQuestions.length > 0
        ? sessionMemory.summary.openQuestions.map((item) => `- open_question: ${item}`)
        : []),
      ...sessionMemory.constraints.map((item) => `- constraint: ${item}`),
      ...sessionMemory.decisions.map((item) => `- decision: ${item}`),
      ...sessionMemory.workingNotes.slice(-6).map((item) => `- working_note: ${item}`),
    ].filter(Boolean);
    if (sessionLines.length > 0) {
      lines.push('', '## Session memory', '- Treat this as the latest session-level facts and continuity state.', ...sessionLines);
    }

    if (lines.length === 1) {
      return '';
    }

    lines.push(
      '',
      '# Memory precedence',
      '- Session memory overrides project memory for current-turn facts.',
      '- Project memory overrides user memory for project-specific operating rules.',
      '- User memory controls default address, tone, and explanation style.'
    );

    return lines.join('\n');
  }

  async buildPromptSectionForRun(input: { sessionId: string; userId: string }) {
    const [userMemory, projectMemory, sessionMemory] = await Promise.all([
      this.getUserMemory(input.userId),
      this.getProjectMemoryForSession(input.sessionId, input.userId),
      this.getSessionMemory(input.sessionId),
    ]);
    return {
      userMemory,
      projectMemory,
      sessionMemory: readSessionAltusMemory(sessionMemory),
      promptSection: this.buildPromptSection({ userMemory, projectMemory, sessionMemory }),
    };
  }

  async invalidateProjectMemory(userId: string, projectId: string) {
    await altusMemoryRedisCacheService.clearProjectMemory(userId, projectId);
  }

  async invalidateUserMemory(userId: string) {
    await altusMemoryRedisCacheService.clearUserMemory(userId);
  }
}

export const altusMemoryContextService = new AltusMemoryContextService();
