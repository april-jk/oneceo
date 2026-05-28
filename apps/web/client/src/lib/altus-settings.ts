export type AltusMode = "sandbox" | "managed";
export type VoiceRecognitionProvider = "browser" | "volcengine";

export const ALTUS_MODE_STORAGE_KEY = "altus_mode";
export const DEFAULT_ALTUS_MODE: AltusMode = "managed";
export const VOICE_RECOGNITION_PROVIDER_STORAGE_KEY =
  "voice_recognition_provider";
export const DEFAULT_VOICE_RECOGNITION_PROVIDER: VoiceRecognitionProvider =
  "browser";

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

export function normalizeVoiceRecognitionProvider(
  value: string | null | undefined,
): VoiceRecognitionProvider {
  return value === "volcengine"
    ? "volcengine"
    : DEFAULT_VOICE_RECOGNITION_PROVIDER;
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

export function readVoiceRecognitionProvider(storage?: Storage | null) {
  const targetStorage = resolveStorage(storage);
  if (!targetStorage) {
    return DEFAULT_VOICE_RECOGNITION_PROVIDER;
  }
  try {
    const stored = targetStorage.getItem(VOICE_RECOGNITION_PROVIDER_STORAGE_KEY);
    const normalized = normalizeVoiceRecognitionProvider(stored);
    if (stored !== normalized) {
      targetStorage.setItem(
        VOICE_RECOGNITION_PROVIDER_STORAGE_KEY,
        normalized,
      );
    }
    return normalized;
  } catch {
    return DEFAULT_VOICE_RECOGNITION_PROVIDER;
  }
}

export function writeVoiceRecognitionProvider(
  provider: VoiceRecognitionProvider,
  storage?: Storage | null,
) {
  const targetStorage = resolveStorage(storage);
  if (!targetStorage) {
    return;
  }
  try {
    targetStorage.setItem(
      VOICE_RECOGNITION_PROVIDER_STORAGE_KEY,
      normalizeVoiceRecognitionProvider(provider),
    );
  } catch {
    // ignore storage failures
  }
}
