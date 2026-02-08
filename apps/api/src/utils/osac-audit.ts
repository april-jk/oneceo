export function auditOsacAction(action: string, metadata: Record<string, unknown>) {
  const payload = {
    action,
    at: new Date().toISOString(),
    ...metadata,
  };
  console.log('[OSAC_AUDIT]', JSON.stringify(payload));
}
