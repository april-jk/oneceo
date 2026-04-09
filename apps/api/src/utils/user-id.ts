export function normalizeUserId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isCanonicalAppUserId(value: unknown): boolean {
  const normalized = normalizeUserId(value);
  if (!normalized) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized);
}

export function isLegacyClientUserId(value: unknown): boolean {
  const normalized = normalizeUserId(value);
  if (!normalized) return false;
  return !isCanonicalAppUserId(normalized);
}

export function isSameUserId(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeUserId(left);
  const normalizedRight = normalizeUserId(right);
  return Boolean(normalizedLeft) && normalizedLeft === normalizedRight;
}
