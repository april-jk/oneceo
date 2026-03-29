import type { ManagedRunStatus } from '../db/dao/task-session-run.dao';
import type { TaskSessionDeliverableArtifactRecord } from './task-session-deliverable-service';
import type { ManagedSkillContext } from './altus-managed-shared';

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
      userInput: string;
      sessionTitle?: string | null;
      connectors: unknown[];
      skills: ManagedSkillContext[];
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
