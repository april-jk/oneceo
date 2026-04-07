function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isConnectorGuideStartupRecomputeEnabled(
  raw = process.env.CONNECTOR_GUIDE_STARTUP_RECOMPUTE_ENABLED
): boolean {
  return asText(raw).toLowerCase() === 'true';
}

