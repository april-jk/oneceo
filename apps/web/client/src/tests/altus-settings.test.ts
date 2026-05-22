import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALTUS_MODE,
  DEFAULT_VOICE_RECOGNITION_PROVIDER,
  normalizeAltusMode,
  normalizeVoiceRecognitionProvider,
  readAltusMode,
  readVoiceRecognitionProvider,
  writeAltusMode,
  writeVoiceRecognitionProvider,
} from "@/lib/altus-settings";

function createStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
}

describe("altus settings", () => {
  it("defaults missing altus mode to managed and persists it", () => {
    const storage = createStorage();

    expect(readAltusMode(storage)).toBe(DEFAULT_ALTUS_MODE);
    expect(storage.getItem("altus_mode")).toBe("managed");
  });

  it("keeps explicit sandbox mode", () => {
    const storage = createStorage({ altus_mode: "sandbox" });

    expect(readAltusMode(storage)).toBe("sandbox");
    expect(storage.getItem("altus_mode")).toBe("sandbox");
  });

  it("normalizes invalid mode back to managed", () => {
    const storage = createStorage({ altus_mode: "broken" });

    expect(readAltusMode(storage)).toBe("managed");
    expect(storage.getItem("altus_mode")).toBe("managed");
  });

  it("writes sandbox explicitly when requested", () => {
    const storage = createStorage();

    writeAltusMode("sandbox", storage);

    expect(storage.getItem("altus_mode")).toBe("sandbox");
  });

  it("treats non-sandbox values as managed", () => {
    expect(normalizeAltusMode("managed")).toBe("managed");
    expect(normalizeAltusMode("sandbox")).toBe("sandbox");
    expect(normalizeAltusMode("")).toBe("managed");
  });

  it("defaults missing voice recognition provider to browser", () => {
    const storage = createStorage();

    expect(readVoiceRecognitionProvider(storage)).toBe(
      DEFAULT_VOICE_RECOGNITION_PROVIDER,
    );
    expect(storage.getItem("voice_recognition_provider")).toBe("browser");
  });

  it("keeps explicit volcengine provider", () => {
    const storage = createStorage({
      voice_recognition_provider: "volcengine",
    });

    expect(readVoiceRecognitionProvider(storage)).toBe("volcengine");
    expect(storage.getItem("voice_recognition_provider")).toBe("volcengine");
  });

  it("normalizes invalid voice provider back to browser", () => {
    const storage = createStorage({
      voice_recognition_provider: "broken",
    });

    expect(readVoiceRecognitionProvider(storage)).toBe("browser");
    expect(storage.getItem("voice_recognition_provider")).toBe("browser");
  });

  it("writes browser and volcengine providers explicitly", () => {
    const storage = createStorage();

    writeVoiceRecognitionProvider("volcengine", storage);
    expect(storage.getItem("voice_recognition_provider")).toBe("volcengine");

    writeVoiceRecognitionProvider("browser", storage);
    expect(storage.getItem("voice_recognition_provider")).toBe("browser");
  });

  it("treats non-volcengine values as browser", () => {
    expect(normalizeVoiceRecognitionProvider("browser")).toBe("browser");
    expect(normalizeVoiceRecognitionProvider("volcengine")).toBe("volcengine");
    expect(normalizeVoiceRecognitionProvider("")).toBe("browser");
  });
});
