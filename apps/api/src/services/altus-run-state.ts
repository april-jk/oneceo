import type { ManagedRunStatus } from '../db/dao/task-session-run.dao';

export class AltusRunState {
  status: ManagedRunStatus;
  stopReason: string | null = null;
  startedAt: Date | null = null;
  completedAt: Date | null = null;
  sandboxId: string | null = null;
  workspaceRoot: string | null = null;
  sandboxReused = false;

  constructor(
    readonly input: {
      runId: string;
      sessionId: string;
      userId: string;
      model: string;
      userInput: string;
      sessionTitle?: string | null;
      connectors: unknown[];
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

  markCompleted() {
    this.status = 'completed';
    this.completedAt = new Date();
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
