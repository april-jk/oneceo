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

