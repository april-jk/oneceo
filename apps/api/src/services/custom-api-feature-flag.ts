export const CUSTOM_API_DISABLED_ERROR = 'custom_api_disabled';

export function isCustomApiEnabled(): boolean {
  return String(process.env.ONECEO_CUSTOM_API_ENABLED || '').trim().toLowerCase() === 'true';
}

export function assertCustomApiEnabled(): void {
  if (!isCustomApiEnabled()) {
    throw new Error(CUSTOM_API_DISABLED_ERROR);
  }
}
