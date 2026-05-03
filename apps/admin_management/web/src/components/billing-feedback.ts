export type BillingNotifyTone = 'error' | 'success' | 'warning' | 'info';

export type BillingNotify = (tone: BillingNotifyTone, title: string, message: string) => void;

export async function readBillingResponseError(response: Response, fallback: string) {
  try {
    const data = await response.json();
    if (typeof data?.error === 'string' && data.error.trim()) return data.error;
    if (typeof data?.message === 'string' && data.message.trim()) return data.message;
  } catch {
    // Ignore non-JSON error responses and use the action-specific fallback.
  }
  return fallback;
}

export function getBillingErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
