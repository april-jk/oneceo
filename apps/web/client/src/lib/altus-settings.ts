export type AltusMode = "sandbox" | "managed";

export const ALTUS_MODE_STORAGE_KEY = "altus_mode";
export const DEFAULT_ALTUS_MODE: AltusMode = "managed";

function resolveStorage(provided?: Storage | null): Storage | null {
  if (provided !== undefined) {
    return provided;
  }
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

export function normalizeAltusMode(value: string | null | undefined): AltusMode {
  return value === "sandbox" ? "sandbox" : DEFAULT_ALTUS_MODE;
}

export function readAltusMode(storage?: Storage | null): AltusMode {
  const targetStorage = resolveStorage(storage);
  if (!targetStorage) {
    return DEFAULT_ALTUS_MODE;
  }
  try {
    const stored = targetStorage.getItem(ALTUS_MODE_STORAGE_KEY);
    const normalized = normalizeAltusMode(stored);
    if (stored !== normalized) {
      targetStorage.setItem(ALTUS_MODE_STORAGE_KEY, normalized);
    }
    return normalized;
  } catch {
    return DEFAULT_ALTUS_MODE;
  }
}

export function writeAltusMode(mode: AltusMode, storage?: Storage | null) {
  const targetStorage = resolveStorage(storage);
  if (!targetStorage) {
    return;
  }
  try {
    targetStorage.setItem(ALTUS_MODE_STORAGE_KEY, normalizeAltusMode(mode));
  } catch {
    // ignore storage failures
  }
}
