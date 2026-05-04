import { describe, expect, it } from "vitest";
import { normalizeRuntimeEnv } from "./runtime-env";

describe("normalizeRuntimeEnv", () => {
  it("keeps supported runtime env values", () => {
    expect(normalizeRuntimeEnv("dev")).toBe("dev");
    expect(normalizeRuntimeEnv("staging")).toBe("staging");
    expect(normalizeRuntimeEnv("product")).toBe("product");
  });

  it("normalizes case and trims spaces", () => {
    expect(normalizeRuntimeEnv(" DEV ")).toBe("dev");
    expect(normalizeRuntimeEnv(" Staging ")).toBe("staging");
  });

  it("falls back to product for unsupported values", () => {
    expect(normalizeRuntimeEnv("")).toBe("product");
    expect(normalizeRuntimeEnv("local")).toBe("product");
    expect(normalizeRuntimeEnv(undefined)).toBe("product");
  });
});
