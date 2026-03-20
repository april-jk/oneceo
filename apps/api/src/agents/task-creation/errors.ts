export class AwaitingUserInputError extends Error {
  constructor(message: string = 'AWAITING_USER_INPUT') {
    super(message);
    this.name = 'AwaitingUserInputError';
    (this as any).__awaitingUserInput = true;
  }
}

export function isAwaitingUserInputError(error: unknown): boolean {
  return Boolean((error as any)?.__awaitingUserInput);
}

export class RecoverableAgentError extends Error {
  constructor(message: string = 'RECOVERABLE_AGENT_ERROR') {
    super(message);
    this.name = 'RecoverableAgentError';
    (this as any).__recoverableAgentError = true;
  }
}

export function isRecoverableAgentError(error: unknown): boolean {
  return Boolean((error as any)?.__recoverableAgentError);
}

export class InterruptedTaskError extends Error {
  constructor(message: string = 'TASK_INTERRUPTED') {
    super(message);
    this.name = 'InterruptedTaskError';
    (this as any).__interruptedTask = true;
  }
}

export function isInterruptedTaskError(error: unknown): boolean {
  return Boolean((error as any)?.__interruptedTask);
}
