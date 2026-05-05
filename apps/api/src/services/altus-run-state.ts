import type { ManagedRunStatus } from '../db/dao/task-session-run.dao';
import type { ProjectInstructionMemory } from '../db/dao/app-user-project.dao';
import type { AltusUserMemory } from './altus-memory-context-service';
import type { TaskSessionDeliverableArtifactRecord } from './task-session-deliverable-service';
import type { ManagedMcpProvider, ManagedSkillCatalogEntry, ManagedSkillContext } from './altus-managed-shared';
import type { AltusManagedTaskIntentProfile } from './altus-managed-prompt-service';
import type { AltusSessionMemory } from './task-session-altus-memory-service';
import type { SessionSkillState, SkillSelectionInput } from './task-session-skill-state-service';
import type { AgentRuntimeSnapshot } from './agent-runtime-profile-service';

export class AltusRunState {
  status: ManagedRunStatus;
  stopReason: string | null = null;
  startedAt: Date | null = null;
  completedAt: Date | null = null;
  sandboxId: string | null = null;
  workspaceRoot: string | null = null;
  sandboxReused = false;
  deliverables: TaskSessionDeliverableArtifactRecord[] = [];

  constructor(
    readonly input: {
      runId: string;
      sessionId: string;
      userId: string;
      model: string;
      billingTargetKey?: string;
      runtimeSnapshot?: AgentRuntimeSnapshot;
      runtimeTokenSource?: string;
      userInput: string;
      messageType?: 'user_input' | 'user_response';
      mcpToolConfirmationPrompt?: string | null;
      confirmedMcpToolReplay?: {
        confirmationId: string;
        confirmationToken: string;
        confirmationAgentRunId?: string | null;
        toolName: string;
        argumentsJson: Record<string, unknown>;
      } | null;
      sessionTitle?: string | null;
      memoryContextPrompt?: string | null;
      userMemory: AltusUserMemory;
      projectMemory: ProjectInstructionMemory | null;
      sessionAltusMemory: AltusSessionMemory;
      connectors: unknown[];
      mcpProviders: ManagedMcpProvider[];
      skillCatalog: ManagedSkillCatalogEntry[];
      skills: ManagedSkillContext[];
      residentSkillSelections: SkillSelectionInput[];
      sessionSkillState: SessionSkillState;
      taskIntentProfile: AltusManagedTaskIntentProfile;
      clarificationAnswerKind?: string;
      closedClarificationRunId?: string | null;
      closedClarificationToolCallId?: string | null;
    }
  ) {
    this.status = 'queued';
  }

  markRunning(input: { sandboxId: string; workspaceRoot: string; reused: boolean }) {
    this.status = 'running';
    this.startedAt = this.startedAt || new Date();
    this.sandboxId = input.sandboxId;
    this.workspaceRoot = input.workspaceRoot;
    this.sandboxReused = input.reused;
  }

  markWaitingUser() {
    this.status = 'waiting_user';
  }

  markCompleted(input?: { deliverables?: TaskSessionDeliverableArtifactRecord[] }) {
    this.status = 'completed';
    this.completedAt = new Date();
    this.deliverables = Array.isArray(input?.deliverables) ? input.deliverables : this.deliverables;
  }

  markFailed(reason: string) {
    this.status = 'failed';
    this.stopReason = reason;
    this.completedAt = new Date();
  }

  markStopped(reason: string) {
    this.status = 'stopped';
    this.stopReason = reason;
    this.completedAt = new Date();
  }
}
